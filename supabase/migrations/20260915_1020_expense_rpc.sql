-- ============================================================================
-- DivvyUp — 03. RPC tạo và huỷ khoản chi
--
-- Tạo khoản chi đụng ba bảng. Nếu client gọi ba lệnh insert rời rạc, một lỗi
-- mạng giữa chừng sẽ để lại khoản chi không có phần chia — và số dư của cả
-- nhóm sai từ đó về sau mà không ai biết. Hàm này gói cả ba vào một transaction.
--
-- CẢNH BÁO VỀ SECURITY DEFINER: hàm chạy với quyền chủ sở hữu và BỎ QUA RLS.
-- Vì vậy dòng đầu tiên của mỗi hàm phải là kiểm quyền. Quên bước đó là tự tạo
-- cửa hậu vòng qua toàn bộ hệ thống policy.
-- ============================================================================

create or replace function public.create_expense(
  p_group_id     uuid,
  p_description  text,
  p_amount_minor bigint,
  p_payments     jsonb,   -- [{"user_id":"<uuid>","amount_minor":123}, ...]
  p_shares       jsonb,   -- [{"user_id":"<uuid>","amount_minor":123}, ...]
  p_paid_at      timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_currency   public.currency_code;
  v_expense_id uuid;
  v_paid       bigint;
  v_owed       bigint;
begin
  -- ---- 1. KIỂM QUYỀN TRƯỚC MỌI THỨ KHÁC -----------------------------------
  if v_uid is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;

  if not public.is_group_member(p_group_id) then
    raise exception 'Bạn không phải thành viên của nhóm này.' using errcode = '42501';
  end if;

  select g.currency into v_currency
  from public.groups g
  where g.id = p_group_id and g.deleted_at is null;

  if not found then
    -- Cùng một thông báo cho "không tồn tại" và "không có quyền": không tiết lộ
    -- sự tồn tại của nhóm mà người gọi không được thấy.
    raise exception 'Nhóm không tồn tại hoặc đã bị xoá.' using errcode = '42501';
  end if;

  -- ---- 2. XÁC THỰC DỮ LIỆU -------------------------------------------------
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Khoản chi phải lớn hơn 0.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'Phải có ít nhất một người ứng tiền.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'Phải có ít nhất một người gánh khoản chi.' using errcode = '22023';
  end if;

  -- ---- 3. BẤT BIẾN TỔNG, KIỂM TRƯỚC KHI GHI -------------------------------
  select coalesce(sum((item ->> 'amount_minor')::bigint), 0) into v_paid
  from jsonb_array_elements(p_payments) as item;

  select coalesce(sum((item ->> 'amount_minor')::bigint), 0) into v_owed
  from jsonb_array_elements(p_shares) as item;

  if v_paid <> p_amount_minor then
    raise exception
      'Tổng tiền ứng (%) khác tổng khoản chi (%).', v_paid, p_amount_minor
      using errcode = 'check_violation';
  end if;

  if v_owed <> p_amount_minor then
    raise exception
      'Tổng phần chia (%) khác tổng khoản chi (%).', v_owed, p_amount_minor
      using errcode = 'check_violation';
  end if;

  -- ---- 4. MỌI NGƯỜI LIÊN QUAN PHẢI THUỘC NHÓM -----------------------------
  -- Không có bước này thì một thành viên có thể gán nợ cho người ngoài nhóm.
  if exists (
    select 1
    from jsonb_array_elements(p_payments || p_shares) as item
    where not exists (
      select 1
      from public.group_members gm
      where gm.group_id = p_group_id
        and gm.user_id = (item ->> 'user_id')::uuid
        and gm.left_at is null
    )
  ) then
    raise exception 'Danh sách có người không thuộc nhóm.' using errcode = '42501';
  end if;

  -- ---- 5. GHI — cả ba bảng trong một transaction ---------------------------
  insert into public.expenses
    (group_id, currency, description, amount_minor, paid_at, created_by)
  values
    (p_group_id, v_currency, p_description, p_amount_minor, p_paid_at, v_uid)
  returning id into v_expense_id;

  insert into public.expense_payments (expense_id, user_id, amount_minor)
  select v_expense_id,
         (item ->> 'user_id')::uuid,
         (item ->> 'amount_minor')::bigint
  from jsonb_array_elements(p_payments) as item;

  insert into public.expense_shares (expense_id, user_id, amount_minor)
  select v_expense_id,
         (item ->> 'user_id')::uuid,
         (item ->> 'amount_minor')::bigint
  from jsonb_array_elements(p_shares) as item;

  -- Trigger bất biến chạy lúc COMMIT và sẽ chặn nếu có gì lệch.
  return v_expense_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- Huỷ khoản chi — xoá mềm, giữ lại để truy vết
-- ---------------------------------------------------------------------------
create or replace function public.void_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_group_id uuid;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;

  select e.group_id into v_group_id
  from public.expenses e
  where e.id = p_expense_id and e.deleted_at is null;

  if not found then
    raise exception 'Khoản chi không tồn tại hoặc đã bị huỷ.' using errcode = '42501';
  end if;

  if not public.is_group_member(v_group_id) then
    raise exception 'Bạn không phải thành viên của nhóm này.' using errcode = '42501';
  end if;

  update public.expenses
  set deleted_at = now()
  where id = p_expense_id;
end;
$$;


revoke execute on function
  public.create_expense(uuid, text, bigint, jsonb, jsonb, timestamptz) from public;
revoke execute on function public.void_expense(uuid) from public;

grant execute on function
  public.create_expense(uuid, text, bigint, jsonb, jsonb, timestamptz) to authenticated;
grant execute on function public.void_expense(uuid) to authenticated;
