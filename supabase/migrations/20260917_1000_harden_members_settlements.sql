-- ============================================================================
-- DivvyUp — 10. Siết thành viên, tất toán và xoá mềm
--
-- THỨ TỰ: 20260916_1040 TRƯỚC, file này SAU. Không bao giờ chạy lại 1040 sau
-- file này: 1040 sẽ ghi đè guard_trip_member_changes bằng bản cũ trong khi
-- trigger đã là BEFORE INSERT — bản cũ đọc OLD (null khi INSERT) và mọi lệnh
-- thêm thành viên gãy. Bước khôi phục thành viên của 1040 được lặp lại ở đây
-- (an toàn khi chạy lại) nên bỏ qua 1040 cũng không sao.
--
-- Các lỗ hổng được đóng (tìm ra khi rà trước release):
--
--  1. LEO QUYỀN QUA INSERT. Trigger 1040 chỉ chặn đổi role khi UPDATE; policy
--     INSERT của trip_members không ràng buộc role. Thành viên thường chèn một
--     dòng role='owner', nhận chỗ đó bằng tài khoản phụ qua join_trip_by_code,
--     rồi xoá chuyến đi của cả nhóm.
--
--  2. CHÈN THÀNH VIÊN ĐÃ-XOÁ-SẴN. INSERT với removed_at khác null lọt qua vì
--     trigger chỉ chạy BEFORE UPDATE. Gán người đó vào khoản chi thì view
--     trip_balances lọc mất họ, tổng số dư ≠ 0, cả chuyến đi báo lỗi.
--
--  3. SỬA TẤT TOÁN SANG NGƯỜI CHUYẾN KHÁC. Policy UPDATE của settlements không
--     kiểm lại from_member/to_member (INSERT thì có). Một vế giao dịch rơi khỏi
--     view, tổng số dư ≠ 0.
--
--  4. KHÔI PHỤC KHOẢN CHI ĐÃ XOÁ. Policy UPDATE cho mọi thành viên đặt lại
--     deleted_at = null. App không có tính năng khôi phục; cửa này chỉ để lại
--     đường hồi sinh khoản chi đang trỏ tới người đã bị gỡ.
--
--  5. GỠ THÀNH VIÊN chỉ còn áp dụng cho CHỖ TRỐNG (chưa gắn tài khoản), chưa
--     dính khoản chi/tất toán, và không phải owner. Gỡ một TÀI KHOẢN không thu
--     hồi được quyền: người đó vẫn biết mã mời và nhận lại chỗ trống khác bằng
--     tài khoản phụ. Muốn thu hồi thật phải đổi mã mời cùng lúc — việc của một
--     tính năng riêng. App hiện không có nút gỡ.
--
--  6. NHẬN CHỖ OWNER QUA MÃ MỜI. join_trip_by_code không loại chỗ role='owner'
--     chưa gắn tài khoản. Chặn ở trigger.
--
--  7. CHUYẾN MẤT CHỦ. Chủ chuyến tự hạ quyền mình (hoặc hạ owner cuối cùng)
--     thì không còn ai quản lý. Chặn bỏ owner cuối cùng.
--
--  8. TRANH CHẤP gỡ thành viên ↔ gán thành viên vào khoản chi chạy song song.
--     Hai bên kiểm lẫn nhau nhưng không khoá, cả hai cùng commit được. Kiểm
--     khoản chi giờ khoá dòng thành viên (FOR SHARE), và hàm đếm bản ghi là
--     VOLATILE để đọc snapshot mới SAU khi chờ khoá.
--
-- "Phiên quản trị" = SQL Editor / psql: không có JWT (auth.uid() null) VÀ không
-- đi qua PostgREST (session_user khác 'authenticator'). Không dùng riêng
-- auth.uid() is null: role anon gọi qua PostgREST cũng có uid null.
--
-- Rollback:
--   drop trigger if exists trip_members_guard_changes on public.trip_members;
--   drop trigger if exists settlements_members_in_trip on public.settlements;
--   drop trigger if exists expenses_forbid_undelete on public.expenses;
--   drop trigger if exists settlements_forbid_undelete on public.settlements;
--   drop function if exists public.guard_trip_member_changes(),
--     public.check_settlement_members(), public.forbid_undelete(),
--     public.is_privileged_session(), public.member_has_active_records(uuid);
--   rồi apply lại 20260916_1040 và bản check_member_belongs_to_trip trong
--   20260915_1110.
-- ============================================================================

