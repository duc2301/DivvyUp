import { Minus, Plus, Users } from 'lucide-react';
import { useState } from 'react';

import { createTripGroup } from '@/entities/member';
import { describeError } from '@/shared/lib/async';
import { Button, IconButton, TextField } from '@/shared/ui';

const MAX_GROUP_SIZE = 100;

interface CreateGroupFormProps {
  readonly tripId: string;
  readonly onCreated: () => void;
  readonly onError: (message: string | null) => void;
}

/** "Tạo nhóm mới": tên + số chỗ đặt sẵn (mỗi chỗ là một dòng tên tạm để sửa). */
export function CreateGroupForm({ tripId, onCreated, onError }: CreateGroupFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [size, setSize] = useState(4);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-3xl border border-dashed border-border text-base font-semibold text-primary hover:bg-muted/60 active:bg-muted">
        <Users size={20} aria-hidden />
        Tạo nhóm mới
      </button>
    );
  }

  const submit = async (): Promise<void> => {
    if (name.trim() === '' || busy) return;
    setBusy(true);
    onError(null);
    try {
      await createTripGroup(tripId, name, size);
      setName('');
      setSize(4);
      setOpen(false);
      onCreated();
    } catch (caught) {
      onError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-sm">
      <p className="text-base font-semibold text-foreground">Nhóm mới</p>
      <TextField
        label="Tên nhóm"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Xe 1, Phòng A…"
        autoFocus
        maxLength={60}
      />
      <div>
        <p className="mb-1 text-sm font-medium text-foreground">Số thành viên</p>
        <div className="flex items-center gap-3">
          <IconButton icon={Minus} label="Bớt một chỗ" disabled={size <= 0} onClick={() => setSize((value) => Math.max(0, value - 1))} />
          <span aria-live="polite" className="min-w-12 text-center text-2xl font-semibold text-foreground">
            {size}
          </span>
          <IconButton
            icon={Plus}
            label="Thêm một chỗ"
            disabled={size >= MAX_GROUP_SIZE}
            onClick={() => setSize((value) => Math.min(MAX_GROUP_SIZE, value + 1))}
          />
        </div>
      </div>
      <div className="flex gap-3">
        <Button label="Huỷ" variant="secondary" disabled={busy} onClick={() => setOpen(false)} />
        <Button label="Tạo nhóm" busy={busy} disabled={name.trim() === ''} onClick={() => void submit()} />
      </div>
    </div>
  );
}
