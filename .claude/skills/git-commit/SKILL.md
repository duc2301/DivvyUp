---
name: git-commit
description: Tạo commit theo quy ước của repo DivvyUp — Conventional Commits, mô tả tiếng Việt, scope theo vùng (money, data, supabase, trip, expense, web, ci...). Dùng khi người dùng muốn commit, nói "commit giúp", "lưu thay đổi". Nhắc rủi ro push main = OTA.
---

# Commit trong repo DivvyUp

## Trước khi commit — luôn làm

```bash
git status
git diff
git diff --cached
git log --no-merges --format='%s' -15
```

Kiểm nhanh:

- File **không nên** vào commit: `.env*`, `.env.secrets`, `web/.env.local`, `dist/`, `web/dist/`, file tạm, thay đổi lạc đề.
- Một commit = một ý; tách nếu cần.
- Đụng `src/lib/money`, `src/lib/data`, `src/lib/storage`, `supabase/`, `web/src/shared/api/` → hook chặn commit cho tới khi `invariant-guard` đã soát. Soát xong (ĐẠT, hoặc CẢNH BÁO người dùng đã chấp nhận) thì commit với tiền tố `INVARIANT_REVIEWED=1 git commit ...` — tiền tố này là lời khẳng định đã soát, không dùng để né.
- `npm run typecheck` và `npm test` xanh; đụng `web/` thì `cd web && npm run build` xanh.

## Định dạng

```
<type>(<scope>): <mô tả tiếng Việt>
```

- Tiêu đề ≤ 72 ký tự, chữ thường đầu mô tả, không chấm cuối.
- Nói **hành vi đã đổi** kèm hậu quả/lý do nếu ngắn gọn được.

| type | Khi |
|---|---|
| `feat` | tính năng người dùng thấy |
| `fix` | sửa lỗi |
| `refactor` | đổi cấu trúc, không đổi hành vi |
| `perf` | hiệu năng |
| `test` | chỉ thêm/sửa test |
| `docs` | tài liệu |
| `chore` | cấu hình, version, dọn dẹp |
| `ci` | GitHub Actions |

**Type quyết định số phiên bản** — sau khi push `main`, `auto-release.yml` tự tăng số theo commit: `feat` → số giữa, `fix`/`perf`/`refactor` → số cuối, `!`/`BREAKING CHANGE:` → số đầu, `docs`/`chore`/`ci`/`test`/`style`/`build` → không phát hành. Chọn type theo tác động tới người dùng, không theo cảm tính. Không tự viết commit `chore(release): …` — dành cho máy phát hành. Tiêu đề commit được đưa **nguyên văn** vào ghi chú phát hành công khai: commit sửa lỗ hổng bảo mật viết chung chung (`fix(trip): siết quyền truy cập`), không mô tả cách khai thác.

Scope: `money`, `data`, `supabase`, `auth`, `trip`, `expense`, `members`, `weather`, `profile`, `place`, `web`, `ci`, `agents`. Nhiều vùng → phân tách bằng dấu phẩy.

Ví dụ:

```
fix(money): tối giản công nợ theo nhóm có tổng bằng 0 để giảm số lần chuyển
feat(expense,supabase): ghi nhật ký mỗi lần sửa khoản chi và màn xem lịch sử
feat(web): bản web responsive cho iPhone, dùng chung lõi tính tiền
```

## Thân commit

Khi có lý do không hiển nhiên, đánh đổi, hoặc **việc tay khi phát hành** (migration phải chạy, cần build APK). Viết **vì sao**, không kể lại diff. Mỗi dòng ≤ 72 ký tự.

## Nhánh và phát hành

- Push lên `main` **tự phát hành OTA** tới máy người dùng (`.github/workflows/ota-update.yml`). Thay đổi cần migration mà migration chưa chạy trên Supabase → app mới gọi RPC chưa có → lỗi. Nhắc người dùng chạy migration **trước** khi push.
- Thay đổi native (`app.json`, module native mới) → OTA không giao được; cần tạo release để build APK.
- Không commit thẳng lên `main` khi người dùng chưa nói; đề xuất nhánh `feat/<mo-ta>` hoặc `fix/<mo-ta>`.

## Tạo commit

```bash
git add <file cụ thể>
git commit -m "$(cat <<'EOF'
fix(money): mô tả ngắn

Thân nếu cần.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

Dòng `Co-Authored-By` lấy theo hướng dẫn attribution hiện hành của phiên, chỉ khi commit do Claude soạn.

## Tuyệt đối không

- **Không `git push` trừ khi người dùng yêu cầu rõ.**
- Không `--no-verify`. Hook đỏ thì sửa nguyên nhân.
- Không `--amend` commit đã push.
- Không commit file chỉ khác line ending.

## Sau khi commit

Báo: hash ngắn, tiêu đề, số file, nhánh; và việc tay còn lại trước khi push.
