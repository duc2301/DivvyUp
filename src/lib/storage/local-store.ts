import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Money, SplitLine } from '@/lib/money';
import type { SplitModeDb } from '@/lib/supabase/database.types';
import type { TripMember, TripSummary } from '@/lib/data/trips';

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
    return this.get<StoredTrip>(this.keys.trips);
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

  async deleteMember(id: string): Promise<void> {
    const members = await this.listAllMembers();
    await this.set(
      this.keys.members,
      members.filter((item) => item.id !== id),
    );
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
