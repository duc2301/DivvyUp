/**
 * Bộ icon dùng trong app — MỌI icon phải lấy từ file này.
 *
 * Icon của lucide nhận màu qua prop `color` (một chuỗi màu JS), không đọc được
 * CSS variable trong global.css. Truyền mã màu thẳng vào thì thành nguồn chân lý
 * thứ hai cho màu — đúng thứ AGENTS.md mục 2 cấm, và icon sẽ không đổi theo chế
 * độ tối.
 *
 * cssInterop của NativeWind gỡ chuyện đó: nó chuyển `className="text-foreground"`
 * thành prop `color`. Nhờ vậy icon dùng cùng bảng token với chữ và tự đổi màu
 * khi bật tắt chế độ tối. Đây cũng là cách react-native-reusables làm.
 *
 * cssInterop phải gọi ĐÚNG MỘT LẦN cho mỗi component, ở tầng module — lý do gom
 * hết vào một file thay vì gọi rải rác ở từng màn hình.
 */

import type { LucideIcon } from 'lucide-react-native';
import {
  Check,
  ChevronLeft,
  CircleUserRound,
  KeyRound,
  LogIn,
  LogOut,
  Moon,
  Plus,
  Square,
  SquareCheck,
  Sun,
  Trash2,
  UserRound,
  X,
} from 'lucide-react-native';
import { cssInterop } from 'nativewind';

function withClassName(icon: LucideIcon): void {
  cssInterop(icon, {
    className: {
      target: 'style',
      nativeStyleToProp: { color: true, opacity: true },
    },
  });
}

[
  Check,
  ChevronLeft,
  CircleUserRound,
  KeyRound,
  LogIn,
  LogOut,
  Moon,
  Plus,
  Square,
  SquareCheck,
  Sun,
  Trash2,
  UserRound,
  X,
].forEach(withClassName);

export {
  Check,
  ChevronLeft,
  CircleUserRound,
  KeyRound,
  LogIn,
  LogOut,
  Moon,
  Plus,
  Square,
  SquareCheck,
  Sun,
  Trash2,
  UserRound,
  X,
};
export type { LucideIcon };
