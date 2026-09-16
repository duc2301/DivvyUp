-- ============================================================================
-- DivvyUp — 08. Bộ ảnh bìa cho chuyến đi
--
-- Trước đây mỗi chuyến chỉ giữ MỘT ảnh bìa qua bốn cột rời. Giờ giữ cả danh
-- sách ảnh đã tìm được để người dùng lướt qua lại trên màn chuyến đi, và nhớ
-- ảnh nào đang được chọn.
--
-- Lưu bằng jsonb chứ không tách bảng riêng: đây là dữ liệu hiển thị thuần tuý,
-- không bao giờ cần join, lọc hay thống kê theo từng ảnh. Tách bảng chỉ thêm
-- một lần truy vấn cho mọi màn hình mà không đổi lại được gì.
--
-- Bốn cột ảnh đơn lẻ bị GỠ BỎ sau khi chuyển dữ liệu sang danh sách — giữ cả
-- hai sẽ thành hai nguồn chân lý cho cùng một thứ, kiểu gì cũng có lúc lệch.
--
-- Rollback: thêm lại bốn cột cũ, chuyển phần tử đầu của cover_images về, rồi
-- drop cover_images và cover_image_index.
-- ============================================================================

alter table public.trips
  -- Mảng các object { url, thumbUrl, credit, link, provider }.
  add column cover_images jsonb not null default '[]'::jsonb,
  -- Vị trí ảnh đang hiển thị trong mảng trên.
  add column cover_image_index integer not null default 0;

-- Chuyển ảnh bìa đơn lẻ đang có thành phần tử đầu tiên của danh sách.
update public.trips
set cover_images = jsonb_build_array(
      jsonb_build_object(
        'url', cover_image_url,
        'thumbUrl', cover_image_url,
        'credit', cover_image_credit,
        'link', cover_image_link,
        'provider', cover_image_provider
      )
    )
where cover_image_url is not null;

alter table public.trips
  drop column cover_image_url,
  drop column cover_image_credit,
  drop column cover_image_link,
  drop column cover_image_provider;

-- cover_images phải là MẢNG, không phải object hay chuỗi. Thiếu ràng buộc này
-- thì một lần ghi sai kiểu sẽ làm màn hình nổ lúc đọc chứ không phải lúc ghi.
alter table public.trips
  add constraint trips_cover_images_is_array
  check (jsonb_typeof(cover_images) = 'array');

-- Chỉ số phải nằm trong mảng. Trỏ ra ngoài thì ảnh bìa biến mất mà không ai
-- hiểu vì sao — greatest(...,1) cho phép index 0 khi mảng còn rỗng.
alter table public.trips
  add constraint trips_cover_index_in_range
  check (
    cover_image_index >= 0
    and cover_image_index < greatest(jsonb_array_length(cover_images), 1)
  );

comment on column public.trips.cover_images is
  'Danh sách ảnh bìa tìm được. Không tải file về Storage — ảnh thuộc về nhà cung cấp.';
comment on column public.trips.cover_image_index is
  'Vị trí ảnh đang hiển thị trong cover_images.';
