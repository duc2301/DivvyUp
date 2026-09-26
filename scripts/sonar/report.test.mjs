import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatMetricValue, normalizeIssue, renderReport, sanitize, sortIssues } from './report.mjs';

const KEY = 'duc2301_DivvyUp';

const raw = (overrides) => ({
  key: 'k',
  rule: 'typescript:S1',
  severity: 'MAJOR',
  type: 'CODE_SMELL',
  component: `${KEY}:src/a.ts`,
  line: 3,
  message: 'msg',
  ...overrides,
});

describe('normalizeIssue', () => {
  test('bỏ tiền tố dự án khỏi đường dẫn, lấy impact nặng nhất', () => {
    const issue = normalizeIssue(
      raw({
        impacts: [
          { softwareQuality: 'MAINTAINABILITY', severity: 'LOW' },
          { softwareQuality: 'SECURITY', severity: 'HIGH' },
        ],
      }),
      KEY,
    );
    assert.equal(issue.file, 'src/a.ts');
    assert.equal(issue.severity, 'HIGH');
    assert.equal(issue.quality, 'SECURITY');
  });

  test('issue kiểu cũ (không có impacts) quy đổi từ severity/type', () => {
    const bug = normalizeIssue(raw({ type: 'BUG', severity: 'CRITICAL' }), KEY);
    assert.equal(bug.quality, 'RELIABILITY');
    assert.equal(bug.severity, 'HIGH');
    const vuln = normalizeIssue(raw({ type: 'VULNERABILITY', severity: 'MINOR' }), KEY);
    assert.equal(vuln.quality, 'SECURITY');
    assert.equal(vuln.severity, 'LOW');
  });

  test('issue cấp file không có dòng', () => {
    assert.equal(normalizeIssue(raw({ line: undefined }), KEY).line, null);
  });
});

describe('sortIssues', () => {
  test('bảo mật trước, rồi tin cậy, rồi bảo trì; nặng trước nhẹ', () => {
    const issues = [
      { file: 'a', line: 1, quality: 'MAINTAINABILITY', severity: 'HIGH' },
      { file: 'b', line: 1, quality: 'SECURITY', severity: 'LOW' },
      { file: 'c', line: 1, quality: 'RELIABILITY', severity: 'MEDIUM' },
      { file: 'd', line: 1, quality: 'SECURITY', severity: 'HIGH' },
    ];
    assert.deepEqual(
      sortIssues(issues).map((issue) => issue.file),
      ['d', 'b', 'c', 'a'],
    );
  });
});

describe('formatMetricValue', () => {
  test('rating 1–5 thành A–E, giá trị khác giữ nguyên', () => {
    assert.equal(formatMetricValue('new_reliability_rating', '4'), 'D');
    assert.equal(formatMetricValue('security_rating', '1.0'), 'A');
    assert.equal(formatMetricValue('new_duplicated_lines_density', '5.0'), '5.0');
    assert.equal(formatMetricValue('coverage', undefined), '—');
  });
});

describe('sanitize', () => {
  test('bỏ ký tự điều khiển và xuống dòng, cắt độ dài', () => {
    const text = `a${String.fromCharCode(0)}b${String.fromCharCode(10)}c${String.fromCharCode(27)}[31m`;
    assert.equal(sanitize(text), 'a b c [31m');
    assert.equal(sanitize('x'.repeat(10), 5), 'xxxx…');
  });
});

describe('renderReport', () => {
  test('có Quality Gate, điều kiện đổi rating ra chữ, danh sách theo thứ tự ưu tiên', () => {
    const text = renderReport({
      projectKey: KEY,
      scope: 'nhánh chính, mã mới',
      analysisDate: '2026-09-26T05:48:49+0000',
      gate: {
        status: 'ERROR',
        conditions: [
          { status: 'ERROR', metricKey: 'new_reliability_rating', comparator: 'GT', errorThreshold: '1', actualValue: '4' },
        ],
      },
      measures: { bugs: '4' },
      issues: [
        normalizeIssue(raw({ key: '1', message: 'nhỏ', severity: 'MINOR' }), KEY),
        normalizeIssue(raw({ key: '2', type: 'VULNERABILITY', severity: 'MAJOR', message: 'lộ', component: `${KEY}:b.yml`, line: 9 }), KEY),
      ],
      hotspots: [],
      truncated: false,
    });
    assert.match(text, /Quality Gate: ❌ ERROR/);
    assert.match(text, /✗ Độ tin cậy \(mã mới\): D \(ngưỡng ≤ A\)/);
    assert.match(text, /Issue chưa xử lý: 2/);
    assert.ok(text.indexOf('b.yml:9') < text.indexOf('src/a.ts:3'), 'bảo mật phải đứng trước bảo trì');
  });
});
