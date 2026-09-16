-- ============================================================================
-- DivvyUp — 07. Địa điểm du lịch của chuyến đi
--
-- Mỗi chuyến đi có MỘT điểm đến. Lưu thẳng trên bảng trips thay vì tách bảng
-- riêng: quan hệ là một-một, tách ra chỉ thêm một lần join cho mọi truy vấn mà
-- không đổi lại được gì. Khi nào cần nhiều điểm đến trong một chuyến thì mới
-- tách bảng trip_destinations — đó là thay đổi có chủ đích, không phải đoán trước.
--
-- Dữ liệu địa điểm đến từ nhà cung cấp bên ngoài (Mapbox), nên lưu kèm
-- provider + id gốc để sau này đổi nhà cung cấp còn biết bản ghi nào từ đâu.
--
-- Rollback: alter table public.trips drop column ... (liệt kê các cột bên dưới).
-- ============================================================================

alter table public.trips
  -- Tên hiển thị ngắn: "Đà Lạt", "Phan Thiết". Đây là thứ hiện trên thẻ.
  add column place_name text check (place_name is null or length(trim(place_name)) between 1 and 160),
  -- Địa chỉ đầy đủ do nhà cung cấp trả về, chỉ để đối chiếu.
  add column place_address text check (place_address is null or length(place_address) <= 400),
  add column place_country text check (place_country is null or length(place_country) <= 80),

  -- Toạ độ là SỐ THỰC — đúng kiểu cho dữ liệu địa lý. Khác hoàn toàn với tiền,
  -- vốn phải là số nguyên. verify.sql chỉ soi cột tên chứa amount/minor nên
  -- không nhầm hai thứ này.
  add column latitude double precision check (latitude is null or latitude between -90 and 90),
  add column longitude double precision check (longitude is null or longitude between -180 and 180),

  add column place_provider text check (place_provider is null or place_provider in ('mapbox')),
  add column place_external_id text check (place_external_id is null or length(place_external_id) <= 200),

  -- Ảnh bìa chọn từ cổng ảnh. Lưu URL chứ không lưu file: ảnh thuộc về nhà
  -- cung cấp, tải về máy chủ mình là vi phạm điều khoản của hầu hết các nguồn.
  add column cover_image_url text check (cover_image_url is null or cover_image_url ~ '^https://'),
  -- Nguồn ảnh bắt buộc phải ghi công với Unsplash, và là phép lịch sự tối thiểu
  -- với mọi nguồn khác. Thiếu hai cột này thì giao diện không ghi công được.
  add column cover_image_credit text check (cover_image_credit is null or length(cover_image_credit) <= 200),
  add column cover_image_link text check (cover_image_link is null or cover_image_link ~ '^https://'),
  add column cover_image_provider text
    check (cover_image_provider is null or cover_image_provider in ('pinterest', 'unsplash', 'upload'));

-- Toạ độ phải có đủ cặp hoặc không có gì. Một nửa toạ độ là dữ liệu vô dụng mà
-- lại trông như dùng được.
alter table public.trips
  add constraint trips_coordinates_paired
  check ((latitude is null) = (longitude is null));

comment on column public.trips.place_name is
  'Tên ngắn của điểm đến, hiện trên thẻ chuyến đi. Nguồn: Mapbox Search qua Edge Function place-search.';
comment on column public.trips.cover_image_url is
  'URL ảnh bìa. KHÔNG tải file về Storage — ảnh thuộc về nhà cung cấp.';
