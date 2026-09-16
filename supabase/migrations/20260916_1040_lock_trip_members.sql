-- ============================================================================
-- DivvyUp — 09. Khoá thành viên: chỉ được thêm và đổi tên
--
-- LỖI GỐC
--   View trip_balances lọc `tm.removed_at is null`. Xoá mềm một thành viên vẫn
--   còn tên trong khoản chi cũ thì phần nợ/được nhận của họ biến mất khỏi bảng
--   số dư — tổng của chuyến không còn bằng 0, và app báo "Dữ liệu số dư không
--   nhất quán" cho CẢ chuyến đi, không chỉ riêng người đó.
--
--   Chặn ở UI là không đủ: policy UPDATE vẫn cho mọi thành viên sửa removed_at
--   qua PostgREST. Phải chặn ở tầng DB.
--
-- LỖI THỨ HAI, phát hiện khi rà cùng chỗ
--   Policy trip_members_update_member cho MỌI thành viên sửa cột role. Một
--   thành viên thường có thể tự nâng mình lên 'owner' bằng một lệnh gọi, rồi
--   đổi tên hay xoá chuyến đi của người khác.
--
-- Rollback: drop trigger trip_members_guard_changes; drop function
--           public.guard_trip_member_changes().
-- ============================================================================

-- Khôi phục thành viên đã bị xoá mềm NHƯNG vẫn dính khoản chi/tất toán còn hiệu
-- lực — đúng những người làm số dư lệch. KHÔNG khôi phục tất cả: người bị gỡ
-- để thu hồi quyền truy cập (còn user_id) sẽ lấy lại quyền đọc cả chuyến, và
-- tên gõ nhầm đã xoá sẽ hiện lại trong form chia đều.
-- Chạy trước khi dựng trigger, vì sau đó chính lệnh này cũng bị chặn.
update public.trip_members tm
set removed_at = null
where tm.removed_at is not null
  and (
    exists (select 1 from public.expenses e
            where e.paid_by = tm.id and e.deleted_at is null)
    or exists (select 1 from public.expense_shares es
               join public.expenses e on e.id = es.expense_id
               where es.member_id = tm.id and e.deleted_at is null)
    or exists (select 1 from public.settlements s
               where (s.from_member = tm.id or s.to_member = tm.id)
                 and s.deleted_at is null)
  );

create or replace function public.guard_trip_member_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.removed_at is distinct from old.removed_at then
    raise exception
      'Không thể xoá thành viên khỏi chuyến đi — người này có thể đang gắn với khoản chi. Chỉ được đổi tên.'
      using errcode = '42501';
  end if;

  -- auth.uid() null: SQL Editor/psql. (RPC SECURITY DEFINER gọi qua PostgREST
  -- VẪN có auth.uid().) Migration 20260917_1000 thay trigger này bằng bản chặt
  -- hơn, có phân biệt phiên quản trị đúng cách.
  if new.role is distinct from old.role
     and (select auth.uid()) is not null
     and not public.is_trip_owner(new.trip_id) then
    raise exception 'Chỉ chủ chuyến đi mới đổi được vai trò thành viên.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trip_members_guard_changes
  before update on public.trip_members
  for each row execute function public.guard_trip_member_changes();
