import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { ImageUpload } from '@/lib/data/profile';

interface PickOptions {
  /** Cắt vuông khi chọn — dùng cho ảnh đại diện. Mã QR thì không cắt, kẻo mất góc mã. */
  readonly square: boolean;
  /** Chiều rộng tối đa sau khi nén. */
  readonly maxWidth: number;
}

/**
 * Chọn ảnh từ thư viện rồi thu nhỏ + nén thành JPEG.
 *
 * Ảnh điện thoại 12MP nặng vài MB: tải nguyên lên thì chậm, tốn dung lượng của
 * người dùng, và vượt giới hạn kích thước của bucket. Ảnh đại diện 512px hay mã
 * QR 1080px là quá đủ để hiển thị và quét.
 *
 * Trả null nếu người dùng huỷ.
 */
export async function pickAndCompressImage({ square, maxWidth }: PickOptions): Promise<ImageUpload | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: square,
    aspect: square ? [1, 1] : undefined,
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const context = ImageManipulator.manipulate(asset.uri);
  if (asset.width > maxWidth) {
    context.resize({ width: maxWidth });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG, base64: true });

  if (!saved.base64) {
    throw new Error('Không đọc được ảnh vừa chọn.');
  }
  return { base64: saved.base64, mimeType: 'image/jpeg' };
}
