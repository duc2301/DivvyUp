-- ============================================================================
-- DivvyUp — 11. Hồ sơ (ảnh đại diện, mã QR nhận tiền) và khoản chi "đã xong"
--
-- Chạy SAU 20260917_1000_harden_members_settlements.sql.
--
-- 1. HỒ SƠ
--    profiles.avatar_path       — file trong bucket `avatars` (công khai)
--    profiles.payment_qr_path   — file trong bucket `payment-qr` (RIÊNG TƯ)
--    profiles.payment_note      — ngân hàng / số tài khoản, tuỳ chọn
--
--    Ai đọc được?
--      - Ảnh đại diện: bucket công khai, tên file ngẫu nhiên. Ảnh đại diện vốn
--        để người khác nhìn; bucket riêng tư thì mỗi dòng thành viên phải xin
--        một signed URL, danh sách dài sẽ chậm rõ rệt.
--      - Mã QR: CHỈ chính chủ và người đang đi chung ít nhất một chuyến
--        (shares_trip_with). QR chứa số tài khoản — không để ai có link là xem.
--    Ai ghi được? Chỉ chính chủ, và chỉ trong thư mục mang đúng id của mình.
--    Cột path có CHECK buộc bắt đầu bằng id của dòng profile: không thể trỏ
--    ảnh đại diện của mình sang file của người khác.
--
-- 2. KHOẢN CHI "ĐÃ XONG"
--    expenses.settled_at / settled_by. Khoản đã xong KHÔNG tính vào số dư
--    (view trip_balances), nhưng vẫn hiện trong danh sách và vẫn tính vào tổng
--    chi của chuyến — tiền đó vẫn đã được tiêu.
--    Bất biến "tổng số dư của chuyến = 0" vẫn giữ: bỏ cả khoản chi thì bỏ cả
--    phần người trả được nhận lẫn phần mọi người nợ, hai vế triệt tiêu nhau.
--    Đánh dấu qua RPC set_expense_settled (ghi cả ai đánh dấu).
--
--    Ba quy tắc giữ số dư đúng (tìm ra khi audit):
--    a) Chuyến ĐÃ CÓ TẤT TOÁN thì không đánh dấu xong được. View bỏ phần nợ của
--       khoản đã xong nhưng vẫn cộng tất toán, nên tiền đã trả qua tất toán bị
--       tính ngược thành nợ — người đã trả đủ lại hiện là chủ nợ.
--    b) Sửa khoản chi (update_expense) tự BỎ đánh dấu xong. Giữ nguyên thì số
--       tiền mới không bao giờ vào số dư: hoá đơn tăng từ 300k lên 450k, phần
--       150k chênh lệch không ai phải trả mà không ai biết.
--    c) settled_at/settled_by CHỈ đổi được qua hai RPC trên. Policy UPDATE của
--       expenses cho mọi thành viên sửa thẳng bảng, đủ để ghi "A đã xác nhận
--       xong" dưới tên người khác.
--
-- Rollback:
--   drop trigger if exists expenses_guard_settled on public.expenses;
--   drop function if exists public.guard_expense_settled_columns();
--   apply lại update_expense trong 20260915_1120_rpc.sql;
--   drop function if exists public.set_expense_settled(uuid, boolean);
--   apply lại view trong 20260916_1000_fix_trip_balances_type.sql;
--   alter table public.expenses drop column settled_by, drop column settled_at;
--   drop policy ... (6 policy storage bên dưới); drop function public.can_view_payment_qr(text);
--   delete from storage.buckets where id in ('avatars', 'payment-qr');  -- chỉ khi đã rỗng
--   alter table public.profiles drop column payment_note, drop column payment_qr_path,
--     drop column avatar_path;
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. profiles
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists payment_qr_path text,
  add column if not exists payment_note text;

-- drop if exists trước: chạy lại migration không lỗi "constraint already exists".
alter table public.profiles
  drop constraint if exists profiles_avatar_path_own,
  drop constraint if exists profiles_payment_qr_path_own,
  drop constraint if exists profiles_payment_note_length;

alter table public.profiles
  add constraint profiles_avatar_path_own
    check (avatar_path is null or avatar_path like id::text || '/%'),
  add constraint profiles_payment_qr_path_own
    check (payment_qr_path is null or payment_qr_path like id::text || '/%'),
  add constraint profiles_payment_note_length
    check (payment_note is null or length(payment_note) <= 120);

