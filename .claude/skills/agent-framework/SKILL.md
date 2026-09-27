---
name: agent-framework
description: Khung 8 điểm cho mọi agent trong .claude/agents/ của repo DivvyUp — vai trò, model, harness, context, effort, quyền, bàn giao/memory, đúng project. Dùng khi TẠO agent mới, SỬA agent có sẵn, hoặc SOÁT bộ agent ("agent này đã đúng khung chưa", "thêm agent", "rà lại bộ agent"). Cũng là nơi tra bảng chọn model/effort và cách đổi model khi hết quota. Không dùng để điều phối một tính năng — việc đó là feature-pipeline.
---

# Khung agent — agent-framework

Mỗi agent trong `.claude/agents/` phải trả lời đủ 8 câu dưới đây. Tạo agent mới thì chép `mau-agent.md` rồi điền; soát agent cũ thì chạy script kiểm rồi đọc lại theo bảng.

```bash
node .claude/skills/agent-framework/kiem-agent.mjs            # soát cả bộ
node .claude/skills/agent-framework/kiem-agent.mjs audit-money
```

Script chỉ kiểm **hình thức** (đủ trường, đủ mục, không lệch bảng, file "Đọc trước" có thật). **Nội dung** (vai trò có chồng lấn không, danh sách đọc trước có đúng file không) phải đọc bằng mắt theo bảng dưới.

## 1. Vai trò — là ai, được làm gì, không được làm gì

- `description` trong frontmatter: **khi nào gọi** (từ khoá người dùng hay nói, giai đoạn nào của feature-pipeline) và một câu **Chỉ ĐỌC** hoặc **Được sửa: <gì>**.
- Thân file mở đầu bằng một câu "Bạn là…/Bạn làm…", kèm lý do agent tồn tại (lỗi gì sẽ xảy ra nếu không có nó).
- Bắt buộc có mục `## Tuyệt đối không`.
- Hai agent không cùng sở hữu một mục soát. Chồng lấn thì một bên ghi rõ "không soát ở đây — `<agent kia>` sở hữu". Ví dụ đang có: tiền thuộc `audit-money`; RLS/policy thuộc `audit-supabase`; bất biến xuyên tầng (khách ↔ đăng nhập, types sửa tay) thuộc `invariant-guard`; `security-code-reviewer` soát IDOR/auth/web/secret.

## 2. Model — con nào hợp việc nào, hết quota thì sao

Frontmatter chỉ dùng **alias** (`opus`, `sonnet`, `haiku`), không ghi tên model cụ thể.

| Loại việc | Model | Agent trong repo |
|---|---|---|
| Soát mà bỏ sót là sự cố thật (tiền, RLS, bảo mật, bất biến), lập kế hoạch xuyên tầng | `opus` | audit-money, audit-supabase, audit-rn, security-code-reviewer, invariant-guard, divvyup-planner, sonar-triage |
| Viết code nhiều tầng, nhiều bước dễ quên | `opus` | supabase-feature |
| Soát theo danh mục rõ ràng, viết test theo khuôn | `sonnet` | code-quality, performance, test-coverage, silent-failure, fsd-architecture, audit-ui, test-writer |
| Tổng hợp, đối chiếu, viết tài liệu, giải thích, trinh sát | `sonnet` | change-audit-log, docs-updater, documentation-accuracy-reviewer, divvyup-explain, scout-repo |
| Tra cứu nhanh, định dạng lại | `haiku` | (chưa có) |

**Hết quota một model** — không sửa từng agent. Đặt trong `.claude/settings.local.json` của máy mình (git bỏ qua):

```json
{ "env": { "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-sonnet-5" } }
```

Mọi agent `model: opus` chạy bằng model thay thế cho tới khi xoá dòng này. **Khi đang chạy model thay thế, kết luận ĐẠT của agent soát `opus` chỉ là tham khảo** — ghi rõ trong báo cáo cuối của feature-pipeline, và chạy `hieu-chuan-agent` nếu định dùng lâu.

## 3. Harness — chạy ở đâu

Bộ agent viết cho **Claude Code** (frontmatter `tools/model/effort/memory` là cú pháp của nó). Agent con được luồng chính gọi và **không hỏi được người dùng**: câu hỏi đưa vào mục "Cần người quyết" của báo cáo, luồng chính hỏi thay.

Repo này chưa chạy agent trên CI (không có `claude -p` trong `.github/workflows`). Khi thêm: đó là cấp quyền 2 (mục 6), agent phải nhận biết brief ghi "KHÔNG NGƯỜI TRỰC".

## 4. Context — đọc gì trước khi làm

Mỗi agent có mục `## Khởi động` liệt kê **đúng** file cần đọc (đường dẫn thật — script kiểm). Nguyên tắc:

- Trỏ tới `AGENTS.md` / `CLAUDE.md` / `supabase/README.md` / `web/README.md` — **đừng chép** kiến thức từ đó vào agent (chép thì lệch).
- Kiến thức chỉ agent đó cần (danh mục soát, khuôn báo cáo) thì viết trong agent.
- Điều agent ghi mâu thuẫn với code: **tin code**, ghi vào mục "Agent lệch" của báo cáo để người sửa agent.

## 5. Effort

