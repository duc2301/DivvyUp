import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { SectionCard } from '@/components/ui/section-card';
import { ErrorView, LoadingView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { getTrip, updateTripPlace } from '@/lib/data/manager';
import type { PlacePhoto, PlaceResult } from '@/lib/data/places';
import { fetchPlacePhotos, searchPlaces } from '@/lib/data/places';
import { describeError, useAsync } from '@/lib/data/use-async';
import type { TripCoverGallery, TripPlace } from '@/lib/data/trips';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function TripPlaceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId?: string | string[] }>();
  const tripId = firstParam(params.tripId);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  // Phân biệt "chưa tìm lần nào" với "đã tìm và không có kết quả" — thiếu nó
  // thì gõ một cái tên không có thật sẽ không hiện gì cả, màn hình như bị treo.
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [place, setPlace] = useState<PlaceResult | null>(null);
  const [photos, setPhotos] = useState<PlacePhoto[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<PlacePhoto | null>(null);

  // Số thứ tự lượt tải ảnh, để bỏ qua kết quả của lượt đã bị thay thế.
  const photoRequestId = useRef(0);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const trip = useAsync(async () => {
    if (!tripId) throw new Error('Thiếu mã chuyến đi.');
    return getTrip(tripId);
  }, [tripId]);

  // Chờ 400ms sau khi ngừng gõ mới tìm. Gọi theo từng ký tự vừa tốn hạn mức
  // API vừa làm danh sách nhấp nháy liên tục.
  useEffect(() => {
    // Đã chọn xong thì KHÔNG tìm lại. choosePlace đặt query = tên địa điểm,
    // mà query là dependency của effect này — thiếu chốt chặn thì 400ms sau
    // danh sách kết quả tự bật lại, đẩy khối ảnh bìa tụt xuống đúng lúc ngón
    // tay đang chạm, và tốn thêm một lượt gọi Mapbox hoàn toàn thừa.
    if (place !== null) {
      // Chọn kết quả đúng lúc một lượt tìm khác đang chạy: cleanup của lượt đó
      // đã chặn `finally` tắt cờ, nên phải tắt ở đây, không thì "Đang tìm…" kẹt.
      setSearching(false);
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearchError(null);
      // Phải tắt cả cờ này: thiếu nó thì gõ "đà" rồi xoá còn "đ" sẽ để dòng
      // "Đang tìm…" kẹt lại vĩnh viễn.
      setSearching(false);
      setSearched(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      searchPlaces(trimmed)
        .then((found) => {
          if (cancelled) return;
          setResults(found);
          setSearched(true);
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          setSearchError(describeError(caught));
          setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, place]);

  const choosePlace = (chosen: PlaceResult): void => {
    setPlace(chosen);
    setResults([]);
    setQuery(chosen.name);
    setSelectedPhoto(null);
    setPhotos([]);
    setPhotoError(null);
    setLoadingPhotos(true);

    // Đánh dấu lượt tải này. Chọn "Hội An" (mạng chậm) rồi đổi ý chọn "Đà Lạt"
    // (trả nhanh): không có chốt này thì ảnh Hội An về sau sẽ đè lên lưới Đà Lạt
    // trong khi tiêu đề vẫn là Đà Lạt — người dùng chọn một tấm rồi lưu, và
    // chuyến Đà Lạt mang ảnh bìa Hội An.
    photoRequestId.current += 1;
    const requestId = photoRequestId.current;

    // Tìm theo tên kèm quốc gia để tránh trùng tên với nơi khác trên thế giới;
    // nếu không ra ảnh nào thì Edge Function tự lùi về riêng tên địa điểm.
    const term = chosen.country ? `${chosen.name} ${chosen.country}` : chosen.name;
    fetchPlacePhotos(term, { limit: 12, fallback: chosen.name })
      .then((found) => {
        if (photoRequestId.current !== requestId) return;
        setPhotos(found);
      })
      .catch((caught: unknown) => {
        if (photoRequestId.current !== requestId) return;
        setPhotoError(describeError(caught));
      })
      .finally(() => {
        // Lượt cũ KHÔNG được tắt spinner của lượt mới, nếu không lưới rỗng sẽ
        // trông như "địa điểm này không có ảnh".
        if (photoRequestId.current !== requestId) return;
        setLoadingPhotos(false);
      });
  };

  // Mở thẳng bằng link thì không có màn phía sau để back() về.
  const leave = (): void => {
    if (router.canGoBack()) router.back();
    else if (tripId) router.replace({ pathname: '/trip/[tripId]/overview', params: { tripId } });
    else router.replace('/');
  };

  const save = async (): Promise<void> => {
    if (!tripId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const nextPlace: TripPlace | null = place
        ? {
            name: place.name,
            address: place.address,
            country: place.country,
            latitude: place.latitude,
            longitude: place.longitude,
            provider: place.provider,
            externalId: place.id,
          }
        : null;

      // Lưu CẢ danh sách ảnh tìm được, không chỉ tấm được chọn: người dùng sẽ
      // lướt qua lại trên màn chuyến đi. Tấm đang chọn trở thành ảnh hiện tại.
      const images = photos.map((photo) => ({
        url: photo.url,
        thumbUrl: photo.thumbUrl,
        credit: photo.credit,
        link: photo.link,
        provider: photo.provider,
      }));
      const chosenIndex = selectedPhoto
        ? Math.max(photos.findIndex((photo) => photo.id === selectedPhoto.id), 0)
        : 0;

      const nextCover: TripCoverGallery = { images, index: chosenIndex };

      await updateTripPlace(tripId, nextPlace, nextCover);
      leave();
    } catch (caught) {
      setSaveError(describeError(caught));
    } finally {
      setSaving(false);
    }
  };

  const clearPlace = async (): Promise<void> => {
    if (!tripId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateTripPlace(tripId, null, { images: [], index: 0 });
      leave();
    } catch (caught) {
      setSaveError(describeError(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen header={<AppHeader title="Địa điểm" subtitle="Chọn nơi chuyến đi diễn ra" showBack />}>
      {trip.loading && trip.data === null ? <LoadingView /> : null}
      {trip.error ? <ErrorView message={trip.error} onRetry={trip.reload} /> : null}

      <TextField
        label="Tìm thành phố hoặc địa danh"
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          // Gõ lại nghĩa là đổi ý — bỏ lựa chọn cũ để không lưu nhầm địa điểm
          // cũ kèm ảnh mới.
          if (place) {
            setPlace(null);
            setPhotos([]);
            setSelectedPhoto(null);
          }
        }}
        placeholder="Đà Lạt, Phan Thiết, Hội An…"
        autoCorrect={false}
        hint={searching ? 'Đang tìm…' : 'Gõ ít nhất 2 ký tự.'}
      />

      {searchError ? <ErrorView message={searchError} /> : null}

      {searched && results.length === 0 && place === null && !searching && !searchError ? (
        <SectionCard title="Kết quả">
          <Text className="text-sm text-muted-foreground">
            Không tìm thấy địa điểm nào khớp. Thử tên khác, hoặc bỏ dấu.
          </Text>
        </SectionCard>
      ) : null}

      {results.length > 0 ? (
        <SectionCard title="Kết quả">
          {results.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`Chọn ${item.name}`}
              onPress={() => choosePlace(item)}
              className="min-h-14 justify-center border-b border-border active:bg-muted">
              <Text className="text-base font-medium text-foreground">{item.name}</Text>
              {item.address ? (
                <Text numberOfLines={1} className="mt-0.5 text-xs text-muted-foreground">
                  {item.address}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </SectionCard>
      ) : null}

      {place ? (
        <SectionCard
          title="Ảnh bìa"
          hint={
            selectedPhoto
              ? `Ảnh mở đầu: ${selectedPhoto.credit}. Cả ${photos.length} ảnh đều được lưu để lướt.`
              : `Cả ${photos.length} ảnh sẽ được lưu. Chạm để chọn ảnh hiện ra đầu tiên.`
          }>
          {loadingPhotos ? <LoadingView label="Đang tải ảnh…" /> : null}
          {photoError ? <ErrorView message={photoError} /> : null}

          {!loadingPhotos && !photoError && photos.length === 0 ? (
            <Text className="text-sm text-muted-foreground">
              Không tìm được ảnh cho địa điểm này. Vẫn lưu được, chỉ là chưa có ảnh bìa.
            </Text>
          ) : null}

          <View className="flex-row flex-wrap gap-2">
            {photos.map((photo) => {
              const chosen = selectedPhoto?.id === photo.id;
              return (
                <Pressable
                  key={photo.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Chọn ảnh của ${photo.credit}`}
                  accessibilityState={{ selected: chosen }}
                  onPress={() => setSelectedPhoto(chosen ? null : photo)}
                  className={`overflow-hidden rounded-2xl ${
                    chosen ? 'border-2 border-primary' : 'border border-border'
                  }`}>
                  <Image
                    source={{ uri: photo.thumbUrl }}
                    style={{ width: 104, height: 104 }}
                    contentFit="cover"
                    transition={120}
                  />
                </Pressable>
              );
            })}
          </View>
        </SectionCard>
      ) : null}

      {saveError ? <ErrorView message={saveError} /> : null}

      <Button
        label="Lưu địa điểm"
        onPress={() => void save()}
        // Khoá khi ảnh còn đang tải: lưu lúc đó là lưu bộ ảnh rỗng, chuyến có
        // địa điểm mà không có ảnh bìa.
        disabled={place === null || saving || loadingPhotos}
        busy={saving}
      />

      {trip.data?.place ? (
        <Button
          label="Bỏ địa điểm hiện tại"
          variant="ghost"
          onPress={() => void clearPlace()}
          disabled={saving}
        />
      ) : null}
    </Screen>
  );
}
