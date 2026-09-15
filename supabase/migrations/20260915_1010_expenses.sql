-- ============================================================================
-- DivvyUp — 02. Khoản chi, tiền ứng, phần chia
--
-- Điểm quan trọng nhất của migration này: BẤT BIẾN TỔNG được ép ở tầng DB.
--   sum(expense_payments) = expenses.amount_minor
--   sum(expense_shares)   = expenses.amount_minor
--
-- Ràng buộc chỉ kiểm ở client là KHÔNG có ràng buộc — client hoàn toàn có thể
-- bị bỏ qua khi kẻ tấn công gọi thẳng PostgREST.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------
create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null,
  currency     public.currency_code not null,

  description  text not null check (length(trim(description)) between 1 and 200),

  -- SỐ NGUYÊN đơn vị nhỏ nhất (VND: đồng, USD: cent). Không bao giờ float/real/
  -- double precision cho tiền — xem AGENTS.md mục 3.
  amount_minor bigint not null check (amount_minor > 0),

  paid_at      timestamptz not null default now(),
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  -- Khoá ngoại composite: đơn vị tiền tệ của khoản chi BUỘC phải trùng nhóm.
  -- Đây là lý do groups có unique (id, currency). Không có ON UPDATE CASCADE
  -- là cố ý: đổi đơn vị tiền tệ của nhóm đã có khoản chi phải là một cuộc
  -- di trú có chủ đích, không phải một lệnh UPDATE lặng lẽ.
  constraint expenses_group_currency_fkey
    foreign key (group_id, currency) references public.groups (id, currency)
    on delete cascade
);

alter table public.expenses enable row level security;


-- ---------------------------------------------------------------------------
-- expense_payments — ai đã ứng tiền (hỗ trợ nhiều người cùng trả một khoản)
-- ---------------------------------------------------------------------------
create table public.expense_payments (
  expense_id   uuid not null references public.expenses (id) on delete cascade,
  user_id      uuid not null references public.profiles (id),
  amount_minor bigint not null check (amount_minor > 0),

  primary key (expense_id, user_id)
);

alter table public.expense_payments enable row level security;


-- ---------------------------------------------------------------------------
-- expense_shares — ai gánh bao nhiêu
-- ---------------------------------------------------------------------------
create table public.expense_shares (
  expense_id   uuid not null references public.expenses (id) on delete cascade,
  user_id      uuid not null references public.profiles (id),
  -- Cho phép 0: có người được miễn trong khoản chi này.
  amount_minor bigint not null check (amount_minor >= 0),

  primary key (expense_id, user_id)
);

alter table public.expense_shares enable row level security;


create index expenses_group_paid_at_idx
  on public.expenses (group_id, paid_at desc)
  where deleted_at is null;

create index expense_payments_user_idx on public.expense_payments (user_id);
create index expense_shares_user_idx on public.expense_shares (user_id);


-- ---------------------------------------------------------------------------
-- BẤT BIẾN TỔNG — trigger ràng buộc hoãn tới lúc COMMIT
--
-- Phải DEFERRABLE INITIALLY DEFERRED: lúc mới chèn dòng expenses thì chưa có
-- dòng nào trong shares/payments, nên kiểm ngay lập tức sẽ luôn fail. Hoãn tới
-- cuối transaction cho phép RPC ghi cả ba bảng rồi mới kiểm tổng.
--
-- Đây là lưới an toàn cuối cùng: kể cả khi có ai đó UPDATE thẳng amount_minor
-- qua PostgREST, transaction vẫn bị chặn lại.
-- ---------------------------------------------------------------------------
create or replace function public.check_expense_balanced()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_expense_id uuid;
  v_amount     bigint;
  v_paid       bigint;
  v_owed       bigint;
begin
  if tg_table_name = 'expenses' then
    v_expense_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_expense_id := case when tg_op = 'DELETE' then old.expense_id else new.expense_id end;
  end if;

  select amount_minor into v_amount
  from public.expenses
  where id = v_expense_id;

  -- Khoản chi đã bị xoá trong cùng transaction: không còn gì để kiểm.
  if not found then
    return null;
  end if;

  select coalesce(sum(amount_minor), 0) into v_paid
  from public.expense_payments
  where expense_id = v_expense_id;

  select coalesce(sum(amount_minor), 0) into v_owed
  from public.expense_shares
  where expense_id = v_expense_id;

  if v_paid <> v_amount then
    raise exception
      'Khoản chi %: tổng tiền ứng (%) khác tổng khoản chi (%)',
      v_expense_id, v_paid, v_amount
      using errcode = 'check_violation';
  end if;

  if v_owed <> v_amount then
    raise exception
      'Khoản chi %: tổng phần chia (%) khác tổng khoản chi (%)',
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

create constraint trigger expense_payments_balanced
  after insert or update or delete on public.expense_payments
  deferrable initially deferred
  for each row execute function public.check_expense_balanced();

create constraint trigger expense_shares_balanced
  after insert or update or delete on public.expense_shares
  deferrable initially deferred
  for each row execute function public.check_expense_balanced();

create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- Khoá phạm vi nhóm và đơn vị tiền tệ sau khi đã tạo.
--
-- Không có ràng buộc này, policy UPDATE cho phép một thành viên CHUYỂN khoản
-- chi sang nhóm khác mà họ cũng tham gia — số dư của cả hai nhóm đổi theo mà
-- không ai thấy. Policy không so sánh được OLD với NEW nên phải dùng trigger.
-- ---------------------------------------------------------------------------
create or replace function public.forbid_changing_group_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.group_id is distinct from old.group_id then
    raise exception 'Không được chuyển bản ghi sang nhóm khác.' using errcode = '42501';
  end if;
  if new.currency is distinct from old.currency then
    raise exception 'Không được đổi đơn vị tiền tệ của bản ghi.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger expenses_lock_group_scope
  before update on public.expenses
  for each row execute function public.forbid_changing_group_scope();


-- ---------------------------------------------------------------------------
-- POLICY
--
-- Cố ý KHÔNG có policy INSERT trên cả ba bảng. Tạo một khoản chi luôn đụng
-- nhiều bảng, nên nó BẮT BUỘC đi qua RPC create_expense() ở migration sau.
-- Không có policy nghĩa là PostgREST từ chối insert trực tiếp — client không
-- thể tạo ra khoản chi lệch tổng ngay cả khi cố tình.
-- ---------------------------------------------------------------------------
create or replace function public.is_expense_visible(p_expense_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.expenses e
    where e.id = p_expense_id
      and public.is_group_member(e.group_id)
  );
$$;

revoke execute on function public.is_expense_visible(uuid) from public;
grant execute on function public.is_expense_visible(uuid) to authenticated;

create policy "expenses_select_member"
  on public.expenses for select
  to authenticated
  using (public.is_group_member(group_id));

-- Sửa mô tả và xoá mềm. Sửa amount_minor vẫn bị trigger bất biến chặn nếu
-- không cập nhật phần chia tương ứng.
create policy "expenses_update_member"
  on public.expenses for update
  to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

create policy "expense_payments_select_member"
  on public.expense_payments for select
  to authenticated
  using (public.is_expense_visible(expense_id));

create policy "expense_shares_select_member"
  on public.expense_shares for select
  to authenticated
  using (public.is_expense_visible(expense_id));
