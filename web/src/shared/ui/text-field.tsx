import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | null;
  /** Ô số tiền cỡ lớn. */
  readonly big?: boolean;
}

export function TextField({ label, hint, error, big = false, id, ...inputProps }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error || hint ? `${inputId}-desc` : undefined;
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
        className={`w-full min-w-0 rounded-xl border bg-muted px-3 text-foreground placeholder:text-muted-foreground ${
          big ? 'min-h-14 text-2xl font-semibold' : 'min-h-12 text-base'
        } ${error ? 'border-negative' : 'border-input'}`}
      />
      {error ? (
        <p id={describedBy} className="mt-1 text-xs text-negative">
          {error}
        </p>
      ) : hint ? (
        <p id={describedBy} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  readonly label: string;
  readonly hint?: string;
}

export function TextArea({ label, hint, id, ...areaProps }: TextAreaProps) {
  const autoId = useId();
  const areaId = id ?? autoId;
  return (
    <div>
      <label htmlFor={areaId} className="mb-1 block text-sm font-medium text-foreground">
        {label}
      </label>
      <textarea
        id={areaId}
        {...areaProps}
        className="min-h-64 w-full min-w-0 rounded-xl border border-input bg-muted p-3 text-base leading-6 text-foreground placeholder:text-muted-foreground"
      />
      {hint ? <p className="mt-1 text-right text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
