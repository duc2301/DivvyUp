-- ============================================================================
-- DivvyUp — 01. Chuyến đi, nhóm, thành viên
--
-- Cấu trúc: trips → trip_groups → trip_members
--
-- ĐIỂM THEN CHỐT CỦA MÔ HÌNH NÀY: thành viên KHÔNG phải tài khoản.
-- trip_members là bản ghi có tên do người tổ chức nhập; cột user_id để trống.
-- Khi người đó được mời và nhận tài khoản, user_id mới được gắn vào.
--
-- Hệ quả: quyền truy cập chuyến đi đi qua trip_members.user_id, không đi qua
-- profiles. Người chưa nhận tài khoản vẫn có công nợ đầy đủ nhưng không tự
-- đăng nhập xem được — đúng ý đồ "nhập tên trước, mời sau".
--
-- App không có backend riêng nên RLS ở đây là tầng bảo mật duy nhất.
-- ============================================================================

create domain public.currency_code as text
  check (value ~ '^[A-Z]{3}$');

create type public.trip_role as enum ('owner', 'member');


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
-- trips
-- ---------------------------------------------------------------------------
create table public.trips (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 120),
  currency   public.currency_code not null,

  start_date date,
  end_date   date,

  -- Mã tham gia để mời người khác. Ngắn, đọc được qua tin nhắn.
  join_code  text not null unique
             default upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)),

  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint trips_dates_ordered check (
    start_date is null or end_date is null or start_date <= end_date
  ),

  -- Cho phép expenses/settlements tham chiếu composite (trip_id, currency),
  -- nhờ đó khoản chi không thể mang đơn vị tiền tệ khác chuyến đi.
  constraint trips_id_currency_key unique (id, currency)
);

alter table public.trips enable row level security;


-- ---------------------------------------------------------------------------
-- trip_groups — nhóm bên trong một chuyến đi (xe 1, xe 2, phòng A…)
-- ---------------------------------------------------------------------------
create table public.trip_groups (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 80),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.trip_groups enable row level security;


-- ---------------------------------------------------------------------------
-- trip_members — MỘT NGƯỜI trong chuyến đi
-- ---------------------------------------------------------------------------
create table public.trip_members (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips (id) on delete cascade,
  -- Có thể chưa thuộc nhóm nào.
  group_id     uuid references public.trip_groups (id) on delete set null,

  display_name text not null check (length(trim(display_name)) between 1 and 80),

  -- NULL = mới chỉ là cái tên, chưa gắn tài khoản.
  -- Gắn bằng RPC join_trip_by_code(), không sửa trực tiếp được.
  user_id      uuid references public.profiles (id) on delete set null,

  role         public.trip_role not null default 'member',
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  -- Xoá mềm: người rời đi vẫn giữ nguyên lịch sử công nợ.
  removed_at   timestamptz
);

alter table public.trip_members enable row level security;

-- Một tài khoản chỉ được gắn vào ĐÚNG MỘT thành viên trong mỗi chuyến đi.
-- Thiếu ràng buộc này, một người có thể chiếm hai suất và số dư nhân đôi.
create unique index trip_members_one_account_per_trip
  on public.trip_members (trip_id, user_id)
  where user_id is not null;

create index trip_members_user_idx on public.trip_members (user_id) where user_id is not null;
create index trip_members_trip_idx on public.trip_members (trip_id) where removed_at is null;
create index trip_groups_trip_idx on public.trip_groups (trip_id) where deleted_at is null;

-- Nhóm và thành viên phải thuộc cùng một chuyến đi. Không có ràng buộc này,
-- một thành viên của chuyến A có thể bị gán vào nhóm của chuyến B.
alter table public.trip_groups add constraint trip_groups_id_trip_key unique (id, trip_id);
alter table public.trip_members add constraint trip_members_group_same_trip_fkey
  foreign key (group_id, trip_id) references public.trip_groups (id, trip_id) on delete set null;


-- ---------------------------------------------------------------------------
-- HÀM TRỢ GIÚP CHO POLICY
--
-- SECURITY DEFINER là bắt buộc: policy trên trip_members mà truy vấn chính
-- trip_members sẽ gây đệ quy. `set search_path` cũng bắt buộc — thiếu nó,
-- hàm definer thành lỗ hổng leo thang quyền.
-- ---------------------------------------------------------------------------
create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members tm
    where tm.trip_id = p_trip_id
      and tm.user_id = (select auth.uid())
      and tm.removed_at is null
  );
$$;

create or replace function public.is_trip_owner(p_trip_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members tm
    where tm.trip_id = p_trip_id
      and tm.user_id = (select auth.uid())
      and tm.removed_at is null
      and tm.role = 'owner'
  );
$$;

/** Người dùng có chung ít nhất một chuyến đi với hồ sơ đang xét. */
create or replace function public.shares_trip_with(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.trip_members me
    join public.trip_members other on other.trip_id = me.trip_id
    where me.user_id = (select auth.uid())
      and me.removed_at is null
      and other.user_id = p_user_id
      and other.removed_at is null
  );
$$;

