import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ErrorView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { createTrip } from '@/lib/data/manager';
import { describeError } from '@/lib/data/use-async';
import { formatDate, parseDateTime, toIsoDate } from '@/lib/datetime';
import type { CurrencyCode } from '@/lib/money';
import { CURRENCY_CODES, DEFAULT_CURRENCY } from '@/lib/money';

export default function NewTripScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY);
  const [startText, setStartText] = useState(formatDate(new Date()));
  const [endText, setEndText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startDate = startText.trim() === '' ? null : parseDateTime(startText);
  const endDate = endText.trim() === '' ? null : parseDateTime(endText);
  const startInvalid = startText.trim() !== '' && startDate === null;
  const endInvalid = endText.trim() !== '' && endDate === null;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const tripId = await createTrip({
        name,
        currency,
        startDate: startDate ? toIsoDate(startDate) : null,
        endDate: endDate ? toIsoDate(endDate) : null,
      });
      // replace thay vì push: quay lui từ màn chuyến đi nên về danh sách,
      // không quay lại form tạo đã dùng xong.
      router.replace({ pathname: '/trip/[tripId]/overview', params: { tripId } });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Screen header={<AppHeader title="Chuyến đi mới" showBack />}>
        <TextField
          label="Tên chuyến đi"
          value={name}
          onChangeText={setName}
          placeholder="Đà Lạt tháng 9"
          autoCapitalize="sentences"
        />

        <View>
          <Text className="mb-1 text-sm font-medium text-foreground">Đơn vị tiền tệ</Text>
          <SegmentedControl
            options={CURRENCY_CODES.map((code) => ({ value: code, label: code }))}
            value={currency}
            onChange={setCurrency}
            accessibilityLabel="Đơn vị tiền tệ của chuyến đi"
          />
          <Text className="mt-1 text-xs text-muted-foreground">
            Mỗi chuyến đi dùng một đơn vị duy nhất, và không đổi được sau khi có khoản chi.
          </Text>
        </View>

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
          error={endInvalid ? 'Ngày không hợp lệ.' : null}
          hint="Để trống nếu chưa chốt."
        />

        {error ? <ErrorView message={error} /> : null}

        <Button
          label="Tạo chuyến đi"
          onPress={() => void submit()}
          disabled={name.trim() === '' || startInvalid || endInvalid}
          busy={busy}
        />
      </Screen>
    </>
  );
}
