import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { PlaceResult, TripSummary } from '@/entities/trip';
import { searchPlaces, toTripPlace, updateTripPlace } from '@/entities/trip';
import { describeError } from '@/shared/lib/async';
import { Button, ErrorView, SectionCard, TextField } from '@/shared/ui';

interface PlacePickerProps {
  readonly trip: TripSummary;
  readonly onDone: () => void;
}

/**
 * Tìm → chạm đúng nơi → Xác nhận (bám place.tsx). Ảnh bìa KHÔNG tải ở đây: nơi
 * mới được lưu kèm bộ ảnh rỗng, màn chuyến đi tự tải ảnh ở nền.
 */
export function PlacePicker({ trip, onDone }: PlacePickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlaceResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Chờ 400ms sau khi ngừng gõ mới tìm — mỗi lượt gọi tốn hạn mức API.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearchError(null);
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

  const confirm = async (): Promise<void> => {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const samePlace = trip.place !== null && trip.place.externalId === selected.id;
      // Chọn lại đúng nơi cũ thì giữ bộ ảnh; nơi mới thì bộ ảnh rỗng để tải ở nền.
      await updateTripPlace(trip.id, toTripPlace(selected), samePlace ? trip.cover : { images: [], index: 0 });
      onDone();
    } catch (caught) {
      setSaveError(describeError(caught));
    } finally {
      setSaving(false);
    }
  };

  const clearPlace = async (): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateTripPlace(trip.id, null, { images: [], index: 0 });
      onDone();
    } catch (caught) {
      setSaveError(describeError(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {trip.place ? (
        <p className="px-1 text-sm text-muted-foreground">
          Đang chọn: <span className="font-semibold text-foreground">📍 {trip.place.name}</span>
        </p>
      ) : null}

      <TextField
        label="Tìm thành phố hoặc địa danh"
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(null);
        }}
        placeholder="Đà Lạt, Phan Thiết, Hội An…"
        autoCorrect="off"
        autoComplete="off"
        hint={searching ? 'Đang tìm…' : 'Gõ ít nhất 2 ký tự, rồi chạm đúng nơi bạn đến.'}
      />

      {searchError ? <ErrorView message={searchError} /> : null}

      {searched && results.length === 0 && !searching && !searchError ? (
        <SectionCard title="Kết quả">
          <p className="text-sm text-muted-foreground">
            Không tìm thấy địa điểm nào khớp. Thử tên khác, hoặc bỏ dấu.
          </p>
        </SectionCard>
      ) : null}

      {results.length > 0 ? (
        <SectionCard title="Kết quả" hint="Chạm để chọn. Ảnh bìa sẽ tự tải sau khi xác nhận.">
          <div role="radiogroup" aria-label="Kết quả tìm địa điểm" className="-mx-2 flex flex-col">
            {results.map((item) => {
              const chosen = selected?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  onClick={() => setSelected(chosen ? null : item)}
                  className={`flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted/60 ${
                    chosen ? 'bg-accent text-accent-foreground' : 'text-foreground'
                  }`}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-medium">{item.name}</span>
                    {item.address ? (
                      <span
                        className={`mt-0.5 block truncate text-xs ${chosen ? 'text-accent-foreground/80' : 'text-muted-foreground'}`}>
                        {item.address}
                      </span>
                    ) : null}
                  </span>
                  {chosen ? <Check size={20} aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </SectionCard>
      ) : null}

      {saveError ? <ErrorView message={saveError} /> : null}

      <Button
        label={selected ? `Xác nhận: ${selected.name}` : 'Chọn một địa điểm ở trên'}
        onClick={() => void confirm()}
        disabled={selected === null || saving}
        busy={saving}
      />
      {trip.place ? (
        <Button label="Bỏ địa điểm hiện tại" variant="ghost" onClick={() => void clearPlace()} disabled={saving} />
      ) : null}
    </>
  );
}
