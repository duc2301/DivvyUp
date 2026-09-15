// Ép TypeScript nạp @types/node cho các file *.test.ts.
// Cần khai báo tường minh vì tsconfig.base của Expo đặt
// customConditions: ["react-native"], khiến @types/node không được tự nạp.
// Dùng triple-slash thay vì compilerOptions.types để không tắt cơ chế tự nạp
// của những gói @types khác.
/// <reference types="node" />
