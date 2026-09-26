/**
 * Thu nhỏ + nén ảnh người dùng chọn trong trình duyệt thành JPEG base64 — cùng
 * hình dạng với ImageUpload của tầng dữ liệu dùng chung, để tải lên bằng đúng
 * hàm của mobile. Ảnh điện thoại vài MB tải nguyên thì chậm và vượt giới hạn bucket.
 */

export interface CompressedImage {
  readonly base64: string;
  readonly mimeType: 'image/jpeg';
}

interface CompressOptions {
  /** Cắt vuông ở giữa — ảnh đại diện. Mã QR thì không cắt, kẻo mất góc mã. */
  readonly square: boolean;
  readonly maxWidth: number;
  readonly quality?: number;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không đọc được ảnh vừa chọn. Hãy chọn ảnh JPEG hoặc PNG.'));
    };
    image.src = url;
  });
}

export async function compressImageFile(
  file: File,
  { square, maxWidth, quality = 0.8 }: CompressOptions,
): Promise<CompressedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Tệp vừa chọn không phải ảnh.');
  }
  const image = await loadImage(file);

  let sx = 0;
  let sy = 0;
  let sw = image.naturalWidth;
  let sh = image.naturalHeight;
  if (square) {
    const side = Math.min(sw, sh);
    sx = Math.floor((sw - side) / 2);
    sy = Math.floor((sh - side) / 2);
    sw = side;
    sh = side;
  }

  const scale = sw > maxWidth ? maxWidth / sw : 1;
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Trình duyệt không xử lý được ảnh.');
  context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  if (base64 === '') throw new Error('Không đọc được ảnh vừa chọn.');
  return { base64, mimeType: 'image/jpeg' };
}
