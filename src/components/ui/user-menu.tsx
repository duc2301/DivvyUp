import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signOut } from '@/features/auth/auth-actions';
import { useSessionContext } from '@/features/auth/session-context';
import { useTheme } from '@/features/theme/theme-context';
import { getMyProfile } from '@/lib/data/profile';
import { useAsync } from '@/lib/data/use-async';

import { Avatar } from './avatar';
import { IconButton } from './icon-button';
import type { LucideIcon } from './icons';
import { CircleUserRound, LogIn, LogOut, Moon, Sun, UserRound } from './icons';

interface MenuItemProps {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly detail?: string;
  readonly onPress?: () => void;
  readonly tone?: 'default' | 'danger';
  readonly disabled?: boolean;
  readonly busy?: boolean;
}

function MenuItem({
  icon: Icon,
  label,
  detail,
  onPress,
  tone = 'default',
  disabled = false,
  busy = false,
}: MenuItemProps) {
  const color = tone === 'danger' ? 'text-negative' : 'text-foreground';
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      className={`min-h-12 flex-row items-center gap-3 rounded-xl px-3 active:bg-muted ${
        disabled ? 'opacity-50' : ''
      }`}>
      {busy ? <ActivityIndicator size="small" /> : <Icon size={20} className={color} />}
      <Text className={`min-w-0 flex-1 text-base ${color}`}>{label}</Text>
      {detail ? (
        <Text className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Nút tài khoản ở góc phải header, bấm vào mở menu thả xuống.
 *
 * Gom Hồ sơ, sáng/tối và Đăng xuất vào một chỗ thay vì rải thành nhiều nút trên
 * header — header màn chính còn phải chứa nút tạo chuyến và tham gia bằng mã.
 */
export function UserMenu() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, isGuest, setGuestMode } = useSessionContext();
  const userId = session?.user.id ?? null;

  // Lấy ảnh đại diện để hiện trên header. Tải lại mỗi lần mở menu, vì người
  // dùng vừa đổi ảnh ở màn Hồ sơ rồi quay về thì ảnh cũ vẫn còn trong state.
  const profile = useAsync(async () => (userId ? getMyProfile() : null), [userId]);
  const { effective, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const user = session?.user ?? null;
  const metadataName: unknown = user?.user_metadata?.display_name;
  const displayName =
    profile.data?.displayName ??
    (typeof metadataName === 'string' && metadataName.trim() !== ''
      ? metadataName
      : isGuest
        ? 'Khách'
        : 'Tài khoản');
  const avatarUrl = profile.data?.avatarUrl ?? null;
  const subtitle = isGuest ? 'Dữ liệu chỉ lưu trên máy này' : (user?.email ?? '');

  const close = (): void => {
    if (!signingOut) setOpen(false);
  };

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // Cả đăng xuất cục bộ cũng lỗi (kho lưu trữ hỏng): không có gì để làm
      // thêm; AuthGate vẫn giữ nguyên nếu phiên còn. Nuốt lỗi để không có
      // promise bị reject mà không ai bắt.
    } finally {
      setSigningOut(false);
      // Không cần điều hướng: AuthGate thấy phiên mất sẽ tự đưa về màn đăng nhập.
      setOpen(false);
    }
  };

  return (
    <>
      {avatarUrl ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tài khoản"
          onPress={() => {
            profile.reload();
            setOpen(true);
          }}
          className="h-11 w-11 items-center justify-center rounded-full active:opacity-60">
          <Avatar name={displayName} uri={avatarUrl} size="sm" />
        </Pressable>
      ) : (
        <IconButton
          icon={CircleUserRound}
          label="Tài khoản"
          onPress={() => {
            if (userId) profile.reload();
            setOpen(true);
          }}
        />
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Đóng menu tài khoản"
          onPress={close}
          className="absolute inset-0 bg-black/30"
        />
        <View
          accessibilityRole="menu"
          style={{ top: insets.top + 60 }}
          className="absolute right-4 w-72 max-w-[90%] gap-1 rounded-2xl border border-border bg-card p-2 shadow-lg">
          <View className="flex-row items-center gap-3 px-3 pb-2 pt-2">
            {isGuest ? (
              <View className="h-10 w-10 items-center justify-center rounded-full bg-accent">
                <UserRound size={20} className="text-accent-foreground" />
              </View>
            ) : (
              <Avatar name={displayName} uri={avatarUrl} size="md" />
            )}
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-base font-semibold text-foreground">
                {displayName}
              </Text>
              {subtitle !== '' ? (
                <Text numberOfLines={1} className="text-xs text-muted-foreground">
                  {subtitle}
                </Text>
              ) : null}
            </View>
          </View>

          <View className="mx-3 mb-1 h-px bg-border" />

          <MenuItem
            icon={UserRound}
            label="Hồ sơ"
            detail={isGuest ? 'Cần đăng nhập' : undefined}
            disabled={isGuest}
            onPress={() => {
              setOpen(false);
              router.push('/profile');
            }}
          />
          <MenuItem
            icon={effective === 'light' ? Moon : Sun}
            label={effective === 'light' ? 'Chế độ tối' : 'Chế độ sáng'}
            onPress={toggle}
          />

          <View className="mx-3 my-1 h-px bg-border" />

          {isGuest ? (
            <MenuItem
              icon={LogIn}
              label="Đăng nhập để đồng bộ"
              onPress={() => {
                setOpen(false);
                void setGuestMode(false);
              }}
            />
          ) : (
            <MenuItem
              icon={LogOut}
              label="Đăng xuất"
              tone="danger"
              busy={signingOut}
              onPress={() => void handleSignOut()}
            />
          )}
        </View>
      </Modal>
    </>
  );
}
