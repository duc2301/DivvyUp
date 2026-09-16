-- ============================================================================
-- DivvyUp — kiểm tra sức khoẻ schema
--
-- Chạy trong SQL Editor của Supabase SAU KHI áp dụng xong 4 migration.
-- Mỗi truy vấn phải trả về 0 dòng. Có dòng nào là có lỗ hổng.
-- ============================================================================

-- 1. Bảng nào trong public chưa bật RLS?
--    Bảng thiếu RLS = bảng công khai cho toàn Internet.
select c.relname as bang_chua_bat_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity;


-- 2. Bảng nào đã bật RLS nhưng KHÔNG có policy nào?
--    Trạng thái này chặn sạch mọi truy cập — thường là quên viết policy.
select c.relname as bang_bat_rls_nhung_khong_co_policy
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and not exists (
    select 1 from pg_policy p where p.polrelid = c.oid
  );


-- 3. Policy nào mở toang (USING true hoặc WITH CHECK true)?
select
  n.nspname   as schema,
  c.relname   as bang,
  p.polname   as policy,
  pg_get_expr(p.polqual, p.polrelid)      as using_expr,
  pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (
    pg_get_expr(p.polqual, p.polrelid) = 'true'
    or pg_get_expr(p.polwithcheck, p.polrelid) = 'true'
  );


-- 4. Policy INSERT nào thiếu WITH CHECK?
--    Chỉ có USING thì không chặn được gì lúc chèn — người dùng chèn được
--    bản ghi mạo danh người khác.
select c.relname as bang, p.polname as policy_insert_thieu_with_check
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and p.polcmd = 'a'          -- 'a' = INSERT
  and p.polwithcheck is null;


-- 5. Hàm SECURITY DEFINER nào thiếu search_path cố định?
--    Thiếu nó, hàm trở thành lỗ hổng leo thang quyền.
select p.proname as ham_definer_thieu_search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (p.proconfig is null or not exists (
    select 1 from unnest(p.proconfig) as cfg where cfg like 'search_path=%'
  ));


-- 6. View nào chưa bật security_invoker?
--    View mặc định chạy với quyền người tạo và BỎ QUA RLS của bảng gốc.
select c.relname as view_chua_bat_security_invoker
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and coalesce(
    (select option_value
     from pg_options_to_table(c.reloptions)
     where option_name = 'security_invoker'),
    'false'
  ) <> 'true';


-- 7. Cột tiền nào bị khai báo bằng kiểu số thực?
--    Tiền phải là bigint đơn vị nhỏ nhất. float/real/double = mất tiền.
select
  c.table_name as bang,
  c.column_name as cot,
  c.data_type as kieu_sai
from information_schema.columns c
where c.table_schema = 'public'
  and (c.column_name like '%amount%' or c.column_name like '%minor%')
  and c.data_type in ('real', 'double precision', 'numeric', 'money');


-- ============================================================================
-- 8. Bất biến tổng — phải trả về 0 dòng trên dữ liệu thật
--    Nếu có dòng nào, tức trigger ràng buộc đã bị vượt qua ở đâu đó.
-- ============================================================================
select
  e.id as khoan_chi_lech_tong,
  e.amount_minor,
  coalesce(s.tong_chia, 0) as tong_phan_chia
from public.expenses e
left join (
  select expense_id, sum(amount_minor) as tong_chia
  from public.expense_shares group by expense_id
) s on s.expense_id = e.id
where coalesce(s.tong_chia, 0) <> e.amount_minor;


-- 9. Chuyến đi nào có tổng số dư khác 0?
--    Tổng net của một chuyến đi LUÔN phải bằng 0. Khác 0 là dữ liệu hỏng.
select trip_id, sum(net_minor) as tong_so_du_phai_bang_0
from public.trip_balances
group by trip_id
having sum(net_minor) <> 0;


-- 10. Người trả hoặc người gánh có ai lọt sang chuyến đi khác không?
--     Trigger check_member_belongs_to_trip phải chặn, đây là lưới kiểm tra lại.
select e.id as khoan_chi_sai_chuyen, 'paid_by' as vi_tri
from public.expenses e
join public.trip_members tm on tm.id = e.paid_by
where tm.trip_id <> e.trip_id
union all
select e.id, 'expense_shares'
from public.expense_shares es
join public.expenses e on e.id = es.expense_id
join public.trip_members tm on tm.id = es.member_id
where tm.trip_id <> e.trip_id;


-- 11. Có tài khoản nào chiếm hai chỗ trong cùng một chuyến đi không?
--     Unique index chặn rồi, đây là kiểm tra lại vì lỗi này làm số dư nhân đôi.
select trip_id, user_id, count(*) as so_cho_chiem
from public.trip_members
where user_id is not null and removed_at is null
group by trip_id, user_id
having count(*) > 1;
