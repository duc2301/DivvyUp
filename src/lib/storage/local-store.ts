import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Money, SplitLine } from '@/lib/money';
import type { SplitModeDb } from '@/lib/supabase/database.types';
import type { ExpenseEvent } from '@/lib/data/expenses';
import type { NoteTemplateKey, TripNote } from '@/lib/data/notes';
import { NOTE_TEMPLATE_KEYS } from '@/lib/data/notes';
import type { TripCoverImage, TripGroup, TripMember, TripSummary } from '@/lib/data/trips';

/**
 * Kho lưu trữ cục bộ cho chế độ khách.
 *
 * Mọi bản ghi ở đây phải có CÙNG hình dạng với bản ghi lấy từ Supabase. Nếu hai
 * bên lệch nhau, màn hình sẽ chạy đúng ở chế độ này và hỏng ở chế độ kia — loại
 * lỗi rất khó truy, vì cùng một đoạn code mà hành vi khác nhau.
 *
 * Money và SplitLine đều là object phẳng nên JSON.stringify giữ nguyên được.
 */

export interface StoredTrip extends TripSummary {
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredMember extends TripMember {
  readonly tripId: string;
}

export interface StoredExpense {
  readonly id: string;
  readonly tripId: string;
  readonly description: string;
  readonly total: Money;
  readonly paidByMemberId: string;
  readonly splitMode: SplitModeDb;
  /** ISO 8601, giống cột paid_at trên server. */
  readonly paidAt: string;
  readonly createdBy: string;
  readonly shares: readonly SplitLine[];
  /** Bản app cũ không có trường này — đọc thiếu thì coi như chưa xong. */
  readonly settledAt?: string | null;
}

export interface StoredGroup extends TripGroup {
  readonly tripId: string;
}

/** Ghi chú khách. Xoá khách là xoá cứng — không có ai khác cần xem lịch sử. */
export type StoredNote = TripNote;

/**
 * Nhật ký khoản chi của khách. Giữ tripId để lọc theo chuyến; ảnh chụp giữ
 * nguyên sau khi khoản chi bị xoá (khách xoá cứng khoản chi).
 */
export interface StoredExpenseEvent extends ExpenseEvent {
  readonly tripId: string;
}

/** Bỏ bản ghi hỏng thay vì làm chết màn hình; bù trường bản cũ chưa có. */
function normalizeNote(note: Partial<StoredNote>): StoredNote | null {
  if (typeof note.id !== 'string' || typeof note.tripId !== 'string') return null;
  const epoch = new Date(0).toISOString();
  // Mẫu lạ (bản app khác, dữ liệu hỏng) → không mẫu, thay vì làm hỏng màn hình.
  const rawTemplate: unknown = note.template;
  const template = (NOTE_TEMPLATE_KEYS as readonly unknown[]).includes(rawTemplate)
    ? (rawTemplate as NoteTemplateKey)
    : null;
  return {
    id: note.id,
    tripId: note.tripId,
    title: typeof note.title === 'string' ? note.title : '',
    body: typeof note.body === 'string' ? note.body : '',
    template,
    sortOrder: typeof note.sortOrder === 'number' ? note.sortOrder : 0,
    createdAt: note.createdAt ?? epoch,
    updatedAt: note.updatedAt ?? note.createdAt ?? epoch,
    updatedByMemberId: note.updatedByMemberId ?? null,
  };
}

function isStoredEvent(event: Partial<StoredExpenseEvent>): event is StoredExpenseEvent {
  return (
    typeof event.id === 'string' &&
    typeof event.tripId === 'string' &&
    typeof event.expenseId === 'string' &&
    typeof event.action === 'string' &&
    typeof event.at === 'string'
  );
}

/**
 * Sinh id cục bộ.
 *
 * KHÔNG dùng thẳng crypto.randomUUID(): Hermes trên React Native không có
 * global `crypto`, nên gọi thẳng sẽ chạy ngon trên web rồi crash trên máy thật.
 * Ưu tiên bản có sẵn, còn không thì tự ghép. Id này chỉ dùng cục bộ, không cần
 * độ mạnh mật mã.
 */
export function localId(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof globalCrypto?.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    // Math.random chỉ là đường dự phòng khi thiếu crypto.randomUUID: id cục bộ
    // cho dữ liệu khách, không phải token hay bí mật (đã xét: Sonar S2245 an toàn).
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * Đọc một chuyến đi đã lưu, bù các trường mà bản app CŨ chưa có.
 *
 * Dữ liệu khách nằm trên máy người dùng và sống qua nhiều lần cập nhật app.
 * Chuyến tạo trước khi có tính năng ảnh bìa không có trường `cover` — đọc thẳng
 * thì `cover.images` văng lỗi và app trắng màn ngay khi mở. Không có migration
 * nào chạy được trên máy người dùng, nên phải bù ở chỗ đọc.
 */
function normalizeTrip(trip: Partial<StoredTrip>): StoredTrip | null {
  if (typeof trip.id !== 'string' || typeof trip.name !== 'string') return null;

  // Bản cũ hơn nữa lưu MỘT ảnh ở `coverImage` — giữ lại thành bộ ảnh một tấm.
  const legacyCover = (trip as { coverImage?: TripCoverImage | null }).coverImage;
  const images = Array.isArray(trip.cover?.images)
    ? trip.cover.images
    : legacyCover && typeof legacyCover.url === 'string'
      ? [legacyCover]
      : [];
  const rawIndex = trip.cover?.index;
  const index =
    typeof rawIndex === 'number' && Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < images.length
      ? rawIndex
      : 0;
  const now = new Date(0).toISOString();

  return {
    id: trip.id,
    name: trip.name,
    currency: trip.currency ?? 'VND',
    startDate: trip.startDate ?? null,
    endDate: trip.endDate ?? null,
    joinCode: trip.joinCode ?? '',
    place: trip.place ?? null,
    cover: { images, index },
    createdAt: trip.createdAt ?? now,
    updatedAt: trip.updatedAt ?? now,
  };
}

export class LocalStore {
  private readonly keys = {
    trips: 'divvyup_local_trips',
    members: 'divvyup_local_members',
    expenses: 'divvyup_local_expenses',
    groups: 'divvyup_local_groups',
    notes: 'divvyup_local_notes',
    expenseEvents: 'divvyup_local_expense_events',
  };

  async get<T>(key: string): Promise<T[]> {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Dữ liệu hỏng thì coi như rỗng, đừng để một chuỗi JSON lỗi làm chết app.
      // Nhưng SAO LƯU chuỗi gốc trước: lần ghi kế tiếp sẽ đè khoá này bằng mảng
      // mới, và dữ liệu cũ (có thể cứu tay được) biến mất không dấu vết.
      await this.backupCorrupt(key, raw);
      return [];
    }
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  }

  /**
   * Chép chuỗi hỏng sang `${key}__corrupt_<ms>`, xong mới gỡ khoá gốc — để mỗi
   * lần đọc sau không sinh thêm một bản sao lưu nữa. Sao lưu thất bại thì GIỮ
   * khoá gốc (thà lần sau thử lại còn hơn mất dữ liệu).
   * Lỗi ở đây không được chặn việc mở app (máy đầy bộ nhớ chẳng hạn) — nuốt có
   * chủ đích: sao lưu là lưới an toàn phụ, không phải đường chính.
   */
  private async backupCorrupt(key: string, raw: string): Promise<void> {
    try {
      await AsyncStorage.setItem(`${key}__corrupt_${Date.now()}`, raw);
    } catch {
      return;
    }
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Còn khoá gốc chỉ nghĩa là lần đọc sau sao lưu thêm một bản — vô hại.
    }
  }

