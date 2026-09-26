import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { Check } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { SectionCard } from '@/components/ui/section-card';
import { ErrorView, LoadingView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { getTrip, updateTripPlace } from '@/lib/data/manager';
import type { PlaceResult } from '@/lib/data/places';
import { searchPlaces } from '@/lib/data/places';
import { describeError, useAsync } from '@/lib/data/use-async';
import type { TripPlace } from '@/lib/data/trips';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toTripPlace(place: PlaceResult): TripPlace {
  return {
    name: place.name,
    address: place.address,
    country: place.country,
    latitude: place.latitude,
    longitude: place.longitude,
    provider: place.provider,
    externalId: place.id,
  };
}

/**
 * Chọn địa điểm: tìm → chạm đúng nơi → xác nhận. Không có bước chọn ảnh.
 *
 * Ảnh bìa KHÔNG tải ở đây: chờ 30 ảnh về rồi mới cho lưu là bắt người dùng
 * đứng nhìn lưới ảnh chỉ để bấm "Lưu". Đổi địa điểm thì lưu kèm bộ ảnh rỗng;
 * màn chuyến đi thấy có địa điểm mà chưa có ảnh sẽ tự tải ảnh ở nền, người dùng
 * lướt ngay trên ảnh bìa (xem useBackgroundCover).
 */
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

  const [selected, setSelected] = useState<PlaceResult | null>(null);
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
      // Tắt cả cờ này: thiếu nó thì gõ "đà" rồi xoá còn "đ" sẽ để dòng
      // "Đang tìm…" kẹt lại vĩnh viễn.
      setSearching(false);
      setSearched(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      searchPlaces(trimmed, 8)
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
  }, [query]);

  // Mở thẳng bằng link thì không có màn phía sau để back() về.
  const leave = (): void => {
    if (router.canGoBack()) router.back();
    else if (tripId) router.replace({ pathname: '/trip/[tripId]/overview', params: { tripId } });
    else router.replace('/');
  };

  const confirm = async (): Promise<void> => {
    if (!tripId || !selected || !trip.data) return;
    setSaving(true);
    setSaveError(null);
    try {
      const current = trip.data.place;
      const samePlace = current !== null && current.externalId === selected.id;
      // Chọn lại đúng nơi cũ thì giữ nguyên bộ ảnh đang có; nơi mới thì bộ ảnh
      // rỗng để màn chuyến đi tải ảnh của nơi mới ở nền.
      await updateTripPlace(
        tripId,
        toTripPlace(selected),
        samePlace ? trip.data.cover : { images: [], index: 0 },
      );
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

      {trip.data?.place ? (
        <Text className="px-1 text-sm text-muted-foreground">
          Đang chọn:{' '}
          <Text className="font-semibold text-foreground">📍 {trip.data.place.name}</Text>
        </Text>
      ) : null}

      <TextField
        label="Tìm thành phố hoặc địa danh"
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          // Gõ lại nghĩa là đổi ý — bỏ lựa chọn cũ để không xác nhận nhầm.
          setSelected(null);
        }}
        placeholder="Đà Lạt, Phan Thiết, Hội An…"
        autoCorrect={false}
        hint={searching ? 'Đang tìm…' : 'Gõ ít nhất 2 ký tự, rồi chạm đúng nơi bạn đến.'}
      />

      {searchError ? <ErrorView message={searchError} /> : null}

      {searched && results.length === 0 && !searching && !searchError ? (
        <SectionCard title="Kết quả">
          <Text className="text-sm text-muted-foreground">
            Không tìm thấy địa điểm nào khớp. Thử tên khác, hoặc bỏ dấu.
          </Text>
        </SectionCard>
      ) : null}

      {results.length > 0 ? (
        <SectionCard title="Kết quả" hint="Chạm để chọn. Ảnh bìa sẽ tự tải sau khi xác nhận.">
          {results.map((item) => {
            const chosen = selected?.id === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen }}
                accessibilityLabel={`Chọn ${item.name}${item.address ? `, ${item.address}` : ''}`}
                onPress={() => setSelected(chosen ? null : item)}
                className={`-mx-2 min-h-14 flex-row items-center gap-3 rounded-xl px-2 py-2 active:bg-muted ${
                  chosen ? 'bg-accent' : ''
                }`}>
                <View className="min-w-0 flex-1">
                  <Text
                    className={`text-base font-medium ${chosen ? 'text-accent-foreground' : 'text-foreground'}`}>
                    {item.name}
                  </Text>
                  {item.address ? (
                    <Text numberOfLines={1} className="mt-0.5 text-xs text-muted-foreground">
                      {item.address}
                    </Text>
                  ) : null}
                </View>
                {chosen ? <Check size={20} className="text-primary" /> : null}
              </Pressable>
            );
          })}
        </SectionCard>
      ) : null}

      {saveError ? <ErrorView message={saveError} /> : null}

      <Button
        label={selected ? `Xác nhận: ${selected.name}` : 'Chọn một địa điểm ở trên'}
        onPress={() => void confirm()}
        disabled={selected === null || saving || trip.data === null}
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