-- Policy profiles_update_self đã giới hạn chính chủ; ba cột mới không cần siết thêm.


-- ---------------------------------------------------------------------------
-- 2. Storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('payment-qr', 'payment-qr', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Tên thư mục đầu tiên phải là UUID hợp lệ TRƯỚC khi ép kiểu: ép thẳng một tên
-- bất kỳ sang uuid làm cả câu truy vấn storage báo lỗi, chứ không chỉ loại dòng đó.
create or replace function public.can_view_payment_qr(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_folder text := split_part(p_object_name, '/', 1);
begin
  if (select auth.uid()) is null then
    return false;
  end if;
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if v_folder::uuid = (select auth.uid()) then
    return true;
  end if;
  -- Không dùng shares_trip_with: hàm đó không loại chuyến đã xoá, mà ở đây là
  -- số tài khoản ngân hàng — xoá chuyến đi thì phải thôi xem được.
  return exists (
    select 1
    from public.trip_members me
    join public.trip_members other on other.trip_id = me.trip_id
    join public.trips t on t.id = me.trip_id
    where me.user_id = (select auth.uid())
      and me.removed_at is null
      and other.user_id = v_folder::uuid
      and other.removed_at is null
      and t.deleted_at is null
  );
end;
$$;

revoke execute on function public.can_view_payment_qr(text) from public, anon;
grant execute on function public.can_view_payment_qr(text) to authenticated;

-- avatars: đọc công khai qua URL bucket public. Policy SELECT cho chính chủ vẫn
-- cần vì lệnh xoá file cũ của Storage API đọc object trước khi xoá.
drop policy if exists "avatars_select_own" on storage.objects;
create policy "avatars_select_own"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "payment_qr_select_self_or_tripmate" on storage.objects;
create policy "payment_qr_select_self_or_tripmate"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'payment-qr' and public.can_view_payment_qr(name));

drop policy if exists "payment_qr_insert_own" on storage.objects;
create policy "payment_qr_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'payment-qr' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "payment_qr_delete_own" on storage.objects;
create policy "payment_qr_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'payment-qr' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Không có policy UPDATE: app luôn tải lên file tên mới rồi xoá file cũ, không
-- ghi đè. Đổi ảnh bằng tên mới cũng tránh được ảnh cũ còn nằm trong bộ nhớ đệm.


-- ---------------------------------------------------------------------------
-- 3. Khoản chi "đã xong"
-- ---------------------------------------------------------------------------
alter table public.expenses
  add column if not exists settled_at timestamptz,
  add column if not exists settled_by uuid references public.profiles (id);

alter table public.expenses
  drop constraint if exists expenses_settled_consistent;

alter table public.expenses
  add constraint expenses_settled_consistent
    check ((settled_at is null) = (settled_by is null));

create or replace function public.set_expense_settled(p_expense_id uuid, p_settled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_trip_id    uuid;
  v_payer_user uuid;
  v_created_by uuid;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;

  select e.trip_id, tm.user_id, e.created_by
    into v_trip_id, v_payer_user, v_created_by
  from public.expenses e
  join public.trip_members tm on tm.id = e.paid_by
  where e.id = p_expense_id and e.deleted_at is null;

  if not found then
    raise exception 'Khoản chi không tồn tại hoặc đã bị huỷ.' using errcode = '42501';
  end if;
  if not public.is_trip_member(v_trip_id) then
    raise exception 'Bạn không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  -- Đánh dấu xong = xoá nợ của mọi người trong khoản này. Chỉ người ĐƯỢC NHẬN
  -- tiền mới có quyền xác nhận "đã nhận đủ": người đã trả (nếu đã vào app), hoặc
  -- chủ chuyến, hoặc — khi người trả chưa có tài khoản — người đã ghi khoản chi.
  -- Không có chốt này, người đang nợ tự bấm là hết nợ.
  -- Bỏ đánh dấu thì ai cũng được: chiều đó chỉ làm nợ hiện lại.
  if p_settled
     and not public.is_trip_owner(v_trip_id)
     and v_payer_user is distinct from v_uid
     and not (v_payer_user is null and v_created_by = v_uid) then
    raise exception
      'Chỉ người đã trả tiền khoản này (hoặc chủ chuyến) mới đánh dấu đã xong được.'
      using errcode = '42501';
  end if;

  if p_settled and exists (
    select 1 from public.settlements s
    where s.trip_id = v_trip_id and s.deleted_at is null
  ) then
    raise exception
      'Chuyến đi đã ghi tất toán nên không đánh dấu từng khoản đã xong được — số dư sẽ bị tính hai lần.'
      using errcode = '22023';
  end if;

  perform set_config('divvyup.allow_settle_change', 'on', true);

  update public.expenses
  set settled_at = case when p_settled then coalesce(settled_at, now()) else null end,
      settled_by = case when p_settled then coalesce(settled_by, v_uid) else null end
  where id = p_expense_id;
end;
$$;

revoke execute on function public.set_expense_settled(uuid, boolean) from public, anon;
grant execute on function public.set_expense_settled(uuid, boolean) to authenticated;


-- Quy tắc (c): chặn đổi hai cột "đã xong" ngoài RPC.
create or replace function public.guard_expense_settled_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.settled_at is distinct from old.settled_at or new.settled_by is distinct from old.settled_by)
     and coalesce(current_setting('divvyup.allow_settle_change', true), 'off') <> 'on'
     and not public.is_privileged_session() then
    raise exception 'Chỉ đánh dấu "đã xong" qua ứng dụng.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_guard_settled on public.expenses;

create trigger expenses_guard_settled
  before update on public.expenses
  for each row execute function public.guard_expense_settled_columns();


-- Quy tắc (b): bản sao update_expense của 20260915_1120, thêm đúng hai việc —
-- bật cờ cho phép đổi cột "đã xong" và bỏ đánh dấu. Chữ ký giữ nguyên nên
-- `create or replace` thay tại chỗ, app không phải đổi gì.
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

  perform set_config('divvyup.allow_settle_change', 'on', true);

  update public.expenses
  set description  = p_description,
      amount_minor = p_amount_minor,
      paid_by      = p_paid_by,
      split_mode   = p_split_mode,
      paid_at      = p_paid_at,
      settled_at   = null,
      settled_by   = null
  where id = p_expense_id;

  delete from public.expense_shares where expense_id = p_expense_id;

  insert into public.expense_shares (expense_id, member_id, amount_minor)
  select p_expense_id,
         (item ->> 'member_id')::uuid,
         (item ->> 'amount_minor')::bigint
  from jsonb_array_elements(p_shares) as item;
end;
$$;


-- Số dư bỏ qua khoản đã xong. Giữ nguyên tên và kiểu cột nên `create or replace`
-- được, không phải drop view.
create or replace view public.trip_balances
with (security_invoker = true) as
with active_expenses as (
  select id, trip_id, paid_by, amount_minor
  from public.expenses
  where deleted_at is null
    and settled_at is null
),
paid as (
  select trip_id, paid_by as member_id, sum(amount_minor) as amount
  from active_expenses
  group by trip_id, paid_by
),
owed as (
  select ae.trip_id, es.member_id, sum(es.amount_minor) as amount
  from active_expenses ae
  join public.expense_shares es on es.expense_id = ae.id
  group by ae.trip_id, es.member_id
),
settled_out as (
  select trip_id, from_member as member_id, sum(amount_minor) as amount
  from public.settlements where deleted_at is null
  group by trip_id, from_member
),
settled_in as (
  select trip_id, to_member as member_id, sum(amount_minor) as amount
  from public.settlements where deleted_at is null
  group by trip_id, to_member
)
select
  tm.trip_id,
  tm.id as member_id,
  tm.display_name,
  tm.group_id,
  t.currency,
  (
    coalesce(p.amount, 0)
      - coalesce(o.amount, 0)
      + coalesce(so.amount, 0)
      - coalesce(si.amount, 0)
  )::bigint as net_minor
from public.trip_members tm
join public.trips t on t.id = tm.trip_id
left join paid        p  on p.trip_id  = tm.trip_id and p.member_id  = tm.id
left join owed        o  on o.trip_id  = tm.trip_id and o.member_id  = tm.id
left join settled_out so on so.trip_id = tm.trip_id and so.member_id = tm.id
left join settled_in  si on si.trip_id = tm.trip_id and si.member_id = tm.id
where tm.removed_at is null
  and t.deleted_at is null;

grant select on public.trip_balances to authenticated;
