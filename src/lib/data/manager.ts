/**
 * Bộ định tuyến dữ liệu: chế độ khách dùng kho cục bộ, đã đăng nhập dùng Supabase.
 *
 * MỌI màn hình phải gọi qua module này, không gọi thẳng ./trips hay ./expenses.
 * Đó cũng là lý do mọi hàm ở đây khai kiểu trả về TƯỜNG MINH và dùng đúng kiểu
 * của tầng remote: nếu để TypeScript tự suy, chỉ cần nhánh khách trả về hình
 * dạng lệch một chút là cả app mất kiểu mà không ai nhận ra.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CurrencyCode } from '@/lib/money';
import { computeBalances } from '@/lib/money';
import type { StoredExpense, StoredMember, StoredTrip } from '@/lib/storage/local-store';
import { localId, localStore } from '@/lib/storage/local-store';
import { DataError } from '@/lib/supabase/errors';

import type {
  ExpenseDetail,
  ExpenseSummary,
  NamedBalance,
  RecordSettlementInput,
  SaveExpenseInput,
} from './expenses';
import * as remoteExpenses from './expenses';
import type {
  CreateTripInput,
  TripCoverGallery,
  TripGroup,
  TripMember,
  TripPlace,
  TripPreview,
  TripSummary,
} from './trips';
import * as remoteTrips from './trips';

const GUEST_KEY = 'divvyup_is_guest';

async function isGuestMode(): Promise<boolean> {
  return (await AsyncStorage.getItem(GUEST_KEY)) === 'true';
}

/** Việc chỉ có nghĩa khi dữ liệu nằm trên server. */
function guestUnsupported(what: string): never {
  throw new DataError(`Chế độ khách chưa hỗ trợ ${what}. Hãy đăng nhập để dùng tính năng này.`);
}

// ---------------------------------------------------------------------------
// Chuyến đi
// ---------------------------------------------------------------------------

export async function listTrips(): Promise<TripSummary[]> {
  if (await isGuestMode()) return localStore.listTrips();
  return remoteTrips.listTrips();
}

export async function getTrip(tripId: string): Promise<TripSummary> {
  if (await isGuestMode()) {
    const trip = (await localStore.listTrips()).find((item) => item.id === tripId);
    if (!trip) throw new DataError('Không tìm thấy chuyến đi trong dữ liệu cục bộ.');
    return trip;
  }
  return remoteTrips.getTrip(tripId);
}

export async function createTrip(input: CreateTripInput): Promise<string> {
  if (await isGuestMode()) {
    const name = input.name.trim();
    if (name === '') throw new DataError('Tên chuyến đi không được để trống.');

    const now = new Date().toISOString();
    const trip: StoredTrip = {
      id: localId(),
      name,
      currency: input.currency,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      // Chuỗi rỗng là CỐ Ý: chuyến đi cục bộ không tồn tại trên server nên
      // không ai tham gia bằng mã được. Màn hình ẩn thẻ "Mã mời" khi rỗng.
      joinCode: '',
      place: input.place ?? null,
      cover: input.cover ?? { images: [], index: 0 },
      createdAt: now,
      updatedAt: now,
    };
    await localStore.saveTrip(trip);
    return trip.id;
  }
  return remoteTrips.createTrip(input);
}

export async function updateTripPlace(
  tripId: string,
  place: TripPlace | null,
  cover: TripCoverGallery | null,
): Promise<void> {
  const next = cover ?? { images: [], index: 0 };
  if (await isGuestMode()) {
    const trip = (await localStore.listTrips()).find((item) => item.id === tripId);
    if (!trip) throw new DataError('Không tìm thấy chuyến đi trong dữ liệu cục bộ.');
    await localStore.saveTrip({ ...trip, place, cover: next, updatedAt: new Date().toISOString() });
    return;
  }
  await remoteTrips.updateTripPlace(tripId, place, next);
}

/** Đổi riêng ảnh đang hiển thị khi người dùng lướt carousel. */
export async function updateCoverIndex(tripId: string, index: number): Promise<void> {
  if (await isGuestMode()) {
    const trip = (await localStore.listTrips()).find((item) => item.id === tripId);
    if (!trip) return;
    const clamped = trip.cover.images.length === 0
      ? 0
      : Math.min(Math.max(index, 0), trip.cover.images.length - 1);
    await localStore.saveTrip({ ...trip, cover: { ...trip.cover, index: clamped } });
    return;
  }
  await remoteTrips.updateCoverIndex(tripId, index);
}

