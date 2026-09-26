import { KeyRound, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';

import { routes } from '@/shared/config';
import { AppHeader, IconButton } from '@/shared/ui';

import { UserMenu } from './user-menu';

/** Header màn "My trips": tham gia bằng mã, tạo chuyến, menu tài khoản — cùng hàng tiêu đề. */
export function HomeHeader() {
  const navigate = useNavigate();
  return (
    <AppHeader
      layout="inline"
      title="My trips"
      subtitle="Mỗi chuyến một sổ chi tiêu riêng"
      right={
        <div className="flex items-center gap-1">
          <IconButton icon={KeyRound} label="Tham gia bằng mã mời" onClick={() => void navigate(routes.join())} />
          <IconButton icon={Plus} label="Tạo chuyến đi" variant="primary" onClick={() => void navigate(routes.tripNew())} />
          <UserMenu />
        </div>
      }
    />
  );
}
