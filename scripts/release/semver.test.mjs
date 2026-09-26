import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  bumpVersion,
  classifyCommit,
  decideBump,
  parseVersion,
  readRuntimeMarker,
  releaseNotes,
  runtimeMarker,
} from './semver.mjs';

const c = (subject, body = '') => ({ subject, body });

describe('parseVersion / bumpVersion', () => {
  test('đọc cả có và không có tiền tố v', () => {
    assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3 });
    assert.deepEqual(parseVersion('10.0.25'), { major: 10, minor: 0, patch: 25 });
  });

  test('từ chối chuỗi không phải X.Y.Z', () => {
    for (const bad of ['1.2', 'v1.2.3-beta', 'Preview', '', '1.2.3.4']) {
      assert.throws(() => parseVersion(bad), /không hợp lệ/);
    }
  });

  test('tăng đúng và đặt lại các số sau', () => {
    assert.equal(bumpVersion('1.0.1', 'patch'), '1.0.2');
    assert.equal(bumpVersion('1.0.1', 'minor'), '1.1.0');
    assert.equal(bumpVersion('1.4.9', 'major'), '2.0.0');
    assert.equal(bumpVersion('v1.9.9', 'minor'), '1.10.0');
  });
});

describe('classifyCommit', () => {
  test('feat → minor, fix/perf/refactor → patch', () => {
    assert.equal(classifyCommit(c('feat(web): bản web cho iPhone')).bump, 'minor');
    assert.equal(classifyCommit(c('fix(money): sửa vòng nợ')).bump, 'patch');
    assert.equal(classifyCommit(c('perf: nhanh hơn')).bump, 'patch');
    assert.equal(classifyCommit(c('refactor(data): tách hàm')).bump, 'patch');
  });

  test('dấu ! hoặc BREAKING CHANGE → major', () => {
    assert.equal(classifyCommit(c('feat(auth)!: bỏ đăng nhập khách')).bump, 'major');
    assert.equal(classifyCommit(c('fix: đổi RPC', 'BREAKING CHANGE: app cũ không gọi được')).bump, 'major');
  });

  test('docs/chore/ci/test/style/build không phát hành', () => {
    for (const type of ['docs', 'chore', 'ci', 'test', 'style', 'build']) {
      assert.equal(classifyCommit(c(`${type}: việc nội bộ`)).bump, 'none', type);
    }
  });

  test('tiêu đề không theo quy ước vẫn là một bản sửa', () => {
    assert.equal(classifyCommit(c('Readme')).bump, 'patch');
    assert.equal(classifyCommit(c('Version 1.0.1: Weather forecast')).bump, 'patch');
  });

  test('commit phát hành do máy tạo bị bỏ qua', () => {
    const info = classifyCommit(c('chore(release): v1.1.0 [skip ci]'));
    assert.equal(info.bump, 'none');
    assert.equal(info.release, false);
  });

  test('kiểu lạ theo quy ước vẫn tính patch', () => {
    assert.equal(classifyCommit(c('ui: đổi màu nút')).bump, 'patch');
  });
});

describe('decideBump', () => {
  test('lấy mức cao nhất của cả loạt', () => {
    assert.equal(decideBump([c('fix: a'), c('feat: b'), c('docs: c')]), 'minor');
    assert.equal(decideBump([c('fix: a'), c('feat!: b')]), 'major');
    assert.equal(decideBump([c('docs: a'), c('ci: b'), c('chore(release): v1.0.2')]), 'none');
    assert.equal(decideBump([]), 'none');
  });
});

describe('releaseNotes', () => {
  test('nhóm theo loại, bỏ việc nội bộ và commit phát hành, không lặp dòng', () => {
    const notes = releaseNotes([
      c('feat(web): bản web cho iPhone'),
      c('fix(money): sửa vòng nợ'),
      c('fix(money): sửa vòng nợ'),
      c('docs: cập nhật README'),
      c('chore(release): v1.0.2'),
      c('Readme'),
    ]);
    assert.match(notes, /### ✨ Tính năng mới\n- Bản web cho iPhone/);
    assert.match(notes, /### 🐛 Sửa lỗi và cải thiện\n- Sửa vòng nợ\n- Readme/);
    assert.doesNotMatch(notes, /cập nhật README|chore|v1\.0\.2/);
    assert.equal(notes.match(/Sửa vòng nợ/g)?.length, 1);
  });

  test('không có gì cho người dùng → chuỗi rỗng', () => {
    assert.equal(releaseNotes([c('ci: a'), c('test: b')]), '');
  });
});

describe('runtime marker', () => {
  test('ghi rồi đọc lại đúng', () => {
    const notes = `Ghi chú\n\n${runtimeMarker('5886bda335530291a2835f8455c214f2f8b10855')}\n`;
    assert.equal(readRuntimeMarker(notes), '5886bda335530291a2835f8455c214f2f8b10855');
  });

  test('lấy dấu cuối cùng — dấu giả chèn qua tiêu đề commit không thắng dấu thật', () => {
    const notes = `- Sửa <!-- divvyup-runtime: fake -->\n\n${runtimeMarker('real123')}`;
    assert.equal(readRuntimeMarker(notes), 'real123');
  });

  test('ghi chú phát hành bỏ dấu comment HTML trong tiêu đề commit', () => {
    const notes = releaseNotes([c('fix: typo <!-- divvyup-runtime: fake -->')]);
    assert.doesNotMatch(notes, /<!--|-->/);
    assert.equal(readRuntimeMarker(notes), null);
  });

  test('ghi chú cũ không có dấu → null (coi như native đã đổi)', () => {
    assert.equal(readRuntimeMarker('Bản 1.0.1'), null);
    assert.equal(readRuntimeMarker(null), null);
  });
});
