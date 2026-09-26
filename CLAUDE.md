# CLAUDE.md - Project Memory & Guidelines

> Tự động nạp quy chuẩn phân quyền và workflow của các AI sub-agents:
> Xem chi tiết tại: @AGENTS.md

## 1. Project Overview & Tech Stack
- **App mobile (gốc):** Expo (React Native) + TypeScript + Supabase (Postgres/RLS/Auth). Không có backend riêng — xem `AGENTS.md` §1, §4.
- **Web (`web/`):** React + Vite + react-router, Feature-Sliced Design, dùng lại lõi tiền/dữ liệu của mobile qua alias `@core`.
- **Data:** Không dùng TanStack Query/Zustand. Truy cập dữ liệu qua `src/lib/data/manager.ts` (tự chọn Supabase hoặc lưu máy khi ở chế độ khách) và hook `use-async` (`src/lib/data/use-async.ts`).
- **Styling:** NativeWind (Tailwind) trên mobile; Tailwind thuần trên web.

## 2. Common Commands
Mobile (thư mục gốc): `npm run start` (dev server), `npm run android` / `ios` / `web`, `npm run lint`, `npm run typecheck`, `npm test`.
Web (`cd web`): `npm run dev`, `npm run build`, `npm run typecheck`.
Chi tiết đầy đủ ở `AGENTS.md` §6 và `docs/DEVELOPMENT.md`.

## 3. Code Style & Architecture Constraints
- **Architecture:** Mobile không theo FSD. Feature-Sliced Design chỉ áp dụng cho `web/` (`app → pages → widgets → features → entities → shared`).
- **Components:** Functional components với TypeScript typing rõ ràng; không dùng `any`.
- **Naming Conventions:**
  - PascalCase cho Components và Interfaces (`UserCard.tsx`, `IUserProfile.ts`).
  - camelCase cho functions, hooks, variables (`useAuth.ts`, `handleSubmit`).
  - UPPER_SNAKE_CASE cho constants.
- **Styling:** Ưu tiên utility classes / stylesheet module, tránh inline styles bừa bãi.

## 4. Agent Rules & Vibe Coding Workflow
- Luôn kiểm tra type-safety trước khi hoàn tất phản hồi.
- Không tự ý xóa comments giải thích logic phức tạp.
- Khi refactor, giữ nguyên contract của API và Props hiện hành.
- Tuân thủ nghiêm ngặt vai trò được định nghĩa trong `@AGENTS.md`.
