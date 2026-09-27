---
name: hieu-chuan-agent
description: Đo bộ agent của repo DivvyUp bằng một tính năng mồi có lỗi cài sẵn — agent nào bắt được lỗi nào, bỏ sót gì, báo nhầm gì, tốn bao nhiêu token — và gỡ thử từng agent để biết agent nào còn gánh việc. Dùng khi đổi model (kể cả đổi tạm vì hết quota), sau khi sửa file agent soát, khi cân nhắc thêm/bỏ agent hoặc chỉnh bảng "Cấp thay đổi" của feature-pipeline, hoặc khi người dùng nói "hiệu chuẩn agent", "đo agent", "agent có còn bắt lỗi không".
---

# Hiệu chuẩn bộ agent — hieu-chuan-agent

Mỗi agent là một giả định "model tự làm thì sẽ sót việc này". Model mạnh lên thì giả định có thể hết đúng, và agent chỉ còn tốn token. Cách biết: cài lỗi đã biết đáp án, cho agent soát **mà không nói đáp án**, chấm điểm, rồi tắt thử từng agent.

## Khi nào chạy

- Đổi model (frontmatter, hoặc `ANTHROPIC_DEFAULT_*_MODEL` khi hết quota).
- Sửa nội dung một agent soát, hoặc thêm agent mới (để nâng cấp quyền 0 → 1 theo `agent-framework`).
- Trước khi sửa bảng "Cấp thay đổi" trong `feature-pipeline`.

## Quy tắc an toàn

DivvyUp chỉ có **một** project Supabase — production. Vì vậy:

- Làm trong **worktree/nhánh riêng** `hieu-chuan/<ngay>` tách từ `main`. Xong thì xoá nhánh và worktree. **Không bao giờ push nhánh này** (push `main` là OTA; push nhánh khác cũng không cần).
- Migration mồi **không bao giờ chạy** — không SQL Editor, không `supabase db push` (hook đã chặn). Agent soát migration bằng cách đọc, đủ cho mục đích đo.
- Không `npm run web` trỏ vào project thật để "thử" code mồi có lỗi bảo mật.
- Không commit gì của tính năng mồi lên nhánh làm việc. Kết quả đo ghi vào `.claude-run/` (git bỏ qua) và tóm tắt vào `lich-su.md` cùng thư mục skill này.

## Bước 1 — Chọn lỗi cài

Chọn 6–8 lỗi, trộn nhiều agent sở hữu. Ghi đáp án vào `.claude-run/hieu-chuan-<ngay>/dap-an.md` — **file này không bao giờ đưa cho agent soát**, không nhắc trong prompt, không để lộ qua tên test/comment/tên biến.

| Mã | Lỗi cài | Agent phải bắt (sở hữu) | Mức mong đợi |
|---|---|---|---|
| L01 | Chia tiền bằng `Math.round(total / n)` cho mọi người — tổng phần chia ≠ tổng khoản chi | audit-money | CHẶN |
| L02 | Số tiền lưu/tính bằng `parseFloat` hoặc `.toFixed(2)` trên đơn vị lớn | audit-money | CHẶN |
| L03 | Policy mới `using (true)` hoặc thiếu `with check` trên bảng có `trip_id` | audit-supabase | CHẶN |
| L04 | RPC `security definer` không `set search_path`, hoặc không kiểm `is_trip_member` | audit-supabase, security-code-reviewer | CHẶN |
| L05 | Thêm cột mà không sửa `database.types.ts` / không có nhánh khách trong `manager.ts` | invariant-guard | CHẶN |
| L06 | Khoá `service_role` hoặc secret dán vào `src/` / `web/src` / `eas.json` | security-code-reviewer, invariant-guard | CHẶN |
| L07 | Web: `dangerouslySetInnerHTML` với dữ liệu người dùng, hoặc redirect theo `?next=` không kiểm | security-code-reviewer | CHẶN |
| L08 | `catch {}` rỗng / `.catch(() => undefined)` ở thao tác chính (lưu khoản chi) | silent-failure | CẦN SỬA |
| L09 | `setState` sau `await` không kiểm unmount, hoặc `new Date()` trong thân render với React Compiler | audit-rn | CẦN SỬA |
| L10 | Màu hex viết cứng trong `className`/style thay vì token | audit-ui | CẦN SỬA |
| L11 | `pages/` web gọi thẳng `supabase.from(...)`, hoặc `features/a` import `features/b` | fsd-architecture-reviewer | CHẶN |
| L12 | Truy vấn trong vòng lặp theo từng thành viên (N+1), danh sách không giới hạn | performance-reviewer | CẦN SỬA |
| L13 | Test tiền chỉ kiểm "không ném lỗi", không kiểm tổng — không bao giờ đỏ khi chia sai | test-coverage-reviewer | THIẾU |
| L14 | `AGENTS.md` / `supabase/README.md` mô tả sai hành vi vừa đổi | documentation-accuracy-reviewer | SAI |

