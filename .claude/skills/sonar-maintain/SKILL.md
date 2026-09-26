---
name: sonar-maintain
description: Vòng bảo trì DivvyUp dựa trên SonarQube Cloud — đọc Quality Gate và issue, cho agent sonar-triage phân loại trên code thật, sửa theo đợt qua feature-pipeline, commit/push, chờ Sonar phân tích lại và kiểm Quality Gate xanh. Dùng khi người dùng nói "bảo trì", "maintain", "xem sonar", "sonarqube", "sonarcloud", "quality gate đỏ", "dọn code smell".
---

# Bảo trì theo SonarQube Cloud

Dự án trên SonarQube Cloud: `duc2301_DivvyUp` (công khai, phân tích tự động mỗi lần push `main` và mỗi PR). Công cụ đọc: `node scripts/sonar/fetch-report.mjs` — cố ý KHÔNG khai thành npm script: `package.json` → `scripts` nằm trong runtime fingerprint, thêm script là workflow build lại APK vô ích. Agent phân loại: `sonar-triage`.

## Bước 1 — Đọc hiện trạng (luồng chính, nhanh)

```bash
node scripts/sonar/fetch-report.mjs --new
```

Nắm: Quality Gate đỏ ở điều kiện nào, bao nhiêu issue mã mới, thời điểm phân tích. Nếu thời điểm phân tích cũ hơn commit mới nhất trên `main`, Sonar chưa chấm các thay đổi gần đây — báo cho người dùng.

Dự án chuyển sang riêng tư: người dùng tự đặt biến môi trường `SONAR_TOKEN` (token SonarQube Cloud, quyền Browse) trong terminal. **Không** yêu cầu họ dán token vào chat, không ghi token vào file.

## Bước 2 — Phân loại (agent `sonar-triage`)

Gọi `sonar-triage` với phạm vi: mã mới trước; nếu người dùng muốn dọn toàn bộ thì thêm toàn bộ. Prompt nêu rõ: thời điểm phân tích, điều kiện gate đang đỏ, và mong muốn (chỉ làm xanh gate hay dọn cả nợ cũ).

## Bước 3 — Điểm dừng

Trình người dùng: LỖI THẬT, NÊN SỬA, DƯƠNG TÍNH GIẢ (đề xuất đánh dấu trên Sonar), và kế hoạch theo đợt. **Chờ chọn đợt** trước khi sửa — trừ khi người dùng đã nói "cứ làm".

## Bước 4 — Sửa từng đợt

Mỗi đợt đi theo skill `feature-pipeline` từ Giai đoạn 2:
- sửa → `npm run typecheck`, `npm test` (và `cd web && npm run typecheck && npm run build` nếu đụng web);
- gọi các agent soát mà `sonar-triage` đã giao cho đợt đó (bắt buộc `invariant-guard` khi đụng `src/lib`, `supabase/`, `web/src/shared/api`);
- commit theo skill `git-commit`, một đợt một commit.

Chọn type commit có chủ đích — type quyết định số phiên bản (`auto-release.yml`):
- sửa bug/lỗ hổng người dùng chịu ảnh hưởng → `fix` (phát hành bản vá);
- dọn code smell thuần, không đổi hành vi → `refactor` (cũng là bản vá) — nên gộp nhiều đợt dọn nhỏ rồi push một lần, tránh phát hành liên tục;
- chỉ workflow CI → `ci`, chỉ migration mới chưa dùng ở app → cân nhắc gộp với commit dùng nó.

Migration Postgres đã chạy thì không sửa; luật `plsql:*` thường không áp dụng — để `sonar-triage` xếp KHÔNG ÁP DỤNG.

## Bước 5 — Push và kiểm lại

Push khi người dùng đồng ý (hook yêu cầu tiền tố `PUSH_APPROVED=1`). Sonar phân tích tự động sau push, thường vài phút. Kiểm:

```bash
node scripts/sonar/fetch-report.mjs --new
```

Đợi tới khi `Lần phân tích gần nhất` mới hơn commit vừa push rồi mới kết luận. Quality Gate còn đỏ → quay lại Bước 2 với phần còn lại (tối đa 2 vòng rồi trình người dùng).

## Đánh dấu dương tính giả

Làm trên giao diện SonarQube Cloud (Issues → chọn issue → *Accept* / *False positive*, kèm lý do do `sonar-triage` đưa). Agent không tự đổi trạng thái issue: việc đó cần token có quyền quản trị issue và là quyết định của người dùng.

## Báo cáo cuối

```
| | Trước | Sau |
|---|---|---|
| Quality Gate | ERROR | OK |
| Issue mã mới | n | n |
| Lỗ hổng / Bug | n / n | n / n |
### Đã sửa (theo đợt, kèm commit)
### Đề xuất đánh dấu trên Sonar (dương tính giả, kèm lý do)
### Để lại (lý do)
```

## Tuyệt đối không

- Không push khi chưa được đồng ý; không sửa migration đã chạy.
- Không "sửa" để qua ngưỡng Sonar mà phá quy ước của repo (ví dụ đổi tiền sang số thực, bỏ `formatMoney`, thêm `useMemo` thừa).
- Không in, không lưu `SONAR_TOKEN`.
