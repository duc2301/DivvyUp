import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { TripCard } from '@/components/trip/trip-card';
import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Archive, ChevronRight, KeyRound, Plus } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/state-views';
import { UserMenu } from '@/components/ui/user-menu';
import { UpdateCard } from '@/features/app-update/update-card';
import { useSessionContext } from '@/features/auth/session-context';
import { loadDismissedReminders, saveDismissedReminders } from '@/features/trip-archive/reminder-store';
import { listArchivedTrips, listTrips, setTripArchived } from '@/lib/data/manager';
import type { TripSummary } from '@/lib/data/trips';
import { describeError, useAsync } from '@/lib/data/use-async';
import { toIsoDate } from '@/lib/datetime';
import {
  dismissReminder,
  endedTrips,
  isTripEnded,
  shouldRemindArchive,
  splitByArchive,
} from '@/lib/trips/archive';

export default function TripListScreen() {
  const router = useRouter();
  const { userId, isGuest, loading: sessionLoading } = useSessionContext();
  // "Để sau" lưu theo tài khoản: hai người dùng chung máy không xoá của nhau.
  // Chờ phiên đọc xong: lúc đầu userId còn null, đoán 'guest' thì đọc/ghi nhầm
  // khoá của khách.
  const reminderScope = sessionLoading ? null : isGuest ? 'guest' : (userId ?? 'guest');

  const { data, error, loading, reload } = useAsync(async () => {
    const [trips, archive, dismissed] = await Promise.all([
      listTrips(),
      // Không tải được danh sách lưu trữ (mạng chập chờn, migration chưa chạy)
      // thì vẫn hiện đủ chuyến đi — kèm dòng báo lỗi, không nuốt im.
      listArchivedTrips().then(
        (archived) => ({ archived, error: null }),
        (caught: unknown) => ({ archived: new Map<string, string>(), error: describeError(caught) }),
      ),
      reminderScope ? loadDismissedReminders(reminderScope) : Promise.resolve(new Set<string>()),
    ]);
    // "Hôm nay" lấy trong lần tải, KHÔNG trong thân render: React Compiler coi
    // new Date() ở render là hằng và có thể giữ nó mãi — app mở qua đêm thì
    // chuyến vừa kết thúc không được nhắc. Mỗi lần focus tải lại là có ngày mới.
    const today = toIsoDate(new Date());
    return { trips, archived: archive.archived, archiveError: archive.error, dismissed, today };
  }, [reminderScope]);

  // Tải lại mỗi khi quay về màn này, để chuyến đi vừa tạo/lưu trữ cập nhật
  // ngay. Bỏ qua lần focus đầu: useAsync đã tự tải lúc mount.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      reload();
    }, [reload]),
  );

  // Id đã "Để sau" trong phiên này — gộp với bản đã lưu, để banner tắt ngay cả
  // khi lưu xuống máy lỗi, mà vẫn hiện lại khi có chuyến MỚI kết thúc.
  const [dismissedNow, setDismissedNow] = useState<ReadonlySet<string>>(new Set());
  let view = null;
  if (data) {
    const { active, archived } = splitByArchive(data.trips, data.archived);
    const ended = endedTrips(active, data.today);
    const dismissed = new Set([...data.dismissed, ...dismissedNow]);
    view = {
      active,
      archivedCount: archived.length,
      ended,
      dismissed,
      remind: shouldRemindArchive(ended, dismissed),
    };
  }

  const dismiss = async () => {
    if (!data || !view || !reminderScope) return;
    const next = dismissReminder(view.dismissed, view.ended, new Set(data.trips.map((trip) => trip.id)));
    setDismissedNow(new Set(next));
    try {
      await saveDismissedReminders(reminderScope, next);
    } catch {
      // Không lưu được thì lần mở app sau banner hiện lại — chấp nhận được,
      // không cần làm phiền người dùng bằng thông báo lỗi.
    }
  };

  // Chuyến đang hỏi lưu trữ. Tách `dialogOpen` khỏi `pending` để tên chuyến
  // còn nguyên trong lúc hộp thoại mờ dần khi đóng.
  const [pending, setPending] = useState<TripSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const askArchive = (trip: TripSummary) => {
    setActionError(null);
    setPending(trip);
    setDialogOpen(true);
  };
  const archivePending = async () => {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      await setTripArchived(pending.id, true);
      setDialogOpen(false);
      reload();
    } catch (caught) {
      setActionError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const trips = data?.trips ?? null;

  return (
    <>
      <Screen
        header={
          <AppHeader
            layout="inline"
            title="My trips"
            subtitle="Mỗi chuyến một sổ chi tiêu riêng"
            right={
              // Nằm cùng hàng tiêu đề thay vì cuối danh sách: có nhiều chuyến
              // đi thì nút ở cuối bị đẩy khuất, phải cuộn hết mới tạo được.
              <View className="flex-row items-center gap-1">
                <IconButton
                  icon={KeyRound}
                  label="Tham gia bằng mã mời"
                  onPress={() => router.push('/join')}
                />
                <IconButton
                  icon={Plus}
                  label="Tạo chuyến đi"
                  variant="primary"
                  onPress={() => router.push('/trip-new')}
                />
                <UserMenu />
              </View>
            }
          />
        }>
        <UpdateCard />

        {loading && data === null ? <LoadingView /> : null}
        {error ? <ErrorView message={error} onRetry={reload} /> : null}

        {trips !== null && trips.length === 0 && !error ? (
          <EmptyView
            title="Chưa có chuyến đi nào"
            hint="Bấm ＋ để tạo chuyến đầu tiên, hoặc 🔑 để tham gia chuyến của bạn bè bằng mã mời."
            actionLabel="Tạo chuyến đi"
            onAction={() => router.push('/trip-new')}
          />
        ) : null}

        {view && trips && trips.length > 0 && view.active.length === 0 ? (
          <EmptyView
            title="Mọi chuyến đi đã lưu trữ"
            hint="Mở mục Lưu trữ bên dưới để xem lại, hoặc bấm ＋ để tạo chuyến mới."
          />
        ) : null}

        {view?.remind ? (
          <View className="gap-3 rounded-3xl border border-border bg-card p-5 shadow-sm">
            <View className="flex-row items-center gap-3">
              <Archive size={20} className="text-accent-strong" />
              <Text className="min-w-0 flex-1 text-base font-semibold text-foreground">
                {view.ended.length} chuyến đã kết thúc
              </Text>
            </View>
            <Text className="text-sm leading-5 text-muted-foreground">
              Lưu trữ để danh sách gọn hơn. Chỉ ẩn khỏi danh sách của bạn — người khác vẫn thấy
              bình thường, và bạn xem lại được trong mục Lưu trữ.
            </Text>
            <View className="flex-row gap-3">
              <View className="min-w-0 flex-1">
                <Button label="Để sau" variant="secondary" onPress={() => void dismiss()} />
              </View>
              <View className="min-w-0 flex-1">
                <Button label="Xem & lưu trữ" onPress={() => router.push('/archive')} />
              </View>
            </View>
          </View>
        ) : null}

        {view?.active.map((trip) => (
          <TripCard
            key={trip.id}
            trip={trip}
            ended={isTripEnded(trip, data?.today ?? '')}
            onPress={() =>
              router.push({ pathname: '/trip/[tripId]/overview', params: { tripId: trip.id } })
            }
            onLongPress={() => askArchive(trip)}
          />
        ))}

        {data?.archiveError ? (
          <Text className="text-center text-xs text-negative">
            Không tải được mục Lưu trữ: {data.archiveError}
          </Text>
        ) : null}

        {/* Cùng điều kiện với web: còn chuyến đã kết thúc (kể cả khi đã "Để
            sau") thì vẫn có lối vào màn lưu trữ hàng loạt. */}
        {view && (view.archivedCount > 0 || view.ended.length > 0) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Mở mục Lưu trữ, ${view.archivedCount} chuyến đã lưu trữ${
              view.ended.length > 0 ? `, ${view.ended.length} chuyến đã kết thúc gợi ý lưu trữ` : ''
            }`}
            onPress={() => router.push('/archive')}
            className="min-h-14 flex-row items-center gap-3 rounded-3xl border border-border bg-card px-5 py-4 active:bg-muted">
            <Archive size={20} className="text-muted-foreground" />
            <Text className="min-w-0 flex-1 text-base text-foreground">Lưu trữ</Text>
            <Text className="text-sm text-muted-foreground">{view.archivedCount}</Text>
            <ChevronRight size={18} className="text-muted-foreground" />
          </Pressable>
        ) : null}
      </Screen>

      <ConfirmDialog
        visible={dialogOpen}
        title="Lưu trữ chuyến đi?"
        message={
          actionError ??
          `"${pending?.name ?? ''}" sẽ chuyển vào mục Lưu trữ của bạn. Người khác trong chuyến vẫn thấy bình thường; bạn bỏ lưu trữ lúc nào cũng được.`
        }
        confirmLabel="Lưu trữ"
        busy={busy}
        onConfirm={() => void archivePending()}
        onCancel={() => setDialogOpen(false)}
      />
    </>
  );
}
