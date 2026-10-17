-- ============================================================================
-- 15. Đồng soạn ghi chú qua Realtime (kênh private) + vá chỗ đua khi nhận chỗ
-- ============================================================================
--
-- 1. QUYỀN KÊNH REALTIME CHO GHI CHÚ
--    App mở kênh `trip-notes:<tripId>:<noteId>` với private: true để phát thao
--    tác Yjs, con trỏ và presence (src/lib/data/note-collab.ts). Kênh private chỉ
--    cho join/gửi/nhận khi RLS trên realtime.messages cho phép. Không có policy
--    → mọi lượt join private đều bị từ chối (an toàn mặc định).
--
--    Luật: người gọi là thành viên CÒN trong chuyến (is_trip_member), ghi chú
--    thuộc ĐÚNG chuyến trong topic, ghi chú và chuyến chưa xoá mềm. Người ngoài
--    chuyến không đọc được nội dung đang gõ của chuyến khác, không chèn được thao
--    tác vào ghi chú của chuyến khác. anon không có policy nào.
--
--    Realtime chấm policy lúc JOIN kênh (và khi làm mới JWT) — người vừa bị gỡ
--    khỏi chuyến còn nghe được tới lần làm mới token kế tiếp. Chấp nhận được:
--    trước đó họ vốn đọc được ghi chú.
--
--    VIỆC TAY: Dashboard → Project Settings → Realtime → TẮT "Allow public
--    access", để mọi kênh bắt buộc qua RLS (repo không dùng kênh public nào).
--
-- 2. VÁ CHỖ ĐUA TRONG join_trip_by_code (lỗi có từ migration 3)
--    Hàm kiểm "chỗ còn trống, chưa bị gỡ" rồi mới UPDATE, không khoá dòng:
--    - chủ chuyến gỡ chỗ đúng lúc có người nhận → người nhận bị gắn vào dòng đã
--      gỡ, RPC vẫn báo thành công, và unique (trip_id, user_id) khiến họ không
--      nhận lại được chỗ nào trong chuyến;
--    - hai người cùng nhận một chỗ → người sau đè người trước.
--    Sửa: khoá dòng (FOR UPDATE) khi đọc, UPDATE kèm điều kiện còn trống + chưa
--    gỡ, kiểm row_count.
--
-- Không thêm bảng/cột → không đổi src/lib/supabase/database.types.ts (hàm chỉ
-- policy gọi, giống is_trip_member).
--
-- Rollback:
--   drop policy if exists "note_collab_receive" on realtime.messages;
--   drop policy if exists "note_collab_send" on realtime.messages;
--   drop function if exists public.can_join_note_channel(text);
--   apply lại join_trip_by_code trong 20260915_1120_rpc.sql — LƯU Ý: bản đó
--   mang lại chỗ đua (nhận vào chỗ vừa bị gỡ, hai người cùng nhận một chỗ).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Quyền kênh realtime
-- ---------------------------------------------------------------------------

-- Tách topic bằng regex uuid đầy đủ, KHÔNG ép ::uuid thẳng: chuỗi rác làm phép
-- ép văng lỗi giữa lúc chấm policy.
create or replace function public.can_join_note_channel(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
  v_trip  uuid;
  v_note  uuid;
begin
  if (select auth.uid()) is null or p_topic is null then
    return false;
  end if;

  v_parts := regexp_match(
    p_topic,
    '^trip-notes:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$',
    'i'
  );
  if v_parts is null then
    return false;
  end if;
  v_trip := v_parts[1]::uuid;
  v_note := v_parts[2]::uuid;

  return public.is_trip_member(v_trip)
    and exists (
      select 1
      from public.trip_notes n
      join public.trips t on t.id = n.trip_id
      where n.id = v_note
        and n.trip_id = v_trip
        and n.deleted_at is null
        and t.deleted_at is null
    );
end;
$$;

revoke execute on function public.can_join_note_channel(text) from public, anon;
grant execute on function public.can_join_note_channel(text) to authenticated;

drop policy if exists "note_collab_receive" on realtime.messages;
create policy "note_collab_receive"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_join_note_channel((select realtime.topic()))
  );

drop policy if exists "note_collab_send" on realtime.messages;
create policy "note_collab_send"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_join_note_channel((select realtime.topic()))
  );


-- ---------------------------------------------------------------------------
-- 2. join_trip_by_code — khoá dòng, UPDATE có điều kiện
-- ---------------------------------------------------------------------------
create or replace function public.join_trip_by_code(
  p_join_code text,
  p_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_trip_id uuid;
  v_taken   uuid;
  v_rows    integer;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;

  select t.id into v_trip_id
  from public.trips t
  where t.join_code = upper(trim(p_join_code)) and t.deleted_at is null;

  if not found then
    raise exception 'Mã tham gia không đúng.' using errcode = '42501';
  end if;

  -- FOR UPDATE: chờ thao tác gỡ / nhận chỗ đang chạy trên dòng này xong rồi mới
  -- đọc (READ COMMITTED đọc lại bản vừa commit) — không nhận vào chỗ vừa bị gỡ
  -- hay vừa có người khác nhận.
  select tm.user_id into v_taken
  from public.trip_members tm
  where tm.id = p_member_id and tm.trip_id = v_trip_id and tm.removed_at is null
  for update;

  if not found then
    raise exception 'Không tìm thấy người này trong chuyến đi.' using errcode = '42501';
  end if;
  if v_taken is not null then
    raise exception 'Chỗ này đã có người nhận.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.trip_members tm
    where tm.trip_id = v_trip_id and tm.user_id = v_uid and tm.removed_at is null
  ) then
    raise exception 'Bạn đã có mặt trong chuyến đi này rồi.' using errcode = '42501';
  end if;

  -- Trigger protect_trip_member_identity chặn mọi thay đổi user_id; cờ cục bộ
  -- này là cửa duy nhất, và nó chỉ tồn tại trong transaction hiện tại.
  perform set_config('divvyup.allow_identity_change', 'on', true);

  -- Điều kiện nhắc lại ngay trong UPDATE: lưới thứ hai nếu sau này ai đó bỏ
  -- FOR UPDATE ở trên.
  update public.trip_members
  set user_id = v_uid
  where id = p_member_id
    and trip_id = v_trip_id
    and user_id is null
    and removed_at is null;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Chỗ này vừa có người nhận hoặc vừa bị xoá. Hãy chọn lại.' using errcode = '42501';
  end if;

  return v_trip_id;
end;
$$;

revoke execute on function public.join_trip_by_code(text, uuid) from public, anon;
grant execute on function public.join_trip_by_code(text, uuid) to authenticated;
