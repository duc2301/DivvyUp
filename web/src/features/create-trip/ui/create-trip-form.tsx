import type { FormEvent } from 'react';
import { useState } from 'react';

import { createTrip } from '@/entities/trip';
import { describeError } from '@/shared/lib/async';
import { toIsoDate } from '@/shared/lib/datetime';
import type { CurrencyCode } from '@/shared/lib/money';
import { CURRENCY_CODES, DEFAULT_CURRENCY } from '@/shared/lib/money';
import { Button, ErrorView, SegmentedControl, TextField } from '@/shared/ui';

/** Tạo chuyến đi (bám trip-new.tsx). Ngày bắt đầu mặc định hôm nay. */
export function CreateTripForm({ onCreated }: { readonly onCreated: (tripId: string) => void }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY);
  const [start, setStart] = useState(() => toIsoDate(new Date()));
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reversed = start !== '' && end !== '' && end < start;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (name.trim() === '' || reversed || busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createTrip({ name, currency, startDate: start || null, endDate: end || null }));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <TextField label="Tên chuyến đi" value={name} onChange={(event) => setName(event.target.value)} placeholder="Đà Lạt tháng 9" maxLength={120} />
      <div>
        <p className="mb-1 text-sm font-medium text-foreground">Đơn vị tiền tệ</p>
        <SegmentedControl
          options={CURRENCY_CODES.map((code) => ({ value: code, label: code }))}
          value={currency}
          onChange={setCurrency}
          ariaLabel="Đơn vị tiền tệ của chuyến đi"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Mỗi chuyến đi dùng một đơn vị duy nhất, và không đổi được sau khi có khoản chi.
        </p>
      </div>
      <TextField label="Ngày bắt đầu" type="date" value={start} onChange={(event) => setStart(event.target.value)} hint="Để trống nếu chưa chốt." />
      <TextField
        label="Ngày kết thúc"
        type="date"
        value={end}
        min={start || undefined}
        onChange={(event) => setEnd(event.target.value)}
        error={reversed ? 'Ngày kết thúc phải sau ngày bắt đầu.' : null}
        hint="Để trống nếu chưa chốt."
      />
      {error ? <ErrorView message={error} /> : null}
      <Button type="submit" label="Tạo chuyến đi" disabled={name.trim() === '' || reversed} busy={busy} />
    </form>
  );
}
