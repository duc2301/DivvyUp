#!/usr/bin/env node
/**
 * Chuẩn bị một bản phát hành: tìm tag trước, đọc commit từ đó tới HEAD, quyết
 * định số phiên bản kế tiếp và soạn ghi chú.
 *
 *   node scripts/release/prepare.mjs                 xem trước (không ghi gì)
 *   node scripts/release/prepare.mjs --bump minor    ép mức tăng (auto|patch|minor|major)
 *   node scripts/release/prepare.mjs --write         ghi version mới vào app.json + package.json
 *   node scripts/release/prepare.mjs --json          in kế hoạch dạng JSON (cho workflow)
 *
 * Dùng chung cho workflow auto-release.yml và cho người chạy tay — một luật duy nhất.
 * Luật tăng số: scripts/release/semver.mjs.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bumpVersion, decideBump, parseVersion, releaseNotes } from './semver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim();

/** Tag phát hành gần nhất (vX.Y.Z) có trong lịch sử của HEAD; null nếu chưa có. */
function latestReleaseTag() {
  const tags = git('tag', '--merged', 'HEAD', '--list', 'v*', '--sort=-v:refname')
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  return tags[0] ?? null;
}

/** Commit từ sau tag tới HEAD (không tính merge). */
function commitsSince(tag) {
  const SEP = '\u001e';
  const END = '\u001f';
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const raw = git('log', range, '--no-merges', `--format=%s${SEP}%b${END}`);
  return raw
    .split(END)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [subject, body = ''] = chunk.split(SEP);
      return { subject: subject.trim(), body: body.trim() };
    });
}

const appJsonPath = path.join(root, 'app.json');
const packageJsonPath = path.join(root, 'package.json');

function appVersion() {
  return JSON.parse(readFileSync(appJsonPath, 'utf8')).expo.version;
}

/** Thay giá trị "version" đầu tiên của đúng khối cần sửa, giữ nguyên định dạng file. */
function writeVersion(file, pattern, version) {
  const text = readFileSync(file, 'utf8');
  if (!pattern.test(text)) throw new Error(`Không tìm thấy trường version trong ${path.basename(file)}`);
  writeFileSync(file, text.replace(pattern, (_, before) => `${before}"${version}"`));
}

const tag = latestReleaseTag();
const commits = commitsSince(tag);
const requested = option('--bump', 'auto');
if (!['auto', 'patch', 'minor', 'major'].includes(requested)) {
  throw new Error(`--bump phải là auto|patch|minor|major, nhận "${requested}"`);
}

// Mốc là tag trước. Chưa có tag nào thì lấy version đang ghi trong app.json.
const current = tag ? tag.slice(1) : appVersion();
parseVersion(current);
const bump = requested === 'auto' ? decideBump(commits) : requested;
const next = bump === 'none' ? null : bumpVersion(current, bump);

// app.json đã được sửa tay vượt trước tag (ví dụ 1.0.1 → 1.2.0) thì tôn trọng số đó.
const manual = appVersion();
const finalVersion =
  next && (() => {
    const a = parseVersion(manual);
    const b = parseVersion(next);
    const bigger = a.major !== b.major ? a.major > b.major : a.minor !== b.minor ? a.minor > b.minor : a.patch > b.patch;
    return bigger ? manual : next;
  })();

const plan = {
  previousTag: tag,
  current,
  bump,
  next: finalVersion,
  tag: finalVersion ? `v${finalVersion}` : null,
  commitCount: commits.length,
  notes: releaseNotes(commits),
};

if (flag('--write') && plan.next) {
  writeVersion(appJsonPath, /("expo"\s*:\s*\{[\s\S]*?"version"\s*:\s*)"[^"]*"/, plan.next);
  writeVersion(packageJsonPath, /^(\{[\s\S]*?"version"\s*:\s*)"[^"]*"/, plan.next);
}

if (flag('--json')) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
} else {
  console.log(`Bản trước : ${tag ?? '(chưa có tag)'} — ${commits.length} commit mới`);
  console.log(`Mức tăng  : ${bump}`);
  console.log(`Bản kế    : ${plan.tag ?? 'không cần phát hành (chỉ docs/ci/test/chore)'}`);
  if (plan.notes) console.log(`\n${plan.notes}`);
  if (flag('--write') && plan.next) console.log(`\nĐã ghi ${plan.next} vào app.json và package.json.`);
}
