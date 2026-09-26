/**
 * Dựng báo cáo SonarQube Cloud từ dữ liệu API đã tải. Thuần JS — không gọi
 * mạng, không đọc file — để test được và để agent/người đọc cùng một định dạng.
 * Phần gọi API nằm ở fetch-report.mjs.
 */

/** Tên dễ hiểu cho các điều kiện Quality Gate hay gặp. */
const METRIC_LABEL = {
  new_reliability_rating: 'Độ tin cậy (mã mới)',
  new_security_rating: 'Bảo mật (mã mới)',
  new_maintainability_rating: 'Khả năng bảo trì (mã mới)',
  new_duplicated_lines_density: 'Tỷ lệ dòng trùng lặp (mã mới, %)',
  new_security_hotspots_reviewed: 'Hotspot đã xem xét (mã mới, %)',
  new_coverage: 'Độ phủ test (mã mới, %)',
  reliability_rating: 'Độ tin cậy',
  security_rating: 'Bảo mật',
  sqale_rating: 'Khả năng bảo trì',
  duplicated_lines_density: 'Tỷ lệ dòng trùng lặp (%)',
  coverage: 'Độ phủ test (%)',
  bugs: 'Bug',
  vulnerabilities: 'Lỗ hổng',
  code_smells: 'Code smell',
  security_hotspots: 'Security hotspot',
  ncloc: 'Số dòng code',
};

/** Rating của Sonar là số 1–5 tương ứng A–E. */
const RATING_METRICS = new Set([
  'new_reliability_rating',
  'new_security_rating',
  'new_maintainability_rating',
  'reliability_rating',
  'security_rating',
  'sqale_rating',
]);

export function metricLabel(key) {
  return METRIC_LABEL[key] ?? key;
}

export function formatMetricValue(key, value) {
  if (value === undefined || value === null || value === '') return '—';
  if (RATING_METRICS.has(key)) {
    const index = Math.round(Number(value)) - 1;
    return 'ABCDE'[index] ?? String(value);
  }
  return String(value);
}

/** Mức nghiêm trọng gộp: ưu tiên impact (thang mới), rơi về severity cũ. */
const IMPACT_RANK = { BLOCKER: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };
const LEGACY_TO_IMPACT = { BLOCKER: 'BLOCKER', CRITICAL: 'HIGH', MAJOR: 'MEDIUM', MINOR: 'LOW', INFO: 'INFO' };
const QUALITY_LABEL = { SECURITY: 'Bảo mật', RELIABILITY: 'Tin cậy', MAINTAINABILITY: 'Bảo trì' };

/**
 * Chuẩn hoá một issue của API thành dạng gọn, đủ để phân loại và sửa.
 * @param {Record<string, any>} issue
 * @param {string} projectKey
 */
export function normalizeIssue(issue, projectKey) {
  const impacts = Array.isArray(issue.impacts) ? issue.impacts : [];
  const top = impacts
    .slice()
    .sort((a, b) => (IMPACT_RANK[b.severity] ?? 0) - (IMPACT_RANK[a.severity] ?? 0))[0];
  const severity = top?.severity ?? LEGACY_TO_IMPACT[issue.severity] ?? 'INFO';
  const quality =
    top?.softwareQuality ??
    (issue.type === 'VULNERABILITY' ? 'SECURITY' : issue.type === 'BUG' ? 'RELIABILITY' : 'MAINTAINABILITY');
  const prefix = `${projectKey}:`;
  const file = typeof issue.component === 'string' && issue.component.startsWith(prefix)
    ? issue.component.slice(prefix.length)
    : String(issue.component ?? '');
  return {
    key: String(issue.key),
    rule: String(issue.rule ?? ''),
    severity,
    quality,
    file,
    line: typeof issue.line === 'number' ? issue.line : null,
    message: String(issue.message ?? '').replace(/\s+/g, ' ').trim(),
    effort: issue.effort ?? null,
    created: issue.creationDate ?? null,
    updated: issue.updateDate ?? null,
  };
}

/** Sắp xếp: bảo mật → tin cậy → bảo trì, trong mỗi nhóm nặng trước, rồi theo file/dòng. */
export function sortIssues(issues) {
  const qualityRank = { SECURITY: 3, RELIABILITY: 2, MAINTAINABILITY: 1 };
  return issues.slice().sort(
    (a, b) =>
      (qualityRank[b.quality] ?? 0) - (qualityRank[a.quality] ?? 0) ||
      (IMPACT_RANK[b.severity] ?? 0) - (IMPACT_RANK[a.severity] ?? 0) ||
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0),
  );
}

