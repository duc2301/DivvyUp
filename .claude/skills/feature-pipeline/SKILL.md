---
name: feature-pipeline
description: Quy trình điều phối trọn vòng một tính năng hoặc bug fix trong DivvyUp — đối chiếu tài liệu, lập kế hoạch kèm Tiêu chí xong, cài đặt (mobile/web/Supabase), viết test, soát tiền/bảo mật/RLS/chất lượng/hiệu năng/FSD/bất biến/độ phủ test theo cấp thay đổi, lập nhật ký thay đổi, cập nhật tài liệu — bằng cách gọi đúng agent ở đúng bước. Dùng khi người dùng giao tính năng hoặc bug fix có sửa code ("làm tính năng", "sửa lỗi", "thêm màn", "implement"), hoặc gọi /feature-pipeline. Không dùng cho câu hỏi giải thích code hay việc chỉ sửa tài liệu.
---

# Điều phối một tính năng — feature-pipeline

Skill chạy ở **luồng hội thoại chính** và gọi các agent trong `.claude/agents/`. Agent con không gọi được agent con khác, nên việc điều phối nằm ở đây. Khung chung của mọi agent (model, quyền, bàn giao) ở skill `agent-framework`.

Nguyên tắc: **agent soát không phải là agent viết.** Người viết code không tự chấm code của mình; người viết test không tự chấm độ phủ.

## Trước khi bắt đầu

- Yêu cầu mơ hồ → xác nhận phạm vi bằng một câu.
- Người dùng nói đang **học** và muốn tự viết → chỉ đưa khung + TODO, không chạy Giai đoạn 2–3.
- Ghi nhận vùng bị đụng: `src/lib/money`, `src/lib/data`, `src/lib/storage`, `src/app`, `supabase/`, `web/`.
- Đang chạy model thay thế vì hết quota (`ANTHROPIC_DEFAULT_OPUS_MODEL` trong `.claude/settings.local.json`) → ghi vào brief; kết luận ĐẠT của agent `opus` chỉ là tham khảo.

### Thư mục việc — bàn giao giữa các agent

Tạo `.claude-run/<ma-viec>/` trước khi gọi agent đầu tiên (`<ma-viec>` dạng `2026-09-26-luu-tru-chuyen-di`). Thư mục tự bỏ khỏi git bằng `.claude-run/.gitignore` — **không** sửa `.gitignore` gốc (nguồn runtime fingerprint → ép build APK).

- `brief.md` — ghi một lần: yêu cầu nguyên văn, vùng bị đụng, cấp thay đổi, bảng **Tiêu chí xong**, các quyết định người dùng đã chốt (bổ sung khi họ chốt thêm).
- `progress.md` — **nối thêm** một dòng sau mỗi agent: `- <HH:MM> <agent>: <kết luận 1 dòng> → reports/<agent>.md`.
- `reports/<agent>.md` — dán nguyên báo cáo agent trả về (vòng 2: `<agent>-v2.md`).

Mọi lần gọi agent kèm câu "thư mục việc: `.claude-run/<ma-viec>/`" — mục Khởi động của agent sẽ đọc brief và progress. Agent soát không ghi file; luồng chính ghi hộ. Hội thoại bị nén → đọc lại `progress.md` để biết đang ở đâu.

### Cấp thay đổi — quyết định gọi agent nào

Agent nào cũng khởi động với ngữ cảnh trống nên tốn token; agent soát chỉ đáng gọi khi việc đủ khó để người viết tự sót. Xếp cấp ngay khi hiểu yêu cầu, ghi vào `brief.md`, trình cùng kế hoạch (người dùng đổi được). Một dấu hiệu của cấp cao hơn là lên cấp.

