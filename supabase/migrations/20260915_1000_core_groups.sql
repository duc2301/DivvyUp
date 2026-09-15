-- ============================================================================
-- DivvyUp — 01. Hồ sơ người dùng, nhóm, thành viên nhóm
--
-- Nguyên tắc: app không có backend riêng, client nói chuyện thẳng với Postgres.
-- RLS ở đây LÀ tầng bảo mật, không có middleware nào chặn giúp.
-- Mỗi bảng được tạo và bật RLS trong cùng một migration — không bao giờ tách,
-- vì khoảng giữa hai lần chạy là khoảng thời gian bảng mở toang.
-- ============================================================================

-- Mã tiền tệ: 3 chữ in hoa. Định nghĩa một lần, dùng lại ở mọi bảng.
create domain public.currency_code as text
  check (value ~ '^[A-Z]{3}$');

create type public.group_role as enum ('owner', 'member');


-- ---------------------------------------------------------------------------
-- profiles — bản sao công khai của auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;


-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 120),
  currency   public.currency_code not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Xoá mềm. Dữ liệu tiền bạc không bao giờ xoá cứng: số dư của người khác
  -- sẽ đổi đột ngột và không còn cách nào truy vết.
  deleted_at timestamptz,

  -- Cho phép bảng expenses tham chiếu composite (group_id, currency).
  -- Nhờ đó một khoản chi KHÔNG THỂ có đơn vị tiền tệ khác nhóm của nó —
  -- ràng buộc ở tầng DB, không phụ thuộc client nhớ kiểm tra.
  constraint groups_id_currency_key unique (id, currency)
);

alter table public.groups enable row level security;


-- ---------------------------------------------------------------------------
-- group_members
-- ---------------------------------------------------------------------------
create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  role     public.group_role not null default 'member',
  joined_at timestamptz not null default now(),
  -- Rời nhóm cũng là xoá mềm: lịch sử công nợ cũ phải giữ nguyên.
  left_at  timestamptz,

  primary key (group_id, user_id)
);

alter table public.group_members enable row level security;

create index group_members_user_id_idx on public.group_members (user_id) where left_at is null;
create index group_members_group_id_idx on public.group_members (group_id) where left_at is null;
create index groups_created_by_idx on public.groups (created_by);


-- ---------------------------------------------------------------------------
-- HÀM TRỢ GIÚP CHO POLICY
--
-- Bắt buộc SECURITY DEFINER: policy trên group_members mà lại truy vấn chính
-- group_members sẽ gây đệ quy vô hạn. Hàm definer cắt vòng lặp đó.
--
-- `set search_path = public` KHÔNG phải chi tiết vụn vặt: thiếu nó, hàm
-- SECURITY DEFINER trở thành lỗ hổng leo thang quyền vì kẻ tấn công có thể
-- đổi search_path để trỏ tên bảng sang schema của mình.
--
-- `(select auth.uid())` bọc trong subselect để Postgres tính một lần cho cả
-- câu truy vấn thay vì tính lại trên từng dòng.
-- ---------------------------------------------------------------------------
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
      and gm.left_at is null
  );
$$;

create or replace function public.is_group_owner(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
      and gm.left_at is null
      and gm.role = 'owner'
  );
$$;

create or replace function public.shares_group_with(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members me
    join public.group_members other on other.group_id = me.group_id
    where me.user_id = (select auth.uid())
      and me.left_at is null
      and other.user_id = p_user_id
      and other.left_at is null
  );
$$;

revoke execute on function public.is_group_member(uuid) from public;
revoke execute on function public.is_group_owner(uuid) from public;
revoke execute on function public.shares_group_with(uuid) from public;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_group_owner(uuid) to authenticated;
grant execute on function public.shares_group_with(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- POLICY — profiles
-- ---------------------------------------------------------------------------
-- Chỉ thấy hồ sơ của chính mình và của người chung nhóm. KHÔNG phải
-- "mọi người đã đăng nhập" — đó là lỗi kinh điển làm lộ toàn bộ danh bạ.
create policy "profiles_select_self_or_groupmate"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or public.shares_group_with(id));

create policy "profiles_insert_self"
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));


-- ---------------------------------------------------------------------------
-- POLICY — groups
-- ---------------------------------------------------------------------------
create policy "groups_select_member"
  on public.groups for select
  to authenticated
  using (public.is_group_member(id));

-- WITH CHECK là bắt buộc cho INSERT. Chỉ có USING thì không chặn được gì
-- lúc chèn, và người dùng tạo được nhóm mạo danh người khác.
create policy "groups_insert_self_as_creator"
  on public.groups for insert
  to authenticated
  with check (created_by = (select auth.uid()));

create policy "groups_update_owner"
  on public.groups for update
  to authenticated
  using (public.is_group_owner(id))
  with check (public.is_group_owner(id));

-- Cố ý KHÔNG có policy DELETE: xoá nhóm = đặt deleted_at qua policy update.


-- ---------------------------------------------------------------------------
-- POLICY — group_members
-- ---------------------------------------------------------------------------
create policy "group_members_select_member"
  on public.group_members for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "group_members_insert_owner"
  on public.group_members for insert
  to authenticated
  with check (public.is_group_owner(group_id));

-- Chủ nhóm sửa được vai trò; ai cũng tự rời nhóm được (đặt left_at cho chính mình).
create policy "group_members_update_owner_or_self"
  on public.group_members for update
  to authenticated
  using (public.is_group_owner(group_id) or user_id = (select auth.uid()))
  with check (public.is_group_owner(group_id) or user_id = (select auth.uid()));

-- Cố ý KHÔNG có policy DELETE: rời nhóm = đặt left_at, giữ lịch sử công nợ.


-- ---------------------------------------------------------------------------
-- TRIGGER
-- ---------------------------------------------------------------------------

-- Tạo hồ sơ tự động khi có người đăng ký.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(new.email, 'nguoi-dung'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Người tạo nhóm tự động thành chủ nhóm.
-- Phải là SECURITY DEFINER: trigger thường chạy với quyền người gọi, mà lúc này
-- họ chưa phải thành viên nên policy group_members_insert_owner sẽ chặn.
create or replace function public.add_group_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (group_id, user_id) do nothing;
  return new;
end;
$$;

create trigger groups_add_creator_as_owner
  after insert on public.groups
  for each row execute function public.add_group_creator_as_owner();

-- updated_at dùng chung. Cần cho việc đồng bộ tăng dần sau này.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger groups_touch_updated_at
  before update on public.groups
  for each row execute function public.touch_updated_at();
