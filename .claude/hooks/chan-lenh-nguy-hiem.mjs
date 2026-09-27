// Hook PreToolUse (Bash, PowerShell): chặn TRƯỚC các lệnh phá dữ liệu / mất việc / lộ secret / phát
// hành ra máy người dùng, áp dụng cho luồng chính lẫn mọi agent con. Đây là "bộ lọc lệnh nguy hiểm"
// của cấp quyền 1 trong .claude/skills/agent-framework/SKILL.md — permissions.allow chỉ quyết định
// lệnh nào KHỎI hỏi, còn file này quyết định lệnh nào KHÔNG BAO GIỜ chạy qua agent.
//
// Chặn = thoát 2, lý do in ra stderr để Claude đọc. Người dùng muốn chạy lệnh bị chặn thì tự chạy
// trong terminal của mình. Hook lỗi (JSON hỏng...) cũng chặn — không để lọt vì chính bộ lọc hỏng.
//
// DivvyUp chỉ có MỘT project Supabase (production) — mọi lệnh ghi vào DB từ CLI là ghi vào dữ liệu
// thật của người dùng. Migration do người dùng tự chạy trong SQL Editor (supabase/README.md).

import { readFileSync } from 'node:fs'

const RULES = [
  // Mất việc chưa commit / lịch sử
  [/\bgit\s+reset\s+(?:\S+\s+)*--hard\b/, 'git reset --hard xoá thay đổi chưa commit'],
  [/\bgit\s+clean\s+(?:\S+\s+)*-\w*f/, 'git clean -f xoá file chưa track'],
  [/\bgit\s+(?:checkout|restore)\s+(?:\S+\s+)*(?:--\s+)?\.(?:\s|$)/, 'checkout/restore cả cây làm việc bỏ mọi thay đổi'],
  [/\bgit\s+push\s+(?:\S+\s+)*(?:--force\b|--force-with-lease\b|-f\b|\S+:\S*\s*\+|\+\S+)/, 'force push ghi đè lịch sử remote'],
  [/\bgit\s+branch\s+(?:\S+\s+)*-D\b/, 'xoá nhánh chưa merge'],
  [/\bgit\s+stash\s+(?:drop|clear)\b/, 'xoá stash'],
  [/\bgit\s+(?:commit|push|merge|rebase)\b.*--no-verify\b/, 'bỏ qua git hook'],
  [/\bgit\s+add\s+(?:\S+\s+)*(?:-A\b|--all\b|\.(?:\s|$))/, 'quy ước repo: stage từng file theo tên, không git add . / -A'],
  [/\bgit\s+tag\s+(?:\S+\s+)*-d\b|\bgit\s+push\s+(?:\S+\s+)*--delete\b|\bgit\s+push\s+\S+\s+:\S+/, 'xoá tag/nhánh remote — tag là mốc phát hành'],
  // Xoá file hàng loạt
  [/\brm\s+(?:\S+\s+)*-\w*[rR]\w*f|\brm\s+(?:\S+\s+)*-\w*f\w*[rR]|\brm\s+(?:\S+\s+)*--recursive\b/, 'rm -rf'],
  [/\bRemove-Item\b.*-Recurse/i, 'Remove-Item -Recurse'],
  // Supabase: một project duy nhất = production
  [/\bsupabase\s+db\s+(?:reset|push)\b/, 'supabase db reset/push ghi thẳng vào DB production — người dùng chạy migration trong SQL Editor'],
  [/\bsupabase\s+migration\s+(?:repair|squash|down)\b/, 'sửa lịch sử migration của project production'],
  [/\bsupabase\s+(?:projects|functions|secrets|storage)\s+(?:delete|rm|unset)\b/, 'xoá tài nguyên Supabase production'],
  [/\bpsql\b.*\b(?:DROP\s+(?:TABLE|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i, 'xoá dữ liệu qua psql'],
  // Phát hành tới máy người dùng
  [/\beas\s+(?:update|build|submit)\b/, 'eas update/build/submit phát hành tới người dùng hoặc tốn lượt build — qua workflow, không qua agent'],
  [/\bgh\s+release\s+(?:create|delete|edit|upload)\b/, 'tạo/sửa GitHub Release — workflow auto-release làm việc này'],
  [/\bgh\s+workflow\s+run\b/, 'kích hoạt workflow (build APK, OTA) — người dùng tự bấm'],
  // Secret
  [/(?:^|[\s;&|(])(?:cat|less|more|head|tail|type|Get-Content|gc|sed|awk|grep|rg|source|\.)\s+(?:\S+\s+)*\S*\.env(?:\.(?!example)\w+)?(?:\s|$|["'])/i, 'đọc .env / .env.secrets — repo cấm agent đọc file secret'],
  [/\b(?:printenv|Get-ChildItem\s+env:|gci\s+env:)\b|(?:^|[;&|]\s*)env\s*(?:$|[|;&])/i, 'in biến môi trường'],
  [/\becho\s+[^|;&]*\$\{?(?:SONAR_TOKEN|EXPO_TOKEN|SUPABASE_\w*KEY|\w*SECRET\w*)\b/i, 'in token/secret ra màn hình'],
  // Tải script về chạy
  [/\b(?:curl|wget|iwr|Invoke-WebRequest)\b.*\|\s*(?:sh|bash|pwsh|powershell|iex|Invoke-Expression|node)\b/i, 'tải script về rồi chạy'],
]

function decide(cmd) {
  // Bỏ nội dung -m "..." của git commit để message nhắc tới "rm -rf" không bị chặn nhầm.
  const scan = cmd.replace(/(\bgit\s+commit\b[^"']*?)(-m|--message)\s*("([^"\\]|\\.)*"|'[^']*')/g, '$1$2 ""')
  for (const [re, why] of RULES) if (re.test(scan)) return why
  return null
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
  const cmd = String(input.tool_input?.command ?? '')
  const why = decide(cmd)
  if (why) {
    process.stderr.write(`[DivvyUp] Lệnh bị chặn: ${why}.\nNếu thật sự cần, người dùng tự chạy trong terminal. Agent: tìm cách khác hoặc báo lại.\n`)
    process.exit(2)
  }
  process.exit(0)
} catch (e) {
  process.stderr.write(`[DivvyUp] Hook chặn lệnh nguy hiểm bị lỗi (${e.message}) — chặn để an toàn.\n`)
  process.exit(2)
}
