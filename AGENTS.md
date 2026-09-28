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
| Web | React 19 + Vite 7 + Tailwind 3 + react-router 7, kiến trúc Feature-Sliced Design, thư mục `web/` | đã cài, dùng chung Supabase và lõi tiền/dữ liệu qua alias `@core` |

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
* **Cổng đặt mật khẩu (đăng nhập Google với tài khoản chưa có mật khẩu):** lõi thuần ở `src/lib/auth/password-gate.ts`, dữ liệu ở `src/lib/data/account.ts`. Chặn ở `src/app/_layout.tsx` (`AuthGate`, mobile) và `web/src/app/router/guards.tsx` (`RequireAuth`/`RequirePasswordSetup`, web) — chặn **trước** mọi màn khác, kể cả deep link `/trips`, `/join`.
* **Không thêm `expo-web-browser` vào `plugins` trong `app.json`.** Đăng nhập Google trên mobile dùng `expo-web-browser` đã có sẵn trong APK nhưng không khai trong `plugins` — thêm vào đó đổi fingerprint native, buộc phải build APK mới thay vì giao qua OTA.

---

## 6. Lệnh

| Lệnh | Mục đích |
|---|---|
| `npm run start` | Dev server + Fast Refresh |
| `npm run start -- --reset-cache` | Xoá cache Metro — **bắt buộc** sau khi đổi config Tailwind/Babel/Metro |
| `npm run android` / `npm run ios` / `npm run web` | Chạy theo nền tảng |
| `npm run lint` | ESLint |
| `npm run typecheck` | Kiểm tra type (`tsc --noEmit`) |
| `npm test` | Chạy test (`node --test`) — logic tiền tệ ở mục 3 phải có test trước tiên |
| `node scripts/sonar/fetch-report.mjs` | Báo cáo SonarQube Cloud (`--new` chỉ mã mới, `--pr <số>`, `--json --out <file>`); dự án riêng tư cần biến `SONAR_TOKEN` |
| `npm run release:plan` | Xem trước bản phát hành kế tiếp: số phiên bản, mức tăng, ghi chú (không ghi gì) |
| `cd web && npm run dev` | Dev server web (Vite, `http://localhost:5173`) |
| `cd web && npm run build` | Build web → `web/dist/` |
| `cd web && npm run typecheck` | Kiểm tra type cho web |

**Không chạy build production trong phiên agent** (`gradlew assembleRelease`, `xcodebuild`, `eas build`). Nó đổi asset, phá trạng thái Metro, và mất rất lâu. Cần build thật thì làm ngoài phiên agent.

CI (GitHub Actions) chạy `npm run typecheck` và `npm test` cho mọi pull request và trước mỗi lần phát hành.

---

## 7. Quy tắc uỷ thác cho agent

Quy trình trọn vòng một tính năng nằm ở skill **`feature-pipeline`**: đối chiếu tài liệu → lập kế hoạch kèm **Tiêu chí xong** (người dùng duyệt) → cài đặt → test → soát song song → nhật ký → tài liệu. Việc được xếp **cấp Nhỏ / Vừa / Lớn** để chỉ gọi agent đáng gọi. Agent soát không phải agent viết: người viết code không tự chấm code của mình.

Mọi agent theo **khung 8 điểm** của skill **`agent-framework`** (vai trò, model alias, harness, "Đọc trước", effort, cấp quyền 0/1/2, bàn giao, kiểm đúng repo); soát hình thức bằng `node .claude/skills/agent-framework/kiem-agent.mjs`. Các agent bàn giao cho nhau qua thư mục việc `.claude-run/<ma-viec>/` (`brief.md`, `progress.md`, `reports/`) — thư mục tự bỏ khỏi git bằng `.gitignore` riêng của nó, **không** sửa `.gitignore` gốc (nguồn runtime fingerprint).

