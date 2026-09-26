import { createBrowserRouter } from 'react-router';

import { BalancesPage } from '@/pages/balances';
import { ExpenseFormPage } from '@/pages/expense-form';
import { ExpenseHistoryPage } from '@/pages/expense-history';
import { ForgotPasswordPage } from '@/pages/forgot-password';
import { JoinPage } from '@/pages/join';
import { MembersPage } from '@/pages/members';
import { NotFoundPage } from '@/pages/not-found';
import { NotesPage } from '@/pages/notes';
import { PlacePage } from '@/pages/place';
import { ProfilePage } from '@/pages/profile';
import { ResetPasswordPage } from '@/pages/reset-password';
import { SignInPage } from '@/pages/sign-in';
import { TripPage } from '@/pages/trip';
import { TripEditPage } from '@/pages/trip-edit';
import { TripNewPage } from '@/pages/trip-new';
import { TripsPage } from '@/pages/trips';

import { GuestOnly, RequireAuth } from './guards';

/** Đường dẫn khớp routes trong shared/config/routes.ts. */
export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/sign-in', element: <SignInPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  // Không chặn: link đặt lại mật khẩu mở ra với phiên khôi phục tạm.
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <TripsPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/join', element: <JoinPage /> },
      { path: '/trips/new', element: <TripNewPage /> },
      { path: '/trips/:tripId', element: <TripPage /> },
      { path: '/trips/:tripId/edit', element: <TripEditPage /> },
      { path: '/trips/:tripId/place', element: <PlacePage /> },
      { path: '/trips/:tripId/notes', element: <NotesPage /> },
      { path: '/trips/:tripId/members', element: <MembersPage /> },
      { path: '/trips/:tripId/balances', element: <BalancesPage /> },
      { path: '/trips/:tripId/expenses/new', element: <ExpenseFormPage /> },
      { path: '/trips/:tripId/expenses/:expenseId', element: <ExpenseFormPage /> },
      { path: '/trips/:tripId/expenses/:expenseId/history', element: <ExpenseHistoryPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
