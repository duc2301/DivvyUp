-- ============================================================================
-- DivvyUp — 06. Sửa lỗi không tạo được chuyến đi
--
-- TRIỆU CHỨNG
--   "new row violates row-level security policy for table trips" khi bấm
--   Tạo chuyến đi, dù created_by đúng bằng auth.uid().
--
-- NGUYÊN NHÂN
--   Client gọi insert(...).select('id'). Mệnh đề RETURNING khiến Postgres kiểm
--   THÊM policy SELECT trên dòng vừa chèn. Policy SELECT của trips là
--   is_trip_member(id), mà tư cách thành viên chỉ do trigger
--   trips_add_creator_as_member tạo ra SAU khi dòng được chèn.
--
--   is_trip_member khai `stable`, tức đọc theo snapshot đầu câu lệnh, nên nó
--   KHÔNG thấy dòng trip_members do trigger vừa tạo trong chính câu lệnh đó.
--   Người tạo vì thế không "thấy" chuyến đi mình vừa tạo, và Postgres từ chối.
--
-- CÁCH SỬA
--   Cho người tạo luôn đọc được chuyến đi của mình, không phụ thuộc trigger.
--   Đây không phải mẹo lách: về nghiệp vụ, người tạo chuyến đi đương nhiên
--   phải thấy nó, kể cả trong tình huống họ bị gỡ khỏi danh sách thành viên.
--
-- Rollback: drop policy mới, tạo lại policy cũ chỉ với public.is_trip_member(id).
-- ============================================================================

drop policy if exists "trips_select_member" on public.trips;

create policy "trips_select_member_or_creator"
  on public.trips for select
  to authenticated
  using (
    public.is_trip_member(id)
    or created_by = (select auth.uid())
  );


-- Cùng lý do, cho phép người tạo sửa chuyến đi của mình. Không có dòng này,
-- người tạo sẽ mất quyền đổi tên hoặc xoá chuyến ngay sau khi tạo, nếu vì lý
-- do nào đó dòng trip_members của họ chưa kịp có.
drop policy if exists "trips_update_owner" on public.trips;

create policy "trips_update_owner_or_creator"
  on public.trips for update
  to authenticated
  using (
    public.is_trip_owner(id)
    or created_by = (select auth.uid())
  )
  with check (
    public.is_trip_owner(id)
    or created_by = (select auth.uid())
  );
