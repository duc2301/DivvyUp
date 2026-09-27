-- ============================================================================
-- DivvyUp — kiểm tra sức khoẻ schema
--
-- Chạy trong SQL Editor của Supabase SAU KHI áp dụng xong mọi migration
-- (thứ tự trong supabase/README.md).
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


-- 12. expenses còn policy UPDATE/ALL nào không?
--     Phải KHÔNG: sửa thẳng expenses là vòng qua nhật ký expense_events
--     (migration 20260925_1000 đã drop expenses_update_member).
select p.polname as policy_sua_thang_expenses
from pg_policy p
where p.polrelid = 'public.expenses'::regclass
  and p.polcmd in ('w', '*');   -- 'w' = UPDATE, '*' = ALL


-- 13. expense_events có policy ghi nào không?
--     Nhật ký chỉ được ghi bởi RPC SECURITY DEFINER.
select p.polname as policy_ghi_nhat_ky
from pg_policy p
where p.polrelid = 'public.expense_events'::regclass
  and p.polcmd <> 'r';          -- 'r' = SELECT


-- 14. trip_notes có policy DELETE/ALL nào không?
--     Xoá ghi chú là xoá mềm (deleted_at), không xoá cứng.
select p.polname as policy_xoa_cung_ghi_chu
from pg_policy p
where p.polrelid = 'public.trip_notes'::regclass
  and p.polcmd in ('d', '*');


-- 15. Nhật ký có dòng nào trỏ sai chuyến đi so với khoản chi của nó không?
select ev.id as nhat_ky_sai_chuyen
from public.expense_events ev
join public.expenses e on e.id = ev.expense_id
where ev.trip_id <> e.trip_id;


-- 16. Hàm nội bộ / RPC mới có mở cho anon, hoặc hàm nội bộ mở cho authenticated?
--     expense_snapshot và log_expense_event chỉ được gọi từ bên trong RPC.
select p.oid::regprocedure as ham_mo_quyen_sai
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    (p.proname in ('update_trip_details', 'update_trip_place', 'set_trip_cover_index',
                   'set_trip_cover_if_empty', 'create_expense', 'update_expense', 'void_expense', 'set_expense_settled')
     and has_function_privilege('anon', p.oid, 'execute'))
    or
    (p.proname in ('expense_snapshot', 'log_expense_event')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')))
  );


-- 17. Role authenticated còn quyền ghi thẳng expense_events không?
--     Migration 20260925_1000 revoke; bảng chỉ được ghi từ RPC SECURITY DEFINER.
select quyen as quyen_ghi_nhat_ky_con_mo
from unnest(array['INSERT', 'UPDATE', 'DELETE']) as quyen
where has_table_privilege('authenticated', 'public.expense_events', quyen);


-- 18. Trigger bảo vệ của migration 20260925_1000 có thiếu hoặc bị tắt không?
--     tgenabled = 'D' là đã ALTER TABLE ... DISABLE TRIGGER — mất chốt mà
--     không lỗi nào hiện ra.
select v.bang, v.trigger_thieu_hoac_tat
from (values
  ('public.trips',      'trips_guard_identity'),  -- từ 20260926_1000 chặn cả deleted_at
  ('public.trips',      'trips_validate_cover'),
  ('public.trip_notes', 'trip_notes_set_actor'),
  ('public.trip_notes', 'trip_notes_forbid_undelete'),
  ('public.trip_notes', 'trip_notes_touch_updated_at')
) as v(bang, trigger_thieu_hoac_tat)
where not exists (
  select 1 from pg_trigger tg
  where tg.tgrelid = to_regclass(v.bang)
    and tg.tgname = v.trigger_thieu_hoac_tat
    and not tg.tgisinternal
    and tg.tgenabled <> 'D'
);


