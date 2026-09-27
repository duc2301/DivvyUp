-- ============================================================================
-- DivvyUp — 13. Lưu trữ chuyến đi theo từng người + bịt đường xoá/sửa thẳng
--
-- Chạy SAU 20260925_1000_trip_collab_notes_history.sql.
--
-- 1. trip_archives — LƯU TRỮ CÁ NHÂN.
--    Mỗi người tự cất chuyến đi khỏi danh sách chính của CHÍNH MÌNH; người khác
--    không bị ảnh hưởng. Đây là tuỳ chọn hiển thị, không phải dữ liệu của chuyến:
--    không đụng trips, không đổi quyền xem, không ẩn khoản chi nào.
--    Một dòng = "tôi đã lưu trữ chuyến này". Bỏ lưu trữ = xoá dòng (xoá cứng là
--    đúng ở đây: không có gì cần giữ lịch sử). Không có UPDATE.
--    Chỉ người đang thuộc chuyến (hoặc người tạo) mới thêm được dòng cho chuyến
--    đó — không dò được id chuyến người khác qua lỗi khoá ngoại/khoá chính.
--
-- 2. BỊT XOÁ MỀM / SỬA THẲNG CHUYẾN ĐI QUA API.
--    Policy trips_update_owner_or_creator phủ cả dòng, nên chủ chuyến — và cả
--    NGƯỜI TẠO đã bị hạ quyền/rời chuyến (vế created_by) — gọi thẳng PostgREST
--    đặt trips.deleted_at được: cả nhóm mất chuyến đi cùng toàn bộ lịch sử chi
--    tiêu. Cũng sửa thẳng được tên/ngày/địa điểm, vòng qua kiểm tra của RPC.
--    Đã grep: app không có .from('trips').update — mọi thay đổi đi qua RPC
--    update_trip_details / update_trip_place / set_trip_cover_* (SECURITY
--    DEFINER, không cần policy). Nên:
--      - DROP policy trips_update_owner_or_creator + REVOKE UPDATE trips.
--      - Lớp hai: trigger trips_guard_identity chặn đổi deleted_at (cả hai
--        chiều) trừ phiên quản trị — kể cả khi ai đó lỡ mở lại policy.
--    App không có tính năng xoá chuyến; người dùng LƯU TRỮ (mục 1).
--
-- 3. KHOÁ GHI THẲNG settlements.
--    settlements_update_member cho mọi thành viên sửa số tiền hoặc xoá mềm một
--    khoản "đã trả"; settlements_insert_member cho mọi thành viên ghi một khoản
--    "A đã trả B" bất kỳ — xoá nợ của người khác mà không cần người nhận xác
--    nhận, không nhật ký. Đã grep: app KHÔNG còn chỗ nào ghi settlements (hàm
--    recordSettlement không màn nào gọi, đã gỡ cùng migration này); "đã xong"
--    đi qua RPC set_expense_settled (chỉ người nhận/chủ chuyến, có nhật ký).
--    Nên DROP cả hai policy + REVOKE INSERT, UPDATE. Dòng cũ vẫn được tính vào
--    số dư như trước. Khi cần tính năng ghi tất toán: viết RPC record_settlement
--    / void_settlement SECURITY DEFINER có nhật ký, KHÔNG mở lại policy.
--
-- ⚠ THỨ TỰ: KHÔNG chạy lại 20260925_1000 sau file này — nó `create or replace`
--    guard_trip_identity_columns bằng bản chưa chặn deleted_at. Lỡ chạy thì
--    chạy lại file này. verify.sql mục 21 bắt trường hợp đó.
--
-- Rollback (chỉ khi thật cần — mở lại đúng các lỗ ở trên):
--   drop table if exists public.trip_archives;
--   apply lại guard_trip_identity_columns trong 20260925_1000;
--   grant update on public.trips to authenticated;
--   create policy "trips_update_owner_or_creator" (xem 20260916_1010);
--   grant insert, update on public.settlements to authenticated;
--   create policy "settlements_insert_member", "settlements_update_member"
--     (xem 20260915_1130).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. trip_archives
-- ---------------------------------------------------------------------------
create table if not exists public.trip_archives (
  -- default auth.uid(): client không cần gửi; policy INSERT vẫn ép bằng uid.
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  trip_id     uuid not null references public.trips (id) on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (user_id, trip_id)
);

alter table public.trip_archives enable row level security;

create index if not exists trip_archives_trip_idx on public.trip_archives (trip_id);

-- Không ai cần sửa một dòng lưu trữ; anon không có việc gì với bảng này.
revoke all on public.trip_archives from anon;
revoke update, truncate on public.trip_archives from authenticated;

drop policy if exists "trip_archives_select_own" on public.trip_archives;
create policy "trip_archives_select_own"
  on public.trip_archives for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "trip_archives_insert_own" on public.trip_archives;
create policy "trip_archives_insert_own"
  on public.trip_archives for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.trips t
      where t.id = trip_archives.trip_id
        and t.deleted_at is null
        and (public.is_trip_member(t.id) or t.created_by = (select auth.uid()))
    )
  );

drop policy if exists "trip_archives_delete_own" on public.trip_archives;
create policy "trip_archives_delete_own"
  on public.trip_archives for delete
  to authenticated
  using (user_id = (select auth.uid()));


-- ---------------------------------------------------------------------------
-- 2. trips: bỏ ghi thẳng + khoá thêm deleted_at
--    Bản sao hàm của 20260925_1000, thêm đúng một điều kiện. Thông báo lỗi tách
--    riêng để người gọi biết bị chặn vì đâu.
-- ---------------------------------------------------------------------------
create or replace function public.guard_trip_identity_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_privileged_session() then
    return new;
  end if;
  if new.join_code is distinct from old.join_code
     or new.created_by is distinct from old.created_by
     or new.currency is distinct from old.currency then
    raise exception 'Không được đổi mã mời, người tạo hay đơn vị tiền tệ của chuyến đi.'
      using errcode = '42501';
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    raise exception 'Không được xoá chuyến đi. Hãy lưu trữ chuyến đi để ẩn khỏi danh sách của bạn.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Trigger trips_guard_identity (BEFORE UPDATE, 20260925_1000) đã trỏ tới hàm
-- này; tạo lại cho chắc khi ai đó lỡ drop.
drop trigger if exists trips_guard_identity on public.trips;
create trigger trips_guard_identity
  before update on public.trips
  for each row execute function public.guard_trip_identity_columns();

drop policy if exists "trips_update_owner_or_creator" on public.trips;
revoke update on public.trips from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. settlements: không ghi thẳng
-- ---------------------------------------------------------------------------
drop policy if exists "settlements_insert_member" on public.settlements;
drop policy if exists "settlements_update_member" on public.settlements;
revoke insert, update on public.settlements from anon, authenticated;
