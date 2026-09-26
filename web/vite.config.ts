import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.join(webRoot, 'src');
/** Mã nguồn của app mobile — nơi chứa lõi tiền và tầng dữ liệu dùng chung. */
const mobileSrc = path.resolve(webRoot, '..', 'src');
/** Thay đúng MỘT file của mobile: client Supabase (bản mobile dùng AsyncStorage + react-native). */
const webSupabaseClient = path.join(webSrc, 'shared', 'api', 'supabase-client.ts');

const toPosix = (value: string): string => value.split(path.sep).join('/');

/**
 * Phân giải `@/` THEO NƠI IMPORT.
 *
 * Web viết `@/shared/...` (trỏ vào web/src). Code mobile dùng chung (lõi tiền,
 * tầng dữ liệu) tự import `@/lib/...` — với file nằm trong ../src thì `@/` phải
 * trỏ về ../src, riêng `@/lib/supabase/client` đổi sang client của web. Một
 * alias tĩnh không làm được việc này vì nó không biết ai đang import.
 *
 * Nhờ vậy web DÙNG LẠI NGUYÊN VĂN code tính tiền và truy vấn của mobile: hai
 * bản không bao giờ ra hai con số khác nhau cho cùng một chuyến.
 */
function divvyupAliases(): Plugin {
  return {
    name: 'divvyup-aliases',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source.startsWith('@core/')) {
        return this.resolve(path.join(mobileSrc, source.slice('@core/'.length)), importer, {
          ...options,
          skipSelf: true,
        });
      }
      if (!source.startsWith('@/')) return null;
      if (source === '@/lib/supabase/client') return webSupabaseClient;

      const fromMobile = importer ? toPosix(importer).startsWith(toPosix(mobileSrc)) : false;
      const rest = source.slice(2);
      if (!fromMobile) {
        const own = await this.resolve(path.join(webSrc, rest), importer, { ...options, skipSelf: true });
        if (own) return own;
      }
      return this.resolve(path.join(mobileSrc, rest), importer, { ...options, skipSelf: true });
    },
  };
}

export default defineConfig({
  plugins: [divvyupAliases(), react()],
  // Cấu hình biên dịch CỐ ĐỊNH thay vì để esbuild tự tìm tsconfig gần nhất: với
  // file dùng chung trong ../src, tsconfig gần nhất là của app mobile, nó
  // `extends: "expo/tsconfig.base"` — trên Vercel chỉ web/ được cài package nên
  // không có `expo`, build gãy. Kiểu vẫn do `npm run typecheck` (tsconfig của web) kiểm.
  esbuild: {
    // PHẢI là chuỗi: Vite chỉ bỏ hẳn bước tìm tsconfig khi tsconfigRaw là chuỗi;
    // dạng object vẫn đi tìm để trộn và vẫn gãy như trên.
    tsconfigRaw: JSON.stringify({
      compilerOptions: {
        jsx: 'react-jsx',
        useDefineForClassFields: true,
        verbatimModuleSyntax: false,
      },
    }),
  },
  resolve: {
    // Code dùng chung nằm ngoài web/ và import thư viện theo tên trần. Không
    // dedupe thì Vite tìm thư viện ở ../node_modules — trên Vercel thư mục đó
    // không được cài (chỉ web/ được cài), và ở máy dev sẽ ra HAI bản React.
    dedupe: ['react', 'react-dom', '@supabase/supabase-js'],
  },
  server: {
    fs: { allow: [webRoot, mobileSrc] },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Thư viện ít đổi tách riêng: mỗi lần deploy trình duyệt chỉ tải lại phần code app.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
