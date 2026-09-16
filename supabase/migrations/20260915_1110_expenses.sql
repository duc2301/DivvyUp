-- ============================================================================
-- DivvyUp — 02. Khoản chi
--
-- Khoản chi tham chiếu TRIP_MEMBERS, không tham chiếu profiles. Nhờ vậy người
-- chưa có tài khoản vẫn gánh nợ và vẫn được tính số dư đầy đủ.
--
-- Theo yêu cầu, mỗi khoản chi có ĐÚNG MỘT người đại diện đứng ra trả, nên
-- người trả là một cột trên chính bảng expenses chứ không phải bảng riêng.
-- Hệ quả tốt: "tổng tiền ứng = tổng khoản chi" đúng theo cấu trúc, không cần
-- ràng buộc nào canh. Chỉ còn một bất biến phải ép: tổng phần chia.
-- ============================================================================

create type public.split_mode as enum ('equal', 'exact');


create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null,
  currency     public.currency_code not null,

  description  text not null check (length(trim(description)) between 1 and 200),
  amount_minor bigint not null check (amount_minor > 0),

  -- Người đại diện đã đứng ra trả.
  paid_by      uuid not null references public.trip_members (id),

  -- Lưu lại cách nhập để lần sửa sau mở đúng chế độ người dùng đã chọn.
  split_mode   public.split_mode not null default 'equal',

  paid_at      timestamptz not null default now(),
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint expenses_trip_currency_fkey
    foreign key (trip_id, currency) references public.trips (id, currency)
    on delete cascade
);

alter table public.expenses enable row level security;


create table public.expense_shares (
  expense_id   uuid not null references public.expenses (id) on delete cascade,
  member_id    uuid not null references public.trip_members (id),
  -- Cho phép 0: có người được miễn trong khoản chi này.
  amount_minor bigint not null check (amount_minor >= 0),

  primary key (expense_id, member_id)
);

alter table public.expense_shares enable row level security;

create index expenses_trip_paid_at_idx
  on public.expenses (trip_id, paid_at desc)
  where deleted_at is null;

create index expenses_paid_by_idx on public.expenses (paid_by);
create index expense_shares_member_idx on public.expense_shares (member_id);


-- ---------------------------------------------------------------------------
-- Người trả và người gánh đều PHẢI thuộc đúng chuyến đi của khoản chi.
-- Không có ràng buộc này, một người của chuyến A có thể bị gán nợ ở chuyến B.
-- ---------------------------------------------------------------------------
create or replace function public.check_member_belongs_to_trip()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_trip_id     uuid;
  v_member_trip uuid;
  v_member_id   uuid;
begin
  if tg_table_name = 'expenses' then
    v_trip_id := new.trip_id;
    v_member_id := new.paid_by;
  else
    select e.trip_id into v_trip_id from public.expenses e where e.id = new.expense_id;
    if not found then
      return null;
    end if;
    v_member_id := new.member_id;
  end if;

  select tm.trip_id into v_member_trip
  from public.trip_members tm
  where tm.id = v_member_id;

  if v_member_trip is distinct from v_trip_id then
    raise exception 'Thành viên % không thuộc chuyến đi của khoản chi này.', v_member_id
      using errcode = '42501';
  end if;

  return null;
end;
$$;

create constraint trigger expenses_payer_in_trip
  after insert or update on public.expenses
  deferrable initially deferred
  for each row execute function public.check_member_belongs_to_trip();

create constraint trigger expense_shares_member_in_trip
  after insert or update on public.expense_shares
  deferrable initially deferred
  for each row execute function public.check_member_belongs_to_trip();


-- ---------------------------------------------------------------------------
-- BẤT BIẾN TỔNG — sum(expense_shares) = expenses.amount_minor
--
-- DEFERRABLE INITIALLY DEFERRED là bắt buộc: lúc chèn dòng expenses thì chưa
-- có phần chia nào, kiểm ngay sẽ luôn fail. Hoãn tới COMMIT cho phép RPC ghi
-- cả hai bảng rồi mới đối chiếu.
-- ---------------------------------------------------------------------------
create or replace function public.check_expense_balanced()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_expense_id uuid;
  v_amount     bigint;
  v_owed       bigint;
begin
  if tg_table_name = 'expenses' then
    v_expense_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_expense_id := case when tg_op = 'DELETE' then old.expense_id else new.expense_id end;
  end if;

  select amount_minor into v_amount from public.expenses where id = v_expense_id;
  if not found then
    return null;  -- khoản chi bị xoá trong cùng transaction
  end if;

  select coalesce(sum(amount_minor), 0) into v_owed
  from public.expense_shares
  where expense_id = v_expense_id;

  if v_owed <> v_amount then
    raise exception
      'Khoản chi %: tổng phần chia (%) khác tổng khoản chi (%).',
      v_expense_id, v_owed, v_amount
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger expenses_balanced
  after insert or update on public.expenses
  deferrable initially deferred
  for each row execute function public.check_expense_balanced();

create constraint trigger expense_shares_balanced
  after insert or update or delete on public.expense_shares
  deferrable initially deferred
  for each row execute function public.check_expense_balanced();


-- Khoá phạm vi chuyến đi và đơn vị tiền tệ sau khi tạo. Policy không so sánh
-- được OLD với NEW nên phải dùng trigger.
create or replace function public.forbid_changing_trip_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.trip_id is distinct from old.trip_id then
    raise exception 'Không được chuyển bản ghi sang chuyến đi khác.' using errcode = '42501';
  end if;
  if new.currency is distinct from old.currency then
    raise exception 'Không được đổi đơn vị tiền tệ của bản ghi.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger expenses_lock_trip_scope
  before update on public.expenses
  for each row execute function public.forbid_changing_trip_scope();

create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- POLICY
--
-- Cố ý KHÔNG có policy INSERT: tạo khoản chi đụng hai bảng nên bắt buộc đi qua
-- RPC create_expense(). Không có policy nghĩa là PostgREST từ chối insert
-- trực tiếp — client không tạo được khoản chi lệch tổng dù cố tình.
-- ---------------------------------------------------------------------------
create or replace function public.is_expense_visible(p_expense_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.expenses e
    where e.id = p_expense_id and public.is_trip_member(e.trip_id)
  );
$$;

revoke execute on function public.is_expense_visible(uuid) from public;
grant execute on function public.is_expense_visible(uuid) to authenticated;

create policy "expenses_select_member"
  on public.expenses for select
  to authenticated
  using (public.is_trip_member(trip_id));

create policy "expenses_update_member"
  on public.expenses for update
  to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

create policy "expense_shares_select_member"
  on public.expense_shares for select
  to authenticated
  using (public.is_expense_visible(expense_id));
