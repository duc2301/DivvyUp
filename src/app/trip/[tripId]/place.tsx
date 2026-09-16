import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import type { TripCoverImage, TripPlace } from '@/lib/data/trips';

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
  const [searchError, setSearchError] = useState<string | null>(null);

  const [place, setPlace] = useState<PlaceResult | null>(null);
  const [photos, setPhotos] = useState<PlacePhoto[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<PlacePhoto | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const trip = useAsync(async () => {
    if (!tripId) throw new Error('Thiếu mã chuyến đi.');
    return getTrip(tripId);
  }, [tripId]);

  // Chờ 400ms sau khi ngừng gõ mới tìm. Gọi theo từng ký tự vừa tốn hạn mức
  // API vừa làm danh sách nhấp nháy liên tục.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearchError(null);
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
  }, [query]);

  const choosePlace = (chosen: PlaceResult): void => {
    setPlace(chosen);
    setResults([]);
    setQuery(chosen.name);
    setSelectedPhoto(null);
    setPhotos([]);
    setPhotoError(null);
    setLoadingPhotos(true);

    // Tìm ảnh theo tên địa điểm kèm quốc gia: "Đà Lạt" một mình dễ ra ảnh lạc đề.
    const term = chosen.country ? `${chosen.name} ${chosen.country}` : chosen.name;
    fetchPlacePhotos(term, { limit: 12 })
      .then(setPhotos)
      .catch((caught: unknown) => setPhotoError(describeError(caught)))
      .finally(() => setLoadingPhotos(false));
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

      const nextCover: TripCoverImage | null = selectedPhoto
        ? {
            url: selectedPhoto.url,
            credit: selectedPhoto.credit,
            link: selectedPhoto.link,
            provider: selectedPhoto.provider,
          }
        : null;

      await updateTripPlace(tripId, nextPlace, nextCover);
      router.back();
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
      await updateTripPlace(tripId, null, null);
      router.back();
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
              ? `Nguồn: ${selectedPhoto.credit} · ${selectedPhoto.provider}`
              : 'Chạm để chọn một ảnh. Có thể bỏ qua.'
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
        disabled={place === null || saving}
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
