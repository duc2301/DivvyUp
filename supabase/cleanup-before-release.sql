-- ============================================================================
-- DivvyUp — Dọn dữ liệu thử nghiệm trước khi phát hành
--
-- XOÁ:    toàn bộ chuyến đi, nhóm, thành viên, khoản chi, phần chia, tất toán
-- GIỮ:    auth.users (tài khoản) và public.profiles (hồ sơ)
--
-- ⚠ KHÔNG HOÀN TÁC ĐƯỢC. Chạy trong SQL Editor của dashboard Supabase.
--
-- Chạy trong MỘT transaction: lỗi giữa chừng thì không mất gì cả, thay vì để
-- lại dữ liệu rách kiểu còn khoản chi mà mất chuyến đi.
--
-- Xoá theo thứ tự con trước cha. Nhiều khoá ngoại có ON DELETE CASCADE nên chỉ
-- xoá `trips` cũng đủ về lý thuyết, nhưng expenses.paid_by và
-- expense_shares.member_id tham chiếu trip_members KHÔNG có cascade — để Postgres
-- tự lo thứ tự cascade giữa hai nhánh đó là chỗ dễ vấp. Viết tường minh thì
-- không phải đoán.
--
-- Dữ liệu CHẾ ĐỘ KHÁCH nằm trên điện thoại (AsyncStorage), không nằm ở đây.
-- Muốn xoá nốt: gỡ app hoặc xoá dữ liệu ứng dụng trong cài đặt máy.
-- ============================================================================

begin;

-- Đếm trước để còn đối chiếu sau khi xoá
select
  (select count(*) from public.settlements)    as settlements,
  (select count(*) from public.expense_shares) as expense_shares,
  (select count(*) from public.expenses)       as expenses,
  (select count(*) from public.trip_members)   as trip_members,
  (select count(*) from public.trip_groups)    as trip_groups,
  (select count(*) from public.trips)          as trips,
  (select count(*) from public.profiles)       as profiles_giu_lai,
  (select count(*) from auth.users)            as accounts_giu_lai;

delete from public.settlements;
delete from public.expense_shares;
delete from public.expenses;
delete from public.trip_members;
delete from public.trip_groups;
delete from public.trips;

-- Kiểm lại: 6 cột đầu phải bằng 0, hai cột cuối giữ nguyên số trước khi xoá
select
  (select count(*) from public.settlements)    as settlements,
  (select count(*) from public.expense_shares) as expense_shares,
  (select count(*) from public.expenses)       as expenses,
  (select count(*) from public.trip_members)   as trip_members,
  (select count(*) from public.trip_groups)    as trip_groups,
  (select count(*) from public.trips)          as trips,
  (select count(*) from public.profiles)       as profiles_giu_lai,
  (select count(*) from auth.users)            as accounts_giu_lai;

commit;