| Agent | Vai trò | Ghi file |
|---|---|---|
| `documentation-accuracy-reviewer` | bước đầu: tài liệu nào sai so với code | không |
| `divvyup-planner` | kế hoạch + phạm vi lan toả + việc tay | không |
| `scout-repo` | bản đồ nhanh khi cần đọc > 10 file | không |
| `divvyup-explain` | giải thích code, luồng, "vì sao" | không |
| `supabase-feature` | thêm bảng/cột/RPC/quyền trọn 8 bước (migration → types → data → nhánh khách) | **có** |
| `test-writer` | test `node --test` + truy vấn `verify.sql` | **có** (chỉ test) |
| `invariant-guard` | bất biến tiền/RLS/khách↔đăng nhập/secret — **bắt buộc trước commit** đụng `src/lib`, `supabase/` | không |
| `audit-money` | chia tiền, số dư, tối giản công nợ | không |
| `audit-supabase` | schema, RLS, RPC, tầng truy cập dữ liệu | không |
| `security-code-reviewer` | IDOR, auth, Storage, Edge Function, web, secret | không |
| `code-quality-reviewer` | đúng tầng, nguồn chân lý, trùng lặp | không |
| `audit-rn` / `audit-ui` | React Native / giao diện mobile | không |
| `fsd-architecture-reviewer` | kiến trúc Feature-Sliced Design của `web/` | không |
| `performance-reviewer` | truy vấn, danh sách, ảnh, thuật toán, bundle | không |
| `silent-failure` | lỗi bị nuốt im lặng | không |
| `test-coverage-reviewer` | bộ test đủ và khách quan chưa | không |
| `sonar-triage` | đọc SonarQube Cloud, xét từng issue trên code thật, phân loại và lập kế hoạch bảo trì | không |
| `change-audit-log` | nhật ký thay đổi + việc tay khi phát hành | không |
| `docs-updater` | cập nhật tài liệu sau khi xong | **có** (chỉ tài liệu) |

Skill: `feature-pipeline`, `agent-framework` (tạo/sửa/soát agent), `hieu-chuan-agent` (đo bộ agent bằng tính năng mồi có lỗi cài sẵn — chạy khi đổi model hoặc sửa agent soát), `git-commit`, `divvyup-release`, `sonar-maintain` (bảo trì theo SonarQube Cloud: đọc → phân loại → sửa theo đợt → kiểm lại Quality Gate), `divvyup-apk-release` (phát hành tự động: tự tăng số theo commit, gắn tag, tạo Release, build APK khi native đổi), `supabase-schema`. Lệnh `/audit` chạy nhanh bộ `audit-*` trên diff hiện tại.

Hook (`.claude/hooks/*.mjs`, gắn trong `.claude/settings.json`, áp cho cả Bash lẫn PowerShell):
- `chan-lenh-nguy-hiem.mjs` — không bao giờ chạy qua agent: `git reset --hard`, `git add .`/`-A`, force push, `rm -rf`, đọc `.env*`, `supabase db push/reset` (chỉ có một project = production), `eas update/build/submit`, `gh release`/`gh workflow run`.
- `nhac-soat-bat-bien.mjs` — chặn `git commit` đụng `src/lib/{money,data,storage}`, `supabase/`, `web/src/shared/api/` tới khi `invariant-guard` đã soát; lối ra `INVARIANT_REVIEWED=1 git commit`. `git add` và `git commit` phải là hai lệnh riêng.
- `nhac-push-main.mjs` — chặn push lên `main` (kể cả `git push` trần khi đứng trên main); lối ra `PUSH_APPROVED=1 git push` sau khi người dùng đồng ý.

Hết quota một model: đặt `ANTHROPIC_DEFAULT_OPUS_MODEL` trong `.claude/settings.local.json` (xem `agent-framework` mục 2) — khi đó kết luận ĐẠT của agent `opus` chỉ là tham khảo.

**Quyết định sửa gì là của người dùng.** Agent soát chỉ trả về phát hiện; agent ghi file chỉ ghi trong phạm vi vai trò của nó.

Agent mới tạo hoặc sửa trong `.claude/agents/` chỉ được nạp ở phiên Claude Code **sau**, không có hiệu lực ngay trong phiên đang tạo/sửa nó.