export async function listTripGroups(tripId: string): Promise<TripGroup[]> {
  // Chế độ khách chưa có nhóm: mọi thành viên nằm chung một danh sách.
  if (await isGuestMode()) return [];
  return remoteTrips.listTripGroups(tripId);
}

export async function createTripGroup(
  tripId: string,
  name: string,
  memberCount: number,
): Promise<string> {
  if (await isGuestMode()) return guestUnsupported('tạo nhóm');
  return remoteTrips.createTripGroup(tripId, name, memberCount);
}

export async function listTripMembers(tripId: string): Promise<TripMember[]> {
  if (await isGuestMode()) return localStore.listMembers(tripId);
  return remoteTrips.listTripMembers(tripId);
}

export async function addTripMember(
  tripId: string,
  displayName: string,
  groupId: string | null = null,
): Promise<string> {
  if (await isGuestMode()) {
    const name = displayName.trim();
    if (name === '') throw new DataError('Tên thành viên không được để trống.');

    const existing = await localStore.listMembers(tripId);
    const member: StoredMember = {
      id: localId(),
      tripId,
      displayName: name,
      groupId,
      role: 'member',
      sortOrder: existing.length,
      claimed: false,
      // Chế độ khách chỉ có một người dùng thiết bị, nên người đầu tiên được
      // coi là "bạn" để màn khoản chi có mặc định hợp lý cho người ứng tiền.
      isMe: existing.length === 0,
    };
    await localStore.saveMember(member);
    return member.id;
  }
  return remoteTrips.addTripMember(tripId, displayName, groupId);
}

export async function renameTripMember(memberId: string, displayName: string): Promise<void> {
  if (await isGuestMode()) {
    const name = displayName.trim();
    if (name === '') throw new DataError('Tên thành viên không được để trống.');

    const found = (await localStore.listAllMembers()).find((item) => item.id === memberId);
    if (!found) throw new DataError('Không tìm thấy thành viên.');
    await localStore.saveMember({ ...found, displayName: name });
    return;
  }
  await remoteTrips.renameTripMember(memberId, displayName);
}

export async function moveMemberToGroup(memberId: string, groupId: string | null): Promise<void> {
  if (await isGuestMode()) return guestUnsupported('chuyển nhóm');
  await remoteTrips.moveMemberToGroup(memberId, groupId);
}

// KHÔNG có removeTripMember. Thành viên chỉ được thêm và đổi tên: xoá một người
// vẫn gắn với khoản chi cũ làm tổng số dư của cả chuyến lệch khỏi 0. DB cũng
// chặn việc này bằng trigger guard_trip_member_changes (migration 09).

export async function previewTripByCode(joinCode: string): Promise<TripPreview> {
  if (await isGuestMode()) return guestUnsupported('tham gia bằng mã mời');
  return remoteTrips.previewTripByCode(joinCode);
}

export async function joinTripByCode(joinCode: string, memberId: string): Promise<string> {
  if (await isGuestMode()) return guestUnsupported('tham gia bằng mã mời');
  return remoteTrips.joinTripByCode(joinCode, memberId);
}

// ---------------------------------------------------------------------------
// Khoản chi
// ---------------------------------------------------------------------------

function toSummary(expense: StoredExpense): ExpenseSummary {
  return {
    id: expense.id,
    description: expense.description,
    total: expense.total,
    paidByMemberId: expense.paidByMemberId,
    splitMode: expense.splitMode,
    paidAt: expense.paidAt,
    createdBy: expense.createdBy,
  };
}

