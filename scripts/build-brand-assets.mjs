/**
 * Sinh asset icon/splash/logo từ file SVG GỐC trong assets/brand/.
 *
 * Chạy lại sau mỗi lần thay logo: node scripts/build-brand-assets.mjs
 *
 * Nguồn chân lý là assets/brand/mark.svg và assets/brand/lockup.svg — do bạn
 * cung cấp. Vì là vector nên mọi kích thước đều nét, kể cả icon 1024.
 * Script chỉ chừa lề theo chuẩn từng nền tảng và đổi màu chữ cho bản nền tối.
 * Nó KHÔNG vẽ lại logo.
 */

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const BRAND = path.join(process.cwd(), 'assets', 'brand');
const OUT = path.join(process.cwd(), 'assets', 'images');

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// Màu chữ trong file lockup gốc, thay khi dựng bản cho nền tối.
const INK = '#0F172A';
const TAGLINE = '#475569';
const INK_ON_DARK = '#F8FAFC';
const TAGLINE_ON_DARK = '#94A3B8';

const markSvg = await readFile(path.join(BRAND, 'mark.svg'), 'utf8');
const lockupSvg = await readFile(path.join(BRAND, 'lockup.svg'), 'utf8');

/** Bỏ ô nền trắng bệt của file lockup để dùng được trên nền bất kỳ. */
function withoutWhiteBackground(svg) {
  return svg.replace(/<rect\s+width="440"\s+height="163"\s+fill="white"\s*\/>\s*/i, '');
}

/** Đổi chữ sang tông sáng cho nền tối. Hình tròn giữ nguyên màu thương hiệu. */
function inverted(svg) {
  return withoutWhiteBackground(svg)
    .split(`fill="${INK}"`)
    .join(`fill="${INK_ON_DARK}"`)
    .split(`fill="${TAGLINE}"`)
    .join(`fill="${TAGLINE_ON_DARK}"`);
}

/**
 * Đặt logo vào giữa khung vuông, chừa lề theo tỉ lệ cho trước.
 *
 * @param {number} size cạnh ảnh ra
 * @param {number} coverage phần khung mà logo chiếm (0.62 = rộng 62% khung)
 * @param {object} background nền của khung
 */
async function framedMark(size, coverage, background) {
  const inner = Math.round(size * coverage);

  // density cao để librsvg dựng vector ở độ phân giải lớn rồi mới thu nhỏ —
  // cho viền mượt hơn là dựng thẳng ở kích thước đích.
  const logo = await sharp(Buffer.from(markSvg), { density: 600 })
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .toBuffer();

  const meta = await sharp(logo).metadata();

  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([
      {
        input: logo,
        left: Math.round((size - meta.width) / 2),
        top: Math.round((size - meta.height) / 2),
      },
    ])
    .png()
    .toBuffer();
}

/** Logo ngang, nền trong suốt, xuất ở 3x để hiển thị nét trên màn hình mật độ cao. */
async function lockup(svg, width) {
  return sharp(Buffer.from(svg), { density: 600 })
    .resize(width, Math.round((width * 163) / 440), {
      fit: 'contain',
      background: TRANSPARENT,
    })
    .png()
    .toBuffer();
}


const targets = [
  // Icon trên màn hình chính: nền trắng, logo chừa lề vừa phải.
  { file: 'icon.png', make: () => framedMark(1024, 0.62, WHITE) },

  // Android adaptive icon: hệ điều hành cắt theo hình dạng riêng của từng máy
  // (tròn, vuông bo, giọt nước). Chỉ khoảng 66% ở giữa là chắc chắn không bị
  // cắt, nên logo phải nhỏ hơn hẳn so với icon thường.
  { file: 'android-icon-foreground.png', make: () => framedMark(1024, 0.44, TRANSPARENT) },
  {
    file: 'android-icon-background.png',
    make: () =>
      sharp({ create: { width: 1024, height: 1024, channels: 4, background: WHITE } })
        .png()
        .toBuffer(),
  },

  // Splash: Expo tự căn giữa trên nền khai trong app.json.
  { file: 'splash-icon.png', make: () => framedMark(512, 1, TRANSPARENT) },

  { file: 'favicon.png', make: () => framedMark(64, 0.92, WHITE) },

  // Ảnh nền cho chuyến đi chưa chọn địa điểm: ảnh chụp thật trong
  // assets/brand/trip-placeholder.jpg. Đổi ảnh thì thay file nguồn đó rồi chạy
  // lại script — đừng sửa thẳng bản trong assets/images, lần chạy sau sẽ ghi đè.
  // Thu về 1080px và nén lại: ảnh chỉ làm nền dưới lớp phủ tối, không cần nét hơn.
  {
    file: 'trip-placeholder.jpg',
    make: () =>
      sharp(path.join(BRAND, 'trip-placeholder.jpg'))
        .resize(1080, 720, { fit: 'cover' })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer(),
  },

  // Logo dùng trong app. Hai bản cho hai chế độ màu, cùng một nguồn vector.
  { file: 'brand-mark.png', make: () => framedMark(240, 1, TRANSPARENT) },
  { file: 'brand-lockup-light.png', make: () => lockup(withoutWhiteBackground(lockupSvg), 1320) },
  { file: 'brand-lockup-dark.png', make: () => lockup(inverted(lockupSvg), 1320) },
];

await mkdir(OUT, { recursive: true });

for (const target of targets) {
  const buffer = await target.make();
  const out = path.join(OUT, target.file);
  await sharp(buffer).toFile(out);
  const meta = await sharp(out).metadata();
  console.log(`${target.file.padEnd(32)} ${meta.width}x${meta.height}`);
}
