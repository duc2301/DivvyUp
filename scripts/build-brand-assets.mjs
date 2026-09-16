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

const TEAL = '#0D9488';
const MINT = '#2DD4BF';
const CORAL = '#F43F5E';

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


/**
 * Ảnh phong cảnh mặc định cho chuyến đi chưa chọn địa điểm.
 *
 * Tự dựng bằng vector thay vì tải ảnh từ kho ngoài: không phụ thuộc khoá API,
 * không vướng giấy phép của ai, và nặng vài chục KB thay vì vài trăm.
 * Giao diện phủ một lớp đen mờ lên trên nên chi tiết không cần thật sắc.
 *
 * Muốn thay bằng ảnh chụp thật: ghi đè assets/images/trip-placeholder.png là xong,
 * không phải sửa code.
 */
function placeholderSceneSvg(width, height) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1200 800">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${MINT}"/>
          <stop offset="0.55" stop-color="#A7F3E4"/>
          <stop offset="1" stop-color="#F0FDFA"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="800" fill="url(#sky)"/>
      <circle cx="900" cy="205" r="88" fill="${CORAL}" opacity="0.5"/>
      <path d="M0 520 L180 400 L320 492 L470 360 L640 500 L820 392 L1000 500 L1200 420 L1200 800 L0 800 Z"
            fill="${TEAL}" opacity="0.32"/>
      <path d="M0 602 L220 470 L400 582 L580 458 L760 592 L980 478 L1200 580 L1200 800 L0 800 Z"
            fill="${TEAL}" opacity="0.58"/>
      <path d="M0 690 L260 578 L520 702 L760 598 L1000 700 L1200 638 L1200 800 L0 800 Z"
            fill="${TEAL}"/>
    </svg>`,
  );
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

  // Ảnh nền cho chuyến đi chưa chọn địa điểm.
  // Xuất JPEG chứ không PNG: đây là ảnh kiểu chuyển sắc, JPEG nhỏ hơn PNG
  // khoảng năm lần mà mắt không phân biệt được — nhất là khi bị phủ lớp đen mờ.
  {
    file: 'trip-placeholder.jpg',
    make: () =>
      sharp(placeholderSceneSvg(1200, 800), { density: 200 })
        .resize(1200, 800, { fit: 'cover' })
        .jpeg({ quality: 82, mozjpeg: true })
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
