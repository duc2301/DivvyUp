-- ============================================================================
-- DivvyUp — 05. Sửa kiểu cột net_minor của view trip_balances
--
-- Vấn đề: trong Postgres, sum(bigint) trả về `numeric` (để tránh tràn số), nên
-- biểu thức tính net_minor bị nâng kiểu theo và view lộ ra cột numeric. Không
-- có đồng nào sai — numeric là số thập phân chính xác, không phải dấu phẩy
-- động — nhưng nó phá giao kèo "tiền luôn là số nguyên đơn vị nhỏ nhất" của
-- toàn schema, và truy vấn số 7 trong verify.sql bắt được đúng chỗ này.
--
-- Phải DROP rồi CREATE: CREATE OR REPLACE VIEW không cho đổi kiểu cột đã có.
--
-- Rollback: chạy lại đúng định nghĩa view ở migration 20260915_1130 bản cũ,
-- tức bỏ phép ép ::bigint. Không mất dữ liệu — đây chỉ là view.
--
-- Nếu bạn cài mới từ đầu (migration 1130 đã có sẵn phép ép), file này chỉ dựng
-- lại y nguyên view đó, chạy cũng không sao.
-- ============================================================================

drop view if exists public.trip_balances;

create view public.trip_balances
with (security_invoker = true) as
with active_expenses as (
  select id, trip_id, paid_by, amount_minor
  from public.expenses
  where deleted_at is null
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
