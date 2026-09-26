/** @type {import('tailwindcss').Config} */
export default {
  // Bật/tắt tối bằng class trên <html>, giống app: có nút chuyển thủ công.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Cùng tên token với app mobile (src/global.css); giá trị nằm trong
      // web/src/app/styles/index.css. Không viết mã màu ở đây.
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: 'hsl(var(--card) / <alpha-value>)',
        'card-foreground': 'hsl(var(--card-foreground) / <alpha-value>)',
        muted: 'hsl(var(--muted) / <alpha-value>)',
        'muted-foreground': 'hsl(var(--muted-foreground) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        primary: 'hsl(var(--primary) / <alpha-value>)',
        'primary-foreground': 'hsl(var(--primary-foreground) / <alpha-value>)',
        accent: 'hsl(var(--accent) / <alpha-value>)',
        'accent-foreground': 'hsl(var(--accent-foreground) / <alpha-value>)',
        'accent-strong': 'hsl(var(--accent-strong) / <alpha-value>)',
        positive: 'hsl(var(--positive) / <alpha-value>)',
        negative: 'hsl(var(--negative) / <alpha-value>)',
        sun: 'hsl(var(--sun) / <alpha-value>)',
        rain: 'hsl(var(--rain) / <alpha-value>)',
        // Chỉ bản web: lớp phủ ảnh bìa và chữ trên ảnh (xem index.css).
        scrim: 'hsl(var(--scrim) / <alpha-value>)',
        'on-image': 'hsl(var(--on-image) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Be Vietnam Pro"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Be Vietnam Pro"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '20px',
        '3xl': '28px',
      },
    },
  },
  plugins: [],
};
