/** Vòng quay nhỏ, lấy màu theo chữ xung quanh (currentColor). */
export function Spinner({ size = 18 }: { readonly size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
