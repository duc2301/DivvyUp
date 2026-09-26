import type { FormEvent } from 'react';
import { useState } from 'react';

import type { TripPreview } from '@/entities/trip';
import { joinTripByCode, previewTripByCode } from '@/entities/trip';
import { describeError } from '@/shared/lib/async';
import { Button, ErrorView, SectionCard, TextField } from '@/shared/ui';

interface JoinTripFormProps {
  /** Mã có sẵn từ link mời (?code=…). */
  readonly initialCode: string;
  readonly onJoined: (tripId: string) => void;
}

/** Nhập mã mời → xem trước chuyến → chọn tên mình → nhận chỗ (bám join.tsx). */
export function JoinTripForm({ initialCode, onJoined }: JoinTripFormProps) {
  const [code, setCode] = useState(initialCode.toUpperCase().slice(0, 8));
  const [preview, setPreview] = useState<TripPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookUp = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (code.trim().length < 4 || busy) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(await previewTripByCode(code));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const claim = async (memberId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onJoined(await joinTripByCode(code, memberId));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form onSubmit={(event) => void lookUp(event)} className="flex flex-col gap-4">
        <TextField
          label="Mã tham gia"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            // Danh sách chỗ đang hiện thuộc về mã CŨ — bỏ đi kẻo nhận nhầm chuyến.
            setPreview(null);
          }}
          placeholder="8 ký tự"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          maxLength={8}
          hint="Người tổ chức lấy mã này ở màn Thành viên của chuyến đi."
        />
        <Button type="submit" label="Tìm chuyến đi" disabled={code.trim().length < 4} busy={busy && preview === null} />
      </form>

      {error ? <ErrorView message={error} /> : null}

      {preview ? (
        <SectionCard title={preview.tripName} hint="Chọn tên của bạn trong danh sách. Mỗi người chỉ nhận được một chỗ.">
          {preview.slots.map((slot) => (
            <button
              key={slot.memberId}
              type="button"
              aria-label={`Nhận chỗ của ${slot.memberName}`}
              disabled={slot.claimed || busy}
              onClick={() => void claim(slot.memberId)}
              className={`flex min-h-14 w-full items-center justify-between rounded-2xl px-2 py-2 text-left hover:bg-muted/60 active:bg-muted ${
                slot.claimed ? 'opacity-40' : ''
              }`}>
              <span className="min-w-0 flex-1 truncate text-base text-foreground">{slot.memberName}</span>
              <span className="pl-3 text-xs text-muted-foreground">{slot.claimed ? 'đã có người' : 'chọn'}</span>
            </button>
          ))}
          <p className="pt-3 text-xs text-muted-foreground">
            Không thấy tên mình? Nhờ người tổ chức thêm bạn vào danh sách thành viên trước.
          </p>
        </SectionCard>
      ) : null}
    </>
  );
}
