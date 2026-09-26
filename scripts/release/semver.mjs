/**
 * Quyết định số phiên bản kế tiếp từ các commit kể từ bản phát hành trước.
 *
 * Thuần JS, không đọc git hay file — để test được bằng node --test và để
 * workflow lẫn người chạy tay dùng CHUNG một luật.
 *
 * Luật (Conventional Commits, xem .claude/skills/git-commit):
 *   `type!:` hoặc thân có "BREAKING CHANGE"  → major
 *   feat                                     → minor
 *   fix, perf, refactor, revert              → patch
 *   docs, chore, ci, test, style, build      → không phát hành
 *   tiêu đề không theo quy ước               → patch (coi là một bản sửa)
 *   chore(release): ...                      → bỏ qua (commit do chính máy phát hành tạo)
 */

const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

const NO_RELEASE_TYPES = new Set(['docs', 'chore', 'ci', 'test', 'style', 'build']);
const PATCH_TYPES = new Set(['fix', 'perf', 'refactor', 'revert']);

// `\S.*` thay cho `\s*.+`: hai phần không cùng khớp khoảng trắng → không backtracking.
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?:\s*(?<subject>\S.*)$/i;

/** @param {string} value 'v1.2.3' hoặc '1.2.3' */
export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value).trim());
  if (!match) throw new Error(`Số phiên bản không hợp lệ: "${value}" (cần dạng X.Y.Z).`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** @param {string} version @param {'major'|'minor'|'patch'} bump */
export function bumpVersion(version, bump) {
  const { major, minor, patch } = parseVersion(version);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Kiểu tăng không hợp lệ: ${bump}`);
}

/**
 * Phân loại MỘT commit.
 * @param {{ subject: string, body?: string }} commit
 * @returns {{ bump: 'none'|'patch'|'minor'|'major', type: string|null, scope: string|null, text: string, release: boolean }}
 */
export function classifyCommit(commit) {
  const subject = commit.subject.trim();
  const body = commit.body ?? '';
  const header = HEADER.exec(subject);

  if (!header) {
    return { bump: 'patch', type: null, scope: null, text: subject, release: true };
  }

  const type = header.groups.type.toLowerCase();
  const scope = header.groups.scope ?? null;
  const text = header.groups.subject.trim();

  if (type === 'chore' && scope === 'release') {
    return { bump: 'none', type, scope, text, release: false };
  }
  if (header.groups.bang || /(^|\n)BREAKING[ -]CHANGE:/.test(body)) {
    return { bump: 'major', type, scope, text, release: true };
  }
  if (type === 'feat') return { bump: 'minor', type, scope, text, release: true };
  if (PATCH_TYPES.has(type)) return { bump: 'patch', type, scope, text, release: true };
  if (NO_RELEASE_TYPES.has(type)) return { bump: 'none', type, scope, text, release: true };
  return { bump: 'patch', type, scope, text, release: true };
}

/** Mức tăng cao nhất của cả loạt commit; 'none' nếu không có gì cần phát hành. */
export function decideBump(commits) {
  let best = 'none';
  for (const commit of commits) {
    const { bump } = classifyCommit(commit);
    if (RANK[bump] > RANK[best]) best = bump;
  }
  return best;
}

/**
 * Ghi chú phát hành cho NGƯỜI DÙNG CUỐI: chỉ liệt kê thay đổi họ thấy được,
 * bỏ phần việc nội bộ (docs, ci, test…) và commit phát hành.
 */
export function releaseNotes(commits) {
  const sections = [
    { title: '⚠️ Thay đổi lớn', items: [] },
    { title: '✨ Tính năng mới', items: [] },
    { title: '🐛 Sửa lỗi và cải thiện', items: [] },
  ];
  for (const commit of commits) {
    const info = classifyCommit(commit);
    if (!info.release || info.bump === 'none') continue;
    // Bỏ dấu comment HTML: tiêu đề commit do người viết đặt, không được giả được
    // dấu runtime nằm ẩn trong ghi chú phát hành.
    const text = info.text.replaceAll('<!--', '').replaceAll('-->', '').trim();
    if (text === '') continue;
    const line = `- ${text.charAt(0).toUpperCase()}${text.slice(1)}`;
    if (info.bump === 'major') sections[0].items.push(line);
    else if (info.bump === 'minor') sections[1].items.push(line);
    else sections[2].items.push(line);
  }
  return sections
    .filter((section) => section.items.length > 0)
    .map((section) => `### ${section.title}\n${[...new Set(section.items)].join('\n')}`)
    .join('\n\n');
}

/** Dấu runtime ghi vào ghi chú phát hành, để lần sau biết phần native có đổi không. */
export const RUNTIME_MARKER = 'divvyup-runtime';

export function runtimeMarker(runtimeVersion) {
  return `<!-- ${RUNTIME_MARKER}: ${runtimeVersion} -->`;
}

/**
 * Runtime ghi trong ghi chú phát hành trước, null nếu không có. Lấy dấu CUỐI
 * CÙNG: dấu thật luôn do workflow ghi ở cuối, sau phần ghi chú lấy từ commit.
 * @returns {string|null}
 */
export function readRuntimeMarker(notes) {
  const pattern = new RegExp(`<!--\\s*${RUNTIME_MARKER}:\\s*([A-Za-z0-9._-]+)\\s*-->`, 'g');
  let last = null;
  for (const match of (notes ?? '').matchAll(pattern)) last = match[1];
  return last;
}