revoke execute on function public.is_trip_member(uuid) from public;
revoke execute on function public.is_trip_owner(uuid) from public;
revoke execute on function public.shares_trip_with(uuid) from public;
grant execute on function public.is_trip_member(uuid) to authenticated;
grant execute on function public.is_trip_owner(uuid) to authenticated;
grant execute on function public.shares_trip_with(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- POLICY — profiles
-- ---------------------------------------------------------------------------
create policy "profiles_select_self_or_tripmate"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or public.shares_trip_with(id));

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
-- POLICY — trips
-- ---------------------------------------------------------------------------
-- Điều kiện `created_by` KHÔNG thừa. Client tạo chuyến đi bằng
-- insert(...).select('id'), và mệnh đề RETURNING khiến Postgres kiểm thêm
-- policy SELECT trên dòng vừa chèn. Tư cách thành viên của người tạo lại do
-- trigger trips_add_creator_as_member tạo ra SAU đó, mà is_trip_member khai
-- `stable` nên đọc theo snapshot đầu câu lệnh và không thấy dòng ấy.
-- Thiếu vế này thì không ai tạo được chuyến đi nào.
create policy "trips_select_member_or_creator"
  on public.trips for select
  to authenticated
  using (
    public.is_trip_member(id)
    or created_by = (select auth.uid())
  );

create policy "trips_insert_self_as_creator"
  on public.trips for insert
  to authenticated
  with check (created_by = (select auth.uid()));

create policy "trips_update_owner_or_creator"
  on public.trips for update
  to authenticated
  using (public.is_trip_owner(id) or created_by = (select auth.uid()))
  with check (public.is_trip_owner(id) or created_by = (select auth.uid()));

-- Không có policy DELETE: xoá chuyến đi = đặt deleted_at.


-- ---------------------------------------------------------------------------
-- POLICY — trip_groups
-- ---------------------------------------------------------------------------
create policy "trip_groups_select_member"
  on public.trip_groups for select
  to authenticated
  using (public.is_trip_member(trip_id));

create policy "trip_groups_write_member"
  on public.trip_groups for insert
  to authenticated
  with check (public.is_trip_member(trip_id));

create policy "trip_groups_update_member"
  on public.trip_groups for update
  to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));


-- ---------------------------------------------------------------------------
-- POLICY — trip_members
--
-- Cột user_id CỐ Ý không cho sửa qua policy thường: gắn tài khoản chỉ được
-- làm qua RPC join_trip_by_code(), nơi có kiểm mã mời. Trigger bên dưới chặn
-- mọi đường khác.
-- ---------------------------------------------------------------------------
create policy "trip_members_select_member"
  on public.trip_members for select
  to authenticated
  using (public.is_trip_member(trip_id));

create policy "trip_members_insert_member"
  on public.trip_members for insert
  to authenticated
  with check (public.is_trip_member(trip_id) and user_id is null);

create policy "trip_members_update_member"
  on public.trip_members for update
  to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));


-- ---------------------------------------------------------------------------
-- TRIGGER
-- ---------------------------------------------------------------------------
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

-- Bù hồ sơ cho tài khoản đã đăng ký TRƯỚC khi migration này chạy.
--
-- Trigger phía trên chỉ chạy khi INSERT vào auth.users, nên người đã tạo tài
-- khoản lúc thử app sẽ không có dòng nào trong profiles. Hệ quả: họ đăng nhập
-- được nhưng KHÔNG tạo được chuyến đi, vì trips.created_by tham chiếu profiles.
-- Lỗi đó rất khó đoán ra từ thông báo của PostgREST.
insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
    split_part(coalesce(u.email, 'nguoi-dung'), '@', 1)
  )
from auth.users u
on conflict (id) do nothing;


-- Người tạo chuyến đi tự động thành thành viên đầu tiên, vai trò owner.
-- SECURITY DEFINER vì lúc này họ chưa phải thành viên nên policy sẽ chặn.
create or replace function public.add_trip_creator_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select display_name into v_name from public.profiles where id = new.created_by;

  insert into public.trip_members (trip_id, display_name, user_id, role, sort_order)
  values (new.id, coalesce(v_name, 'Tôi'), new.created_by, 'owner', 0);

  return new;
end;
$$;

create trigger trips_add_creator_as_member
  after insert on public.trips
  for each row execute function public.add_trip_creator_as_member();


-- Khoá cột user_id và trip_id khỏi mọi lệnh UPDATE thông thường.
create or replace function public.protect_trip_member_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.trip_id is distinct from old.trip_id then
    raise exception 'Không được chuyển thành viên sang chuyến đi khác.' using errcode = '42501';
  end if;
  -- SECURITY DEFINER bỏ qua RLS nhưng KHÔNG bỏ qua trigger, nên RPC gắn tài
  -- khoản cũng sẽ bị chính trigger này chặn. Cửa duy nhất là cờ set_config
  -- cục bộ trong transaction — PostgREST không cho client tự đặt GUC này.
  if new.user_id is distinct from old.user_id
     and coalesce(current_setting('divvyup.allow_identity_change', true), 'off') <> 'on' then
    raise exception
      'Không được gắn hoặc gỡ tài khoản trực tiếp. Dùng RPC join_trip_by_code().'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trip_members_protect_identity
  before update on public.trip_members
  for each row execute function public.protect_trip_member_identity();


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

create trigger trips_touch_updated_at
  before update on public.trips
  for each row execute function public.touch_updated_at();
