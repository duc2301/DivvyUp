<p align="center">
  <img src="assets/images/brand-lockup-light.png" alt="DivvyUp" width="280" />
</p>

<p align="center"><b>Chia hoá đơn và chi tiêu nhóm cho mỗi chuyến đi.</b></p>

---

## Tính năng

- **Chuyến đi → nhóm → thành viên.** Tạo nhóm với số người khai sẵn, đặt tên từng người. Người trong chuyến chưa cần cài app: gửi **mã mời** sau để họ nhận đúng tên của mình.
- **Khoản chi.** Mặc định chia đều cho cả chuyến, bỏ bớt người không chịu, hoặc gõ số tiền riêng từng người. Có một người đại diện đứng ra trả. Sửa và xoá được (xoá có hỏi lại).
- **Số dư & ai trả ai.** Số dư được tính ở database từ dữ liệu gốc. App gợi ý số giao dịch ít nhất để trả hết nợ.
- **Điểm đến & ảnh bìa.** Tìm địa điểm bằng Mapbox, ảnh bìa lấy từ Unsplash (Pinterest nếu có quyền). Lướt để chọn ảnh làm nền.
- **Tài khoản.** Đăng ký có xác nhận email, ghi nhớ đăng nhập, quên mật khẩu. Hoặc **dùng không cần tài khoản** (chế độ khách, dữ liệu chỉ nằm trên máy).
- Giao diện sáng/tối, tiếng Việt.

Tiền luôn lưu bằng **số nguyên đơn vị nhỏ nhất** (đồng, cent) và chia theo phương pháp phần dư lớn nhất: tổng các phần chia luôn khớp tuyệt đối với tổng khoản chi.

## Công nghệ

| Phần | Dùng |
|---|---|
| App | Expo SDK 57, React Native 0.86, React 19, expo-router, React Compiler |
| Giao diện | NativeWind v4 (Tailwind), lucide icons |
| Dữ liệu & đăng nhập | Supabase: Postgres + RLS, Auth (PKCE), Edge Functions |
| Build & cập nhật | EAS Build, EAS Update, GitHub Actions |

Không có backend riêng. Logic nghiệp vụ nằm trong app; **RLS và RPC trong Postgres là lớp bảo mật duy nhất**, nên mọi quy tắc quan trọng (tổng phần chia, quyền chủ chuyến, không xoá thành viên đang có khoản chi) đều được chặn lại ở database.

---

## Chạy trên máy

Yêu cầu: Node.js 22, npm. Điện thoại có **Expo Go**, hoặc Android emulator.

```bash
npm ci
```

Tạo file `.env.local` ở thư mục gốc (không commit):

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_...
```

> Hai biến này **công khai**: chúng được nhúng vào app. Dữ liệu được bảo vệ bởi RLS, không phải bởi việc giấu khoá. **Tuyệt đối không** đặt `service_role` key vào repo này.

```bash
npx expo start            # quét QR bằng Expo Go
npx expo start --web      # chạy trên trình duyệt
```

Sửa `.env.local` xong phải khởi động lại với `npx expo start --clear`.

### Kiểm tra

```bash
npm run typecheck
npm test
```

GitHub Actions chạy đúng hai lệnh này cho mọi pull request, và trước mỗi lần phát hành.

---

## Cài đặt Supabase (làm một lần cho mỗi project)

### 1. Database

Mở **SQL Editor**, chạy lần lượt các file trong `supabase/migrations/` **theo thứ tự tên file**.

> ⚠️ Không chạy lại `20260916_1040_lock_trip_members.sql` **sau** `20260917_1000_harden_members_settlements.sql`: nó ghi đè trigger bằng bản cũ và làm hỏng việc thêm thành viên.

`supabase/verify.sql` dùng để kiểm tra nhanh sau khi chạy.
`supabase/cleanup-before-release.sql` xoá toàn bộ chuyến đi và khoản chi, **giữ tài khoản**. Chỉ dùng khi dọn dữ liệu thử.

### 2. Edge Functions (tìm địa điểm, ảnh bìa)

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase secrets set MAPBOX_TOKEN=... UNSPLASH_ACCESS_KEY=...
# Tuỳ chọn, cần quyền Pinterest Partner:  PINTEREST_TOKEN=...
npx supabase functions deploy place-search
npx supabase functions deploy place-photos
```

### 3. Auth

**Authentication → URL Configuration → Redirect URLs.** Thêm đủ các dòng sau, kể cả `**`:

```
divvyup://**
exp://**
http://localhost:8081/**
```

Thiếu dòng này thì bấm link trong email xác nhận hoặc đặt lại mật khẩu sẽ ra trang trắng, không quay về app.

**Authentication → Emails → SMTP Settings.** Bật SMTP riêng (Gmail app password, Resend, Brevo…). Máy chủ email mặc định của Supabase chỉ gửi được vài email mỗi giờ cho cả project, người dùng sẽ gặp lỗi *email rate limit exceeded*. Sau đó nới **Authentication → Rate Limits → emails**.

