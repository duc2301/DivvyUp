import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Money, SplitLine } from '@/lib/money';
import type { SplitModeDb } from '@/lib/supabase/database.types';
import type { TripCoverImage, TripMember, TripSummary } from '@/lib/data/trips';

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
    const random = (Math.random() * 16) | 0;
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
  };

  async get<T>(key: string): Promise<T[]> {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      // Dữ liệu hỏng thì coi như rỗng, đừng để một chuỗi JSON lỗi làm chết app.
      return [];
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
    return all
      .filter((member) => member.tripId === tripId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
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
}

export const localStore = new LocalStore();