| Cấp | Dấu hiệu | Giai đoạn 1 | Giai đoạn 4 |
|---|---|---|---|
| **Nhỏ** | ≤ 3 file, chỉ UI/chữ/style, không đụng `src/lib`, `supabase/`, `web/src/shared/api` | luồng chính tự lập kế hoạch ngắn + Tiêu chí xong, không gọi agent | `code-quality-reviewer`; + `audit-ui` nếu đổi giao diện mobile; + `fsd-architecture-reviewer` nếu đụng `web/` |
| **Vừa** | đụng `src/lib/data`/`storage`, logic thuần, xử lý lỗi, nhiều màn; không bảng/policy/RPC mới, không đụng tiền | cả 2 agent | invariant-guard, security, code-quality, test-coverage (nếu có test); + audit-rn/audit-ui/fsd theo vùng; + performance nếu đổi truy vấn/danh sách; + silent-failure nếu đổi xử lý lỗi |
| **Lớn** | migration/bảng/policy/RPC/trigger mới, đụng `src/lib/money`, auth, Edge Function, quyền, hoặc xuyên mobile + web + Supabase | cả 2 agent | mọi agent áp dụng trong bảng Giai đoạn 4 |

Đụng `src/lib/money` luôn là **Lớn** và luôn có `audit-money`. Giai đoạn 5 cấp Nhỏ: chỉ `change-audit-log`; `docs-updater` chỉ khi đổi hành vi mà tài liệu có mô tả. Bảng là mặc định ban đầu — skill `hieu-chuan-agent` đo lại và cập nhật.

## Giai đoạn 1 — Hiểu hiện trạng (chỉ đọc, SONG SONG)

| Agent | Đầu vào |
|---|---|
| `documentation-accuracy-reviewer` | yêu cầu + vùng code dự kiến |
| `divvyup-planner` | yêu cầu (nó trả kèm bảng Tiêu chí xong nháp) |
| `scout-repo` | (tuỳ chọn) khi cần bản đồ nhanh một vùng lạ |

Chỗ tài liệu sai → kế hoạch dựa vào code.

**Điểm dừng:** trình cho người dùng và **chờ đồng ý** — trừ khi người dùng đã nói rõ "cứ làm luôn"/"làm đi":

- kế hoạch: file sẽ đụng, migration, việc tay;
- cấp thay đổi và danh sách agent sẽ gọi;
- **Tiêu chí xong** (bảng TC từ `divvyup-planner`, luồng chính làm gọn): mỗi TC là một hành vi quan sát được, kèm cách kiểm — test thuần / verify.sql / tay (2 tài khoản) / tay (máy thật hoặc web).

Người dùng duyệt → ghi bảng TC vào `brief.md`. **Đây là hợp đồng "thế nào là xong"**: `test-writer` viết test theo TC, `test-coverage-reviewer` chấm theo TC, báo cáo cuối liệt kê từng TC. Đổi TC giữa chừng phải hỏi lại người dùng.

## Giai đoạn 2 — Cài đặt

- Bảng/cột/RPC/quyền mới → giao `supabase-feature` (8 bước, gồm types sửa tay và nhánh khách).
- Phần còn lại → luồng chính tự sửa theo kế hoạch.
- Build tối thiểu phải xanh trước khi sang giai đoạn sau:
  ```
  npm run typecheck
  npm test
  cd web && npm run typecheck && npm run build     # nếu đụng web
  ```
- Thêm route mobile mới: typed routes (`.expo/types/router.d.ts`, git bỏ qua) chỉ tự sinh khi dev server chạy — typecheck đỏ vì route mới là do file đó cũ, không phải lỗi code.

## Giai đoạn 3 — Test

- Logic thuần (đặc biệt tiền) → giao `test-writer`, kèm yêu cầu và bảng Tiêu chí xong trong `brief.md` (mỗi TC "Kiểm bằng: test thuần" phải có test).
- Bất biến chỉ nằm trong SQL → truy vấn mới trong `supabase/verify.sql` + checklist kiểm tay hai tài khoản.
- Màn hình mobile/web không có bộ chạy test UI — TC "tay" ghi rõ là **chưa kiểm** trong báo cáo cuối nếu chưa chạy thật (`npm run web`, máy thật, hoặc Browser pane với web local), không coi là đạt.
- Đang hiệu chuẩn bộ agent (skill `hieu-chuan-agent`): không nói trước lỗi đã cài cho agent soát, và test không được lộ đáp án (tên test/comment).

## Giai đoạn 4 — Soát (chỉ đọc, SONG SONG)

Gọi cùng lúc những agent **áp dụng và thuộc cấp thay đổi** đã chốt:

