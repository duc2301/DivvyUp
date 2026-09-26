import { useNavigate, useParams } from 'react-router';

import { ExpenseEditor } from '@/features/expense-editor';
import { routes } from '@/shared/config';
import { useGoBack } from '@/shared/lib/router';

/** Tạo (/expenses/new) hoặc sửa (/expenses/:expenseId) khoản chi. */
export function ExpenseFormPage() {
  const { tripId = '', expenseId } = useParams();
  const navigate = useNavigate();
  const tripHref = routes.trip(tripId);
  // Mở thẳng bằng link thì không có màn phía sau — lưu xong về màn chuyến đi.
  const leave = useGoBack(tripHref);

  return (
    <ExpenseEditor
      key={expenseId ?? 'new'}
      tripId={tripId}
      expenseId={expenseId}
      backFallback={tripHref}
      onDone={leave}
      onOpenHistory={() => {
        if (expenseId) void navigate(routes.expenseHistory(tripId, expenseId));
      }}
    />
  );
}
