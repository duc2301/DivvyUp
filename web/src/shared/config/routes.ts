/**
 * Mọi đường dẫn của app ở một chỗ — không ghép chuỗi đường dẫn rải rác trong
 * component (tương đương typed routes của expo-router).
 */
export const routes = {
  home: () => '/',
  signIn: () => '/sign-in',
  forgotPassword: () => '/forgot-password',
  resetPassword: () => '/reset-password',
  profile: () => '/profile',
  archive: () => '/archive',
  tripNew: () => '/trips/new',
  join: (code?: string) => (code ? `/join?code=${encodeURIComponent(code)}` : '/join'),
  trip: (tripId: string) => `/trips/${encodeURIComponent(tripId)}`,
  tripEdit: (tripId: string) => `/trips/${encodeURIComponent(tripId)}/edit`,
  tripPlace: (tripId: string) => `/trips/${encodeURIComponent(tripId)}/place`,
  tripNotes: (tripId: string) => `/trips/${encodeURIComponent(tripId)}/notes`,
  tripMembers: (tripId: string) => `/trips/${encodeURIComponent(tripId)}/members`,
  expenseNew: (tripId: string) => `/trips/${encodeURIComponent(tripId)}/expenses/new`,
  expenseEdit: (tripId: string, expenseId: string) =>
    `/trips/${encodeURIComponent(tripId)}/expenses/${encodeURIComponent(expenseId)}`,
  expenseHistory: (tripId: string, expenseId: string) =>
    `/trips/${encodeURIComponent(tripId)}/expenses/${encodeURIComponent(expenseId)}/history`,
  balances: (
    tripId: string,
    focus?: { readonly from: string; readonly to: string; readonly mode: 'simplified' | 'direct' },
  ) => {
    const base = `/trips/${encodeURIComponent(tripId)}/balances`;
    if (!focus) return base;
    const query = new URLSearchParams({ from: focus.from, to: focus.to, mode: focus.mode });
    return `${base}?${query.toString()}`;
  },
} as const;

/** Địa chỉ tuyệt đối của một đường dẫn trong app — cho link trong email, link mời. */
export function absoluteUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}
