-- ============================================================================
-- DivvyUp — 12. Cùng sửa chuyến đi, ghi chú chuyến đi, nhật ký khoản chi
--
-- Chạy SAU 20260917_1100_profile_payment_settled.sql.
--
-- 1. THÀNH VIÊN CÙNG SỬA CHUYẾN ĐI
--    Trước đây chỉ chủ chuyến/người tạo sửa được bảng trips (policy
--    trips_update_owner_or_creator), nên thành viên chọn ảnh bìa xong thấy
--    "chỉ chủ chuyến mới đổi được". Nay mọi thành viên ĐÃ NHẬN CHỖ
--    (is_trip_member) sửa được tên, ngày, địa điểm + bộ ảnh bìa, ảnh đang chọn.
--
--    Quyết định: làm bằng 3 RPC SECURITY DEFINER, KHÔNG nới policy UPDATE.
--    Policy phủ CẢ DÒNG: nới nó cho thành viên là cho họ sửa luôn deleted_at
--    (xoá chuyến của cả nhóm), join_code, created_by. RPC chỉ chạm đúng các cột
--    được phép và kiểm dữ liệu ở một chỗ.
--
--    Kèm trigger trips_guard_identity chặn đổi join_code/created_by/currency
--    bằng UPDATE thẳng (kể cả chủ chuyến qua policy cũ) trừ phiên quản trị.
--    Đã grep: không code nào đổi join_code — chưa có tính năng "đổi mã mời".
--    Khi làm tính năng đó, viết RPC riêng và mở bằng cờ set_config giống
--    divvyup.allow_identity_change, KHÔNG gỡ trigger.
--    currency: đổi đơn vị tiền của chuyến đã có khoản chi vốn đã bị khoá ngoại
--    composite chặn; chuyến chưa có khoản chi thì đổi được — nay chặn luôn cho
--    nhất quán, vì app không có luồng đổi tiền tệ.
--
--    Ảnh bìa kiểm ở TẦNG BẢNG (trigger trips_validate_cover, BEFORE INSERT OR
--    UPDATE OF cover_images, cover_image_index), không chỉ trong RPC: chủ chuyến
--    vẫn ghi thẳng trips qua policy cũ, và màn hình mọi thành viên đọc thẳng url
--    trong mảng. RPC không lặp lại kiểm tra — một nguồn chân lý.
--    Luật: ≤ 100 ảnh, pg_column_size ≤ 64 KiB; mỗi ảnh là object CHỈ có khoá
--    url, thumbUrl, credit, link, provider; url/thumbUrl https với host thuộc
--    images.unsplash.com, plus.unsplash.com, upload.wikimedia.org, i.pinimg.com;
--    link null hoặc https với host thuộc unsplash.com, www.unsplash.com,
--    commons.wikimedia.org, www.pinterest.com, pinterest.com; credit ≤ 200,
--    provider ≤ 20. Allowlist lấy từ các host mà Edge Function place-photos trả.
--    DỮ LIỆU CŨ: trigger chỉ kiểm phần tử khi cover_images THỰC SỰ đổi giá trị
--    (UPDATE OF bắn cả khi cột chỉ nằm trong SET, nên so old/new trong hàm).
--    Ảnh lưu trước migration này (kể cả bản chuyển từ cột đơn lẻ ở 20260916_1030,
--    thumbUrl = url, provider có thể là 'upload') không bị kiểm lại khi lướt
--    carousel; chỉ bị kiểm khi ai đó lưu bộ ảnh MỚI. Truy vấn đếm ảnh cũ ngoài
--    allowlist nằm trong verify.sql (mục 19) — chạy để biết có bao nhiêu.
--    Hạn chế đã biết: Pinterest API trả item.link là trang đích của pin (host
--    bất kỳ) → ảnh Pinterest sẽ bị trigger từ chối cho tới khi place-photos
--    luôn trả link dạng https://www.pinterest.com/pin/<id>/. Hiện Pinterest trả
--    403 (chưa có Partner Access) nên chưa phát sinh.
--
--    set_trip_cover_if_empty: tải ảnh bìa NỀN sau khi chọn điểm đến. So-rồi-ghi
--    phải ở máy chủ trong MỘT câu UPDATE (điểm đến vẫn là cái đã tìm ảnh cho,
--    bộ ảnh vẫn rỗng) — so ở client rồi mới ghi thì ghi đè địa điểm/ảnh mà
--    người khác vừa đổi trong lúc đang tải.
--
-- 2. trip_notes — ghi chú dùng chung của chuyến (kế hoạch, lưu ý, mô tả).
--    Mọi thành viên đọc/thêm/sửa. Không có xoá cứng: xoá = đặt deleted_at, một
--    chiều (forbid_undelete). updated_by do trigger điền bằng auth.uid(), client
--    không mạo danh được "ai sửa cuối".
--    Policy SELECT KHÔNG lọc deleted_at (cùng cách với expenses): UPDATE đặt
--    deleted_at kèm RETURNING phải thấy được dòng mới, lọc ở policy thì xoá mềm
--    báo lỗi RLS. Client tự lọc deleted_at is null.
--    INSERT/UPDATE chỉ được khi CHUYẾN chưa xoá mềm. created_at/updated_at do
--    trigger đặt lúc INSERT (client không gửi giờ giả). updated_at là khoá lạc
--    quan: client sửa kèm .eq('updated_at', <giá trị đã đọc>), trúng 0 dòng =
--    người khác vừa sửa.
--
-- 3. expense_events — nhật ký thay đổi khoản chi, trả lời "ai sửa khoản này,
--    sửa từ bao nhiêu thành bao nhiêu".
--    Ghi BÊN TRONG 4 RPC create/update/void_expense, set_expense_settled — cùng
--    transaction với thay đổi, nên không thể có thay đổi mà thiếu dòng nhật ký
--    (hay ngược lại). Không ghi bằng trigger trên expenses: update_expense ghi
--    expenses rồi xoá/chèn lại expense_shares, trigger dòng không thấy được
--    "ảnh chụp trọn khoản chi" trước và sau.
--    Bảng chỉ có policy SELECT; không policy ghi — client không sửa được lịch sử.
--
--    Hệ quả bắt buộc: DROP policy expenses_update_member. Nó cho mọi thành viên
--    sửa thẳng expenses qua PostgREST (mô tả, số tiền...) — vòng qua RPC là
--    vòng qua nhật ký. Đã grep: app không gọi .update() trên expenses; mọi thay
--    đổi đi qua RPC. (Số tiền đổi thẳng vốn cũng bị trigger bất biến tổng chặn,
--    nhưng mô tả/người trả/paid_at thì không.)
--
--    4 RPC được `create or replace` bằng bản sao NGUYÊN thân bản mới nhất
--    (create_expense, void_expense: 20260915_1120; update_expense,
--    set_expense_settled: 20260917_1100), chữ ký giữ nguyên, chỉ thêm:
--      - `for update` ở câu đọc khoản chi (update/void/settle): khoá dòng trước
--        khi chụp ảnh "trước", hai lần sửa song song không ghi nhật ký lệch.
--      - chụp ảnh + ghi nhật ký.
--      - update/void/settle: từ chối khi CHUYẾN đã xoá mềm (create vốn đã kiểm).
--      - update_expense: kiểm số tiền > 0, danh sách chia không rỗng, người trả
--        và mọi người gánh còn hoạt động và cùng chuyến — như create_expense
--        (bản 20260917_1100 thiếu, trigger chỉ chặn khác chuyến, không chặn
--        người đã rời chuyến).
--    set_expense_settled chỉ ghi khi settled_at thực sự đổi (bấm "xong" hai lần
--    không sinh hai dòng).
--
-- Rollback:
--   apply lại create_expense, void_expense trong 20260915_1120_rpc.sql và
--     update_expense, set_expense_settled trong 20260917_1100;
--   create policy "expenses_update_member" (xem 20260915_1110_expenses.sql);
--   drop table if exists public.expense_events;
--   drop function if exists public.log_expense_event(uuid, uuid, text, jsonb, jsonb),
--     public.expense_snapshot(uuid);
--   drop table if exists public.trip_notes;
--   drop function if exists public.set_trip_note_actor();
--   drop trigger if exists trips_guard_identity on public.trips;
--   drop function if exists public.guard_trip_identity_columns();
--   drop trigger if exists trips_validate_cover on public.trips;
--   drop function if exists public.validate_trip_cover();
--   drop function if exists public.update_trip_details(uuid, text, date, date),
--     public.update_trip_place(uuid, text, text, text, double precision,
--       double precision, text, text, jsonb, integer),
--     public.set_trip_cover_index(uuid, integer),
--     public.set_trip_cover_if_empty(uuid, text, jsonb);
--   (Lịch sử và ghi chú mất theo bảng — sao lưu trước nếu cần giữ.)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Chuyến đi: khoá cột định danh + 3 RPC sửa cho thành viên
-- ---------------------------------------------------------------------------
create or replace function public.guard_trip_identity_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.join_code is distinct from old.join_code
      or new.created_by is distinct from old.created_by
      or new.currency is distinct from old.currency)
     and not public.is_privileged_session() then
    raise exception 'Không được đổi mã mời, người tạo hay đơn vị tiền tệ của chuyến đi.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trips_guard_identity on public.trips;

