import { getMyProfile } from '@/entities/profile';
import { ProfileEditor } from '@/features/edit-profile';
import { useAsync } from '@/shared/lib/async';
import { AppHeader, ErrorView, LoadingView, Screen } from '@/shared/ui';

export function ProfilePage() {
  const profile = useAsync(() => getMyProfile(), []);
  return (
    <Screen header={<AppHeader title="Hồ sơ" showBack />}>
      {profile.loading && profile.data === null ? <LoadingView /> : null}
      {profile.error ? <ErrorView message={profile.error} onRetry={profile.reload} /> : null}
      {/* key: form nhận dữ liệu đúng một lần; tải lại không ghi đè chữ đang gõ. */}
      {profile.data ? <ProfileEditor key={profile.data.id} profile={profile.data} /> : null}
    </Screen>
  );
}
