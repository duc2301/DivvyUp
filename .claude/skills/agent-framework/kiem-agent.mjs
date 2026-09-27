// Soát HÌNH THỨC các agent trong .claude/agents/ theo khung 8 điểm (xem SKILL.md cùng thư mục).
// Không đánh giá nội dung — chỉ bắt những lệch máy kiểm được: thiếu trường, thiếu mục, quyền mâu
// thuẫn với vai trò, "Đọc trước" trỏ tới file không tồn tại.
//
//   node .claude/skills/agent-framework/kiem-agent.mjs [ten-agent ...]
//
// Thoát 1 nếu có LỖI; CẢNH BÁO không làm thoát lỗi.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const dir = join(root, '.claude', 'agents')
const only = process.argv.slice(2)

const MODELS = ['opus', 'sonnet', 'haiku', 'inherit']
const EFFORTS = ['low', 'medium', 'high', 'max']
const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const REQUIRED_SECTIONS = ['## Khởi động', '## Phòng thủ', '## Tuyệt đối không']

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const fm = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (kv) fm[kv[1]] = kv[2].trim()
  }
  return fm
}

function section(text, heading) {
  const start = text.indexOf(heading)
  if (start < 0) return ''
  const rest = text.slice(start + heading.length)
  const next = rest.search(/\n## /)
  return next < 0 ? rest : rest.slice(0, next)
}

let errors = 0
const files = readdirSync(dir).filter((f) => f.endsWith('.md') && (!only.length || only.includes(basename(f, '.md'))))

for (const f of files) {
  const text = readFileSync(join(dir, f), 'utf8')
  const name = basename(f, '.md')
  const out = []
  const err = (m) => out.push(`  LỖI       ${m}`)
  const warn = (m) => out.push(`  CẢNH BÁO  ${m}`)

  if (text.includes('\r\n')) err('line ending CRLF — repo dùng LF cho file agent')
  const fm = frontmatter(text)
  if (!fm) {
    err('thiếu frontmatter')
  } else {
    const tools = (fm.tools ?? '').split(',').map((t) => t.trim()).filter(Boolean)
    const writes = tools.some((t) => WRITE_TOOLS.includes(t))
    const readOnly = /chỉ\s+đọc/i.test(fm.description ?? '')

    // 1. Vai trò
    if (fm.name !== name) err(`name "${fm.name}" khác tên file "${name}"`)
    if (!fm.description || fm.description.length < 80) err('description thiếu hoặc quá ngắn (cần: làm gì + khi nào gọi + chỉ đọc/được sửa)')
    if (!readOnly && !/được sửa|chỉ sửa|viết|thêm/i.test(fm.description ?? '')) warn('description không nói rõ chỉ đọc hay được sửa gì')
    // 2. Model, 5. Effort
    if (!MODELS.includes(fm.model)) err(`model "${fm.model}" không phải alias (${MODELS.join('/')})`)
    if (!EFFORTS.includes(fm.effort)) err(`effort "${fm.effort}" thiếu hoặc sai (${EFFORTS.join('/')})`)
    if (fm.model === 'opus' && fm.effort !== 'high' && fm.effort !== 'max') warn(`opus mà effort=${fm.effort} — khung quy định opus đi với high`)
    // 6. Quyền
    if (!tools.length) err('thiếu tools (không khai = kế thừa MỌI công cụ)')
    if (readOnly && writes) err(`description nói chỉ đọc nhưng tools có ${tools.filter((t) => WRITE_TOOLS.includes(t)).join(', ')}`)
    // 7. Memory
    if (fm.memory && !['user', 'project', 'local'].includes(fm.memory)) err(`memory "${fm.memory}" không hợp lệ`)
    if (fm.memory && readOnly) err('agent chỉ đọc không được bật memory (memory tự cấp quyền ghi file)')
  }

  for (const s of REQUIRED_SECTIONS) if (!text.includes(s)) err(`thiếu mục "${s}"`)
  if (!text.includes('Agent lệch')) warn('không nhắc mục "Agent lệch" trong báo cáo')

  // 8. Đúng project, 4. Context
  const boot = section(text, '## Khởi động')
  if (boot) {
    if (!boot.includes('DivvyUp') || !boot.includes('app.json')) err('mục Khởi động thiếu bước kiểm đúng repo')
    if (!boot.includes('.claude-run/')) warn('mục Khởi động không nhắc đọc brief/progress trong .claude-run/')
    if (!/Đọc trước/.test(boot)) err('mục Khởi động thiếu danh sách "Đọc trước"')
    for (const m of boot.matchAll(/`([\w./[\]-]+\.(?:md|ts|tsx|mjs|js|sql|json|ya?ml|css|properties))`/g)) {
      const p = m[1]
      // File của thư mục việc (.claude-run/<ma-viec>/) — không nằm trong repo.
      if (p.includes('<') || p.startsWith('.claude-run/') || ['brief.md', 'progress.md', 'app.json', 'web/package.json'].includes(p)) continue
      if (!existsSync(join(root, p))) err(`"Đọc trước" trỏ tới file không tồn tại: ${p}`)
    }
  }

  errors += out.filter((l) => l.includes('LỖI')).length
  console.log(`${out.length ? '✗' : '✓'} ${name}`)
  for (const l of out) console.log(l)
}

console.log(`\n${files.length} agent, ${errors} lỗi`)
process.exit(errors ? 1 : 0)