create trigger trips_guard_identity
  before update on public.trips
  for each row execute function public.guard_trip_identity_columns();


-- Kiểm bộ ảnh bìa ở tầng bảng (xem mục 1 ở đầu file). SECURITY INVOKER: không
-- cần quyền gì ngoài đọc NEW/OLD. Mọi thông báo lỗi ở đây là thông báo người
-- dùng thấy khi lưu ảnh bìa — RPC không kiểm lại.
create or replace function public.validate_trip_cover()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item        jsonb;
  v_bad_key     text;
  v_key         text;
  v_host        text;
  v_count       integer;
  -- https, host chỉ gồm chữ/số/./-, không userinfo, không cổng; sau host là
  -- hết chuỗi hoặc / ? #. Không khoảng trắng ở bất kỳ đâu.
  c_https       constant text := '^https://([A-Za-z0-9.-]+)([/?#][^[:space:]]*)?$';
  c_image_hosts constant text[] := array[
    'images.unsplash.com', 'plus.unsplash.com', 'upload.wikimedia.org', 'i.pinimg.com'
  ];
  c_link_hosts  constant text[] := array[
    'unsplash.com', 'www.unsplash.com', 'commons.wikimedia.org',
    'www.pinterest.com', 'pinterest.com'
  ];
begin
  if jsonb_typeof(new.cover_images) is distinct from 'array' then
    raise exception 'Bộ ảnh bìa phải là một danh sách.' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(new.cover_images);

  -- Chỉ số nằm ngoài mảng. CHECK trips_cover_index_in_range cũng chặn; kiểm ở
  -- đây để người dùng nhận thông báo đọc được thay vì tên constraint.
  if new.cover_image_index is null
     or new.cover_image_index < 0
     or new.cover_image_index >= greatest(v_count, 1) then
    raise exception 'Vị trí ảnh bìa nằm ngoài bộ ảnh.' using errcode = '22023';
  end if;

  -- Bộ ảnh không đổi (lướt carousel, lưu lại cùng bộ ảnh): không kiểm lại phần
  -- tử — dữ liệu cũ lưu trước luật này không được làm hỏng thao tác khác.
  if tg_op = 'UPDATE' and new.cover_images is not distinct from old.cover_images then
    return new;
  end if;

  if v_count > 100 then
    raise exception 'Bộ ảnh bìa tối đa 100 ảnh.' using errcode = '22023';
  end if;
  if pg_column_size(new.cover_images) > 65536 then
    raise exception 'Bộ ảnh bìa quá lớn (tối đa 64 KB).' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(new.cover_images) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Ảnh bìa không hợp lệ (không phải object).' using errcode = '22023';
    end if;

    select k into v_bad_key
    from jsonb_object_keys(v_item) as k
    where k not in ('url', 'thumbUrl', 'credit', 'link', 'provider')
    limit 1;
    if v_bad_key is not null then
      raise exception 'Ảnh bìa có trường lạ "%".', v_bad_key using errcode = '22023';
    end if;

    -- url và thumbUrl: bắt buộc, https, host trong allowlist ảnh.
    foreach v_key in array array['url', 'thumbUrl'] loop
      if jsonb_typeof(v_item -> v_key) is distinct from 'string' then
        raise exception 'Ảnh bìa thiếu đường dẫn "%".', v_key using errcode = '22023';
      end if;
      v_host := lower(substring(v_item ->> v_key from c_https));
      if v_host is null or not (v_host = any (c_image_hosts)) then
        raise exception 'Ảnh bìa phải là https từ nguồn được hỗ trợ (Unsplash, Wikimedia, Pinterest).'
          using errcode = '22023';
      end if;
    end loop;

    -- link: null/thiếu, hoặc https với host trong allowlist trang nguồn.
    if coalesce(jsonb_typeof(v_item -> 'link'), 'null') <> 'null' then
      if jsonb_typeof(v_item -> 'link') <> 'string' then
        raise exception 'Đường dẫn nguồn ảnh bìa không hợp lệ.' using errcode = '22023';
      end if;
      v_host := lower(substring(v_item ->> 'link' from c_https));
      if v_host is null or not (v_host = any (c_link_hosts)) then
        raise exception 'Đường dẫn nguồn ảnh bìa phải là https tới trang nguồn được hỗ trợ.'
          using errcode = '22023';
      end if;
    end if;

    if coalesce(jsonb_typeof(v_item -> 'credit'), 'null') not in ('null', 'string')
       or length(v_item ->> 'credit') > 200 then
      raise exception 'Ghi công ảnh bìa tối đa 200 ký tự.' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_item -> 'provider'), 'null') not in ('null', 'string')
       or length(v_item ->> 'provider') > 20 then
      raise exception 'Nguồn ảnh bìa tối đa 20 ký tự.' using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trips_validate_cover on public.trips;

