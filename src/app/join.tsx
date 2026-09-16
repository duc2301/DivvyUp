import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { SectionCard } from '@/components/ui/section-card';
import { ErrorView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import type { TripPreview } from '@/lib/data/trips';
import { joinTripByCode, previewTripByCode } from '@/lib/data/manager';
import { describeError } from '@/lib/data/use-async';

export default function JoinTripScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<TripPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookUp = async (): Promise<void> => {
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
      const tripId = await joinTripByCode(code, memberId);
      router.replace({ pathname: '/trip/[tripId]/overview', params: { tripId } });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Screen header={<AppHeader title="Tham gia" subtitle="Nhập mã người tổ chức gửi" showBack />}>
        <TextField
          label="Mã tham gia"
          value={code}
          onChangeText={(text) => setCode(text.toUpperCase())}
          placeholder="8 ký tự"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
          hint="Người tổ chức lấy mã này ở màn hình chuyến đi."
        />

        <Button
          label="Tìm chuyến đi"
          onPress={() => void lookUp()}
          disabled={code.trim().length < 4}
          busy={busy && preview === null}
        />

        {error ? <ErrorView message={error} /> : null}

        {preview ? (
          <SectionCard
            title={preview.tripName}
            hint="Chọn tên của bạn trong danh sách. Mỗi người chỉ nhận được một chỗ.">
            {preview.slots.map((slot) => (
              <Pressable
                key={slot.memberId}
                accessibilityRole="button"
                accessibilityLabel={`Nhận chỗ của ${slot.memberName}`}
                accessibilityState={{ disabled: slot.claimed || busy }}
                disabled={slot.claimed || busy}
                onPress={() => void claim(slot.memberId)}
                className={`min-h-14 flex-row items-center justify-between py-2 active:bg-muted rounded-2xl px-2 ${
                  slot.claimed ? 'opacity-40' : ''
                }`}>
                <Text className="min-w-0 flex-1 text-base text-foreground">{slot.memberName}</Text>
                <Text className="pl-3 text-xs text-muted-foreground">
                  {slot.claimed ? 'đã có người' : 'chọn'}
                </Text>
              </Pressable>
            ))}
            <View className="pt-3">
              <Text className="text-xs text-muted-foreground">
                Không thấy tên mình? Nhờ người tổ chức thêm bạn vào danh sách thành viên trước.
              </Text>
            </View>
          </SectionCard>
        ) : null}
      </Screen>
    </>
  );
}
