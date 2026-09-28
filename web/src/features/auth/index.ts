// Nạp recovery.ts sớm (qua public API này) để bắt sự kiện PASSWORD_RECOVERY
// và chụp URL gốc trước khi supabase-js xoá ?code khỏi thanh địa chỉ.
import './api/recovery';

export { signOut } from './api/auth-actions';
export { ForgotPasswordForm } from './ui/forgot-password-form';
export { ResetPasswordForm } from './ui/reset-password-form';
export { SetPasswordForm } from './ui/set-password-form';
export { SignInForm } from './ui/sign-in-form';
