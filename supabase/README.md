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

                view trip_balances  (net = đã ứng − phải gánh + đã trả − đã nhận,
                                      bỏ qua khoản chi đã đánh dấu "đã xong")

trip_archives (user_id, trip_id) — lưu trữ hiển thị riêng từng người, không thuộc cây trên
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
| 7 | `migrations/20260916_1020_trip_place.sql` | điểm đến của chuyến đi (cột `place_*`, toạ độ) |
| 8 | `migrations/20260916_1030_trip_cover_gallery.sql` | bộ ảnh bìa `cover_images` + `cover_image_index`, gỡ 4 cột ảnh đơn |
| 9 | `migrations/20260916_1040_lock_trip_members.sql` | chặn xoá thành viên, chặn tự nâng quyền. **Không bao giờ chạy lại sau số 10** (xem đầu file 10) |
| 10 | `migrations/20260917_1000_harden_members_settlements.sql` | siết thành viên/tất toán, xoá mềm một chiều, `is_privileged_session()` |
| 11 | `migrations/20260917_1100_profile_payment_settled.sql` | ảnh đại diện, mã QR nhận tiền (Storage), khoản chi "đã xong" |
| 12 | `migrations/20260925_1000_trip_collab_notes_history.sql` | thành viên sửa chuyến qua RPC, khoá `join_code`/`created_by`/`currency`, bảng `trip_notes`, nhật ký `expense_events`, bỏ policy UPDATE của `expenses` |
| 13 | `migrations/20260926_1000_trip_archives_lock_deletes.sql` | bảng `trip_archives` (lưu trữ chuyến đi riêng từng người), chặn xoá chuyến qua trigger `trips_guard_identity` (cả deleted_at), bỏ policy UPDATE của `trips`, bỏ policy INSERT/UPDATE của `settlements`. **Không chạy lại migration 12 sau file này** — nó ghi đè `guard_trip_identity_columns` bằng bản chưa chặn `deleted_at` |
| 14 | `migrations/20260928_1000_google_sign_in.sql` | đăng nhập Google: RPC `account_needs_password()` (cổng "Đặt mật khẩu" cho người mới tạo qua Google), `handle_new_user` lấy tên Google (`full_name`/`name`), cắt 80 ký tự |

Xong thì chạy `verify.sql` — **mục 1–18, 20, 21, 23, 24 phải trả về 0 dòng**. Mục 19 và 22 chỉ để soát thủ công (không bắt buộc 0 dòng); mục 25 là checklist kiểm tay đăng nhập Google (câu lệnh để trong comment).

## Những quyết định đáng nhớ

**Tiền là `bigint` đơn vị nhỏ nhất.** VND lưu bằng đồng, USD bằng cent. Không có cột `float`/`numeric` nào cho tiền.

**Một người đại diện trả, lưu ở cột `expenses.paid_by`.** Không có bảng payments riêng. Hệ quả tốt: "tổng tiền ứng = tổng khoản chi" đúng theo cấu trúc, không cần ràng buộc nào canh. Chỉ còn một bất biến phải ép là tổng phần chia.

**Bất biến `sum(expense_shares) = expenses.amount_minor`** ép bằng constraint trigger `DEFERRABLE INITIALLY DEFERRED`. Phải hoãn vì lúc chèn dòng `expenses` thì chưa có phần chia nào.

**Đơn vị tiền tệ khoá bằng khoá ngoại composite.** `trips` có `unique (id, currency)`; `expenses` và `settlements` tham chiếu `(trip_id, currency)`. Khoản chi không thể mang đơn vị tiền tệ khác chuyến đi.

**Thành viên không lọt được sang chuyến đi khác.** `trip_members.group_id` tham chiếu composite `(id, trip_id)` của `trip_groups`; người trả và người gánh được trigger `check_member_belongs_to_trip` kiểm.

**`expenses` và `expense_shares` không có policy INSERT, `expenses` không có policy UPDATE.** Cố ý — mọi thay đổi khoản chi bắt buộc qua RPC `create_expense()` / `update_expense()` / `void_expense()` / `set_expense_settled()`. Client không tạo được khoản chi lệch tổng dù cố tình, và không vòng qua được nhật ký.

**`trips` không có policy UPDATE, `settlements` không có policy INSERT/UPDATE.** Client không xoá được chuyến đi (kể cả xoá mềm) hay ghi tất toán trực tiếp. Sửa chuyến đi đi qua RPC `update_trip_details()` / `update_trip_place()` / `set_trip_cover_index()`; app không có tính năng xoá chuyến, người dùng chỉ **lưu trữ** (bảng `trip_archives`, riêng của từng người, không đụng dữ liệu chuyến). Ghi tất toán hiện chưa có đường vào từ client — cần tính năng đó thì phải viết RPC `SECURITY DEFINER` có nhật ký, không mở lại policy.

**`trip_archives` là lưu trữ hiển thị, không phải dữ liệu chuyến đi.** Mỗi dòng nghĩa là "người này đã cất chuyến khỏi danh sách của họ" — không ảnh hưởng quyền xem, khoản chi, hay người khác trong chuyến. Không có policy UPDATE (bỏ lưu trữ = xoá dòng, không sửa).

**Nhật ký `expense_events` ghi bên trong 4 RPC trên**, cùng transaction với thay đổi: mỗi dòng giữ ảnh chụp trọn khoản chi trước/sau (mô tả, số tiền, người trả, phần chia). Bảng chỉ có policy SELECT — không ai sửa được lịch sử.

**Sửa chuyến đi: mọi thành viên qua RPC, không qua policy.** `update_trip_details`, `update_trip_place`, `set_trip_cover_index` chỉ chạm đúng cột được phép. Policy UPDATE của `trips` vẫn chỉ cho chủ chuyến (app chỉ dùng để xoá mềm). Trigger `trips_guard_identity` chặn đổi `join_code`/`created_by`/`currency` ngoài phiên quản trị.

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
