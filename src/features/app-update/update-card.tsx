import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { RefreshCw } from '@/components/ui/icons';

import { useAppUpdate } from './use-app-update';

/**
 * Thẻ báo cập nhật — chỉ đặt ở màn danh sách chuyến: ở đó không có form đang
 * nhập, nên "Khởi động lại" không làm mất gì; và thẻ nằm trong luồng cuộn, không
 * đè lên nội dung như thẻ nổi. Một thẻ một lúc: cần APK mới thì OTA vốn không
 * tới được, nên báo APK trước.
 */
export function UpdateCard() {
  const { otaReady, restart, nativeUpdate, openApk, snoozeNative, openError } = useAppUpdate();
  // "Để sau" của OTA chỉ trong phiên này: lần mở sau bản mới tự áp dụng rồi.
  const [otaLater, setOtaLater] = useState(false);

  let content: {
    readonly title: string;
    readonly hint: string;
    readonly action: string;
    readonly onAction: () => void;
    readonly onLater: () => void;
  } | null = null;
  if (nativeUpdate.kind === 'apk') {
    content = {
      title: `Có phiên bản ${nativeUpdate.tag} cần cài lại app`,
      hint:
        'Bản này đổi phần lõi của app nên không tự cập nhật được. Tải APK rồi cài đè lên app hiện tại. ' +
        'Nếu Android báo không cài được, ĐỪNG gỡ app (sẽ mất dữ liệu chế độ khách) — hãy báo nhóm phát triển.',
      action: 'Tải APK',
      onAction: openApk,
      onLater: snoozeNative,
    };
  } else if (otaReady && !otaLater) {
    content = {
      title: 'Đã có bản cập nhật mới',
      hint: 'Khởi động lại app để dùng ngay. Để sau thì bản mới tự áp dụng ở lần mở tới.',
      action: 'Khởi động lại',
      onAction: restart,
      onLater: () => setOtaLater(true),
    };
  }
  if (!content) return null;

  return (
    <View
      accessibilityRole="alert"
      className="gap-3 rounded-3xl border border-border bg-card p-5 shadow-sm">
      <View className="flex-row items-center gap-3">
        <RefreshCw size={20} className="text-accent-strong" />
        <Text className="min-w-0 flex-1 text-base font-semibold text-foreground">{content.title}</Text>
      </View>
      <Text className="text-sm leading-5 text-muted-foreground">{content.hint}</Text>
      {nativeUpdate.kind === 'apk' && openError ? (
        <Text selectable className="text-xs leading-5 text-negative">
          {openError}
        </Text>
      ) : null}
      <View className="flex-row gap-3">
        <View className="min-w-0 flex-1">
          <Button label="Để sau" variant="secondary" onPress={content.onLater} />
        </View>
        <View className="min-w-0 flex-1">
          <Button label={content.action} onPress={content.onAction} />
        </View>
      </View>
    </View>
  );
}
