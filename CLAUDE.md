# CLAUDE.md - Project Memory & Guidelines

> Tự động nạp quy chuẩn phân quyền và workflow của các AI sub-agents:
> Xem chi tiết tại: @AGENTS.md

## 1. Project Overview & Tech Stack
- **Framework/Core:** React Native / React / TypeScript / Node.js
- **State Management & Data:** TanStack Query / Zustand / Tailwind CSS
- **Package Manager:** npm / yarn / pnpm

## 2. Common Commands
- **Install dependencies:** `npm install`
- **Run local dev:** `npm run dev` (hoặc `npx react-native start`)
- **Build / Lint / Test:**
  - Lint: `npm run lint`
  - Type check: `npx tsc --noEmit`
  - Test: `npm test`

## 3. Code Style & Architecture Constraints
- **Architecture:** Feature-Sliced Design (FSD).
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