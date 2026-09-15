/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // Màu KHÔNG được viết trực tiếp ở đây. Chúng trỏ về CSS variable khai báo
      // trong src/global.css — đó là nguồn chân lý duy nhất (AGENTS.md mục 2).
      // Cách khai báo này cũng là cách react-native-reusables mong đợi, nên
      // component của nó thả vào là chạy, không cần sửa theme.
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        'card-foreground': 'hsl(var(--card-foreground))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        // Ngữ nghĩa riêng của DivvyUp: được nhận lại tiền / đang nợ tiền.
        positive: 'hsl(var(--positive))',
        negative: 'hsl(var(--negative))',
      },
    },
  },
  plugins: [],
};
