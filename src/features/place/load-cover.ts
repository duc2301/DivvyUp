import { fetchPlacePhotos } from '@/lib/data/places';
import type { TripCoverGallery, TripCoverImage, TripPlace } from '@/lib/data/trips';
import { assertCoverImages } from '@/lib/data/trips';

/** Số ảnh lưu cho mỗi chuyến — người dùng lướt qua lại trên ảnh bìa. */
export const COVER_PHOTO_LIMIT = 30;

/**
 * Tìm bộ ảnh bìa cho một địa điểm.
 *
 * Gửi kèm riêng tên (để máy chủ loại ảnh không nhắc tới nơi này) và toạ độ
 * (để lấy thêm ảnh chụp thật tại chỗ). Ném lỗi thật — người gọi quyết định có
 * báo cho người dùng hay không.
 */
export async function loadCoverForPlace(place: TripPlace): Promise<TripCoverGallery> {
  const term = place.country ? `${place.name} ${place.country}` : place.name;
  const photos = await fetchPlacePhotos(term, {
    limit: COVER_PHOTO_LIMIT,
    fallback: place.name,
    name: place.name,
    latitude: place.latitude ?? undefined,
    longitude: place.longitude ?? undefined,
  });
  const images = photos
    .map(
      (photo): TripCoverImage => ({
        url: photo.url,
        thumbUrl: photo.thumbUrl,
        credit: photo.credit,
        link: photo.link,
        provider: photo.provider,
      }),
    )
    // Lớp phòng thủ thứ hai: bỏ riêng ảnh không qua luật của trigger
    // trips_validate_cover, để một ảnh lỗi không làm hỏng cả bộ khi lưu.
    .filter((image) => {
      try {
        assertCoverImages([image]);
        return true;
      } catch {
        return false;
      }
    });
  return { images, index: 0 };
}