Lỗi typecheck/test đỏ cố ý **không** thuộc bộ này: build đỏ bị chặn ở Giai đoạn 2 bằng lệnh, không cần agent.

## Bước 2 — Dựng tính năng mồi

Một tính năng nhỏ trung tính (vd "ghi chú cho từng khoản chi": một cột, một RPC, một ô nhập mobile + web) — tự viết, rồi cài các lỗi đã chọn **bằng tay** sau khi code chạy được. Typecheck/test phải xanh trước khi soát. Code mồi trông như code bình thường — không comment "lỗi ở đây".

## Bước 3 — Chạy soát, chấm

Gọi các agent của Giai đoạn 4 (và documentation-accuracy-reviewer nếu cài L14) với prompt **trung tính**, giống hệt khi dùng thật: "soát tính năng ghi chú khoản chi trên nhánh này". Ghi số token mỗi lượt gọi (có trong kết quả trả về của công cụ Agent).

Chấm vào `.claude-run/hieu-chuan-<ngay>/ket-qua.md`:

```
| Mã | Agent sở hữu bắt? | Agent khác bắt | Mức báo | Ghi chú |
| L01 | có | invariant-guard | CHẶN | |

| Agent | Bắt đúng | Bắt DUY NHẤT (không agent nào khác bắt) | Báo nhầm | Token |
```

- **Bỏ sót** của agent sở hữu → sửa file agent đó (qua `agent-framework`), chạy lại riêng agent đó.
- **Báo nhầm** (mục CHẶN không có thật) → cũng là lỗi của agent: tốn vòng sửa, làm người dùng mất tin.

## Bước 4 — Gỡ thử (ablation)

Agent có **0 lỗi bắt duy nhất** qua **2 lần hiệu chuẩn liên tiếp** là ứng viên bỏ hoặc hạ xuống chỉ gọi ở cấp Lớn. Muốn chắc: chạy lại Bước 3 **không có** agent đó trên cùng bộ lỗi — tổng số lỗi bắt được không giảm thì agent không còn gánh việc ở model hiện tại.

Không tự bỏ agent. Trình kết quả cho người dùng quyết, rồi mới sửa bảng "Cấp thay đổi" trong `feature-pipeline`.

## Bước 5 — Ghi lịch sử và dọn

1. Nối vào `lich-su.md` một khối: ngày, model từng agent (hoặc model thay thế đang bật), lỗi đã cài (mã), tỉ lệ bắt theo agent, token theo agent, quyết định rút ra. Không ghi code mồi, không ghi đáp án chi tiết ngoài mã lỗi.
2. Xoá nhánh/worktree `hieu-chuan/<ngay>` (người dùng tự chạy lệnh xoá nếu hook chặn).
3. `git status` trên nhánh làm việc chính phải sạch khỏi mọi thứ của tính năng mồi.
