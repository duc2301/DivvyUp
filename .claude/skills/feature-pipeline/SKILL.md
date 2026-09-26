---
name: feature-pipeline
description: Quy trình điều phối trọn vòng một tính năng hoặc bug fix trong DivvyUp — đối chiếu tài liệu, lập kế hoạch, cài đặt (mobile/web/Supabase), viết test, soát tiền/bảo mật/RLS/chất lượng/hiệu năng/FSD/bất biến/độ phủ test, lập nhật ký thay đổi, cập nhật tài liệu — bằng cách gọi đúng agent ở đúng bước. Dùng khi người dùng giao tính năng hoặc bug fix có sửa code ("làm tính năng", "sửa lỗi", "thêm màn", "implement"), hoặc gọi /feature-pipeline. Không dùng cho câu hỏi giải thích code hay việc chỉ sửa tài liệu.
---

# Điều phối một tính năng — feature-pipeline

Skill chạy ở **luồng hội thoại chính** và gọi các agent trong `.claude/agents/`. Agent con không gọi được agent con khác, nên việc điều phối nằm ở đây.

Nguyên tắc: **agent soát không phải là agent viết.** Người viết code không tự chấm code của mình; người viết test không tự chấm độ phủ.

## Trước khi bắt đầu

- Yêu cầu mơ hồ → xác nhận phạm vi bằng một câu.
- Người dùng nói đang **học** và muốn tự viết → chỉ đưa khung + TODO, không chạy Giai đoạn 2–3.
- Ghi nhận vùng bị đụng: `src/lib/money`, `src/lib/data`, `src/app`, `supabase/`, `web/`.

## Giai đoạn 1 — Hiểu hiện trạng (chỉ đọc, SONG SONG)

| Agent | Đầu vào |
|---|---|
| `documentation-accuracy-reviewer` | yêu cầu + vùng code dự kiến |
| `divvyup-planner` | yêu cầu |
| `scout-repo` | (tuỳ chọn) khi cần bản đồ nhanh một vùng lạ |

Chỗ tài liệu sai → kế hoạch dựa vào code.

**Điểm dừng:** trình kế hoạch (file sẽ đụng, migration, việc tay) và **chờ đồng ý** — trừ khi người dùng đã nói rõ "cứ làm luôn".

## Giai đoạn 2 — Cài đặt

- Bảng/cột/RPC/quyền mới → giao `supabase-feature` (8 bước, gồm types sửa tay và nhánh khách).
- Phần còn lại → luồng chính tự sửa theo kế hoạch.
- Build tối thiểu phải xanh trước khi sang giai đoạn sau:
  ```
  npm run typecheck
  npm test
  cd web && npm run typecheck && npm run build     # nếu đụng web
  ```

## Giai đoạn 3 — Test

- Logic thuần (đặc biệt tiền) → giao `test-writer`, kèm **đặc tả** để nó lập ma trận ca từ đặc tả.
- Bất biến chỉ nằm trong SQL → truy vấn mới trong `supabase/verify.sql` + checklist kiểm tay hai tài khoản.
- Màn hình mobile không có bộ chạy test UI — ghi rõ trong báo cáo cuối; kiểm bằng chạy thật (`npm run web` hoặc máy thật) nếu được.

## Giai đoạn 4 — Soát (chỉ đọc, SONG SONG)

| Agent | Khi nào |
|---|---|
| `invariant-guard` | luôn gọi khi đụng `src/lib`, `supabase/`, hoặc `web/src/shared/api` |
| `audit-money` | đụng chia tiền, số dư, tối giản công nợ, định dạng tiền |
| `audit-supabase` | đụng migration, policy, RPC, tầng truy cập dữ liệu |
| `security-code-reviewer` | luôn gọi khi có sửa code |
| `code-quality-reviewer` | luôn gọi khi có sửa code |
| `audit-rn` | đụng component/hook/route mobile |
| `audit-ui` | đụng giao diện mobile |
| `fsd-architecture-reviewer` | đụng `web/` |
| `performance-reviewer` | đụng truy vấn, danh sách, ảnh, thuật toán trên dữ liệu, bundle web |
| `silent-failure` | đụng xử lý lỗi, best-effort, upload |
| `test-coverage-reviewer` | Giai đoạn 3 có viết test |

Agent khởi động với context trắng: prompt phải tự đủ nghĩa — danh sách file, mô tả thay đổi một câu, và nhắc đọc trạng thái hiện tại của file.

### Hợp nhất

Một bảng, khử trùng (cùng `file:line` → một dòng, ghi các agent):

```
| Mức | Agent | file:line | Vấn đề |
```

Xếp: mất tiền → lộ dữ liệu → crash → sai dữ liệu → hiệu năng → quy ước. Hai agent kết luận trái nhau → tự đọc file và phân xử.

### Vòng sửa

- CHẶN / CẦN SỬA / THIẾU → sửa, rồi **chỉ gọi lại agent đã báo mục đó**. Tối đa **2 vòng**; còn chặn → trình người dùng quyết.
- CẢNH BÁO → người dùng chọn sửa hay chấp nhận; ghi lại để đưa vào nhật ký.

## Giai đoạn 5 — Nhật ký và tài liệu (tuần tự)

1. `change-audit-log` — kèm kết quả build/test/soát và CẢNH BÁO đã chấp nhận.
2. `docs-updater` — kèm nhật ký và các mục SAI/THIẾU từ Giai đoạn 1.

## Giai đoạn 6 — Báo cáo cuối

```
| Giai đoạn | Kết quả |
|---|---|
| Tài liệu hiện trạng | n chỗ sai |
| Cài đặt | typecheck / test / web build |
| Test | n test mới |
| Invariant / Money / Supabase / Security / Quality / RN / UI / FSD / Perf / Coverage | ĐẠT / CẢNH BÁO / CHẶN / không áp dụng |
| Tài liệu | file đã cập nhật |
### Việc tay của người dùng (migration, deploy function, build APK, deploy web)
### Còn tồn đọng
### Nhật ký thay đổi
```

Rồi hỏi người dùng có muốn commit không (skill `git-commit`).

## Tuyệt đối không

- Không commit, không push khi chưa được yêu cầu — **push `main` tự phát hành OTA**.
- Không bỏ Giai đoạn 4 vì "thay đổi nhỏ" khi đụng tiền hoặc RLS.
- Không coi ĐẠT của một agent là lý do bỏ qua CHẶN của agent khác.
- Không tự sửa `.claude/settings.json` trong quy trình này.
