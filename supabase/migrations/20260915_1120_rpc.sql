-- ============================================================================
-- DivvyUp — 03. RPC
--
-- CẢNH BÁO CHUNG: mọi hàm SECURITY DEFINER dưới đây chạy với quyền chủ sở hữu
-- và BỎ QUA RLS. Dòng đầu tiên của mỗi hàm phải là kiểm quyền. Quên bước đó là
-- tự tạo cửa hậu vòng qua toàn bộ hệ thống policy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tạo nhóm kèm sẵn N thành viên.
-- Đáp ứng yêu cầu "mỗi nhóm thiết đặt sẵn số lượng người": khai số người là có
-- ngay từng ấy chỗ trống được đặt tên tạm, sửa tên sau.
-- ---------------------------------------------------------------------------
create or replace function public.create_trip_group(
  p_trip_id      uuid,
  p_name         text,
  p_member_count integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_offset   integer;
  i          integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Bạn không thuộc chuyến đi này.' using errcode = '42501';
  end if;
  if p_member_count < 0 or p_member_count > 100 then
    raise exception 'Số người trong nhóm phải từ 0 tới 100.' using errcode = '22023';
  end if;

  insert into public.trip_groups (trip_id, name, sort_order)
  values (
    p_trip_id,
    p_name,
    coalesce((select max(sort_order) + 1 from public.trip_groups where trip_id = p_trip_id), 0)
  )
  returning id into v_group_id;

  select coalesce(max(sort_order) + 1, 0) into v_offset
  from public.trip_members where trip_id = p_trip_id;

  for i in 1 .. p_member_count loop
    insert into public.trip_members (trip_id, group_id, display_name, sort_order)
    values (p_trip_id, v_group_id, 'Thành viên ' || i, v_offset + i - 1);
  end loop;

  return v_group_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- Tạo khoản chi. Ghi expenses + expense_shares trong MỘT transaction.
-- Nhiều lệnh insert rời rạc sẽ để lại khoản chi không có phần chia khi lỗi
-- giữa chừng, và số dư cả chuyến sai từ đó về sau mà không ai biết.
-- ---------------------------------------------------------------------------
create or replace function public.create_expense(
  p_trip_id      uuid,
  p_description  text,
  p_amount_minor bigint,
  p_paid_by      uuid,
  p_shares       jsonb,   -- [{"member_id":"<uuid>","amount_minor":123}, ...]
  p_split_mode   public.split_mode default 'equal',
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
  v_owed       bigint;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Bạn không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  select t.currency into v_currency
  from public.trips t
  where t.id = p_trip_id and t.deleted_at is null;

  if not found then
    -- Cùng thông báo cho "không tồn tại" và "không có quyền": phân biệt sẽ
    -- tiết lộ sự tồn tại của chuyến đi mà người gọi không được thấy.
    raise exception 'Chuyến đi không tồn tại hoặc đã bị xoá.' using errcode = '42501';
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Khoản chi phải lớn hơn 0.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'Phải có ít nhất một người gánh khoản chi.' using errcode = '22023';
  end if;

  -- Bất biến tổng, kiểm TRƯỚC khi ghi.
  select coalesce(sum((item ->> 'amount_minor')::bigint), 0) into v_owed
  from jsonb_array_elements(p_shares) as item;

  if v_owed <> p_amount_minor then
    raise exception
      'Tổng phần chia (%) khác tổng khoản chi (%).', v_owed, p_amount_minor
      using errcode = 'check_violation';
  end if;

  -- Người trả và mọi người gánh đều phải thuộc chuyến đi và còn hoạt động.
  if not exists (
    select 1 from public.trip_members tm
    where tm.id = p_paid_by and tm.trip_id = p_trip_id and tm.removed_at is null
  ) then
    raise exception 'Người đại diện trả tiền không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_shares) as item
    where not exists (
      select 1 from public.trip_members tm
      where tm.id = (item ->> 'member_id')::uuid
        and tm.trip_id = p_trip_id
        and tm.removed_at is null
    )
  ) then
    raise exception 'Danh sách có người không thuộc chuyến đi.' using errcode = '42501';
  end if;

  insert into public.expenses
    (trip_id, currency, description, amount_minor, paid_by, split_mode, paid_at, created_by)
  values
    (p_trip_id, v_currency, p_description, p_amount_minor, p_paid_by, p_split_mode, p_paid_at, v_uid)
  returning id into v_expense_id;

  insert into public.expense_shares (expense_id, member_id, amount_minor)
  select v_expense_id,
         (item ->> 'member_id')::uuid,
         (item ->> 'amount_minor')::bigint
  from jsonb_array_elements(p_shares) as item;

  return v_expense_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- Sửa khoản chi: thay toàn bộ phần chia thay vì cộng trừ theo delta.
-- Tính lại từ đầu là cách duy nhất giữ số dư không trôi.
-- ---------------------------------------------------------------------------
create or replace function public.update_expense(
  p_expense_id   uuid,
  p_description  text,
  p_amount_minor bigint,
  p_paid_by      uuid,
  p_shares       jsonb,
  p_split_mode   public.split_mode,
  p_paid_at      timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_trip_id uuid;
  v_owed    bigint;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;

  select e.trip_id into v_trip_id
  from public.expenses e
  where e.id = p_expense_id and e.deleted_at is null;

  if not found then
    raise exception 'Khoản chi không tồn tại hoặc đã bị huỷ.' using errcode = '42501';
  end if;
  if not public.is_trip_member(v_trip_id) then
    raise exception 'Bạn không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  select coalesce(sum((item ->> 'amount_minor')::bigint), 0) into v_owed
  from jsonb_array_elements(p_shares) as item;

  if v_owed <> p_amount_minor then
    raise exception
      'Tổng phần chia (%) khác tổng khoản chi (%).', v_owed, p_amount_minor
      using errcode = 'check_violation';
  end if;

  update public.expenses
  set description  = p_description,
      amount_minor = p_amount_minor,
      paid_by      = p_paid_by,
      split_mode   = p_split_mode,
      paid_at      = p_paid_at
  where id = p_expense_id;

  delete from public.expense_shares where expense_id = p_expense_id;

  insert into public.expense_shares (expense_id, member_id, amount_minor)
  select p_expense_id,
         (item ->> 'member_id')::uuid,
         (item ->> 'amount_minor')::bigint
  from jsonb_array_elements(p_shares) as item;

  -- Trigger bất biến và trigger kiểm thành viên chạy lúc COMMIT.
end;
$$;


create or replace function public.void_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;

  select e.trip_id into v_trip_id
  from public.expenses e
  where e.id = p_expense_id and e.deleted_at is null;

  if not found then
    raise exception 'Khoản chi không tồn tại hoặc đã bị huỷ.' using errcode = '42501';
  end if;
  if not public.is_trip_member(v_trip_id) then
    raise exception 'Bạn không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  update public.expenses set deleted_at = now() where id = p_expense_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- MỜI SAU — xem trước chuyến đi bằng mã, rồi nhận đúng một chỗ trong danh sách
--
-- Người được mời chưa phải thành viên nên RLS chặn họ đọc bất cứ thứ gì. Hai
-- hàm này là cửa duy nhất, và chỉ mở khi có mã mời đúng.
-- ---------------------------------------------------------------------------
create or replace function public.preview_trip_by_code(p_join_code text)
returns table (
  trip_id     uuid,
  trip_name   text,
  member_id   uuid,
  member_name text,
  claimed     boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select t.id, t.name, tm.id, tm.display_name, tm.user_id is not null
  from public.trips t
  join public.trip_members tm on tm.trip_id = t.id and tm.removed_at is null
  where t.join_code = upper(trim(p_join_code))
    and t.deleted_at is null
  order by tm.sort_order, tm.display_name;
$$;


create or replace function public.join_trip_by_code(
  p_join_code text,
  p_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_trip_id uuid;
  v_taken   uuid;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;

  select t.id into v_trip_id
  from public.trips t
  where t.join_code = upper(trim(p_join_code)) and t.deleted_at is null;

  if not found then
    raise exception 'Mã tham gia không đúng.' using errcode = '42501';
  end if;

  select tm.user_id into v_taken
  from public.trip_members tm
  where tm.id = p_member_id and tm.trip_id = v_trip_id and tm.removed_at is null;

  if not found then
    raise exception 'Không tìm thấy người này trong chuyến đi.' using errcode = '42501';
  end if;
  if v_taken is not null then
    raise exception 'Chỗ này đã có người nhận.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.trip_members tm
    where tm.trip_id = v_trip_id and tm.user_id = v_uid and tm.removed_at is null
  ) then
    raise exception 'Bạn đã có mặt trong chuyến đi này rồi.' using errcode = '42501';
  end if;

  -- Trigger protect_trip_member_identity chặn mọi thay đổi user_id; cờ cục bộ
  -- này là cửa duy nhất, và nó chỉ tồn tại trong transaction hiện tại.
  perform set_config('divvyup.allow_identity_change', 'on', true);

  update public.trip_members
  set user_id = v_uid
  where id = p_member_id;

  return v_trip_id;
end;
$$;


revoke execute on function public.create_trip_group(uuid, text, integer) from public;
revoke execute on function
  public.create_expense(uuid, text, bigint, uuid, jsonb, public.split_mode, timestamptz) from public;
revoke execute on function
  public.update_expense(uuid, text, bigint, uuid, jsonb, public.split_mode, timestamptz) from public;
revoke execute on function public.void_expense(uuid) from public;
revoke execute on function public.preview_trip_by_code(text) from public;
revoke execute on function public.join_trip_by_code(text, uuid) from public;

grant execute on function public.create_trip_group(uuid, text, integer) to authenticated;
grant execute on function
  public.create_expense(uuid, text, bigint, uuid, jsonb, public.split_mode, timestamptz) to authenticated;
grant execute on function
  public.update_expense(uuid, text, bigint, uuid, jsonb, public.split_mode, timestamptz) to authenticated;
grant execute on function public.void_expense(uuid) to authenticated;
grant execute on function public.preview_trip_by_code(text) to authenticated;
grant execute on function public.join_trip_by_code(text, uuid) to authenticated;
