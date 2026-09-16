/** @type {import('tailwindcss').Config} */
module.exports = {
  // PHẢI khớp với cách viết token trong src/global.css (.dark:root).
  // 'class' là bắt buộc vì app có nút bật tắt sáng/tối thủ công: NativeWind chỉ
  // gắn class .dark khi được setColorScheme() gọi tới, và đó là thứ cho phép
  // ghi đè chế độ của hệ thống.
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
        // Ngữ nghĩa riêng của DivvyUp: được nhận lại tiền / đang nợ tiền.
        positive: 'hsl(var(--positive) / <alpha-value>)',
        negative: 'hsl(var(--negative) / <alpha-value>)',
      },
      fontFamily: {
        // Poppins khớp với chữ trong logo "Divvy up". Chỉ dùng cho tiêu đề;
        // thân bài vẫn để font hệ thống vì nó có sẵn đủ dấu tiếng Việt và
        // không tốn thời gian tải.
        display: ['Poppins_600SemiBold'],
      },
      borderRadius: {
        // Bo tròn lớn hơn mặc định để hợp với ngôn ngữ thẻ mềm.
        '2xl': '20px',
        '3xl': '28px',
      },
    },
  },
  plugins: [],
};