---

## Phát hành

Có hai cách đưa thay đổi tới người dùng:

| | **Cập nhật OTA** | **APK mới** |
|---|---|---|
| Dùng khi | Chỉ sửa code JS/TS, giao diện, text | Thêm/đổi thư viện có mã native, đổi `app.json` phần native (icon, splash, scheme, quyền…), hoặc lần phát hành đầu |
| Cách làm | Push lên `main` | Tạo GitHub Release |
| Người dùng | Tự nhận ở lần mở app sau đó | Tải APK và cài đè |
| Workflow | `.github/workflows/ota-update.yml` | `.github/workflows/build-apk-release.yml` |

Không cần tự nhớ cách nào an toàn: `runtimeVersion` dùng policy **fingerprint**. Nếu thay đổi có đụng phần native, bản OTA **tự không áp** cho APK cũ (thay vì làm app crash), và bạn sẽ thấy người dùng không nhận được cập nhật. Khi đó phát hành APK mới.

### Chuẩn bị (một lần)

1. **Tạo token Expo:** expo.dev → Account settings → Access tokens. Thêm vào GitHub: **Settings → Secrets and variables → Actions → New repository secret**, tên `EXPO_TOKEN`.
2. **Build lần đầu ở máy mình** để EAS tạo keystore Android (CI chạy ở chế độ không tương tác nên không tạo được):
   ```bash
   npx eas-cli login
   npx eas-cli build -p android --profile preview
   ```
   Chọn *Generate new keystore* khi được hỏi. Keystore được giữ trên EAS; **đừng xoá nó**, vì APK ký bằng khoá khác không cài đè được lên bản cũ.

### Phát hành APK mới

1. Tăng `"version"` trong `app.json` (vd `1.0.0` → `1.1.0`), commit và push lên `main`.
2. Trên GitHub: **Releases → Draft a new release**.
   - Tag: `v` + version vừa đặt, vd **`v1.1.0`** (tag không khớp `app.json` thì workflow dừng và báo lỗi).
   - Target: `main`. Viết ghi chú thay đổi rồi **Publish release**.
3. Workflow chạy typecheck và test, build APK trên EAS (có thể mất 10–40 phút do xếp hàng), rồi đính `DivvyUp-v1.1.0.apk` vào release.

Workflow lỗi giữa chừng mà release đã tạo: vào **Actions → Release APK → Run workflow**, nhập tag để chạy lại.

### Cập nhật OTA

Push lên `main`. Workflow chạy typecheck và test rồi phát hành lên channel `preview`. Chạy tay được ở **Actions → OTA Update → Run workflow**.

Thay đổi chỉ nằm trong `supabase/`, `.github/`, `scripts/` hoặc file `.md` không kích hoạt OTA.

> **Migration database không đi theo OTA hay APK.** Phải chạy tay trong SQL Editor, **trước** khi phát hành bản app cần nó.

### Checklist trước khi phát hành

- [ ] `npm run typecheck` và `npm test` qua
- [ ] Đã chạy migration mới (nếu có) trên Supabase
- [ ] Bấm thử trên máy: đăng ký, đăng nhập, tạo chuyến, thêm khoản chi, xem số dư
- [ ] Đổi thư viện native hoặc `app.json`? → phát hành **APK mới**, không chỉ OTA
- [ ] Phát hành APK: đã tăng `version` trong `app.json`, tag khớp

---

## Cài đặt cho người dùng (Android)

1. Mở trang **Releases** của repo, tải file `DivvyUp-vX.Y.Z.apk` ở bản mới nhất.
2. Mở file. Nếu máy hỏi, cho phép *Cài ứng dụng không rõ nguồn gốc* với trình duyệt/trình quản lý file.
3. Bản sau cài đè lên bản cũ, dữ liệu giữ nguyên. Các sửa lỗi nhỏ tự về qua OTA khi mở app.

**Bấm link trong email mà không mở app?** Chọn *Mở bằng Chrome* thay vì trình duyệt trong Gmail. Link đặt lại mật khẩu phải mở trên **chính điện thoại** đã bấm "Quên mật khẩu".

---

## Cấu trúc thư mục

```
src/
  app/                 màn hình (expo-router, route theo file)
  components/ui/       component giao diện dùng chung
  features/auth/       đăng nhập, phiên, link email
  features/theme/      sáng/tối
  lib/money/           tiền: chia, số dư, định dạng (có unit test)
  lib/data/            truy cập dữ liệu, tự chọn Supabase hoặc lưu trên máy (khách)
  lib/supabase/        client, kiểu database, xử lý lỗi
supabase/
  migrations/          schema, RLS, RPC — chạy theo thứ tự
  functions/           Edge Functions (Deno)
.github/workflows/     CI, OTA, build APK
```

Quy ước code và quy trình làm việc: xem `AGENTS.md`.
