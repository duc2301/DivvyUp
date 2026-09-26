/**
 * Hồ sơ: tên hiển thị, ảnh đại diện, mã QR nhận tiền — dùng chung với mobile.
 * Ảnh tải lên dạng ImageUpload { base64, mimeType }: web nén bằng canvas
 * (shared/lib/image) rồi gọi đúng uploadAvatar/uploadPaymentQr của mobile.
 */
export type { ImageUpload, MyProfile, PaymentInfo } from '@core/lib/data/profile';
export {
  getMyProfile,
  getPaymentInfo,
  removePaymentQr,
  signedPaymentQrUrl,
  updateMyProfile,
  uploadAvatar,
  uploadPaymentQr,
} from '@core/lib/data/profile';
