---
name: divvyup-apk-release
description: Phát hành phiên bản mới của DivvyUp và build APK — xem trước số phiên bản kế tiếp, quyết định có cần APK mới hay chỉ OTA, kích hoạt workflow tự phát hành (tự tăng số, tự gắn tag, tự tạo GitHub Release), ép build APK khi cần. Dùng khi người dùng nói "build apk", "bản mới", "tăng version", "tạo tag", "release", "phát hành", hoặc hỏi "bản tiếp theo là số mấy".
---

# Phát hành phiên bản mới / build APK

Phát hành đã **tự động**: mỗi lần push `main`, workflow `.github/workflows/auto-release.yml` tự làm hết. Skill này để (1) biết trước chuyện gì sẽ xảy ra, (2) ép build khi cần, (3) xử lý khi hỏng.

## Máy tự làm gì khi push `main`

| Bước | Ai làm |
|---|---|
| Typecheck + test | `ci.yml` |
| Phát OTA (JS mới tới máy đang cài APK cùng runtime) | `ota-update.yml` |
| Tính số phiên bản kế tiếp từ tag trước + commit | `scripts/release/prepare.mjs` (luật ở `semver.mjs`) |
| Ghi version vào `app.json` + `package.json`, commit `chore(release): vX.Y.Z [skip ci]`, gắn tag, tạo Release | `auto-release.yml` |
| So runtime fingerprint với bản trước → native đổi (hoặc bản trước không có APK) thì **build APK mới**, không đổi thì **gắn lại APK bản trước** | `auto-release.yml` → `build-apk-release.yml` |

Luật tăng số (Conventional Commits — skill `git-commit`):

| Commit | Tăng |
|---|---|
| `feat(...)!:` hoặc thân có `BREAKING CHANGE:` | số đầu `2.0.0` |
| `feat` | số giữa `1.1.0` |
| `fix`, `perf`, `refactor`, `revert`, tiêu đề không theo quy ước | số cuối `1.0.2` |
| chỉ `docs`, `chore`, `ci`, `test`, `style`, `build` | không phát hành — **trừ khi** phần native đổi: tự ép số cuối và build APK, vì OTA của runtime mới không tới được APK cũ |

Nhiều commit trong một lần push → lấy mức cao nhất. `version` KHÔNG nằm trong fingerprint (`fingerprint.config.js`), nên tăng số không làm OTA mất đường tới máy đang cài APK cũ.

## Bước 1 — Xem trước

```bash
npm run release:plan
```

In ra tag trước, số commit mới, mức tăng, số kế tiếp và ghi chú phát hành. Không ghi gì.

## Bước 2 — Có cần APK mới không?

Cần APK khi runtime fingerprint đổi. Fingerprint gồm: module native trong `package.json`, plugin và cấu hình trong `app.json` (trừ `version`), `eas.json`, `.gitignore`, `fingerprint.config.js`, icon/splash. Xem chính xác:

```bash
npx expo-updates runtimeversion:resolve --platform android
```

Workflow tự so với dấu `<!-- divvyup-runtime: … -->` trong ghi chú của Release trước. Release không có dấu (bản cũ) → coi như đổi → build.

## Bước 3 — Phát hành

Thứ tự bắt buộc (skill `divvyup-release`): migration Supabase → deploy Edge Function → **rồi mới** push `main`. Push trước migration thì APK/OTA mới gọi RPC chưa tồn tại.

- **Thường:** push `main` (người dùng phải đồng ý — hook sẽ chặn nhắc).
- **Ép số phiên bản hoặc ép build APK:** GitHub → Actions → *Auto release* → *Run workflow*: chọn `bump` (auto/patch/minor/major) và `force_apk`.
- **Build lại APK cho một tag đã có Release:** Actions → *Release APK* → *Run workflow* với `tag`.
- **Muốn tự đặt số:** sửa `version` trong `app.json` lớn hơn tag hiện tại rồi push — script tôn trọng số lớn hơn.

APK xuất hiện trong Release sau khoảng 15–30 phút (EAS build). Link tải cố định: `https://github.com/<owner>/<repo>/releases/latest`.

## Xử lý khi hỏng

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Job *Tag + GitHub Release* lỗi khi `git push origin HEAD:main` | Nhánh `main` có branch protection chặn bot, hoặc có commit mới chen vào. Cho `github-actions[bot]` bypass, hoặc chạy lại workflow. |
| Release có nhưng không có APK | Build EAS lỗi (xem job *Build APK*), hoặc `EXPO_TOKEN` hết hạn/không đủ quyền (phải là token cá nhân có quyền project). Sửa rồi chạy *Release APK* với tag đó. |
| "Tag vX không khớp version trong app.json" | Tag gắn trên commit mà `app.json` chưa ghi số đó. Xoá tag + Release, để auto-release tạo lại. |
| Máy đang cài không nhận OTA | Runtime của máy khác runtime của OTA (phần native đã đổi) → người dùng phải cài APK mới của bản đó. |
| Không có bản nào được tạo | Các commit mới chỉ là docs/ci/test/chore — đúng thiết kế. Cần phát hành thì chạy tay với `bump`. |

## Tuyệt đối không

- Không push, không tạo tag, không chạy workflow khi người dùng chưa đồng ý.
- Không sửa tay `versionCode` — EAS tự tăng (`appVersionSource: remote`).
- Không xoá `fingerprint.config.js` hay bỏ `ExpoConfigVersions` khỏi nó: mỗi lần tăng số sẽ thành runtime mới và OTA không tới được ai.
- Không chạy workflow phát hành từ nhánh khác `main` — job tự bỏ qua, và đẩy code chưa review lên `main` là lỗ hổng quy trình.
- Không chạy `eas build` trong phiên agent (bị chặn trong `.claude/settings.json`) — build chạy trên GitHub Actions.
