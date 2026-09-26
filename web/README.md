# DivvyUp — bản web

Bản web responsive của DivvyUp cho người không cài được app (iPhone). Dùng **chung
Supabase** với app mobile và **dùng lại nguyên văn** lõi tiền + tầng dữ liệu trong
`../src` qua alias `@core/*` (xem `vite.config.ts`) — hai bản không bao giờ ra hai
con số khác nhau cho cùng một chuyến. Web **bắt buộc đăng nhập** (không có chế độ khách).

Stack: Vite 7, React 19, react-router 7, Tailwind 3 (token màu chép từ
`src/global.css`), lucide-react. Kiến trúc Feature-Sliced Design trong `src/`:
`app → pages → widgets → features → entities → shared`.

## Chạy dev

```bash
cd web
npm install
# Biến môi trường: chép .env.example thành .env.development.local (đã gitignore)
npm run dev          # http://localhost:5173
```

## Kiểm tra & build

```bash
npm run typecheck    # tsc --noEmit -p tsconfig.json
npm run build        # vite build → dist/
npm run preview
```

## Deploy Vercel

1. Import repo, **Root Directory = `web`**.
2. Bật **"Include files outside the root directory in the Build Step"** — web import
   code trong `../src`.
3. Framework: Vite (đã khai trong `vercel.json`, kèm SPA rewrite và header bảo mật).
4. Environment Variables (Production + Preview):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_KEY` — khoá **publishable/anon** (công khai). Không bao giờ dùng `service_role`.
5. Domain: thêm `divvyup.vn` trong Project → Domains.
6. Supabase → Authentication → URL Configuration → **Redirect URLs**: thêm
   `https://divvyup.vn/**`. Thiếu bước này thì link xác nhận email / đặt lại mật
   khẩu rơi về Site URL.
   **Tuyệt đối không thêm `https://*.vercel.app/**`**: ai cũng tạo được một site
   `*.vercel.app`, gọi "quên mật khẩu" cho email của nạn nhân với redirectTo trỏ về
   site đó và nhận mã đổi phiên → chiếm tài khoản. Cần preview thì chỉ thêm đúng
   pattern của project mình, ví dụ `https://divvyup-web-*-<team>.vercel.app/**`.
7. CSP trong `vercel.json` chỉ cho gọi Supabase của project này và các host ảnh
   trong allowlist của trigger `trips_validate_cover`. Đổi project Supabase hoặc
   thêm nguồn ảnh thì sửa cả hai nơi.

Link mời chia sẻ từ màn Thành viên có dạng `https://divvyup.vn/join?code=XXXXXXXX`.
