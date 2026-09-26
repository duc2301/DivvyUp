/**
 * Client Supabase của web. Chỉ `entities/*\/api` và `features/*\/api` được dùng
 * trực tiếp; pages/widgets đi qua các hàm của entity.
 */
export { getRememberSession, setRememberSession, supabase } from './supabase-client';