-- Lặp lại bước khôi phục của 1040 (có điều kiện, chạy lại vô hại): thành viên đã
-- gỡ mà còn dính dữ liệu tiền có hiệu lực làm số dư lệch. Chạy TRƯỚC khi thay
-- trigger, vì trigger mới cũng chặn lệnh này nếu không phải phiên quản trị.
update public.trip_members tm
set removed_at = null
where tm.removed_at is not null
  and (
    exists (select 1 from public.expenses e
            where e.paid_by = tm.id and e.deleted_at is null)
    or exists (select 1 from public.expense_shares es
               join public.expenses e on e.id = es.expense_id
               where es.member_id = tm.id and e.deleted_at is null)
    or exists (select 1 from public.settlements s
               where (s.from_member = tm.id or s.to_member = tm.id)
                 and s.deleted_at is null)
  );


create or replace function public.is_privileged_session()
returns boolean
language sql
stable
set search_path = public
as $$
  select (select auth.uid()) is null and session_user <> 'authenticator';
$$;

-- Trigger không phải SECURITY DEFINER nên chạy với quyền người gọi: role
-- authenticated PHẢI có EXECUTE, không thì mọi lệnh ghi qua API báo
-- "permission denied". Thu của anon (Supabase cấp mặc định cho cả anon).
revoke execute on function public.is_privileged_session() from public, anon;
grant execute on function public.is_privileged_session() to authenticated;


-- Thành viên còn dính dữ liệu tiền đang có hiệu lực không. Khoản chi/tất toán đã
-- xoá mềm không tính: trigger forbid_undelete bên dưới bảo đảm chúng không bao
-- giờ quay lại.
-- VOLATILE có chủ đích (xem mục 8): hàm STABLE dùng snapshot của câu lệnh gọi
-- nó, chụp TRƯỚC khi chờ khoá — không thấy phần chia vừa commit.
create or replace function public.member_has_active_records(p_member_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.expenses e
      where e.paid_by = p_member_id and e.deleted_at is null
    )
    or exists (
      select 1 from public.expense_shares es
      join public.expenses e on e.id = es.expense_id
      where es.member_id = p_member_id and e.deleted_at is null
    )
    or exists (
      select 1 from public.settlements s
      where (s.from_member = p_member_id or s.to_member = p_member_id)
        and s.deleted_at is null
    );
$$;

