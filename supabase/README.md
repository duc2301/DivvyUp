# Schema Supabase — DivvyUp

## Áp dụng

Chạy **đúng thứ tự**, mỗi file một lần:

| Thứ tự | File | Nội dung |
|---|---|---|
| 1 | `migrations/20260915_1000_core_groups.sql` | profiles, groups, group_members, hàm trợ giúp, RLS |
| 2 | `migrations/20260915_1010_expenses.sql` | expenses, payments, shares, trigger bất biến tổng |
| 3 | `migrations/20260915_1020_expense_rpc.sql` | RPC `create_expense`, `void_expense` |
| 4 | `migrations/20260915_1030_settlements_balances.sql` | settlements, view `group_balances` |

Cách nhanh nhất: mở **SQL Editor** trên dashboard Supabase, dán từng file theo thứ tự.

Dùng CLI thì:

```bash
npx supabase link --project-ref <project-ref>
```

```bash
npx supabase db push
```

Sau khi xong, chạy `verify.sql` — **mọi truy vấn trong đó phải trả về 0 dòng**.

## Lưu ý khi áp dụng

**Trigger trên `auth.users`** (file 1) cần quyền của role `postgres`. Chạy qua SQL Editor của dashboard là được. Nếu môi trường của bạn chặn, bỏ trigger đó đi và tạo hồ sơ bằng một lệnh `upsert` vào `profiles` ngay sau khi đăng nhập thành công.

**Migration chưa có đường rollback tự động.** Đây là lần khởi tạo đầu tiên nên rollback = xoá sạch schema:

```sql
drop schema public cascade; create schema public;
```

Chỉ làm khi chưa có dữ liệu thật. Từ migration thứ 5 trở đi, mỗi file phải kèm cách đảo ngược.

## Những quyết định thiết kế đáng nhớ

**Tiền là `bigint` đơn vị nhỏ nhất.** VND lưu bằng đồng, USD bằng cent. Không có cột `float`/`numeric` nào cho tiền. Khớp đúng kiểu `Money` ở `src/lib/money/`.

**Đơn vị tiền tệ bị khoá bằng khoá ngoại composite.** `groups` có `unique (id, currency)`, còn `expenses` và `settlements` tham chiếu `(group_id, currency)`. Một khoản chi **không thể** mang đơn vị tiền tệ khác nhóm của nó — ràng buộc ở tầng DB, không phụ thuộc client nhớ kiểm.

**Bất biến tổng được ép bằng constraint trigger hoãn tới COMMIT.** Phải hoãn vì lúc chèn dòng `expenses` thì chưa có dòng nào trong `shares`. Kể cả khi ai đó `UPDATE` thẳng `amount_minor` qua PostgREST, transaction vẫn bị chặn.

**Không có policy INSERT trên `expenses`, `expense_payments`, `expense_shares`.** Cố ý. Tạo khoản chi bắt buộc đi qua RPC `create_expense()` — nơi kiểm quyền, kiểm bất biến, và ghi cả ba bảng trong một transaction. Client không thể tạo ra khoản chi lệch tổng ngay cả khi cố tình.

**Xoá mềm ở mọi nơi.** `deleted_at` cho nhóm/khoản chi/tất toán, `left_at` cho thành viên. Xoá cứng dữ liệu tiền bạc làm số dư của người khác thay đổi đột ngột và không còn cách truy vết.

**`group_balances` bật `security_invoker = on`.** Thiếu dòng này, view chạy với quyền người tạo, bỏ qua RLS và để lộ số dư của mọi nhóm cho mọi người.

## Cách gọi RPC từ app

```ts
const { data, error } = await supabase.rpc('create_expense', {
  p_group_id: groupId,
  p_description: 'Ăn tối',
  p_amount_minor: total.minor,           // lấy thẳng từ Money
  p_payments: [{ user_id: payerId, amount_minor: total.minor }],
  p_shares: lines.map((line) => ({
    user_id: line.participantId,
    amount_minor: line.amount.minor,
  })),
});
```

`lines` chính là kết quả của `splitExpense()`. Lõi tiền tệ trong app và ràng buộc trong DB kiểm cùng một bất biến ở hai tầng độc lập.

## Checklist kiểm thử thủ công — cần HAI tài khoản

Một tài khoản không kiểm được gì về cô lập dữ liệu. Tạo hai người dùng ở hai nhóm khác nhau rồi thử:

- [ ] A đọc dữ liệu nhóm của B → trả về **rỗng**, không phải lỗi
- [ ] A sửa hoặc huỷ khoản chi của nhóm B → bị từ chối
- [ ] A gọi `create_expense` với `p_group_id` của nhóm B → báo "không phải thành viên"
- [ ] A tạo khoản chi có người tham gia nằm ngoài nhóm → báo "có người không thuộc nhóm"
- [ ] A tạo khoản chi với tổng phần chia lệch tổng tiền → bị từ chối kèm số chênh lệch
- [ ] A insert thẳng vào `expense_shares` qua PostgREST → bị từ chối (không có policy)
- [ ] Người đã rời nhóm (`left_at` khác null) không còn đọc được dữ liệu nhóm
- [ ] `select * from group_balances` chỉ trả về các nhóm của chính người gọi
- [ ] Tổng `net_minor` của mỗi nhóm bằng 0

## Còn thiếu

Chưa có: mời thành viên bằng link/mã, Realtime cho cập nhật trực tiếp, phân trang khi danh sách khoản chi dài, và tỷ giá khi nhóm dùng nhiều đơn vị tiền tệ (hiện mỗi nhóm khoá một đơn vị duy nhất).
