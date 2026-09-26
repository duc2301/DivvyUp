/**
 * Bộ định tuyến dữ liệu: chế độ khách dùng kho cục bộ, đã đăng nhập dùng Supabase.
 *
 * MỌI màn hình phải gọi qua module này, không gọi thẳng ./trips hay ./expenses.
 * Đó cũng là lý do mọi hàm ở đây khai kiểu trả về TƯỜNG MINH và dùng đúng kiểu
 * của tầng remote: nếu để TypeScript tự suy, chỉ cần nhánh khách trả về hình
 * dạng lệch một chút là cả app mất kiểu mà không ai nhận ra.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CurrencyCode, LedgerExpense } from '@/lib/money';
import { computeBalances } from '@/lib/money';
import type { StoredExpense, StoredMember, StoredNote, StoredTrip } from '@/lib/storage/local-store';
import { localId, localStore } from '@/lib/storage/local-store';
import { DataError } from '@/lib/supabase/errors';

import type {
  ExpenseDetail,
  ExpenseEvent,
  ExpenseEventAction,
  ExpenseSnapshot,
  ExpenseSummary,
  NamedBalance,
  RecordSettlementInput,
  SaveExpenseInput,
  TripLedger,
} from './expenses';
import * as remoteExpenses from './expenses';
import type { NoteTemplateKey, TripNote } from './notes';
import * as remoteNotes from './notes';
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

export type { ExpenseEvent, ExpenseEventAction, ExpenseSnapshot, TripLedger } from './expenses';
export type { NoteTemplateKey, TripNote } from './notes';
export { NOTE_TEMPLATE_KEYS } from './notes';
export { placeKeyOf } from './trips';

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

async function findLocalTrip(tripId: string): Promise<StoredTrip> {
  const trip = (await localStore.listTrips()).find((item) => item.id === tripId);
  if (!trip) throw new DataError('Không tìm thấy chuyến đi trong dữ liệu cục bộ.');
  return trip;
}

/** Đổi tên và ngày ('YYYY-MM-DD') của chuyến đi. Mọi thành viên sửa được. */
export async function updateTripDetails(
  tripId: string,
  input: { name: string; startDate: string | null; endDate: string | null },
): Promise<void> {
  if (await isGuestMode()) {
    const valid = remoteTrips.validateTripDetails(input);
    const trip = await findLocalTrip(tripId);
    await localStore.saveTrip({
      ...trip,
      name: valid.name,
      startDate: valid.startDate,
      endDate: valid.endDate,
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  await remoteTrips.updateTripDetails(tripId, input);
}

export async function updateTripPlace(
  tripId: string,
  place: TripPlace | null,
  cover: TripCoverGallery | null,
): Promise<void> {
  const next = cover ?? { images: [], index: 0 };
  if (await isGuestMode()) {
    const trip = await findLocalTrip(tripId);
    // Cùng luật với trigger trips_validate_cover: chỉ kiểm khi bộ ảnh đổi, để
    // ảnh lưu từ bản app cũ không chặn việc sửa điểm đến.
    if (JSON.stringify(next.images) !== JSON.stringify(trip.cover.images)) {
      remoteTrips.assertCoverImages(next.images);
    }
    await localStore.saveTrip({ ...trip, place, cover: next, updatedAt: new Date().toISOString() });
    return;
  }
  await remoteTrips.updateTripPlace(tripId, place, next);
}

/**
 * Lưu bộ ảnh bìa tải nền — chỉ khi điểm đến vẫn là `expectedPlaceKey`
 * (placeKeyOf) và chuyến chưa có ảnh. false = điều kiện đã đổi (không phải
 * lỗi): người gọi bỏ bộ ảnh vừa tải, không ghi đè lựa chọn mới.
 */
export async function saveCoverIfPlaceUnchanged(
  tripId: string,
  expectedPlaceKey: string,
  cover: TripCoverGallery,
): Promise<boolean> {
  if (await isGuestMode()) {
    const trip = await findLocalTrip(tripId);
    // Cùng điều kiện với RPC set_trip_cover_if_empty.
    if (
      trip.place === null ||
      remoteTrips.placeKeyOf(trip.place) !== expectedPlaceKey ||
      trip.cover.images.length > 0
    ) {
      return false;
    }
    remoteTrips.assertCoverImages(cover.images);
    await localStore.saveTrip({
      ...trip,
      cover: { images: cover.images, index: 0 },
      updatedAt: new Date().toISOString(),
    });
    return true;
  }
  return remoteTrips.saveCoverIfPlaceUnchanged(tripId, expectedPlaceKey, cover);
}

/**
 * Đổi riêng ảnh đang hiển thị khi người dùng lướt carousel. Ném lỗi thật
 * (không nuốt) — người gọi tự quyết có bỏ qua hay không.
 */
export async function updateCoverIndex(tripId: string, index: number): Promise<void> {
  if (await isGuestMode()) {
    const trip = await findLocalTrip(tripId);
    // Cùng kiểm tra với RPC set_trip_cover_index.
    if (!Number.isInteger(index) || index < 0 || index >= Math.max(trip.cover.images.length, 1)) {
      throw new DataError('Vị trí ảnh bìa nằm ngoài bộ ảnh.');
    }
    await localStore.saveTrip({ ...trip, cover: { ...trip.cover, index } });
    return;
  }
  await remoteTrips.updateCoverIndex(tripId, index);
}

export async function listTripGroups(tripId: string): Promise<TripGroup[]> {
  if (await isGuestMode()) {
    return (await localStore.listGroups(tripId)).map(({ id, name, sortOrder }) => ({ id, name, sortOrder }));
  }
  return remoteTrips.listTripGroups(tripId);
}

export async function createTripGroup(
  tripId: string,
  name: string,
  memberCount: number,
): Promise<string> {
  if (await isGuestMode()) {
    // Cùng hành vi với RPC create_trip_group: tạo nhóm kèm N chỗ tên tạm.
    const groupName = name.trim();
    if (groupName === '') throw new DataError('Tên nhóm không được để trống.');
    if (!Number.isInteger(memberCount) || memberCount < 0 || memberCount > 100) {
      throw new DataError('Số người trong nhóm phải từ 0 tới 100.');
    }
    const groups = await localStore.listGroups(tripId);
    const groupId = localId();
    await localStore.saveGroup({ id: groupId, tripId, name: groupName, sortOrder: groups.length });

    const existing = await localStore.listMembers(tripId);
    for (let index = 0; index < memberCount; index += 1) {
      await localStore.saveMember({
        id: localId(),
        tripId,
        displayName: `Thành viên ${index + 1}`,
        groupId,
        role: 'member',
        sortOrder: existing.length + index,
        claimed: false,
        isMe: existing.length === 0 && index === 0,
        userId: null,
        avatarUrl: null,
      });
    }
    return groupId;
  }
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
      userId: null,
      avatarUrl: null,
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
  if (await isGuestMode()) {
    const found = (await localStore.listAllMembers()).find((item) => item.id === memberId);
    if (!found) throw new DataError('Không tìm thấy thành viên.');
    await localStore.saveMember({ ...found, groupId });
    return;
  }
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
// Ghi chú chuyến đi
// ---------------------------------------------------------------------------

/** Khách chỉ có một người dùng thiết bị — "bạn" là chỗ isMe của chuyến. */
async function guestActorMemberId(tripId: string): Promise<string | null> {
  return (await localStore.listMembers(tripId)).find((member) => member.isMe)?.id ?? null;
}

async function findLocalNote(noteId: string): Promise<StoredNote> {
  const found = (await localStore.listAllNotes()).find((note) => note.id === noteId);
  if (!found) throw new DataError('Không tìm thấy ghi chú, hoặc bạn không có quyền sửa.', '42501');
  return found;
}

export async function listTripNotes(tripId: string): Promise<TripNote[]> {
  if (await isGuestMode()) return localStore.listNotes(tripId);
  return remoteNotes.listTripNotes(tripId);
}

export async function createTripNote(
  tripId: string,
  input: { title: string; body: string; template: NoteTemplateKey | null },
): Promise<string> {
  if (await isGuestMode()) {
    const valid = remoteNotes.validateNoteInput(input);
    const template = remoteNotes.assertNoteTemplate(input.template);
    await findLocalTrip(tripId);
    const existing = await localStore.listNotes(tripId);
    const now = new Date().toISOString();
    const note: StoredNote = {
      id: localId(),
      tripId,
      title: valid.title,
      body: valid.body,
      template,
      // Cùng quy tắc với trigger set_trip_note_actor: nối vào cuối.
      sortOrder: existing.reduce((max, item) => Math.max(max, item.sortOrder + 1), 0),
      createdAt: now,
      updatedAt: now,
      updatedByMemberId: await guestActorMemberId(tripId),
    };
    await localStore.saveNote(note);
    return note.id;
  }
  return remoteNotes.createTripNote(tripId, input);
}

/**
 * Sửa ghi chú với khoá lạc quan: `expectedUpdatedAt` là TripNote.updatedAt lúc
 * mở ghi chú. Đã có người sửa sau đó → DataError NOTE_STALE_MESSAGE.
 */
export async function updateTripNote(
  noteId: string,
  input: { title: string; body: string },
  expectedUpdatedAt: string,
): Promise<void> {
  if (await isGuestMode()) {
    const valid = remoteNotes.validateNoteInput(input);
    const found = await findLocalNote(noteId);
    // Cùng khoá lạc quan với nhánh đăng nhập (khách có thể mở hai màn cùng lúc).
    if (found.updatedAt !== expectedUpdatedAt) {
      throw new DataError(remoteNotes.NOTE_STALE_MESSAGE, '40001');
    }
    await localStore.saveNote({
      ...found,
      title: valid.title,
      body: valid.body,
      updatedAt: new Date().toISOString(),
      updatedByMemberId: await guestActorMemberId(found.tripId),
    });
    return;
  }
  await remoteNotes.updateTripNote(noteId, input, expectedUpdatedAt);
}

export async function deleteTripNote(noteId: string): Promise<void> {
  if (await isGuestMode()) {
    await findLocalNote(noteId);
    await localStore.deleteNote(noteId);
    return;
  }
  await remoteNotes.deleteTripNote(noteId);
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
    settledAt: expense.settledAt ?? null,
  };
}

/**
 * Ghi nhật ký cho nhánh khách — cùng chỗ ghi với RPC trên server (tạo, sửa,
 * huỷ, đánh dấu/bỏ đánh dấu xong), cùng hình dạng before/after.
 */
async function logGuestEvent(
  tripId: string,
  expenseId: string,
  action: ExpenseEventAction,
  before: ExpenseSnapshot | null,
  after: ExpenseSnapshot | null,
): Promise<void> {
  await localStore.appendExpenseEvent({
    id: localId(),
    tripId,
    expenseId,
    action,
    actorMemberId: await guestActorMemberId(tripId),
    at: new Date().toISOString(),
    before,
    after,
  });
}

/**
 * Khách không có transaction: khoản chi đã ghi xong mà nhật ký lỗi thì KHÔNG
 * được ném lỗi chung chung — UI sẽ hiểu là "chưa lưu" và người dùng nhập lại,
 * sinh khoản trùng. Báo rõ phần nào đã xong.
 */
async function logGuestEventAfterSave(
  what: string,
  ...args: Parameters<typeof logGuestEvent>
): Promise<void> {
  try {
    await logGuestEvent(...args);
  } catch (error) {
    const detail = error instanceof Error ? ` (${error.message})` : '';
    throw new DataError(`Đã lưu ${what} nhưng chưa ghi được lịch sử${detail}.`);
  }
}

export async function setExpenseSettled(expenseId: string, settled: boolean): Promise<void> {
  if (await isGuestMode()) {
    const found = (await localStore.listAllExpenses()).find((item) => item.id === expenseId);
    if (!found) throw new DataError('Không tìm thấy khoản chi.');
    const next: StoredExpense = {
      ...found,
      settledAt: settled ? (found.settledAt ?? new Date().toISOString()) : null,
    };
    await localStore.saveExpense(next);
    // Bấm lại trạng thái đang có thì không ghi — cùng quy tắc với RPC.
    if ((found.settledAt ?? null) !== (next.settledAt ?? null)) {
      await logGuestEventAfterSave(
        'trạng thái khoản chi',
        found.tripId,
        found.id,
        settled ? 'settle' : 'unsettle',
        remoteExpenses.snapshotOf(found),
        remoteExpenses.snapshotOf(next),
      );
    }
    return;
  }
  await remoteExpenses.setExpenseSettled(expenseId, settled);
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
    await logGuestEventAfterSave(
      'khoản chi',
      expense.tripId,
      expense.id,
      'create',
      null,
      remoteExpenses.snapshotOf(expense),
    );
    return expense.id;
  }
  return remoteExpenses.createExpense(input);
}

export async function updateExpense(expenseId: string, input: SaveExpenseInput): Promise<void> {
  if (await isGuestMode()) {
    const found = (await localStore.listAllExpenses()).find((item) => item.id === expenseId);
    if (!found) throw new DataError('Không tìm thấy khoản chi.');
    await assertGuestExpense({ ...input, tripId: found.tripId });
    const next: StoredExpense = {
      ...found,
      description: input.description.trim(),
      total: input.total,
      paidByMemberId: input.paidByMemberId,
      splitMode: input.splitMode,
      paidAt: (input.paidAt ?? new Date()).toISOString(),
      shares: input.shares,
      // Cùng quy tắc với update_expense trên server: sửa là bỏ đánh dấu xong,
      // để số tiền mới được tính lại vào số dư.
      settledAt: null,
    };
    await localStore.saveExpense(next);
    await logGuestEventAfterSave(
      'khoản chi',
      found.tripId,
      found.id,
      'update',
      remoteExpenses.snapshotOf(found),
      remoteExpenses.snapshotOf(next),
    );
    return;
  }
  await remoteExpenses.updateExpense(expenseId, input);
}

export async function voidExpense(expenseId: string): Promise<void> {
  if (await isGuestMode()) {
    const found = (await localStore.listAllExpenses()).find((item) => item.id === expenseId);
    if (!found) throw new DataError('Không tìm thấy khoản chi.');
    // Khách xoá cứng khoản chi; ảnh chụp "trước" trong nhật ký là bản duy nhất
    // còn lại — nên ghi nhật ký TRƯỚC. Ghi lỗi thì chưa xoá gì (người dùng thử
    // lại được); xoá lỗi sau khi đã ghi thì chỉ thừa một dòng "huỷ" cho khoản
    // vẫn còn, không mất dữ liệu.
    await logGuestEvent(found.tripId, found.id, 'void', remoteExpenses.snapshotOf(found), null);
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
      // Khoản "đã xong" không tính vào số dư — cùng quy tắc với view trip_balances.
      expenses.filter((expense) => !expense.settledAt).map((expense) => ({
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

// ---------------------------------------------------------------------------
// Nhật ký khoản chi + sổ cái
// ---------------------------------------------------------------------------

/** Lịch sử của một khoản chi, mới nhất trước. */
export async function listExpenseEvents(expenseId: string): Promise<ExpenseEvent[]> {
  if (await isGuestMode()) {
    // Bỏ tripId (chỉ dùng để lưu) cho đúng hình dạng của nhánh đăng nhập.
    return (await localStore.listExpenseEvents(expenseId)).map(
      ({ tripId: _tripId, ...event }): ExpenseEvent => event,
    );
  }
  return remoteExpenses.listExpenseEvents(expenseId);
}

/**
 * Dữ liệu gốc cho bảng kê / nợ từng cặp (src/lib/money/ledger.ts). Khách không
 * có tất toán nên settlements luôn rỗng.
 */
export async function listTripLedger(tripId: string): Promise<TripLedger> {
  if (await isGuestMode()) {
    const expenses = await localStore.listExpenses(tripId);
    return {
      expenses: expenses
        .slice()
        .sort((a, b) => a.paidAt.localeCompare(b.paidAt))
        .map(
          (expense): LedgerExpense => ({
            id: expense.id,
            description: expense.description,
            paidAt: expense.paidAt,
            payerId: expense.paidByMemberId,
            total: expense.total,
            shares: expense.shares,
            excluded: Boolean(expense.settledAt),
          }),
        ),
      settlements: [],
    };
  }
  return remoteExpenses.listTripLedger(tripId);
}
