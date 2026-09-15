---
description: Chạy bộ auditor DivvyUp trên các thay đổi hiện tại (hoặc phạm vi chỉ định)
---

Thẩm định các thay đổi trong repo DivvyUp. Phạm vi: $ARGUMENTS (bỏ trống = toàn bộ thay đổi chưa commit).

## Bước 1 — Xác định phạm vi

Chạy `git status --short` và `git diff --stat` (thêm `--cached` nếu đã stage). Nếu người dùng chỉ định phạm vi ở trên thì dùng phạm vi đó.

Không có thay đổi nào → nói thẳng và dừng, đừng đi tìm việc để làm.

## Bước 2 — Chọn auditor theo file đã đổi

Chỉ gọi auditor nào thật sự liên quan. Gọi thừa vừa tốn token vừa tạo phát hiện nhiễu.

| File đã đổi | Auditor |
|---|---|
| Logic chia tiền, số dư, cấn trừ, định dạng tiền tệ | `audit-money` |
| `.sql`, migration, policy, file gọi `supabase`, tầng truy cập dữ liệu | `audit-supabase` |
| Component, hook, route, animation, file theo nền tảng | `audit-rn` |
| Giao diện, style, theme, token màu | `audit-ui` |

Một file có thể kích hoạt nhiều auditor — ví dụ màn hình nhập khoản chi cần cả `audit-money`, `audit-rn` và `audit-ui`.

## Bước 3 — Gọi song song

Gọi tất cả auditor đã chọn **trong cùng một lượt** để chúng chạy song song.

Các auditor **không có quyền chạy git**. Vì vậy prompt gửi cho mỗi auditor phải tự đủ nghĩa và bao gồm:
- Danh sách đường dẫn file đã đổi mà auditor đó phụ trách
- Tóm tắt một câu: thay đổi này nhằm làm gì
- Câu nhắc: đọc trạng thái hiện tại của các file đó, và cả file liên quan nếu cần

Đừng giả định auditor biết bối cảnh cuộc trò chuyện này — mỗi agent khởi động với context trắng.

## Bước 4 — Gộp kết quả

- **Khử trùng lặp**: cùng một vấn đề bị nhiều auditor báo thì gộp làm một, ghi nhận cả hai góc nhìn.
- **Xử lý mâu thuẫn**: hai auditor kết luận trái nhau thì tự kiểm chứng bằng cách đọc file, rồi nêu rõ bên nào đúng và vì sao. Không dán cả hai rồi để người dùng tự xử.
- **Lọc**: bỏ phát hiện không nêu được kịch bản thất bại cụ thể.
- **Xếp hạng**: mất tiền → lộ dữ liệu → crash → sai dữ liệu → hiệu năng → quy ước.

## Bước 5 — Báo cáo

Trình bày một danh sách gộp duy nhất, nghiêm trọng nhất trước, mỗi mục kèm đường dẫn `file:dòng`.

**Không sửa file.** Theo quy tắc của repo, việc sửa do người dùng quyết định. Kết thúc bằng câu hỏi ngắn: nên xử lý mục nào trước.
