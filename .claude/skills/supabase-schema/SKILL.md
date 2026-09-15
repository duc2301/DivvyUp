---
name: supabase-schema
description: Quy trình thiết kế và đổi schema Supabase cho DivvyUp — tạo bảng, viết RLS policy, viết migration, thêm RPC. Dùng khi thêm hoặc sửa bảng, cột, policy, hoặc function trong Postgres.
---

# Quy trình đổi schema Supabase — DivvyUp

Áp dụng luật ở mục 4 của `AGENTS.md`. Skill này nói **thứ tự làm** và **các bẫy cụ thể**.

Nguyên tắc bao trùm: app không có backend riêng, nên **schema chính là tầng bảo mật**. Thiết kế schema xong mới viết code client — không làm ngược lại.

---

## Bước 1 — Thiết kế trên giấy trước

Trả lời đủ bốn câu trước khi gõ một dòng SQL:

1. **Ai được đọc bản ghi này?** Diễn đạt bằng quan hệ dữ liệu, không bằng vai trò. "Thành viên của nhóm chứa khoản chi này" — không phải "người dùng đã đăng nhập".
2. **Ai được sửa, ai được xoá?** Thường hẹp hơn quyền đọc nhiều. Người tạo khoản chi? Hay mọi thành viên?
3. **Xoá thì chuyện gì xảy ra?** Xoá cứng làm mất lịch sử công nợ và làm số dư của người khác thay đổi đột ngột. Với dữ liệu tiền bạc, **soft delete gần như luôn đúng hơn**.
4. **Bản ghi này có bất biến nào?** Ví dụ: tổng các phần chia phải bằng tổng khoản chi. Bất biến nào ép được ở DB thì ép ở DB.

---

## Bước 2 — Viết bảng kèm RLS trong CÙNG một migration

Không bao giờ tách "tạo bảng" và "bật RLS" thành hai migration. Khoảng thời gian giữa hai lần chạy là lúc bảng mở toang.

```sql
create table expenses (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references groups(id) on delete cascade,
  paid_by      uuid not null references profiles(id),
  amount_minor bigint not null check (amount_minor > 0),  -- SỐ NGUYÊN, không float
  currency     char(3) not null,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz                                 -- soft delete
);

alter table expenses enable row level security;
```

Ghi nhớ về cột tiền:
- `bigint` đơn vị nhỏ nhất (VND: đồng). **Không** `float`, `real`, `double precision`.
- Nếu buộc phải dùng `numeric`, luôn ghi rõ precision và scale.
- Có `check` chặn số âm hoặc số 0 nếu nghiệp vụ không cho phép.

---

## Bước 3 — Policy: tách theo từng thao tác

Không dùng `for all`. Viết riêng từng cái, vì điều kiện đọc và điều kiện ghi khác nhau.

```sql
create policy "thành viên đọc khoản chi của nhóm mình"
  on expenses for select
  using ( is_group_member(group_id) );

create policy "thành viên thêm khoản chi vào nhóm mình"
  on expenses for insert
  with check ( is_group_member(group_id) and paid_by = auth.uid() );
```

Ba bẫy phải tránh:

**a) `insert` thiếu `with check`.** Chỉ có `using` là không chặn gì khi chèn — người dùng chèn được bản ghi mạo danh người khác.

**b) Đệ quy policy.** Policy trên `group_members` mà lại truy vấn chính `group_members` sẽ gây vòng lặp. Cắt bằng `security definer` function:

```sql
create function is_group_member(gid uuid) returns boolean
language sql security definer stable
set search_path = public   -- BẮT BUỘC: chống tấn công đổi search_path
as $$
  select exists (
    select 1 from group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;
```

`set search_path` không phải chi tiết vụn vặt — thiếu nó, `security definer` function trở thành lỗ hổng leo thang quyền.

**c) Quên cột mới.** Thêm cột vào bảng đã có policy thì phải rà lại policy xem có cần siết không.

---

## Bước 4 — Thao tác nhiều bảng phải là RPC

Tạo một khoản chi = ghi vào `expenses` + n dòng `expense_shares`. Làm bằng nhiều lệnh `insert` từ client là sai: lỗi mạng giữa chừng để lại khoản chi không có phần chia, và số dư của cả nhóm sai từ đó về sau.

Gói vào một function, và **ép bất biến tổng ngay trong function**:

```sql
create function create_expense(...) returns uuid
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_group_member(p_group_id) then
    raise exception 'không phải thành viên nhóm';
  end if;

  -- kiểm bất biến: tổng các phần chia phải bằng tổng khoản chi
  if (select sum(amount_minor) from unnest(p_shares) ...) <> p_amount_minor then
    raise exception 'tổng phần chia lệch tổng khoản chi';
  end if;

  -- insert cả hai bảng ở đây, tự động trong một transaction
end;
$$;
```

`security definer` bỏ qua RLS, nên **function phải tự kiểm quyền ở dòng đầu tiên**. Quên bước đó là tạo cửa hậu vòng qua toàn bộ RLS.

---

## Bước 5 — Kiểm tra trước khi coi là xong

Chạy thử với **hai tài khoản ở hai nhóm khác nhau**, không phải một tài khoản:

- [ ] Người dùng A đọc dữ liệu nhóm của B → phải trả về rỗng, không phải lỗi
- [ ] A sửa/xoá bản ghi của B → phải bị từ chối
- [ ] A chèn bản ghi mạo danh B (`paid_by = B`) → phải bị từ chối
- [ ] Người đã rời nhóm truy cập dữ liệu cũ → hành vi đúng như thiết kế
- [ ] Mọi bảng mới đều đã `enable row level security`
- [ ] Không có policy nào `using (true)`
- [ ] Mọi `security definer` function đều có `set search_path` và kiểm quyền ở đầu

Truy vấn tìm bảng còn hở:

```sql
select tablename from pg_tables
where schemaname = 'public'
  and tablename not in (
    select tablename from pg_tables t
    join pg_class c on c.relname = t.tablename
    where c.relrowsecurity
  );
```

---

## Bước 6 — Migration an toàn

- Migration phải **cộng thêm** khi có thể. Đổi kiểu cột và `drop column` làm mất dữ liệu.
- Thêm cột `not null` vào bảng đã có dữ liệu thì **phải có `default`**, hoặc tách làm ba bước: thêm cột nullable → điền dữ liệu → siết `not null`.
- Mỗi migration ghi kèm cách rollback. Không rollback được thì ghi rõ lý do.
- Đặt tên theo thời gian và mô tả: `20260915_1030_add_expense_shares.sql`.
- Đổi tên bảng/cột đang được app dùng: triển khai theo kiểu expand–contract, đừng đổi một phát.

---

## Sau khi xong

Chạy `audit-supabase` trên migration mới. Nếu thay đổi chạm tới cột tiền hoặc cách tính số dư, chạy thêm `audit-money`.
