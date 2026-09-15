# DivvyUp — Hiến pháp repo

App mobile chia hoá đơn và chi tiêu nhóm (kiểu Splitwise). **Không có backend riêng**: toàn bộ logic nghiệp vụ chạy trong app, dữ liệu lưu trên Supabase.

Hệ quả quan trọng nhất của kiến trúc này: **RLS của Supabase là ranh giới bảo mật duy nhất**. Không có tầng server nào chặn giúp. Mọi thứ client gửi lên đều phải coi là không đáng tin.

---

## 1. Stack

| Phần | Công nghệ | Trạng thái |
|---|---|---|
| Runtime | Expo SDK 57, React Native 0.86, React 19.2 | đã cài |
| Ngôn ngữ | TypeScript 6 (strict) | đã cài |
| Routing | expo-router, typed routes bật | đã cài |
| Compiler | React Compiler bật (`experiments.reactCompiler`) | đã cài |
| Animation | react-native-reanimated 4 + worklets | đã cài |
| Data | Supabase (Postgres + RLS + Auth) | đã cài, đã nối client |
| Styling | NativeWind (Tailwind) | đã cài, đã cấu hình |
| UI primitives | react-native-reusables (founded-labs) | **chưa cài** |
| UI phức tạp | UI Kitten (akveo) + Eva Design | cài package, **chưa nối `ApplicationProvider`** |

> **Chưa import `@ui-kitten/*`** cho tới khi `ApplicationProvider` được nối kèm cầu nối theme đọc lại từ CSS variable trong `src/global.css`. **Chưa dùng component của react-native-reusables** cho tới khi copy chúng vào repo.

Nguồn chân lý của schema là `supabase/migrations/`. Đổi schema thì phải cập nhật `src/lib/supabase/database.types.ts` cho khớp.

---

## 2. Ranh giới ba thư viện UI — quy tắc bắt buộc

Kitten và reusables có hai hệ theme riêng biệt. Không trộn tuỳ hứng:

| Việc | Dùng gì |
|---|---|
| Layout, spacing, màu, typography | **NativeWind** (`className`) — mặc định |
| Button, Card, Input, Dialog, Sheet, Badge, Avatar… | **react-native-reusables** |
| Component phức tạp reusables không có: Datepicker, Autocomplete, Calendar, Menu lồng nhau | **UI Kitten** |
| Style bên trong component Kitten | Theme Eva, **không** đắp `className` lên |

Hai luật chống trôi:
1. **Màu chỉ khai báo một lần** — ở Tailwind config / CSS variables. Theme Eva của Kitten phải *đọc lại* từ đó, không định nghĩa màu riêng.
2. Nếu reusables đã có component tương đương, **không** dùng bản Kitten. Mỗi lần dùng Kitten phải là lựa chọn có lý do.

`StyleSheet.create` chỉ dùng cho: đo đạc động, style chạy trên worklet của Reanimated, và thứ Tailwind không biểu đạt được. Không dùng vì tiện tay.

---

## 3. Luật tiền tệ — vi phạm là bug nghiêm trọng

Đây là phần lõi của app. Sai ở đây thì người dùng mất tiền thật.

1. **Không bao giờ dùng số thực (`number` dấu phẩy động) cho tiền.** Lưu và tính bằng **số nguyên đơn vị nhỏ nhất** (VND: đồng; USD: cent). `0.1 + 0.2 !== 0.3` là bug chờ xảy ra.
2. **Bất biến cốt lõi:** `sum(mọi phần chia) === tổng khoản chi`, luôn luôn, không sai một đơn vị.
3. **Phần dư phải chia có chủ đích.** 10.000đ chia 3 người = 3.334 + 3.333 + 3.333, không phải 3.333,33 × 3. Dùng thuật toán largest-remainder và **ghi rõ ai nhận phần dư** (xoay vòng hoặc gán người trả).
4. **Không làm tròn ở giữa chuỗi tính.** Chỉ làm tròn đúng một lần, ở bước chia cuối cùng.
5. Mỗi khoản chi phải ghi **đơn vị tiền tệ**. Không cộng hai đơn vị khác nhau dù tỷ giá có sẵn.
6. **Cấn trừ công nợ (settle-up) không được đổi tổng số dư của bất kỳ ai.** Thuật toán tối giản giao dịch chỉ gộp đường đi, không đổi kết quả.
7. Sửa/xoá một khoản chi cũ phải tính lại toàn bộ số dư liên quan, không cộng dồn theo kiểu delta.

