import { assets } from '../config';
import { useTheme } from '../lib/theme';

const LOCKUP_RATIO = 163 / 440;

/** Logo chữ "Divvy up" kèm tagline — cùng file ảnh với app mobile. */
export function BrandLockup({ width = 240 }: { readonly width?: number }) {
  const { effective } = useTheme();
  return (
    <img
      src={effective === 'dark' ? assets.brandLockupDark : assets.brandLockupLight}
      alt="Divvy up"
      width={width}
      height={Math.round(width * LOCKUP_RATIO)}
      style={{ width, height: Math.round(width * LOCKUP_RATIO) }}
      className="object-contain"
    />
  );
}
