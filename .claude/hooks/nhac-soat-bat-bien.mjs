// Hook PreToolUse (Bash, PowerShell): commit có file thuộc lõi tiền / tầng dữ liệu / kho khách /
// Supabase / API web phải qua invariant-guard (và audit-money nếu đụng src/lib/money) TRƯỚC.
//
// Lối ra rõ ràng — chỉ dùng khi invariant-guard đã kết luận ĐẠT, hoặc CẢNH BÁO đã được người dùng
// chấp nhận, và phải nói rõ điều đó trong câu trả lời trước khi commit:
//
//   INVARIANT_REVIEWED=1 git commit ...
//
// Tiền tố phải đứng ngay trước `git commit` (không tính nếu chỉ nằm trong commit message).
//
// Hai đường lách của bản hook viết liền cũ cũng bị đóng:
//   - `git add x && git commit` trong MỘT lệnh: hook chạy trước khi add, thấy staged rỗng -> lọt.
//     Nay: lệnh có cả add và commit mà chưa có tiền tố -> yêu cầu tách hai lệnh.
//   - `git commit -a`: file đã sửa nhưng chưa stage không nằm trong `--cached`. Nay xét cả chúng.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const GUARDED = /^(src\/lib\/(money|data|storage)\/|supabase\/(?!\.temp\/)|web\/src\/shared\/api\/)/

const MSG =
  '[DivvyUp] Commit này đụng lõi tiền, tầng dữ liệu, kho khách, Supabase hoặc API web. Chạy agent invariant-guard (và audit-money nếu đụng src/lib/money) TRƯỚC — xem AGENTS.md mục 7.\n' +
  'Soát xong, kết luận ĐẠT (hoặc CẢNH BÁO người dùng đã chấp nhận) -> nói rõ kết luận đó, rồi commit lại bằng:\n' +
  '  INVARIANT_REVIEWED=1 git commit ...\n'

function touchesGuarded(cwd, args) {
  try {
    return execFileSync('git', ['diff', ...args, '--name-only'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .some((p) => GUARDED.test(p.trim()))
  } catch {
    return false
  }
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
  const cmd = String(input.tool_input?.command ?? '')
  if (!/\bgit\s+(?:-C\s+\S+\s+)?commit\b/.test(cmd)) process.exit(0)
  if (/(?:^|[;&|]\s*|\$env:)INVARIANT_REVIEWED\s*=\s*['"]?1['"]?\s*;?\s*git\s+commit\b/.test(cmd)) process.exit(0)

  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  if (/\bgit\s+add\b/.test(cmd)) {
    process.stderr.write('[DivvyUp] Tách `git add` và `git commit` thành hai lệnh riêng để hook soát được đúng phần sẽ commit.\n')
    process.exit(2)
  }
  // Bỏ nội dung -m "..." trước khi tìm cờ -a, để message chứa chữ "-a" không bị hiểu nhầm là cờ.
  const flags = cmd.replace(/(-m|--message)\s*("([^"\\]|\\.)*"|'[^']*')/g, '$1 ""')
  const all = /\bgit\s+commit\b.*(?:\s-\w*a\w*\b|\s--all\b)/.test(flags)
  if (touchesGuarded(cwd, ['--cached']) || (all && touchesGuarded(cwd, []))) {
    process.stderr.write(MSG)
    process.exit(2)
  }
  process.exit(0)
} catch (e) {
  process.stderr.write(`[DivvyUp] Hook nhắc soát bất biến bị lỗi (${e.message}) — chặn để an toàn.\n`)
  process.exit(2)
}
