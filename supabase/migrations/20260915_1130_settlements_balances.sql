-- ============================================================================
-- DivvyUp — 04. Tất toán và khung nhìn số dư
--
-- Số dư KHÔNG do client gửi lên. Nó được tính ở DB từ dữ liệu gốc, mỗi lần
-- truy vấn tính lại từ đầu. Tin số dư client gửi thì ai cũng sửa được nợ của
-- chính mình bằng một lệnh gọi PostgREST.
-- ============================================================================

create table public.settlements (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null,
  currency     public.currency_code not null,

  from_member  uuid not null references public.trip_members (id),
  to_member    uuid not null references public.trip_members (id),
  amount_minor bigint not null check (amount_minor > 0),

  settled_at   timestamptz not null default now(),
  note         text check (note is null or length(note) <= 200),
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint settlements_distinct_parties check (from_member <> to_member),

  constraint settlements_trip_currency_fkey
    foreign key (trip_id, currency) references public.trips (id, currency)
    on delete cascade
);

alter table public.settlements enable row level security;

create index settlements_trip_idx
  on public.settlements (trip_id, settled_at desc)
  where deleted_at is null;

create trigger settlements_lock_trip_scope
  before update on public.settlements
  for each row execute function public.forbid_changing_trip_scope();


create policy "settlements_select_member"
  on public.settlements for select
  to authenticated
  using (public.is_trip_member(trip_id));

-- Cả hai đầu của giao dịch phải thuộc đúng chuyến đi, và không ghi hộ người
-- khác đứng tên tạo.
create policy "settlements_insert_member"
  on public.settlements for insert
  to authenticated
  with check (
    public.is_trip_member(trip_id)
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.trip_members tm
      where tm.id = settlements.from_member
        and tm.trip_id = settlements.trip_id
        and tm.removed_at is null
    )
    and exists (
      select 1 from public.trip_members tm
      where tm.id = settlements.to_member
        and tm.trip_id = settlements.trip_id
        and tm.removed_at is null
    )
  );

create policy "settlements_update_member"
  on public.settlements for update
  to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));


-- ---------------------------------------------------------------------------
-- trip_balances — số dư ròng của từng thành viên trong chuyến đi
--
-- net_minor > 0 : người đó ĐƯỢC NHẬN LẠI
-- net_minor < 0 : người đó ĐANG NỢ
-- Tổng net_minor của một chuyến đi luôn bằng 0.
--
-- security_invoker = true là BẮT BUỘC. Mặc định, view chạy với quyền người tạo,
-- bỏ qua RLS và để lộ số dư của mọi chuyến đi cho mọi người.
-- ---------------------------------------------------------------------------
create or replace view public.trip_balances
with (security_invoker = true) as
with active_expenses as (
  select id, trip_id, paid_by, amount_minor
  from public.expenses
  where deleted_at is null
),
-- Mỗi khoản chi có đúng một người đại diện trả, nên phần "đã ứng" gom thẳng
-- từ cột paid_by, không cần bảng payments riêng.
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
-- Người trả tiền tất toán: nợ giảm đi, tức net tăng lên.
settled_out as (
  select trip_id, from_member as member_id, sum(amount_minor) as amount
  from public.settlements where deleted_at is null
  group by trip_id, from_member
),
-- Người nhận tiền tất toán: phần được nhận lại giảm đi, tức net giảm xuống.
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
  -- Ép về bigint là CỐ Ý. Trong Postgres, sum(bigint) trả về numeric để tránh
  -- tràn số, nên cả biểu thức bị nâng kiểu theo và view sẽ lộ ra cột numeric —
  -- phá giao kèo "tiền luôn là số nguyên đơn vị nhỏ nhất" của toàn schema.
  -- Không mất mát gì khi ép, vì các số hạng vốn đều là bigint; nếu tổng có
  -- thực sự vượt ngưỡng bigint thì phép ép sẽ báo lỗi to, đúng như mong muốn.
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
