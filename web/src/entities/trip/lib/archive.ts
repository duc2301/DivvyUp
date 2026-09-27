/** Chia danh sách chính / lưu trữ và chọn chuyến cần nhắc — dùng chung với mobile. */
export type { ArchiveCardCopy, ArchivedTrips, TripShelves } from '@core/lib/trips/archive';
export {
  archiveCardCopy,
  dismissReminder,
  endedTrips,
  isTripEnded,
  shouldRemindArchive,
  splitByArchive,
} from '@core/lib/trips/archive';