| Agent | Khi nào |
|---|---|
| `invariant-guard` | đụng `src/lib`, `supabase/`, hoặc `web/src/shared/api` (hook commit bắt buộc) |
| `audit-money` | đụng chia tiền, số dư, tối giản công nợ, định dạng tiền |
| `audit-supabase` | đụng migration, policy, RPC, tầng truy cập dữ liệu |
| `security-code-reviewer` | có sửa code ở cấp Vừa/Lớn |
| `code-quality-reviewer` | có sửa code |
| `audit-rn` | đụng component/hook/route mobile |
| `audit-ui` | đụng giao diện mobile |
| `fsd-architecture-reviewer` | đụng `web/` |
| `performance-reviewer` | đụng truy vấn, danh sách, ảnh, thuật toán trên dữ liệu, bundle web |
| `silent-failure` | đụng xử lý lỗi, best-effort, upload |
| `test-coverage-reviewer` | Giai đoạn 3 có viết test |

Prompt tự đủ nghĩa: thư mục việc, danh sách file, mô tả thay đổi một câu, nhắc đọc trạng thái hiện tại của file.

### Hợp nhất

Một bảng, khử trùng (cùng `file:line` → một dòng, ghi các agent):

```
| Mức | Agent | file:line | Vấn đề |
```

Xếp: mất tiền → lộ dữ liệu → crash → sai dữ liệu → hiệu năng → quy ước. Hai agent kết luận trái nhau → tự đọc file và phân xử. Mục "Agent lệch" của các báo cáo → gom lại cuối bảng để sửa file agent (qua `agent-framework`).

### Vòng sửa

- CHẶN / CẦN SỬA / THIẾU / TC chưa đạt → sửa, rồi **chỉ gọi lại agent đã báo mục đó**, chỉ đưa phần diff của vòng sửa và danh sách mục cần xác nhận — không bắt soát lại cả tính năng.
- Tối đa **2 vòng**; còn chặn → trình người dùng quyết.
- CẢNH BÁO → rẻ thì sửa luôn; tốn/đổi phạm vi → người dùng chọn sửa hay chấp nhận; ghi lại để đưa vào nhật ký.

## Giai đoạn 5 — Nhật ký và tài liệu (tuần tự)

1. `change-audit-log` — kèm kết quả build/test/soát và CẢNH BÁO đã chấp nhận.
2. `docs-updater` — kèm nhật ký và các mục SAI/THIẾU từ Giai đoạn 1.

## Giai đoạn 6 — Báo cáo cuối

```
| Giai đoạn | Kết quả |
|---|---|
| Cấp thay đổi | Nhỏ / Vừa / Lớn — agent đã gọi: <...> |
| Tài liệu hiện trạng | n chỗ sai |
| Cài đặt | typecheck / test / web build |
| Test | n test mới |
| Invariant / Money / Supabase / Security / Quality / RN / UI / FSD / Perf / Coverage | ĐẠT / CẢNH BÁO / CHẶN / không áp dụng |
| Tài liệu | file đã cập nhật |

### Tiêu chí xong
| TC | Kiểm bằng | Kết quả | Bằng chứng |
|---|---|---|---|
| TC-1 | test thuần | ĐẠT | archive.test.ts (test-writer), phủ đủ (test-coverage) |
| TC-2 | tay (2 tài khoản) | CHƯA KIỂM | cần chạy migration trước |

Tính năng chỉ gọi là "xong" khi mọi TC ĐẠT; còn lại liệt kê ở "Còn tồn đọng".

### Việc tay của người dùng (migration → Edge Function → push → build APK / deploy web)
### Còn tồn đọng
### Agent lệch (đề xuất sửa file agent)
### Nhật ký thay đổi
```

Rồi hỏi người dùng có muốn commit không (skill `git-commit`).

## Tuyệt đối không

- Không commit, không push khi chưa được yêu cầu — **push `main` tự phát hành OTA**.
- Không bỏ Giai đoạn 4 vì "thay đổi nhỏ" khi đụng tiền hoặc RLS.
- Không coi ĐẠT của một agent là lý do bỏ qua CHẶN của agent khác.
- Không tự sửa `.claude/settings.json` trong quy trình này.
