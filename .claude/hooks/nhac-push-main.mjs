// Hook PreToolUse (Bash, PowerShell): push lên main TỰ PHÁT HÀNH — workflow ota-update đẩy OTA tới
// mọi máy người dùng, auto-release gắn tag/Release, Vercel deploy web. Chỉ push khi người dùng yêu
// cầu rõ, và migration Supabase mới (nếu có) đã được chạy TRƯỚC (xem skill divvyup-release).
//
// Lối ra: người dùng đã đồng ý rõ ràng trong chat -> push lại với tiền tố
//
//   PUSH_APPROVED=1 git push ...
//
// Bản viết liền cũ chỉ bắt `git push ... main`; `git push` trần khi đang đứng trên main lọt qua.
// Bản này xét cả nhánh hiện tại khi lệnh không ghi refspec.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const MSG =
  '[DivvyUp] Push lên main sẽ TỰ PHÁT HÀNH: OTA tới máy người dùng, tag/Release, deploy web. Chỉ push khi người dùng yêu cầu rõ, và migration Supabase mới (nếu có) đã chạy TRƯỚC.\n' +
  'Người dùng đã đồng ý rõ ràng -> push lại với tiền tố: PUSH_APPROVED=1 git push ...  (xem skill divvyup-release)\n'

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
  const cmd = String(input.tool_input?.command ?? '')
  const push = cmd.match(/\bgit\s+(?:-C\s+\S+\s+)?push\b([^|;&]*)/)
  if (!push) process.exit(0)
  if (/(?:^|[;&|]\s*|\$env:)PUSH_APPROVED\s*=\s*['"]?1['"]?\s*;?\s*git\s+(?:-C\s+\S+\s+)?push\b/.test(cmd)) process.exit(0)

  const args = push[1].split(/\s+/).filter((a) => a && !a.startsWith('-'))
  const toMain = /(^|[\s:/])main\b/.test(push[1]) || /\bHEAD\b/.test(push[1]) || /\s--all\b|\s--mirror\b/.test(push[1])
  // `git push` / `git push origin` không refspec -> đẩy nhánh hiện tại.
  const bare = args.length <= 1
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  if (toMain || (bare && currentBranch(cwd) === 'main')) {
    process.stderr.write(MSG)
    process.exit(2)
  }
  process.exit(0)
} catch (e) {
  process.stderr.write(`[DivvyUp] Hook nhắc push main bị lỗi (${e.message}) — chặn để an toàn.\n`)
  process.exit(2)
}