  async set<T>(key: string, data: readonly T[]): Promise<void> {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  }

  // --- Trips ---
  async listTrips(): Promise<StoredTrip[]> {
    const raw = await this.get<Partial<StoredTrip>>(this.keys.trips);
    return raw.flatMap((trip) => {
      const normalized = normalizeTrip(trip);
      return normalized ? [normalized] : [];
    });
  }

  async saveTrip(trip: StoredTrip): Promise<void> {
    const trips = await this.listTrips();
    const index = trips.findIndex((item) => item.id === trip.id);
    if (index > -1) trips[index] = trip;
    else trips.push(trip);
    await this.set(this.keys.trips, trips);
  }

  async deleteTrip(id: string): Promise<void> {
    const trips = await this.listTrips();
    await this.set(
      this.keys.trips,
      trips.filter((item) => item.id !== id),
    );
  }

  // --- Members ---
  async listAllMembers(): Promise<StoredMember[]> {
    return this.get<StoredMember>(this.keys.members);
  }

  async listMembers(tripId: string): Promise<StoredMember[]> {
    const all = await this.listAllMembers();
    return (
      all
        .filter((member) => member.tripId === tripId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        // Khách không có tài khoản: không ai "nhận chỗ", không có ảnh đại diện.
        // Bù hai trường mà dữ liệu lưu từ bản app cũ chưa có.
        .map((member) => ({ ...member, groupId: member.groupId ?? null, userId: null, avatarUrl: null }))
    );
  }

  // --- Groups ---
  async listGroups(tripId: string): Promise<StoredGroup[]> {
    const all = await this.get<StoredGroup>(this.keys.groups);
    return all.filter((group) => group.tripId === tripId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async saveGroup(group: StoredGroup): Promise<void> {
    const groups = await this.get<StoredGroup>(this.keys.groups);
    const index = groups.findIndex((item) => item.id === group.id);
    if (index > -1) groups[index] = group;
    else groups.push(group);
    await this.set(this.keys.groups, groups);
  }

  async saveMember(member: StoredMember): Promise<void> {
    const members = await this.listAllMembers();
    const index = members.findIndex((item) => item.id === member.id);
    if (index > -1) members[index] = member;
    else members.push(member);
    await this.set(this.keys.members, members);
  }

  // --- Expenses ---
  async listAllExpenses(): Promise<StoredExpense[]> {
    return this.get<StoredExpense>(this.keys.expenses);
  }

  async listExpenses(tripId: string): Promise<StoredExpense[]> {
    const all = await this.listAllExpenses();
    return all
      .filter((expense) => expense.tripId === tripId)
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  }

  async saveExpense(expense: StoredExpense): Promise<void> {
    const expenses = await this.listAllExpenses();
    const index = expenses.findIndex((item) => item.id === expense.id);
    if (index > -1) expenses[index] = expense;
    else expenses.push(expense);
    await this.set(this.keys.expenses, expenses);
  }

  async deleteExpense(id: string): Promise<void> {
    const expenses = await this.listAllExpenses();
    await this.set(
      this.keys.expenses,
      expenses.filter((item) => item.id !== id),
    );
  }

  // --- Notes ---
  async listAllNotes(): Promise<StoredNote[]> {
    const raw = await this.get<Partial<StoredNote>>(this.keys.notes);
    return raw.flatMap((note) => {
      const normalized = normalizeNote(note);
      return normalized ? [normalized] : [];
    });
  }

  async listNotes(tripId: string): Promise<StoredNote[]> {
    const all = await this.listAllNotes();
    return all
      .filter((note) => note.tripId === tripId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  }

  async saveNote(note: StoredNote): Promise<void> {
    const notes = await this.listAllNotes();
    const index = notes.findIndex((item) => item.id === note.id);
    if (index > -1) notes[index] = note;
    else notes.push(note);
    await this.set(this.keys.notes, notes);
  }

  async deleteNote(id: string): Promise<void> {
    const notes = await this.listAllNotes();
    await this.set(
      this.keys.notes,
      notes.filter((item) => item.id !== id),
    );
  }

  // --- Expense events ---
  async listExpenseEvents(expenseId: string): Promise<StoredExpenseEvent[]> {
    const raw = await this.get<Partial<StoredExpenseEvent>>(this.keys.expenseEvents);
    return raw
      .filter(isStoredEvent)
      .filter((event) => event.expenseId === expenseId)
      .map((event) => ({
        ...event,
        actorMemberId: event.actorMemberId ?? null,
        before: event.before ?? null,
        after: event.after ?? null,
      }))
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  async appendExpenseEvent(event: StoredExpenseEvent): Promise<void> {
    const events = (await this.get<Partial<StoredExpenseEvent>>(this.keys.expenseEvents)).filter(
      isStoredEvent,
    );
    events.push(event);
    await this.set(this.keys.expenseEvents, events);
  }
}

export const localStore = new LocalStore();