/** Đếm theo một khoá. */
export function countBy(items, pick) {
  const counts = new Map();
  for (const item of items) counts.set(pick(item), (counts.get(pick(item)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Chữ trong issue do người khác (và công cụ) viết: bỏ ký tự điều khiển và cắt
 * gọn trước khi đưa vào báo cáo mà agent sẽ đọc. Nội dung vẫn chỉ là DỮ LIỆU.
 */
export function sanitize(text, max = 240) {
  let clean = '';
  for (const char of String(text)) {
    const code = char.charCodeAt(0);
    clean += code < 32 || code === 127 ? ' ' : char;
  }
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Báo cáo Markdown.
 * @param {{
 *   projectKey: string,
 *   scope: string,
 *   analysisDate: string | null,
 *   gate: { status: string, conditions: any[] } | null,
 *   measures: Record<string, string>,
 *   issues: ReturnType<typeof normalizeIssue>[],
 *   hotspots: { file: string, line: number | null, message: string, rule: string, probability: string }[],
 *   truncated: boolean,
 * }} data
 */
export function renderReport(data) {
  const out = [];
  const gateIcon = data.gate?.status === 'OK' ? '✅' : data.gate?.status === 'ERROR' ? '❌' : '⚠️';
  out.push(`# SonarQube Cloud — ${data.projectKey} (${data.scope})`);
  out.push(`Lần phân tích gần nhất: ${data.analysisDate ?? 'không rõ'}`);
  out.push('');
  out.push(`## Quality Gate: ${gateIcon} ${data.gate?.status ?? 'không đọc được'}`);
  for (const condition of data.gate?.conditions ?? []) {
    const icon = condition.status === 'OK' ? '✓' : '✗';
    out.push(
      `- ${icon} ${metricLabel(condition.metricKey)}: ${formatMetricValue(condition.metricKey, condition.actualValue)}` +
        ` (ngưỡng ${condition.comparator === 'GT' ? '≤' : '≥'} ${formatMetricValue(condition.metricKey, condition.errorThreshold)})`,
    );
  }
  out.push('');

  const measureKeys = Object.keys(data.measures);
  if (measureKeys.length > 0) {
    out.push('## Chỉ số');
    for (const key of measureKeys) {
      out.push(`- ${metricLabel(key)}: ${formatMetricValue(key, data.measures[key])}`);
    }
    out.push('');
  }

  const issues = sortIssues(data.issues);
  out.push(`## Issue chưa xử lý: ${issues.length}${data.truncated ? ' (đã cắt bớt — dùng --limit lớn hơn)' : ''}`);
  const byQuality = countBy(issues, (issue) => `${QUALITY_LABEL[issue.quality] ?? issue.quality} ${issue.severity}`);
  if (byQuality.length > 0) out.push(byQuality.map(([k, v]) => `${k}: ${v}`).join(' · '));
  out.push('');

  const rules = countBy(issues, (issue) => issue.rule).slice(0, 10);
  if (rules.length > 0) {
    out.push('### Luật gặp nhiều nhất');
    for (const [rule, count] of rules) {
      const sample = issues.find((issue) => issue.rule === rule);
      out.push(`- \`${rule}\` × ${count} — ${sanitize(sample?.message ?? '', 120)}`);
    }
    out.push('');
  }

  out.push('### Danh sách (bảo mật → tin cậy → bảo trì)');
  for (const issue of issues) {
    const where = issue.line ? `${issue.file}:${issue.line}` : issue.file;
    out.push(
      `- [${QUALITY_LABEL[issue.quality] ?? issue.quality}/${issue.severity}] \`${where}\` \`${issue.rule}\` — ${sanitize(issue.message)}`,
    );
  }
  out.push('');

  out.push(`## Security hotspot cần xem xét: ${data.hotspots.length}`);
  for (const hotspot of data.hotspots) {
    const where = hotspot.line ? `${hotspot.file}:${hotspot.line}` : hotspot.file;
    out.push(`- [${hotspot.probability}] \`${where}\` \`${hotspot.rule}\` — ${sanitize(hotspot.message)}`);
  }
  return `${out.join('\n')}\n`;
}
