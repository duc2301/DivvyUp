#!/usr/bin/env node
/**
 * Đọc kết quả phân tích của SonarQube Cloud qua Web API.
 *
 *   node scripts/sonar/fetch-report.mjs                 toàn bộ issue chưa xử lý (nhánh chính)
 *   node scripts/sonar/fetch-report.mjs --new           chỉ issue trong "mã mới" (thứ Quality Gate chấm)
 *   node scripts/sonar/fetch-report.mjs --pr 12         kết quả của pull request
 *   node scripts/sonar/fetch-report.mjs --branch dev    kết quả của một nhánh
 *   node scripts/sonar/fetch-report.mjs --quality SECURITY,RELIABILITY
 *   node scripts/sonar/fetch-report.mjs --json --out report.json
 *
 * Dự án công khai đọc được không cần đăng nhập. Dự án riêng tư: đặt biến môi
 * trường SONAR_TOKEN (token của SonarQube Cloud, quyền Browse). Token chỉ đi vào
 * header, KHÔNG bao giờ được in ra.
 *
 * Khoá dự án: --project, rồi SONAR_PROJECT_KEY, mặc định duc2301_DivvyUp.
 * Máy chủ: SONAR_HOST_URL, mặc định https://sonarcloud.io.
 */

import { writeFileSync } from 'node:fs';

import { normalizeIssue, renderReport } from './report.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
};

const host = (process.env.SONAR_HOST_URL ?? 'https://sonarcloud.io').replace(/\/+$/, '');
const projectKey = option('--project', process.env.SONAR_PROJECT_KEY ?? 'duc2301_DivvyUp');
const branch = option('--branch');
const pullRequest = option('--pr');
const onlyNew = flag('--new');
const qualities = option('--quality');
const limit = Math.min(Number(option('--limit', '2000')) || 2000, 10_000);

if (!/^[\w.:-]+$/.test(projectKey)) throw new Error(`Khoá dự án không hợp lệ: ${projectKey}`);

const token = process.env.SONAR_TOKEN;
const headers = token ? { Authorization: `Bearer ${token}` } : {};

/** Tham số chọn nhánh / PR dùng chung cho mọi lệnh gọi. */
function scopeParams() {
  const params = new URLSearchParams();
  if (pullRequest) params.set('pullRequest', pullRequest);
  else if (branch) params.set('branch', branch);
  return params;
}

async function get(path, params) {
  const url = `${host}/api/${path}?${params.toString()}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const hint =
      response.status === 401 || response.status === 403
        ? ' — dự án riêng tư? Đặt SONAR_TOKEN (không dán token vào lệnh hay file).'
        : response.status === 404
          ? ' — sai khoá dự án/nhánh/PR, hoặc chưa có lần phân tích nào.'
          : '';
    throw new Error(`Sonar API ${path} trả ${response.status}${hint} ${body.slice(0, 200)}`);
  }
  return response.json();
}

async function fetchGate() {
  const params = scopeParams();
  params.set('projectKey', projectKey);
  const data = await get('qualitygates/project_status', params);
  return data.projectStatus ?? null;
}

async function fetchMeasures() {
  const params = scopeParams();
  params.set('component', projectKey);
  params.set(
    'metricKeys',
    [
      'bugs',
      'vulnerabilities',
      'code_smells',
      'security_hotspots',
      'reliability_rating',
      'security_rating',
      'sqale_rating',
      'duplicated_lines_density',
      'coverage',
      'ncloc',
    ].join(','),
  );
  const data = await get('measures/component', params);
  const measures = {};
  for (const measure of data.component?.measures ?? []) measures[measure.metric] = measure.value;
  return measures;
}

async function fetchIssues() {
  const all = [];
  let page = 1;
  let total = 0;
  for (;;) {
    const params = scopeParams();
    params.set('componentKeys', projectKey);
    params.set('resolved', 'false');
    params.set('ps', '500');
    params.set('p', String(page));
    if (onlyNew) params.set('inNewCodePeriod', 'true');
    if (qualities) params.set('impactSoftwareQualities', qualities);
    const data = await get('issues/search', params);
    total = data.paging?.total ?? data.total ?? 0;
    all.push(...(data.issues ?? []));
    if (all.length >= total || all.length >= limit || (data.issues ?? []).length === 0) break;
    page += 1;
  }
  return { issues: all.slice(0, limit), truncated: total > limit };
}

async function fetchHotspots() {
  const params = scopeParams();
  params.set('projectKey', projectKey);
  params.set('status', 'TO_REVIEW');
  params.set('ps', '500');
  if (onlyNew) params.set('inNewCodePeriod', 'true');
  const data = await get('hotspots/search', params);
  return (data.hotspots ?? []).map((hotspot) => ({
    file: String(hotspot.component ?? '').replace(`${projectKey}:`, ''),
    line: typeof hotspot.line === 'number' ? hotspot.line : null,
    message: String(hotspot.message ?? ''),
    rule: String(hotspot.ruleKey ?? ''),
    probability: String(hotspot.vulnerabilityProbability ?? ''),
  }));
}

async function fetchAnalysisDate() {
  const params = scopeParams();
  params.set('component', projectKey);
  const data = await get('components/show', params).catch(() => null);
  return data?.component?.analysisDate ?? null;
}

const [gate, measures, issueResult, hotspots, analysisDate] = await Promise.all([
  fetchGate(),
  fetchMeasures(),
  fetchIssues(),
  fetchHotspots(),
  fetchAnalysisDate(),
]);

const scope = [pullRequest ? `PR #${pullRequest}` : branch ? `nhánh ${branch}` : 'nhánh chính', onlyNew ? 'mã mới' : 'toàn bộ']
  .join(', ');

const report = {
  projectKey,
  scope,
  analysisDate,
  gate,
  measures,
  issues: issueResult.issues.map((issue) => normalizeIssue(issue, projectKey)),
  hotspots,
  truncated: issueResult.truncated,
};

const output = flag('--json') ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report);
const outFile = option('--out');
if (outFile) {
  writeFileSync(outFile, output);
  console.log(`Đã ghi ${outFile} — ${report.issues.length} issue, Quality Gate ${gate?.status ?? '?'}.`);
} else {
  process.stdout.write(output);
}