-- 19. Ảnh bìa ngoài allowlist của trigger trips_validate_cover.
--     KHÔNG bắt buộc 0 dòng: trigger chỉ kiểm khi bộ ảnh đổi, nên dữ liệu lưu
--     trước migration 20260925_1000 có thể còn ở đây. Có dòng = lần tới ai đó
--     lưu một bộ ảnh KHÁC mà vẫn giữ ảnh này thì bị từ chối (lướt carousel hay
--     lưu lại nguyên bộ thì không sao). Quyết định dọn hay giữ.
select t.id as chuyen_co_anh_bia_ngoai_allowlist, item ->> 'url' as url, item ->> 'link' as link
from public.trips t
cross join lateral jsonb_array_elements(t.cover_images) as item
where coalesce(lower(substring(item ->> 'url' from '^https://([A-Za-z0-9.-]+)([/?#][^[:space:]]*)?$')), '')
        <> all (array['images.unsplash.com', 'plus.unsplash.com',
                      'upload.wikimedia.org', 'i.pinimg.com'])
   or (item ->> 'link' is not null
       and coalesce(lower(substring(item ->> 'link' from '^https://([A-Za-z0-9.-]+)([/?#][^[:space:]]*)?$')), '')
             <> all (array['unsplash.com', 'www.unsplash.com', 'commons.wikimedia.org',
                           'www.pinterest.com', 'pinterest.com']));


-- 20. Migration 20260926_1000: client không còn ghi thẳng trips/settlements.
--     Mong đợi 0 dòng. has_any_column_privilege bắt cả quyền cấp theo cột
--     (grant update (note) on ...), has_table_privilege thì không.
select v.vai, v.bang, v.quyen as quyen_con_mo
from (values
  ('authenticated', 'public.trips',         'UPDATE'),
  ('authenticated', 'public.settlements',   'INSERT'),
  ('authenticated', 'public.settlements',   'UPDATE'),
  ('authenticated', 'public.trip_archives', 'UPDATE'),
  -- anon: RLS đã chặn (mọi policy chỉ cho authenticated) — đây là lớp hai.
  ('anon',          'public.trips',         'UPDATE'),
  ('anon',          'public.settlements',   'INSERT'),
  ('anon',          'public.settlements',   'UPDATE'),
  ('anon',          'public.trip_archives', 'SELECT'),
  ('anon',          'public.trip_archives', 'INSERT'),
  ('anon',          'public.trip_archives', 'UPDATE')
) as v(vai, bang, quyen)
where has_any_column_privilege(v.vai, v.bang, v.quyen)
union all
select v.vai, v.bang, 'DELETE'
from (values ('anon', 'public.trip_archives')) as v(vai, bang)
where has_table_privilege(v.vai, v.bang, 'DELETE');


-- 21. Policy ghi còn sót, RLS tắt, hoặc chốt deleted_at bị mất. Mong đợi 0 dòng.
--     Chốt deleted_at mất khi ai đó chạy lại 20260925_1000 SAU 20260926_1000
--     (bản cũ của guard_trip_identity_columns không có dòng kiểm deleted_at).
select 'trips còn policy ghi: ' || policyname as van_de
from pg_policies
where schemaname = 'public' and tablename = 'trips' and cmd in ('UPDATE', 'DELETE', 'ALL')
union all
select 'settlements còn policy ghi: ' || policyname
from pg_policies
where schemaname = 'public' and tablename = 'settlements' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
union all
select 'trip_archives có policy lạ: ' || policyname || ' (' || cmd || ')'
from pg_policies
where schemaname = 'public' and tablename = 'trip_archives'
  and (cmd in ('UPDATE', 'ALL') or coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
union all
select 'trip_archives chưa bật RLS'
from pg_class
where oid = 'public.trip_archives'::regclass and not relrowsecurity
union all
select 'guard_trip_identity_columns không còn chặn deleted_at — chạy lại 20260926_1000'
where to_regprocedure('public.guard_trip_identity_columns()') is null
   or pg_get_functiondef(to_regprocedure('public.guard_trip_identity_columns()'))
        not like '%new.deleted_at is distinct from old.deleted_at%';


-- 22. Chuyến đi đã xoá mềm. Từ migration 20260926_1000 chỉ phiên quản trị làm
--     được; dòng có deleted_at sau ngày chạy migration = kiểm lại ai đã chạy
--     SQL Editor. Không bắt buộc 0 dòng.
select id as chuyen_da_xoa_mem, name, deleted_at
from public.trips
where deleted_at is not null
order by deleted_at desc;
