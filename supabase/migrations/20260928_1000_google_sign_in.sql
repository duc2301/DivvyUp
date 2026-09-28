-- ============================================================================
-- DivvyUp — 14. Đăng nhập Google
--
-- Chạy SAU 20260926_1000_trip_archives_lock_deletes.sql.
--
-- Liên kết tài khoản cùng email là việc của Supabase Auth (automatic identity
-- linking, mặc định bật): đăng nhập Google bằng email đã có tài khoản thì
-- identity google được gắn vào ĐÚNG user đó — cùng user.id, trigger
-- on_auth_user_created không chạy. Migration này chỉ lo hai việc còn lại:
--
-- 1. account_needs_password() — người dùng mới tạo qua Google chưa có mật
--    khẩu. App bắt họ đặt mật khẩu trước khi vào (cổng "Đặt mật khẩu"). Không
--    suy được từ phía client: updateUser({ password }) không thêm identity
--    'email', nên nhìn user.identities sẽ hỏi lại mãi. Hàm đọc
--    auth.users.encrypted_password của CHÍNH người gọi — không tham số, không
--    hỏi được về người khác. anon không có quyền gọi.
--    Cũng bắt trường hợp tài khoản email CHƯA xác nhận rồi đăng nhập Google:
--    GoTrue gắn Google vào user đó nhưng xoá mật khẩu cũ (chống chiếm tài khoản
--    trước khi đăng ký) → hàm trả true → người dùng đặt mật khẩu mới.
--
-- 2. handle_new_user(): Google không gửi display_name, bản cũ rơi về phần
--    trước @ của email ("phamvanduc2301"). Nay thứ tự: display_name (đăng ký
--    bằng email) → full_name → name (Google) → phần trước @. Cắt còn 80 ký tự:
--    CHECK của profiles.display_name là 1–80, tên Google dài hơn mà không cắt
--    thì trigger lỗi và GoTrue trả "Database error saving new user" — không
--    đăng nhập được.
--
-- Rollback:
--   drop function if exists public.account_needs_password();
--     → app hiểu lỗi RPC là "không cần mật khẩu": cổng mở, người mới qua
--       Google vào thẳng app (không treo, không chặn nhầm). Muốn đóng hẳn thì
--       tắt provider Google trên dashboard trước.
--   GIỮ NGUYÊN handle_new_user() bản mới — nó chỉ an toàn hơn bản cũ. Dán lại
--   bản 20260915_1100 mà provider Google còn bật thì tên Google > 80 ký tự làm
--   hỏng việc tạo tài khoản.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. account_needs_password
-- ---------------------------------------------------------------------------
create or replace function public.account_needs_password()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hash text;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;

  select u.encrypted_password into v_hash
  from auth.users u
  where u.id = v_uid;

  if not found then
    raise exception 'Không tìm thấy tài khoản.' using errcode = '28000';
  end if;

  -- User OAuth có encrypted_password là '' hoặc NULL tuỳ bản GoTrue.
  return coalesce(v_hash, '') = '';
end;
$$;

revoke execute on function public.account_needs_password() from public, anon;
grant execute on function public.account_needs_password() to authenticated;


-- ---------------------------------------------------------------------------
-- 2. handle_new_user — lấy tên Google
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
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'nguoi-dung'
      ),
      80
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