| Effort | Khi nào |
|---|---|
| `low` | Tổng hợp theo mẫu có sẵn, không suy luận nhiều bước (change-audit-log, docs-updater, divvyup-explain) |
| `medium` | Soát theo danh mục, viết test theo khuôn, đối chiếu tài liệu, trinh sát |
| `high` | Viết code nhiều tầng; soát mà bỏ sót là sự cố; lập kế hoạch xuyên tầng |
| `max` | Không dùng mặc định. Người gọi yêu cầu riêng cho một lần chạy |

Quy tắc chéo: `opus` đi với `high`. Agent chạy **đầu tiên** của pipeline (documentation-accuracy-reviewer, divvyup-planner — sai thì lan cho mọi bước sau) không để `low`.

## 6. Quyền — 3 cấp tin cậy

| Cấp | Dùng cho | Cách đặt |
|---|---|---|
| **0 — agent mới/đang thử** | Agent vừa viết, chưa qua ≥ 3 lần chạy thật được người đọc lại kết quả | Không `Edit`/`Write`. Chỉ có `Bash` khi bắt buộc, và lệnh nó cần **không** nằm trong `permissions.allow` — người duyệt từng lệnh. Agent ghi rõ trong file mình đang ở cấp 0 |
| **1 — đã kiểm soát** (mặc định của bộ hiện tại) | Agent đã chạy ổn | Được `Bash`; lệnh tự duyệt theo `permissions.allow` trong `.claude/settings.json`; lệnh nguy hiểm bị hook `.claude/hooks/chan-lenh-nguy-hiem.mjs` chặn trước |
| **2 — không người trực** | CI (chưa có) | `--allowedTools` hẹp, hook riêng cho CI |

Agent **chỉ đọc** thì `tools` không có `Edit`/`Write`, và **không bật memory** (memory tự cấp công cụ ghi file).

Không bao giờ thêm vào `permissions.allow` lệnh cài gói hay chạy code tuỳ ý (`npm install`, `npx` chung, `eas *`, `supabase db push`) — để người duyệt từng lần.

## 7. Bàn giao và memory — đọc việc ở đâu, ghi tiến độ ở đâu

**Thư mục việc** `.claude-run/<ma-viec>/`, do **luồng chính** tạo khi bắt đầu feature-pipeline. Thư mục tự bỏ khỏi git bằng file `.claude-run/.gitignore` (nội dung `*` rồi `!.gitignore`) — **không** sửa `.gitignore` gốc: nó là nguồn của runtime fingerprint, sửa là ép build APK mới.

| File | Ai ghi | Ai đọc |
|---|---|---|
| `brief.md` | luồng chính, một lần: yêu cầu nguyên văn, phạm vi, cấp thay đổi, bảng **Tiêu chí xong**, quyết định của người dùng | mọi agent |
| `progress.md` | luồng chính, **nối thêm** sau mỗi agent: `- <HH:MM> <agent>: <kết luận 1 dòng> → reports/<agent>.md` | mọi agent |
| `reports/<agent>.md` | luồng chính dán nguyên báo cáo agent trả về (vòng 2: `<agent>-v2.md`) | agent sau; người dùng |

Agent soát không ghi file — luồng chính ghi hộ. Nhờ vậy báo cáo không mất khi hội thoại bị nén.

**Memory của agent** (`memory: local` → `.claude/agent-memory-local/<agent>/`, bỏ khỏi git bằng `.claude/agent-memory-local/.gitignore`): chỉ bật cho agent **được ghi** (`supabase-feature`, `test-writer`, `docs-updater`). Chỉ lưu bài học dùng lại được ("repo này X phải làm kiểu Y vì Z"), không lưu tiến độ việc. Agent chỉ đọc không có memory; bài học của chúng đi vào mục "Agent lệch" → người sửa file agent.

## 8. Đúng project

Mục `## Khởi động` của mọi agent bắt đầu bằng bước kiểm repo:

```
git remote get-url origin     # phải chứa DivvyUp
test -f app.json && test -f web/package.json    # đang đứng ở gốc repo
```

Sai → dừng ngay, báo "sai repo/sai thư mục: <đường dẫn>", không đọc/ghi thêm gì. Mọi đường dẫn trong báo cáo viết **tương đối từ gốc repo**. Không kiểm theo tên thư mục (worktree có tên khác).

## Tạo agent mới

1. Chép `mau-agent.md` thành `.claude/agents/<ten>.md`, điền đủ 8 điểm. Bắt đầu ở **cấp quyền 0**.
2. `node .claude/skills/agent-framework/kiem-agent.mjs <ten>` → sửa tới khi không còn lỗi.
3. Thêm agent vào bảng agent ở `AGENTS.md` mục 7 và vào `feature-pipeline` nếu nó thuộc một giai đoạn.
4. Sau ≥ 3 lần chạy thật được đọc lại kết quả, hoặc qua một lần `hieu-chuan-agent` bắt đúng lỗi nó sở hữu mà không báo nhầm → nâng cấp quyền 1.

Sửa nội dung agent soát, hoặc đổi model → chạy lại `hieu-chuan-agent` cho agent đó.

Agent mới tạo trong phiên **chưa gọi được** bằng `subagent_type` cho tới phiên sau — trong phiên hiện tại, gọi `general-purpose` và bảo nó đọc file agent rồi làm theo.

## Soát bộ agent

Chạy script, rồi với mỗi agent đọc lại theo 8 điểm và báo theo bảng: `| Agent | Điểm | Lệch | Đề xuất |`. Không tự sửa khi người dùng chỉ yêu cầu soát.
