/**
 * Lưu trữ chuyến đi — phần thuần: chia danh sách chính / lưu trữ và chọn chuyến
 * cần nhắc. Không import React Native hay Supabase, để bản web dùng lại và để
 * test bằng node --test.
 *
 * Lưu trữ là tuỳ chọn CỦA TỪNG NGƯỜI (bảng trip_archives): chỉ đổi chỗ chuyến
 * đi hiện trong danh sách của người đó, không đổi dữ liệu chuyến.
 */

interface DatedTrip {
  readonly id: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
}

/** id chuyến → thời điểm người dùng lưu trữ (ISO 8601). */
export type ArchivedTrips = ReadonlyMap<string, string>;

/**
 * Chuyến đã kết thúc: ngày về (hoặc ngày đi, khi chưa đặt ngày về) trước hôm
 * nay. Chuyến chưa đặt ngày nào thì không bao giờ tính là đã kết thúc.
 * Hai ngày đều là chuỗi yyyy-MM-dd nên so chuỗi là so ngày.
 */
export function isTripEnded(trip: DatedTrip, today: string): boolean {
  const lastDay = trip.endDate ?? trip.startDate;
  return lastDay !== null && lastDay < today;
}

export interface TripShelves<T> {
  /** Giữ nguyên thứ tự đầu vào. */
  readonly active: T[];
  /** Mới lưu trữ lên trước. */
  readonly archived: T[];
}

export function splitByArchive<T extends DatedTrip>(
  trips: readonly T[],
  archived: ArchivedTrips,
): TripShelves<T> {
  const active: T[] = [];
  const shelved: T[] = [];
  for (const trip of trips) {
    if (archived.has(trip.id)) shelved.push(trip);
    else active.push(trip);
  }
  shelved.sort((a, b) => {
    const at = archived.get(a.id) ?? '';
    const bt = archived.get(b.id) ?? '';
    if (at === bt) return 0;
    return at < bt ? 1 : -1;
  });
  return { active, archived: shelved };
}

/**
 * Chuyến trong danh sách chính đã kết thúc — gợi ý lưu trữ trong màn chọn.
 * Đầu vào là phần `active` của splitByArchive.
 */
export function endedTrips<T extends DatedTrip>(active: readonly T[], today: string): T[] {
  return active.filter((trip) => isTripEnded(trip, today));
}

/**
 * Có hiện banner nhắc không: còn chuyến đã kết thúc mà người dùng CHƯA bấm
 * "Để sau" cho nó. Bấm "Để sau" ghi lại id các chuyến lúc đó; banner chỉ quay
 * lại khi có thêm chuyến vừa kết thúc.
 */
export function shouldRemindArchive(
  ended: readonly DatedTrip[],
  dismissed: ReadonlySet<string>,
): boolean {
  return ended.some((trip) => !dismissed.has(trip.id));
}

export interface ArchiveCardCopy {
  readonly title: string;
  readonly hint: string;
  readonly action: string;
}

/**
 * Chữ trên thẻ lưu trữ ở trang chuyến đi — một nguồn cho mobile và web.
 * null = không hiện thẻ (chưa lưu trữ và chưa kết thúc: không có gì để nói).
 * `openTransfers`: số lần chuyển tiền còn lại theo cách tối giản.
 */
export function archiveCardCopy(
  archived: boolean,
  ended: boolean,
  openTransfers: number,
): ArchiveCardCopy | null {
  if (archived) {
    return {
      title: 'Bạn đã lưu trữ chuyến này',
      hint: 'Chuyến không hiện ở danh sách chính của bạn. Người khác vẫn thấy bình thường.',
      action: 'Bỏ lưu trữ',
    };
  }
  if (!ended) return null;
  return {
    title: 'Chuyến đi đã kết thúc',
    hint:
      openTransfers > 0
        ? `Còn ${openTransfers} lần chuyển tiền chưa xong. Lưu trữ chỉ ẩn chuyến khỏi danh sách của bạn — khoản nợ vẫn còn.`
        : 'Mọi người đã thanh toán xong. Lưu trữ để danh sách chính gọn hơn.',
    action: 'Lưu trữ chuyến đi',
  };
}

/**
 * Danh sách id "Để sau" cần lưu: gộp cái cũ với các chuyến đang nhắc, bỏ id
 * không còn trong `allTripIds` (rời chuyến, chuyến bị xoá) để kho không phình
 * mãi. Truyền MỌI chuyến người dùng thấy, kể cả đã lưu trữ: bỏ lưu trữ một
 * chuyến đã "Để sau" thì không bị nhắc lại.
 */
export function dismissReminder(
  dismissed: ReadonlySet<string>,
  ended: readonly DatedTrip[],
  allTripIds: ReadonlySet<string>,
): string[] {
  const next = new Set<string>();
  for (const id of dismissed) if (allTripIds.has(id)) next.add(id);
  for (const trip of ended) next.add(trip.id);
  return [...next];
}
