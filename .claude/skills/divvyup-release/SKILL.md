---
name: divvyup-release
description: Chuẩn bị phát hành DivvyUp — Definition of Done, chọn đường phát hành (OTA qua push main, APK qua GitHub Release, web qua Vercel), thứ tự việc tay (migration → Edge Function → push → release), soạn ghi chú phát hành và mô tả PR trên GitHub. Dùng khi người dùng nói "phát hành", "release", "tạo PR", "đẩy lên", "deploy web".
---

# Phát hành DivvyUp

Repo trên GitHub: lấy owner/repo từ `git remote -v`. Dùng `gh` cho PR/release.

## Ba đường phát hành

| Đường | Kích hoạt | Giao được gì |
|---|---|---|
| **OTA** | push lên `main` (`.github/workflows/ota-update.yml`) | JS/asset. **Không** giao được thay đổi native |
| **Tag + Release + APK** | tự động sau mỗi push `main` (`auto-release.yml`): tự tăng số theo commit, gắn tag, tạo Release, build APK khi native đổi — chi tiết ở skill `divvyup-apk-release` | bản cài đầy đủ |
| **Web** | Vercel (Git integration với Root Directory `web`, hoặc `vercel --prod` trong `web/`) | bản web cho iPhone/máy tính |

## Bước 1 — Definition of Done

### Chung
- [ ] `npm run typecheck`, `npm test` xanh
- [ ] `invariant-guard` ĐẠT (hoặc CẢNH BÁO đã chấp nhận, ghi lý do)
- [ ] Không file rác/secret trong diff; không file chỉ khác line ending
- [ ] Tài liệu đã cập nhật (`docs-updater`)

### Nếu có migration
- [ ] Chạy trong SQL Editor **trước khi push** — theo thứ tự trong `supabase/README.md`
- [ ] Chạy `supabase/verify.sql`, mọi truy vấn trả 0 dòng
- [ ] Kiểm tay với **hai tài khoản** ở hai chuyến khác nhau

### Nếu có Edge Function
- [ ] `supabase functions deploy <ten>`; secret mới đã `supabase secrets set`

### Nếu có thay đổi native
- [ ] Không cần sửa `version` tay: `auto-release.yml` tự tăng số và tự build APK khi fingerprint đổi (`npm run release:plan` để xem trước)

### Nếu đụng web
- [ ] `cd web && npm run typecheck && npm run build` xanh
- [ ] `fsd-architecture-reviewer` ĐẠT
- [ ] Biến `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` đã đặt trên Vercel
- [ ] Domain web đã có trong Supabase Auth → URL Configuration (Site URL / Redirect URLs)

## Bước 2 — Thứ tự việc tay

1. Migration → 2. Edge Function → 3. push `main` (OTA) → 4. Release (APK, nếu cần) → 5. Web deploy.

Làm ngược (push trước migration) → máy người dùng nhận code gọi RPC/cột chưa tồn tại → lỗi ngay khi mở.

## Bước 3 — Mô tả PR / ghi chú phát hành

```markdown
## Vì sao
## Thay đổi gì
## Việc tay khi phát hành
## Đã kiểm tra
- [x] npm run typecheck, npm test
- [x] invariant-guard: ĐẠT
- [ ] Chưa thử trên máy thật
## Rủi ro & quay lui

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Ghi chú Release (người dùng cuối đọc): tiếng Việt, nói tính năng, không nói công nghệ.

## Tuyệt đối không

- Không push, không tạo release, không deploy khi người dùng chưa đồng ý.
- Không đánh `[x]` cho mục chưa thực sự chạy.
- Không bật auto-merge.