revoke execute on function public.member_has_active_records(uuid) from public, anon;
grant execute on function public.member_has_active_records(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- trip_members: một trigger cho cả INSERT lẫn UPDATE
-- ---------------------------------------------------------------------------
create or replace function public.guard_trip_member_changes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_privileged boolean := public.is_privileged_session();
begin
  if v_privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.removed_at is not null then
      raise exception 'Không thể tạo thành viên ở trạng thái đã xoá.' using errcode = '42501';
    end if;

    -- Dòng owner duy nhất hợp lệ là dòng do trigger add_trip_creator_as_member
    -- tạo lúc tạo chuyến: đúng người tạo, gắn tài khoản của chính họ, và chuyến
    -- chưa có owner nào. (Client thường không chèn được user_id — policy chặn.)
    if new.role is distinct from 'member'
       and not (
         new.user_id = v_uid
         and exists (
           select 1 from public.trips t
           where t.id = new.trip_id and t.created_by = v_uid
         )
         and not exists (
           select 1 from public.trip_members tm
           where tm.trip_id = new.trip_id and tm.role = 'owner'
         )
       ) then
      raise exception 'Chỉ người tạo chuyến đi mới là chủ chuyến.' using errcode = '42501';
    end if;

    return new;
  end if;

  -- UPDATE
  if new.removed_at is distinct from old.removed_at then
    if not public.is_trip_owner(new.trip_id) then
      raise exception 'Chỉ chủ chuyến đi mới gỡ hoặc thêm lại thành viên.' using errcode = '42501';
    end if;
    if new.removed_at is not null then
      -- Kiểm cả old.role: một lệnh vừa hạ quyền vừa gỡ không được lọt qua.
      if old.role = 'owner' or new.role = 'owner' then
        raise exception 'Không thể gỡ chủ chuyến đi.' using errcode = '42501';
      end if;
      if old.user_id is not null then
        raise exception
          'Chỉ gỡ được chỗ chưa có người nhận. Gỡ một tài khoản không thu hồi được quyền vì họ vẫn biết mã mời.'
          using errcode = '42501';
      end if;
      if public.member_has_active_records(new.id) then
        raise exception
          'Không thể xoá thành viên đang gắn với khoản chi hoặc tất toán. Chỉ được đổi tên.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if new.role is distinct from old.role then
    if not public.is_trip_owner(new.trip_id) then
      raise exception 'Chỉ chủ chuyến đi mới đổi được vai trò thành viên.' using errcode = '42501';
    end if;
    if new.role = 'owner' and new.user_id is null then
      raise exception 'Chỉ trao quyền chủ chuyến cho người đã có tài khoản.' using errcode = '42501';
    end if;
    if old.role = 'owner' and not exists (
      select 1 from public.trip_members tm
      where tm.trip_id = new.trip_id
        and tm.id <> new.id
        and tm.role = 'owner'
        and tm.user_id is not null
        and tm.removed_at is null
    ) then
      raise exception 'Chuyến đi phải còn ít nhất một chủ chuyến.' using errcode = '42501';
    end if;
  end if;

  -- Nhận chỗ qua join_trip_by_code: chỗ owner chưa có người là dấu vết lỗi cũ
  -- hoặc dữ liệu sửa tay — không cho ai nhận để thành chủ chuyến.
  if old.user_id is null and new.user_id is not null and new.role = 'owner' then
    raise exception 'Không thể nhận chỗ của chủ chuyến bằng mã mời.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trip_members_guard_changes on public.trip_members;

create trigger trip_members_guard_changes
  before insert or update on public.trip_members
  for each row execute function public.guard_trip_member_changes();


-- ---------------------------------------------------------------------------
-- Khoản chi: người trả và người gánh phải thuộc chuyến VÀ còn hoạt động.
-- Bản cũ (20260915_1110) chỉ kiểm cùng chuyến. update_expense không kiểm
-- removed_at như create_expense, nên chốt ở constraint trigger cho mọi đường.
-- ---------------------------------------------------------------------------
create or replace function public.check_member_belongs_to_trip()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_trip_id     uuid;
  v_active      boolean;
  v_member_trip uuid;
  v_removed_at  timestamptz;
  v_member_id   uuid;
begin
  if tg_table_name = 'expenses' then
    v_trip_id := new.trip_id;
    v_member_id := new.paid_by;
    v_active := new.deleted_at is null;
  else
    select e.trip_id, e.deleted_at is null into v_trip_id, v_active
    from public.expenses e where e.id = new.expense_id;
    if not found then
      return null;
    end if;
    v_member_id := new.member_id;
  end if;

  -- FOR SHARE: chờ nếu có ai đang gỡ đúng người này, rồi đọc trạng thái SAU
  -- khi họ commit (xem mục 8).
  select tm.trip_id, tm.removed_at into v_member_trip, v_removed_at
  from public.trip_members tm
  where tm.id = v_member_id
  for share;

  if v_member_trip is distinct from v_trip_id then
    raise exception 'Thành viên % không thuộc chuyến đi của khoản chi này.', v_member_id
      using errcode = '42501';
  end if;
  if v_active and v_removed_at is not null then
    raise exception 'Thành viên % đã rời chuyến đi, không gán vào khoản chi được.', v_member_id
      using errcode = '42501';
  end if;

  return null;
end;
$$;


-- ---------------------------------------------------------------------------
-- Tất toán: hai đầu giao dịch phải thuộc đúng chuyến và còn hoạt động — cho cả
-- UPDATE, không chỉ INSERT như policy.
-- ---------------------------------------------------------------------------
create or replace function public.check_settlement_members()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.deleted_at is not null then
    return null;
  end if;

  perform 1 from public.trip_members tm
  where tm.id in (new.from_member, new.to_member)
  for share;

  if (
    select count(*) from public.trip_members tm
    where tm.id in (new.from_member, new.to_member)
      and tm.trip_id = new.trip_id
      and tm.removed_at is null
  ) <> 2 then
    raise exception 'Hai bên của giao dịch tất toán phải thuộc chuyến đi này.'
      using errcode = '42501';
  end if;

  return null;
end;
$$;

drop trigger if exists settlements_members_in_trip on public.settlements;

create constraint trigger settlements_members_in_trip
  after insert or update on public.settlements
  deferrable initially deferred
  for each row execute function public.check_settlement_members();


-- ---------------------------------------------------------------------------
-- Xoá mềm là một chiều.
-- ---------------------------------------------------------------------------
create or replace function public.forbid_undelete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.deleted_at is not null
     and new.deleted_at is null
     and not public.is_privileged_session() then
    raise exception 'Không thể khôi phục bản ghi đã xoá.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_forbid_undelete on public.expenses;

create trigger expenses_forbid_undelete
  before update on public.expenses
  for each row execute function public.forbid_undelete();

drop trigger if exists settlements_forbid_undelete on public.settlements;

create trigger settlements_forbid_undelete
  before update on public.settlements
  for each row execute function public.forbid_undelete();
