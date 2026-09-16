import type { ComponentProps } from 'react';
import { Text, TextInput, View } from 'react-native';

interface TextFieldProps extends Omit<ComponentProps<typeof TextInput>, 'className'> {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | null;
  readonly big?: boolean;
}

export function TextField({ label, hint, error, big = false, ...inputProps }: TextFieldProps) {
  return (
    <View>
      <Text className="mb-1 text-sm font-medium text-foreground">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        {...inputProps}
        // min-w-0 bắt buộc cho bản web: react-native-web dựng TextInput thành
        // <input>, và min-width:auto mặc định của flex item không cho nó co.
        className={`min-w-0 rounded-xl border border-input bg-muted px-3 text-foreground ${
          big ? 'min-h-14 text-2xl font-semibold' : 'min-h-12 text-base'
        } ${error ? 'border-negative' : ''}`}
      />
      {error ? (
        <Text className="mt-1 text-xs text-negative">{error}</Text>
      ) : hint ? (
        <Text className="mt-1 text-xs text-muted-foreground">{hint}</Text>
      ) : null}
    </View>
  );
}