create trigger trips_validate_cover
  before insert or update of cover_images, cover_image_index on public.trips
  for each row execute function public.validate_trip_cover();


-- Tên, ngày bắt đầu/kết thúc.
create or replace function public.update_trip_details(
  p_trip_id    uuid,
  p_name       text,
  p_start_date date,
  p_end_date   date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
begin
  if (select auth.uid()) is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Bạn không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  perform 1 from public.trips t
  where t.id = p_trip_id and t.deleted_at is null
  for update;
  if not found then
    raise exception 'Chuyến đi không tồn tại hoặc đã bị xoá.' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'Tên chuyến đi không được để trống.' using errcode = '22023';
  end if;
  if length(v_name) > 120 then
    raise exception 'Tên chuyến đi tối đa 120 ký tự.' using errcode = '22023';
  end if;
  if p_start_date is not null and p_end_date is not null and p_start_date > p_end_date then
    raise exception 'Ngày kết thúc phải sau ngày bắt đầu.' using errcode = '22023';
  end if;

  update public.trips
  set name       = v_name,
      start_date = p_start_date,
      end_date   = p_end_date
  where id = p_trip_id;
end;
$$;


-- Điểm đến + bộ ảnh bìa. Ghi đủ mọi cột mỗi lần (xem ghi chú ở
-- src/lib/data/trips.ts): bỏ sót một cột là để lại mảnh địa điểm cũ.
-- p_place_name rỗng/null = gỡ điểm đến → mọi cột place_* về null.
create or replace function public.update_trip_place(
  p_trip_id           uuid,
  p_place_name        text,
  p_place_address     text,
  p_place_country     text,
  p_latitude          double precision,
  p_longitude         double precision,
  p_place_provider    text,
  p_place_external_id text,
  p_cover_images      jsonb,
  p_cover_index       integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text := nullif(trim(coalesce(p_place_name, '')), '');
  v_images jsonb := coalesce(p_cover_images, '[]'::jsonb);
  v_index  integer := coalesce(p_cover_index, 0);
begin
  if (select auth.uid()) is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Bạn không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  perform 1 from public.trips t
  where t.id = p_trip_id and t.deleted_at is null
  for update;
  if not found then
    raise exception 'Chuyến đi không tồn tại hoặc đã bị xoá.' using errcode = '42501';
  end if;

  if v_name is not null and (p_latitude is null) <> (p_longitude is null) then
    raise exception 'Toạ độ điểm đến phải có đủ vĩ độ và kinh độ.' using errcode = '22023';
  end if;

  -- Bộ ảnh bìa + chỉ số: trigger trips_validate_cover kiểm (một nguồn chân lý
  -- cho cả RPC lẫn ghi thẳng bảng). Các ràng buộc cột (độ dài, provider, toạ
  -- độ trong khoảng) do CHECK của bảng trips ép.
  update public.trips
  set place_name        = v_name,
      place_address     = case when v_name is null then null else p_place_address end,
      place_country     = case when v_name is null then null else p_place_country end,
      latitude          = case when v_name is null then null else p_latitude end,
      longitude         = case when v_name is null then null else p_longitude end,
      place_provider    = case when v_name is null then null else p_place_provider end,
      place_external_id = case when v_name is null then null else p_place_external_id end,
      cover_images      = v_images,
      cover_image_index = v_index
  where id = p_trip_id;
end;
$$;


-- Đổi riêng ảnh đang hiển thị (lướt carousel).
create or replace function public.set_trip_cover_index(
  p_trip_id uuid,
  p_index   integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Bạn không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  perform 1 from public.trips t
  where t.id = p_trip_id and t.deleted_at is null
  for update;
  if not found then
    raise exception 'Chuyến đi không tồn tại hoặc đã bị xoá.' using errcode = '42501';
  end if;

  -- Chỉ số ngoài bộ ảnh (kể cả null): trigger trips_validate_cover từ chối.
  update public.trips set cover_image_index = p_index where id = p_trip_id;
end;
$$;


-- Ghi bộ ảnh bìa tải NỀN sau khi chọn điểm đến — chỉ khi điểm đến vẫn là cái
-- đã tìm ảnh cho VÀ chuyến chưa có ảnh. So và ghi trong một câu UPDATE (khoá
-- dòng ngầm), nên không đè lên địa điểm/ảnh người khác vừa đổi.
-- p_expected_place_key = coalesce(place_external_id, place_name) lúc bắt đầu
-- tải (client: placeKeyOf trong src/lib/data/trips.ts).
-- Trả true nếu đã ghi, false nếu điều kiện không còn đúng (không phải lỗi).
create or replace function public.set_trip_cover_if_empty(
  p_trip_id            uuid,
  p_expected_place_key text,
  p_cover_images       jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Bạn không thuộc chuyến đi này.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.trips t where t.id = p_trip_id and t.deleted_at is null
  ) then
    raise exception 'Chuyến đi không tồn tại hoặc đã bị xoá.' using errcode = '42501';
  end if;

  -- Bộ ảnh do trigger trips_validate_cover kiểm.
  update public.trips
  set cover_images      = p_cover_images,
      cover_image_index = 0
  where id = p_trip_id
    and deleted_at is null
    and coalesce(place_external_id, place_name) = p_expected_place_key
    and jsonb_array_length(cover_images) = 0;

  return found;
end;
$$;

revoke execute on function public.update_trip_details(uuid, text, date, date) from public, anon;
revoke execute on function public.update_trip_place(
  uuid, text, text, text, double precision, double precision, text, text, jsonb, integer
) from public, anon;
revoke execute on function public.set_trip_cover_index(uuid, integer) from public, anon;
revoke execute on function public.set_trip_cover_if_empty(uuid, text, jsonb) from public, anon;

grant execute on function public.update_trip_details(uuid, text, date, date) to authenticated;
grant execute on function public.update_trip_place(
  uuid, text, text, text, double precision, double precision, text, text, jsonb, integer
) to authenticated;
grant execute on function public.set_trip_cover_index(uuid, integer) to authenticated;
grant execute on function public.set_trip_cover_if_empty(uuid, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. trip_notes
-- ---------------------------------------------------------------------------
create table if not exists public.trip_notes (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  -- Cho phép tiêu đề rỗng: ghi chú nhanh không bắt đặt tên.
  title      text not null default '' check (length(title) <= 120),
  body       text not null default '' check (length(body) <= 10000),
  template   text check (template is null or template in ('plan', 'notes', 'description')),
  sort_order integer not null default 0,
  -- default auth.uid(): client không cần gửi; policy INSERT vẫn ép bằng uid.
  created_by uuid not null default auth.uid() references public.profiles (id),
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.trip_notes enable row level security;

create index if not exists trip_notes_trip_idx
  on public.trip_notes (trip_id, sort_order)
  where deleted_at is null;

-- Điền updated_by, thứ tự; khoá trip_id/created_by/created_at sau khi tạo.
-- Không dùng forbid_changing_trip_scope: hàm đó đọc new.currency, bảng này
-- không có cột currency.
create or replace function public.set_trip_note_actor()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    -- Giờ do máy chủ đặt: updated_at là khoá lạc quan, client gửi giờ giả thì
    -- khoá đó vô nghĩa.
    new.created_at := now();
    new.updated_at := now();
    new.sort_order := coalesce(
      (select max(n.sort_order) + 1 from public.trip_notes n
       where n.trip_id = new.trip_id and n.deleted_at is null),
      0
    );
  else
    if new.trip_id is distinct from old.trip_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Không được chuyển ghi chú sang chuyến khác hay đổi người tạo.'
        using errcode = '42501';
    end if;
  end if;

  -- Phiên quản trị (uid null) giữ nguyên giá trị đang có.
  if v_uid is not null then
    new.updated_by := v_uid;
  end if;
  return new;
end;
$$;

drop trigger if exists trip_notes_set_actor on public.trip_notes;
create trigger trip_notes_set_actor
  before insert or update on public.trip_notes
  for each row execute function public.set_trip_note_actor();

drop trigger if exists trip_notes_forbid_undelete on public.trip_notes;
create trigger trip_notes_forbid_undelete
  before update on public.trip_notes
  for each row execute function public.forbid_undelete();

drop trigger if exists trip_notes_touch_updated_at on public.trip_notes;
create trigger trip_notes_touch_updated_at
  before update on public.trip_notes
  for each row execute function public.touch_updated_at();

drop policy if exists "trip_notes_select_member" on public.trip_notes;
create policy "trip_notes_select_member"
  on public.trip_notes for select
  to authenticated
  using (public.is_trip_member(trip_id));

drop policy if exists "trip_notes_insert_member" on public.trip_notes;
create policy "trip_notes_insert_member"
  on public.trip_notes for insert
  to authenticated
  with check (
    public.is_trip_member(trip_id)
    and created_by = (select auth.uid())
    and deleted_at is null
    -- Chuyến đã xoá mềm thì không ghi thêm gì vào.
    and exists (
      select 1 from public.trips t
      where t.id = trip_notes.trip_id and t.deleted_at is null
    )
  );

drop policy if exists "trip_notes_update_member" on public.trip_notes;
create policy "trip_notes_update_member"
  on public.trip_notes for update
  to authenticated
  using (
    public.is_trip_member(trip_id)
    and exists (
      select 1 from public.trips t
      where t.id = trip_notes.trip_id and t.deleted_at is null
    )
  )
  with check (
    public.is_trip_member(trip_id)
    and exists (
      select 1 from public.trips t
      where t.id = trip_notes.trip_id and t.deleted_at is null
    )
  );

-- Không có policy DELETE: xoá = đặt deleted_at.


-- ---------------------------------------------------------------------------
-- 3. expense_events
-- ---------------------------------------------------------------------------
create table if not exists public.expense_events (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips (id) on delete cascade,
  expense_id      uuid not null references public.expenses (id) on delete cascade,
  action          text not null
                  check (action in ('create', 'update', 'void', 'settle', 'unsettle')),
  actor_user_id   uuid references public.profiles (id) on delete set null,
  -- trip_members.id của người gọi; null khi phiên quản trị hoặc không tìm thấy.
  actor_member_id uuid references public.trip_members (id) on delete set null,
  before          jsonb,
  after           jsonb,
  created_at      timestamptz not null default now(),

  -- Hình dạng theo hành động: tạo chỉ có "sau", huỷ chỉ có "trước".
  constraint expense_events_shape check (
    case action
      when 'create' then before is null and after is not null
      when 'void'   then before is not null and after is null
      else before is not null and after is not null
    end
  )
);

alter table public.expense_events enable row level security;

create index if not exists expense_events_expense_idx
  on public.expense_events (expense_id, created_at);

-- Phòng thủ thêm ngoài RLS: role của client không có quyền ghi bảng này.
revoke insert, update, delete, truncate on public.expense_events from anon, authenticated;

drop policy if exists "expense_events_select_member" on public.expense_events;
create policy "expense_events_select_member"
  on public.expense_events for select
  to authenticated
  using (public.is_trip_member(trip_id));
-- Cố ý KHÔNG có policy INSERT/UPDATE/DELETE: chỉ RPC SECURITY DEFINER ghi.


-- Ảnh chụp trọn một khoản chi (kể cả đã huỷ). Hàm NỘI BỘ: chỉ gọi từ RPC
-- definer, client không có quyền EXECUTE.
create or replace function public.expense_snapshot(p_expense_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'description',  e.description,
    'amount_minor', e.amount_minor,
    'currency',     e.currency,
    'paid_by',      e.paid_by,
    'split_mode',   e.split_mode,
    'paid_at',      e.paid_at,
    'settled_at',   e.settled_at,
    'shares', coalesce(
      (select jsonb_agg(
                jsonb_build_object('member_id', s.member_id, 'amount_minor', s.amount_minor)
                order by s.member_id)
       from public.expense_shares s
       where s.expense_id = e.id),
      '[]'::jsonb
    )
  )
  from public.expenses e
  where e.id = p_expense_id;
$$;

create or replace function public.log_expense_event(
  p_trip_id    uuid,
  p_expense_id uuid,
  p_action     text,
  p_before     jsonb,
  p_after      jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  insert into public.expense_events
    (trip_id, expense_id, action, actor_user_id, actor_member_id, before, after)
  values (
    p_trip_id,
    p_expense_id,
    p_action,
    v_uid,
    (select tm.id from public.trip_members tm
     where tm.trip_id = p_trip_id and tm.user_id = v_uid and tm.removed_at is null
     limit 1),
    p_before,
    p_after
  );
end;
$$;

revoke execute on function public.expense_snapshot(uuid) from public, anon, authenticated;
revoke execute on function public.log_expense_event(uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;


-- Đóng đường sửa thẳng expenses (xem mục 3 ở đầu file).
drop policy if exists "expenses_update_member" on public.expenses;


-- ---------------------------------------------------------------------------
-- 3a. create_expense — bản sao 20260915_1120 + ghi nhật ký 'create'
-- ---------------------------------------------------------------------------
create or replace function public.create_expense(
  p_trip_id      uuid,
  p_description  text,
  p_amount_minor bigint,
  p_paid_by      uuid,
  p_shares       jsonb,   -- [{"member_id":"<uuid>","amount_minor":123}, ...]
  p_split_mode   public.split_mode default 'equal',
  p_paid_at      timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_currency   public.currency_code;
  v_expense_id uuid;
  v_owed       bigint;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Bạn không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  select t.currency into v_currency
  from public.trips t
  where t.id = p_trip_id and t.deleted_at is null;

  if not found then
    -- Cùng thông báo cho "không tồn tại" và "không có quyền": phân biệt sẽ
    -- tiết lộ sự tồn tại của chuyến đi mà người gọi không được thấy.
    raise exception 'Chuyến đi không tồn tại hoặc đã bị xoá.' using errcode = '42501';
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Khoản chi phải lớn hơn 0.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'Phải có ít nhất một người gánh khoản chi.' using errcode = '22023';
  end if;

  -- Bất biến tổng, kiểm TRƯỚC khi ghi.
  select coalesce(sum((item ->> 'amount_minor')::bigint), 0) into v_owed
  from jsonb_array_elements(p_shares) as item;

  if v_owed <> p_amount_minor then
    raise exception
      'Tổng phần chia (%) khác tổng khoản chi (%).', v_owed, p_amount_minor
      using errcode = 'check_violation';
  end if;

  -- Người trả và mọi người gánh đều phải thuộc chuyến đi và còn hoạt động.
  if not exists (
    select 1 from public.trip_members tm
    where tm.id = p_paid_by and tm.trip_id = p_trip_id and tm.removed_at is null
  ) then
    raise exception 'Người đại diện trả tiền không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_shares) as item
    where not exists (
      select 1 from public.trip_members tm
      where tm.id = (item ->> 'member_id')::uuid
        and tm.trip_id = p_trip_id
        and tm.removed_at is null
    )
  ) then
    raise exception 'Danh sách có người không thuộc chuyến đi.' using errcode = '42501';
  end if;

  insert into public.expenses
    (trip_id, currency, description, amount_minor, paid_by, split_mode, paid_at, created_by)
  values
    (p_trip_id, v_currency, p_description, p_amount_minor, p_paid_by, p_split_mode, p_paid_at, v_uid)
  returning id into v_expense_id;

  insert into public.expense_shares (expense_id, member_id, amount_minor)
  select v_expense_id,
         (item ->> 'member_id')::uuid,
         (item ->> 'amount_minor')::bigint
  from jsonb_array_elements(p_shares) as item;

  -- Nhật ký (migration 12).
  perform public.log_expense_event(
    p_trip_id, v_expense_id, 'create', null, public.expense_snapshot(v_expense_id)
  );

  return v_expense_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3b. update_expense — bản sao 20260917_1100 + khoá dòng + nhật ký 'update'
-- ---------------------------------------------------------------------------
create or replace function public.update_expense(
  p_expense_id   uuid,
  p_description  text,
  p_amount_minor bigint,
  p_paid_by      uuid,
  p_shares       jsonb,
  p_split_mode   public.split_mode,
  p_paid_at      timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_trip_id uuid;
  v_owed    bigint;
  v_before  jsonb;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;

  -- Join trips: chuyến đã xoá mềm thì khoản chi của nó coi như không sửa được.
  select e.trip_id into v_trip_id
  from public.expenses e
  join public.trips t on t.id = e.trip_id and t.deleted_at is null
  where e.id = p_expense_id and e.deleted_at is null
  for update of e;

  if not found then
    raise exception 'Khoản chi không tồn tại hoặc đã bị huỷ.' using errcode = '42501';
  end if;
  if not public.is_trip_member(v_trip_id) then
    raise exception 'Bạn không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Khoản chi phải lớn hơn 0.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_shares) is distinct from 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'Phải có ít nhất một người gánh khoản chi.' using errcode = '22023';
  end if;

  select coalesce(sum((item ->> 'amount_minor')::bigint), 0) into v_owed
  from jsonb_array_elements(p_shares) as item;

  if v_owed <> p_amount_minor then
    raise exception
      'Tổng phần chia (%) khác tổng khoản chi (%).', v_owed, p_amount_minor
      using errcode = 'check_violation';
  end if;

  -- Người trả và mọi người gánh: thuộc chuyến và còn hoạt động — như create_expense.
  if not exists (
    select 1 from public.trip_members tm
    where tm.id = p_paid_by and tm.trip_id = v_trip_id and tm.removed_at is null
  ) then
    raise exception 'Người đại diện trả tiền không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_shares) as item
    where not exists (
      select 1 from public.trip_members tm
      where tm.id = (item ->> 'member_id')::uuid
        and tm.trip_id = v_trip_id
        and tm.removed_at is null
    )
  ) then
    raise exception 'Danh sách có người không thuộc chuyến đi.' using errcode = '42501';
  end if;

  v_before := public.expense_snapshot(p_expense_id);

  perform set_config('divvyup.allow_settle_change', 'on', true);

  update public.expenses
  set description  = p_description,
      amount_minor = p_amount_minor,
      paid_by      = p_paid_by,
      split_mode   = p_split_mode,
      paid_at      = p_paid_at,
      settled_at   = null,
      settled_by   = null
  where id = p_expense_id;

  delete from public.expense_shares where expense_id = p_expense_id;

  insert into public.expense_shares (expense_id, member_id, amount_minor)
  select p_expense_id,
         (item ->> 'member_id')::uuid,
         (item ->> 'amount_minor')::bigint
  from jsonb_array_elements(p_shares) as item;

  perform public.log_expense_event(
    v_trip_id, p_expense_id, 'update', v_before, public.expense_snapshot(p_expense_id)
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 3c. void_expense — bản sao 20260915_1120 + khoá dòng + nhật ký 'void'
-- ---------------------------------------------------------------------------
create or replace function public.void_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_before  jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;

  select e.trip_id into v_trip_id
  from public.expenses e
  join public.trips t on t.id = e.trip_id and t.deleted_at is null
  where e.id = p_expense_id and e.deleted_at is null
  for update of e;

  if not found then
    raise exception 'Khoản chi không tồn tại hoặc đã bị huỷ.' using errcode = '42501';
  end if;
  if not public.is_trip_member(v_trip_id) then
    raise exception 'Bạn không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  v_before := public.expense_snapshot(p_expense_id);

  update public.expenses set deleted_at = now() where id = p_expense_id;

  perform public.log_expense_event(v_trip_id, p_expense_id, 'void', v_before, null);
end;
$$;


-- ---------------------------------------------------------------------------
-- 3d. set_expense_settled — bản sao 20260917_1100 + khoá dòng + nhật ký
-- ---------------------------------------------------------------------------
create or replace function public.set_expense_settled(p_expense_id uuid, p_settled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_trip_id    uuid;
  v_payer_user uuid;
  v_created_by uuid;
  v_before     jsonb;
  v_after      jsonb;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;

  select e.trip_id, tm.user_id, e.created_by
    into v_trip_id, v_payer_user, v_created_by
  from public.expenses e
  join public.trip_members tm on tm.id = e.paid_by
  join public.trips t on t.id = e.trip_id and t.deleted_at is null
  where e.id = p_expense_id and e.deleted_at is null
  for update of e;

  if not found then
    raise exception 'Khoản chi không tồn tại hoặc đã bị huỷ.' using errcode = '42501';
  end if;
  if not public.is_trip_member(v_trip_id) then
    raise exception 'Bạn không thuộc chuyến đi này.' using errcode = '42501';
  end if;

  -- Đánh dấu xong = xoá nợ của mọi người trong khoản này. Chỉ người ĐƯỢC NHẬN
  -- tiền mới có quyền xác nhận "đã nhận đủ": người đã trả (nếu đã vào app), hoặc
  -- chủ chuyến, hoặc — khi người trả chưa có tài khoản — người đã ghi khoản chi.
  -- Không có chốt này, người đang nợ tự bấm là hết nợ.
  -- Bỏ đánh dấu thì ai cũng được: chiều đó chỉ làm nợ hiện lại.
  if p_settled
     and not public.is_trip_owner(v_trip_id)
     and v_payer_user is distinct from v_uid
     and not (v_payer_user is null and v_created_by = v_uid) then
    raise exception
      'Chỉ người đã trả tiền khoản này (hoặc chủ chuyến) mới đánh dấu đã xong được.'
      using errcode = '42501';
  end if;

  if p_settled and exists (
    select 1 from public.settlements s
    where s.trip_id = v_trip_id and s.deleted_at is null
  ) then
    raise exception
      'Chuyến đi đã ghi tất toán nên không đánh dấu từng khoản đã xong được — số dư sẽ bị tính hai lần.'
      using errcode = '22023';
  end if;

  v_before := public.expense_snapshot(p_expense_id);

  perform set_config('divvyup.allow_settle_change', 'on', true);

  update public.expenses
  set settled_at = case when p_settled then coalesce(settled_at, now()) else null end,
      settled_by = case when p_settled then coalesce(settled_by, v_uid) else null end
  where id = p_expense_id;

  v_after := public.expense_snapshot(p_expense_id);

  -- Bấm lại trạng thái đang có thì không có gì để ghi.
  if (v_before ->> 'settled_at') is distinct from (v_after ->> 'settled_at') then
    perform public.log_expense_event(
      v_trip_id, p_expense_id,
      case when p_settled then 'settle' else 'unsettle' end,
      v_before, v_after
    );
  end if;
end;
$$;

-- create or replace giữ nguyên quyền cũ; lặp lại để file tự đủ khi đọc riêng.
revoke execute on function
  public.create_expense(uuid, text, bigint, uuid, jsonb, public.split_mode, timestamptz)
  from public, anon;
revoke execute on function
  public.update_expense(uuid, text, bigint, uuid, jsonb, public.split_mode, timestamptz)
  from public, anon;
revoke execute on function public.void_expense(uuid) from public, anon;
revoke execute on function public.set_expense_settled(uuid, boolean) from public, anon;

grant execute on function
  public.create_expense(uuid, text, bigint, uuid, jsonb, public.split_mode, timestamptz)
  to authenticated;
grant execute on function
  public.update_expense(uuid, text, bigint, uuid, jsonb, public.split_mode, timestamptz)
  to authenticated;
grant execute on function public.void_expense(uuid) to authenticated;
grant execute on function public.set_expense_settled(uuid, boolean) to authenticated;
