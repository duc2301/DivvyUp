import type { FormEvent } from 'react';
import { useState } from 'react';

import type { TripSummary } from '@/entities/trip';
import { updateTripDetails } from '@/entities/trip';
import { describeError } from '@/shared/lib/async';
import { Button, ErrorView, TextField } from '@/shared/ui';

interface TripEditFormProps {
  readonly trip: TripSummary;
  readonly onSaved: () => void;
}

/**
 * Sửa tên + ngày (bám edit.tsx). Ngày dùng <input type="date"> — trả sẵn
 * 'YYYY-MM-DD' theo giờ máy, đúng định dạng cột date; RPC kiểm lại ở DB.
 */
export function TripEditForm({ trip, onSaved }: TripEditFormProps) {
  const [name, setName] = useState(trip.name);
  const [start, setStart] = useState(trip.startDate ?? '');
  const [end, setEnd] = useState(trip.endDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reversed = start !== '' && end !== '' && end < start;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (name.trim() === '' || reversed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateTripDetails(trip.id, { name, startDate: start || null, endDate: end || null });
      onSaved();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <TextField label="Tên chuyến đi" value={name} onChange={(event) => setName(event.target.value)} placeholder="Đà Lạt tháng 9" maxLength={120} />
      <TextField label="Ngày bắt đầu" type="date" value={start} onChange={(event) => setStart(event.target.value)} hint="Để trống nếu chưa chốt." />
      <TextField
        label="Ngày kết thúc"
        type="date"
        value={end}
        min={start || undefined}
        onChange={(event) => setEnd(event.target.value)}
        error={reversed ? 'Ngày kết thúc trước ngày bắt đầu.' : null}
        hint="Để trống nếu chưa chốt."
      />
      <p className="px-1 text-xs leading-5 text-muted-foreground">
        Mọi người trong chuyến đều sửa được tên, ngày, địa điểm, ảnh bìa và ghi chú.
      </p>
      {error ? <ErrorView message={error} /> : null}
      <Button type="submit" label="Lưu thay đổi" disabled={name.trim() === '' || reversed} busy={busy} />
    </form>
  );
}
