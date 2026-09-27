/**
 * Chuyến đi, địa điểm, ảnh bìa — dùng NGUYÊN VĂN tầng dữ liệu của mobile.
 * Web bắt buộc đăng nhập nên gọi thẳng bản remote, không qua manager.ts.
 */
export type {
  CreateTripInput,
  TripCoverGallery,
  TripCoverImage,
  TripDetailsInput,
  TripPlace,
  TripPreview,
  TripPreviewSlot,
  TripSummary,
} from '@core/lib/data/trips';
export {
  createTrip,
  currentCover,
  getTrip,
  joinTripByCode,
  placeKeyOf,
  saveCoverIfPlaceUnchanged,
  listTrips,
  previewTripByCode,
  updateCoverIndex,
  updateTripDetails,
  updateTripPlace,
} from '@core/lib/data/trips';

export type { PlaceResult } from '@core/lib/data/places';
export { searchPlaces } from '@core/lib/data/places';
export { loadCoverForPlace } from '@core/features/place/load-cover';

// Lưu trữ CÁ NHÂN (bảng trip_archives) — chỉ đổi danh sách của người đăng nhập.
export { getTripArchivedAt, listArchivedTrips, setTripArchived } from '@core/lib/data/archives';
