import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { ErrorView, LoadingView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { getTrip, updateTripDetails } from '@/lib/data/manager';
import { describeError, useAsync } from '@/lib/data/use-async';
import { formatDate, fromIsoDate, parseDateTime, toIsoDate } from '@/lib/datetime';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Sửa tên và ngày của chuyến đi. Mọi thành viên đã vào chuyến đều sửa được —
 * máy chủ kiểm quyền trong RPC update_trip_details, màn này không tự chặn.
 */
export default function EditTripScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId?: string | string[] }>();
  const tripId = firstParam(params.tripId);

  const [name, setName] = useState('');
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trip = useAsync(async () => {
    if (!tripId) throw new Error('Thiếu mã chuyến đi.');
    return getTrip(tripId);
  }, [tripId]);

  // Đổ dữ liệu đúng một lần — reload sau đó không được ghi đè thứ đang gõ.
  useEffect(() => {
    if (!trip.data || seeded) return;
    const start = fromIsoDate(trip.data.startDate);
    const end = fromIsoDate(trip.data.endDate);
    setName(trip.data.name);
    setStartText(start ? formatDate(start) : '');
    setEndText(end ? formatDate(end) : '');
    setSeeded(true);
  }, [trip.data, seeded]);

  const startDate = startText.trim() === '' ? null : parseDateTime(startText);
  const endDate = endText.trim() === '' ? null : parseDateTime(endText);
  const startInvalid = startText.trim() !== '' && startDate === null;
  const endInvalid = endText.trim() !== '' && endDate === null;
  const reversed =
    startDate !== null && endDate !== null && toIsoDate(endDate) < toIsoDate(startDate);

  const leave = (): void => {
    if (router.canGoBack()) router.back();
    else if (tripId) router.replace({ pathname: '/trip/[tripId]/overview', params: { tripId } });
  };

  const submit = async (): Promise<void> => {
    if (!tripId) return;
    setBusy(true);
    setError(null);
    try {
      await updateTripDetails(tripId, {
        name,
        startDate: startDate ? toIsoDate(startDate) : null,
        endDate: endDate ? toIsoDate(endDate) : null,
      });
      leave();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<AppHeader title="Sửa chuyến đi" subtitle="Tên và ngày đi" showBack />}>
      {trip.loading && trip.data === null ? <LoadingView /> : null}
      {trip.error ? <ErrorView message={trip.error} onRetry={trip.reload} /> : null}

      {seeded ? (
        <>
          <TextField
            label="Tên chuyến đi"
            value={name}
            onChangeText={setName}
            placeholder="Đà Lạt tháng 9"
            autoCapitalize="sentences"
          />
          <TextField
            label="Ngày bắt đầu"
            value={startText}
            onChangeText={setStartText}
            placeholder="dd/mm/yyyy"
            keyboardType="numbers-and-punctuation"
            error={startInvalid ? 'Ngày không hợp lệ.' : null}
            hint="Để trống nếu chưa chốt."
          />
          <TextField
            label="Ngày kết thúc"
            value={endText}
            onChangeText={setEndText}
            placeholder="dd/mm/yyyy"
            keyboardType="numbers-and-punctuation"
            error={
              endInvalid
                ? 'Ngày không hợp lệ.'
                : reversed
                  ? 'Ngày kết thúc trước ngày bắt đầu.'
                  : null
            }
            hint="Để trống nếu chưa chốt."
          />
          <Text className="px-1 text-xs leading-5 text-muted-foreground">
            Mọi người trong chuyến đều sửa được tên, ngày, địa điểm, ảnh bìa và ghi chú. Dự báo thời
            tiết tính lại theo ngày mới.
          </Text>

          {error ? <ErrorView message={error} /> : null}

          <Button
            label="Lưu thay đổi"
            onPress={() => void submit()}
            disabled={name.trim() === '' || startInvalid || endInvalid || reversed}
            busy={busy}
          />
        </>
      ) : null}
    </Screen>
  );
}