---

## 4. Luật Supabase

1. **Bật RLS cho mọi bảng.** Bảng không có policy = bảng công khai.
2. `anon key` nằm trong bundle app → **công khai**. Không coi nó là bí mật.
3. **Không bao giờ đưa `service_role` key vào app.** Nếu cần quyền cao, dùng Edge Function.
4. Mọi policy phải kiểm tra **tư cách thành viên nhóm**, không chỉ `auth.uid() IS NOT NULL`. Người dùng A không được đọc nhóm của người dùng B.
5. Số dư và số tiền client gửi lên là **dữ liệu không đáng tin**. Ưu tiên tính ở phía DB (view / RPC) hoặc có ràng buộc DB kiểm chứng.
6. Thao tác nhiều bảng (tạo khoản chi + các phần chia) phải nằm trong **một RPC/transaction**. Không gọi nhiều `insert` rời rạc — lỗi giữa chừng để lại dữ liệu rách.
7. Đổi schema đi kèm migration có kiểm soát. Xem skill `supabase-schema`.

---

## 5. Quy ước code

* **TypeScript strict.** `.tsx` cho component/screen, `.ts` cho hook/util/type. Props có interface tường minh. Không dùng `any`; chỗ chưa biết kiểu thì dùng `unknown` rồi thu hẹp.
* **expo-router**: route nằm trong `src/app`. Typed routes đang bật → dùng `Href` đã sinh, không ghép chuỗi đường dẫn bằng tay.
* **File theo nền tảng**: `.web.tsx` / `.ios.tsx` / `.android.tsx`. Khi sửa một biến thể, kiểm tra các biến thể còn lại có cần sửa theo không — đây là nguồn bug âm thầm hay gặp nhất của repo này.
* **React Compiler đang bật**: không thêm `useMemo`/`useCallback` thủ công nếu chỉ để tối ưu. Nhưng phải giữ quy tắc của hooks thật nghiêm — compiler sẽ bỏ qua (bail out) component vi phạm mà không báo lỗi.
* **Reanimated 4**: code trong worklet không được đụng state React hay biến ngoài chưa capture đúng. Animation phải chạy trên UI thread; rơi về JS thread là lỗi hiệu năng.
* Component riêng của một feature thì đặt cùng thư mục feature, không nhét hết vào `src/components`.

---

## 6. Lệnh

| Lệnh | Mục đích |
|---|---|
| `npm run start` | Dev server + Fast Refresh |
| `npm run start -- --reset-cache` | Xoá cache Metro — **bắt buộc** sau khi đổi config Tailwind/Babel/Metro |
| `npm run android` / `npm run ios` / `npm run web` | Chạy theo nền tảng |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Kiểm tra type (chưa có script riêng) |

**Không chạy build production trong phiên agent** (`gradlew assembleRelease`, `xcodebuild`, `eas build`). Nó đổi asset, phá trạng thái Metro, và mất rất lâu. Cần build thật thì làm ngoài phiên agent.

Chưa có test runner. Khi thêm, phần logic tiền tệ ở mục 3 là thứ **phải** có test trước tiên.

---

## 7. Quy tắc uỷ thác cho agent

* Việc cần đọc trên 10 file mới kết luận được → gọi `scout-repo`, đừng tự đọc tràn lan.
* Đụng vào chia tiền / số dư / cấn trừ → chạy `audit-money`.
* Đụng vào schema, policy, hoặc tầng truy cập dữ liệu → chạy `audit-supabase`.
* Đụng vào render, animation, file theo nền tảng → chạy `audit-rn`.
* Thêm hoặc sửa giao diện → chạy `audit-ui`.
* Xong một mảng việc → `/audit` để chạy cả bộ trên diff hiện tại.

**Agent chỉ trả về phát hiện. Quyết định sửa gì là của người dùng.** Không agent nào trong repo này có quyền ghi file.
