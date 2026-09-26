import { Plus } from 'lucide-react';
import type { FormEvent } from 'react';
import { useState } from 'react';

import { addTripMember } from '@/entities/member';
import { describeError } from '@/shared/lib/async';
import { IconButton } from '@/shared/ui';

interface AddMemberRowProps {
  readonly tripId: string;
  readonly groupId: string | null;
  readonly placeholder: string;
  readonly onAdded: () => void;
  readonly onError: (message: string | null) => void;
}

/** Ô thêm người ở cuối mỗi thẻ nhóm. Thêm xong thì xoá trắng ô. */
export function AddMemberRow({ tripId, groupId, placeholder, onAdded, onError }: AddMemberRowProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const canAdd = name.trim() !== '' && !busy;

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (!canAdd) return;
    setBusy(true);
    onError(null);
    try {
      await addTripMember(tripId, name, groupId);
      setName('');
      onAdded();
    } catch (caught) {
      onError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-3 flex items-center gap-2">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoCapitalize="words"
        maxLength={80}
        enterKeyHint="done"
        className="min-h-11 min-w-0 flex-1 rounded-xl border border-input bg-muted px-3 text-base text-foreground placeholder:text-muted-foreground"
      />
      <IconButton icon={Plus} label="Thêm người" variant="primary" disabled={!canAdd} busy={busy} onClick={() => void submit()} />
    </form>
  );
}