export async function listExpenses(
  tripId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ExpenseSummary[]> {
  if (await isGuestMode()) {
    const all = await localStore.listExpenses(tripId);
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    return all.slice(offset, offset + limit).map(toSummary);
  }
  return remoteExpenses.listExpenses(tripId, options);
}

const EXPENSE_PAGE_SIZE = 500;

/**
 * MỌI khoản chi của chuyến, tải theo trang tới khi hết.
 *
 * Màn chuyến đi cộng "tổng chi" từ danh sách này. Dùng listExpenses mặc định
 * (50 khoản) thì chuyến dài bị hụt tổng chi, và các khoản cũ không mở ra sửa
 * được — trong khi số dư (tính ở DB) vẫn đếm đủ, hai con số mâu thuẫn nhau.
 */
export async function listAllExpenses(tripId: string): Promise<ExpenseSummary[]> {
  const all: ExpenseSummary[] = [];
  for (;;) {
    const page = await listExpenses(tripId, { limit: EXPENSE_PAGE_SIZE, offset: all.length });
    all.push(...page);
    if (page.length < EXPENSE_PAGE_SIZE) return all;
  }
}

export async function getExpenseDetail(expenseId: string): Promise<ExpenseDetail> {
  if (await isGuestMode()) {
    const found = (await localStore.listAllExpenses()).find((item) => item.id === expenseId);
    if (!found) throw new DataError('Không tìm thấy khoản chi.');
    return { ...toSummary(found), shares: found.shares };
  }
  return remoteExpenses.getExpenseDetail(expenseId);
}

/**
 * Chế độ khách không có DB để kiểm lại, nên đây là chốt DUY NHẤT. Một khoản chi
 * lệch tổng lọt vào AsyncStorage thì computeBalances ném lỗi và màn chuyến đi
 * chết hẳn trên máy đó — không còn đường vào để sửa.
 */
async function assertGuestExpense(input: SaveExpenseInput): Promise<void> {
  remoteExpenses.assertSharesBalance(input);
  const memberIds = new Set((await localStore.listMembers(input.tripId)).map((member) => member.id));
  if (!memberIds.has(input.paidByMemberId)) {
    throw new DataError('Người đại diện trả tiền không thuộc chuyến đi này.');
  }
  if (input.shares.some((share) => !memberIds.has(share.participantId))) {
    throw new DataError('Danh sách có người không thuộc chuyến đi.');
  }
}

export async function createExpense(input: SaveExpenseInput): Promise<string> {
  if (await isGuestMode()) {
    await assertGuestExpense(input);
    const expense: StoredExpense = {
      id: localId(),
      tripId: input.tripId,
      description: input.description.trim(),
      total: input.total,
      paidByMemberId: input.paidByMemberId,
      splitMode: input.splitMode,
      paidAt: (input.paidAt ?? new Date()).toISOString(),
      createdBy: 'guest',
      shares: input.shares,
    };
    await localStore.saveExpense(expense);
    return expense.id;
  }
  return remoteExpenses.createExpense(input);
}

export async function updateExpense(expenseId: string, input: SaveExpenseInput): Promise<void> {
  if (await isGuestMode()) {
    const found = (await localStore.listAllExpenses()).find((item) => item.id === expenseId);
    if (!found) throw new DataError('Không tìm thấy khoản chi.');
    await assertGuestExpense({ ...input, tripId: found.tripId });
    await localStore.saveExpense({
      ...found,
      description: input.description.trim(),
      total: input.total,
      paidByMemberId: input.paidByMemberId,
      splitMode: input.splitMode,
      paidAt: (input.paidAt ?? new Date()).toISOString(),
      shares: input.shares,
    });
    return;
  }
  await remoteExpenses.updateExpense(expenseId, input);
}

export async function voidExpense(expenseId: string): Promise<void> {
  if (await isGuestMode()) {
    await localStore.deleteExpense(expenseId);
    return;
  }
  await remoteExpenses.voidExpense(expenseId);
}

export async function getTripBalances(tripId: string): Promise<NamedBalance[]> {
  if (await isGuestMode()) {
    const [expenses, members, trips] = await Promise.all([
      localStore.listExpenses(tripId),
      localStore.listMembers(tripId),
      localStore.listTrips(),
    ]);

    const currency: CurrencyCode = trips.find((trip) => trip.id === tripId)?.currency ?? 'VND';

    // Dùng lại computeBalances của lõi tiền tệ thay vì tự cộng trừ ở đây: nó đã
    // ép sẵn bất biến "tổng tiền ứng = tổng phần chia" cho từng khoản chi, nên
    // dữ liệu cục bộ hỏng sẽ bị bắt chứ không âm thầm cho ra số dư sai.
    const balances = computeBalances(
      expenses.map((expense) => ({
        id: expense.id,
        payments: [{ participantId: expense.paidByMemberId, amount: expense.total }],
        shares: expense.shares,
      })),
      currency,
      members.map((member) => member.id),
    );

    return balances.map((balance) => {
      const member = members.find((item) => item.id === balance.participantId);
      return {
        ...balance,
        displayName: member?.displayName ?? 'Không rõ',
        groupId: member?.groupId ?? null,
      };
    });
  }
  return remoteExpenses.getTripBalances(tripId);
}

export async function recordSettlement(input: RecordSettlementInput): Promise<void> {
  if (await isGuestMode()) return guestUnsupported('ghi nhận tất toán');
  await remoteExpenses.recordSettlement(input);
}
