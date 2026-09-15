-- ============================================================================
-- DivvyUp — 04. Tất toán công nợ và khung nhìn số dư
--
-- Số dư KHÔNG được client gửi lên. Nó được tính ở DB từ dữ liệu gốc, mỗi lần
-- truy vấn tính lại từ đầu. Nếu tin số dư client gửi thì bất kỳ ai cũng sửa
-- được khoản nợ của chính mình bằng một lệnh gọi PostgREST.
-- ============================================================================

create table public.settlements (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null,
  currency     public.currency_code not null,

  from_user    uuid not null references public.profiles (id),
  to_user      uuid not null references public.profiles (id),
  amount_minor bigint not null check (amount_minor > 0),

  settled_at   timestamptz not null default now(),
  note         text check (note is null or length(note) <= 200),
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  -- Không ai tự trả tiền cho chính mình.
  constraint settlements_distinct_parties check (from_user <> to_user),

  -- Cùng lý do với expenses: đơn vị tiền tệ buộc phải trùng nhóm.
  constraint settlements_group_currency_fkey
    foreign key (group_id, currency) references public.groups (id, currency)
    on delete cascade
);

alter table public.settlements enable row level security;

create index settlements_group_idx
  on public.settlements (group_id, settled_at desc)
  where deleted_at is null;


create policy "settlements_select_member"
  on public.settlements for select
  to authenticated
  using (public.is_group_member(group_id));

-- Chỉ thành viên mới ghi được, và không ghi hộ người khác đứng tên tạo.
-- Cả hai đầu của giao dịch cũng phải là thành viên nhóm.
create policy "settlements_insert_member"
  on public.settlements for insert
  to authenticated
  with check (
    public.is_group_member(group_id)
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = settlements.group_id
        and gm.user_id = settlements.from_user
        and gm.left_at is null
    )
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = settlements.group_id
        and gm.user_id = settlements.to_user
        and gm.left_at is null
    )
  );

-- Cùng lý do với expenses: không cho chuyển giao dịch tất toán sang nhóm khác.
create trigger settlements_lock_group_scope
  before update on public.settlements
  for each row execute function public.forbid_changing_group_scope();


create policy "settlements_update_member"
  on public.settlements for update
  to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));


-- ---------------------------------------------------------------------------
-- group_balances — số dư ròng của từng thành viên
--
-- net_minor > 0 : người đó ĐƯỢC NHẬN LẠI
-- net_minor < 0 : người đó ĐANG NỢ
-- Tổng net_minor của một nhóm luôn bằng 0.
--
-- security_invoker = on là BẮT BUỘC. Mặc định view chạy với quyền người tạo,
-- tức là bỏ qua RLS và để lộ số dư của mọi nhóm cho mọi người.
-- ---------------------------------------------------------------------------
create or replace view public.group_balances
with (security_invoker = true) as
with active_expenses as (
  select id, group_id
  from public.expenses
  where deleted_at is null
),
paid as (
  select ae.group_id, ep.user_id, sum(ep.amount_minor) as amount
  from active_expenses ae
  join public.expense_payments ep on ep.expense_id = ae.id
  group by ae.group_id, ep.user_id
),
owed as (
  select ae.group_id, es.user_id, sum(es.amount_minor) as amount
  from active_expenses ae
  join public.expense_shares es on es.expense_id = ae.id
  group by ae.group_id, es.user_id
),
-- Người trả tiền tất toán: khoản nợ của họ giảm đi, tức net tăng lên.
settled_out as (
  select group_id, from_user as user_id, sum(amount_minor) as amount
  from public.settlements
  where deleted_at is null
  group by group_id, from_user
),
-- Người nhận tiền tất toán: phần được nhận lại giảm đi, tức net giảm xuống.
settled_in as (
  select group_id, to_user as user_id, sum(amount_minor) as amount
  from public.settlements
  where deleted_at is null
  group by group_id, to_user
)
select
  gm.group_id,
  gm.user_id,
  g.currency,
  coalesce(p.amount, 0)
    - coalesce(o.amount, 0)
    + coalesce(so.amount, 0)
    - coalesce(si.amount, 0) as net_minor
from public.group_members gm
join public.groups g on g.id = gm.group_id
left join paid        p  on p.group_id  = gm.group_id and p.user_id  = gm.user_id
left join owed        o  on o.group_id  = gm.group_id and o.user_id  = gm.user_id
left join settled_out so on so.group_id = gm.group_id and so.user_id = gm.user_id
left join settled_in  si on si.group_id = gm.group_id and si.user_id = gm.user_id
where gm.left_at is null
  and g.deleted_at is null;

grant select on public.group_balances to authenticated;
