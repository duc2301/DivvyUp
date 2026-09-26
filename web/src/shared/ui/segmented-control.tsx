export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface SegmentedControlProps<T extends string> {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly ariaLabel: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex rounded-xl bg-muted p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={`min-h-11 min-w-0 flex-1 truncate rounded-lg px-2 text-sm transition ${
              selected
                ? 'bg-card font-semibold text-foreground shadow-sm'
                : 'text-muted-foreground'
            }`}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
