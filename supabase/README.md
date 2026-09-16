# Schema Supabase — DivvyUp

## Mô hình

```
auth.users → profiles
                │
                ▼
              trips ──► trip_groups ──► trip_members ◄── user_id (NULL cho tới khi nhận lời mời)
                │                            ▲
                ├──► expenses ──────paid_by──┤   (một người đại diện trả)
                │        └──► expense_shares─┤
                └──► settlements ────────────┘

                view trip_balances  (net = đã ứng − phải gánh + đã trả − đã nhận)
```

**Điểm then chốt: `trip_members` không phải tài khoản.** Nó là một cái tên do người tổ chức nhập, `user_id` để trống. Khi người đó được mời và nhận chỗ, `user_id` mới được gắn. Nhờ vậy người chưa cài app vẫn có công nợ đầy đủ.

Hệ quả: quyền truy cập chuyến đi đi qua `trip_members.user_id`, không đi qua `profiles`. Mọi khoản chi tham chiếu `trip_members.id`, không tham chiếu `profiles.id`.

## Áp dụng

Chạy **đúng thứ tự**, mỗi file một lần, trong SQL Editor của dashboard:

| Thứ tự | File | Nội dung |
|---|---|---|
| 1 | `migrations/20260915_1100_trips.sql` | profiles, trips, trip_groups, trip_members, hàm trợ giúp, RLS |
| 2 | `migrations/20260915_1110_expenses.sql` | expenses, expense_shares, trigger bất biến |
| 3 | `migrations/20260915_1120_rpc.sql` | create_trip_group, create/update/void_expense, luồng mời |
| 4 | `migrations/20260915_1130_settlements_balances.sql` | settlements, view trip_balances |
| 5 | `migrations/20260916_1000_fix_trip_balances_type.sql` | ép `net_minor` về bigint (xem ghi chú trong file) |
| 6 | `migrations/20260916_1010_fix_trip_insert_visibility.sql` | người tạo luôn thấy chuyến đi của mình (xem ghi chú trong file) |

Xong thì chạy `verify.sql` — **11 truy vấn, tất cả phải trả về 0 dòng**.

## Những quyết định đáng nhớ

**Tiền là `bigint` đơn vị nhỏ nhất.** VND lưu bằng đồng, USD bằng cent. Không có cột `float`/`numeric` nào cho tiền.

**Một người đại diện trả, lưu ở cột `expenses.paid_by`.** Không có bảng payments riêng. Hệ quả tốt: "tổng tiền ứng = tổng khoản chi" đúng theo cấu trúc, không cần ràng buộc nào canh. Chỉ còn một bất biến phải ép là tổng phần chia.

**Bất biến `sum(expense_shares) = expenses.amount_minor`** ép bằng constraint trigger `DEFERRABLE INITIALLY DEFERRED`. Phải hoãn vì lúc chèn dòng `expenses` thì chưa có phần chia nào.

**Đơn vị tiền tệ khoá bằng khoá ngoại composite.** `trips` có `unique (id, currency)`; `expenses` và `settlements` tham chiếu `(trip_id, currency)`. Khoản chi không thể mang đơn vị tiền tệ khác chuyến đi.

**Thành viên không lọt được sang chuyến đi khác.** `trip_members.group_id` tham chiếu composite `(id, trip_id)` của `trip_groups`; người trả và người gánh được trigger `check_member_belongs_to_trip` kiểm.

**`expenses` và `expense_shares` không có policy INSERT.** Cố ý — tạo khoản chi bắt buộc qua RPC `create_expense()`. Client không tạo được khoản chi lệch tổng dù cố tình.

**Cột `user_id` không sửa được bằng UPDATE thường.** Trigger `protect_trip_member_identity` chặn. Cửa duy nhất là RPC `join_trip_by_code()`, và nó mở khoá bằng `set_config('divvyup.allow_identity_change', 'on', true)` — cờ chỉ tồn tại trong transaction đó, PostgREST không cho client tự đặt.

Lý do phải làm vậy: `SECURITY DEFINER` bỏ qua RLS **nhưng không bỏ qua trigger**, nên nếu không có cờ thì chính RPC cũng bị trigger của mình chặn.

**Mỗi tài khoản chỉ chiếm một chỗ trong mỗi chuyến đi** — unique index `trip_members_one_account_per_trip`. Thiếu nó, một người chiếm hai suất và số dư nhân đôi.

**`trip_balances` bật `security_invoker = true`.** Thiếu dòng này, view chạy với quyền người tạo, bỏ qua RLS và để lộ số dư của mọi chuyến đi.

## Luồng mời

Người được mời chưa phải thành viên nên RLS chặn họ đọc mọi thứ. Hai RPC `SECURITY DEFINER` là cửa duy nhất, chỉ mở khi có mã đúng:

1. `preview_trip_by_code(code)` → tên chuyến đi + danh sách chỗ, kèm cờ chỗ nào đã có người nhận
2. `join_trip_by_code(code, member_id)` → gắn tài khoản vào đúng chỗ đó

Mã tham gia là cột `trips.join_code`, 8 ký tự in hoa, sinh tự động.

## Checklist kiểm thủ công — cần HAI tài khoản

Một tài khoản không kiểm được gì về cô lập dữ liệu.

- [ ] A đọc dữ liệu chuyến đi của B → trả về **rỗng**, không phải lỗi
- [ ] A gọi `create_expense` với `p_trip_id` của chuyến B → báo "không thuộc chuyến đi"
- [ ] A tạo khoản chi có người gánh thuộc chuyến khác → bị từ chối
- [ ] A tạo khoản chi với tổng phần chia lệch tổng tiền → bị từ chối kèm số chênh lệch
- [ ] A insert thẳng vào `expense_shares` qua PostgREST → bị từ chối (không có policy)
- [ ] A `update trip_members set user_id = ...` → bị trigger chặn
- [ ] B nhận một chỗ đã có người → báo "chỗ này đã có người nhận"
- [ ] B nhận chỗ thứ hai trong cùng chuyến → báo "bạn đã có mặt trong chuyến đi này rồi"
- [ ] `select * from trip_balances` chỉ trả về chuyến đi của chính người gọi
- [ ] Tổng `net_minor` của mỗi chuyến đi bằng 0

## Còn thiếu

Chưa có: đổi mã tham gia khi bị lộ, hạn dùng của mã, Realtime, phân trang khi danh sách khoản chi dài, nhiều người cùng ứng tiền cho một khoản (hiện chỉ một đại diện), và tỷ giá khi chuyến đi cần nhiều đơn vị tiền tệ (hiện mỗi chuyến khoá một đơn vị).
