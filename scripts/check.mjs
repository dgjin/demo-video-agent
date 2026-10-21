#!/usr/bin/env node
/**
 * 发布前一致性自检（CI 与本地共用）：
 * 1. manifest（plugin.json）必需字段与 marketplace 字段
 * 2. 版本一致：plugin.json / package.json / CHANGELOG 条目 / 技能 frontmatter
 * 3. 技能 / 子代理 / 命令文件与 frontmatter
 * 4. 文档防漂移：
 *    - 文档中出现的 `cli.mjs <子命令>` 必须是 CLI 真实支持的命令
 *    - 文档中的 DV_ROOT 定位片段必须与 cli.mjs 启动器垫片同源
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_ROOT, readManifest } from '../engine/lib/deps.mjs';

const errors = [];
const oks = [];
const ok = (msg) => oks.push(msg);
const fail = (msg) => errors.push(msg);

/** 读取文本，失败返回空串（交由调用方判定存在性） */
function readOr(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

// ── 1. manifest ─────────────────────────────────────────────
const manifest = readManifest();
if (manifest.version === '0.0.0') fail('.qoder-plugin/plugin.json 缺失或无法解析');
for (const field of ['name', 'version', 'description', 'license', 'keywords']) {
  const v = manifest[field];
  const bad = Array.isArray(v) ? v.length === 0 : !v;
  if (bad) fail(`manifest 缺少字段 ${field}`);
}
for (const field of ['displayName', 'descriptionZh', 'logo', 'repository']) {
  if (!manifest[field]) fail(`manifest 缺少 marketplace 字段 ${field}`);
}
if (manifest.name !== 'demo-video-agent') fail(`manifest name 异常：${manifest.name}`);
ok('manifest 字段完整');

// ── 2. 版本一致性 ────────────────────────────────────────────
const pkg = JSON.parse(readOr(join(PLUGIN_ROOT, 'package.json')) || '{}');
if (pkg.version !== manifest.version) {
  fail(`版本不一致：package.json ${pkg.version} vs plugin.json ${manifest.version}`);
}
const changelog = readOr(join(PLUGIN_ROOT, 'CHANGELOG.md'));
if (!changelog.includes(`## ${manifest.version} `)) {
  fail(`CHANGELOG.md 缺少 ${manifest.version} 的条目（## ${manifest.version} — 日期）`);
}
ok(`版本一致 v${manifest.version}`);

// ── 3. 技能 / 子代理 / 命令 ──────────────────────────────────
const skillFiles = readdirSync(join(PLUGIN_ROOT, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(PLUGIN_ROOT, 'skills', d.name, 'SKILL.md'));
if (!skillFiles.length) fail('skills/ 下没有 SKILL.md');
for (const file of skillFiles) {
  if (!existsSync(file)) {
    fail(`缺少 ${file.replace(PLUGIN_ROOT + '/', '')}`);
    continue;
  }
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) {
    fail(`${file.replace(PLUGIN_ROOT + '/', '')} 缺少 frontmatter`);
    continue;
  }
  for (const key of ['name', 'description', 'version']) {
    if (!new RegExp(`^${key}:\\s*\\S`, 'm').test(m[1])) {
      fail(`${file.replace(PLUGIN_ROOT + '/', '')} frontmatter 缺少 ${key}`);
    }
  }
  // 技能版本随插件版本一起升级（避免安装后无法判断新旧）
  const v = m[1].match(/^version:\s*(\S+)/m);
  if (v && v[1] !== manifest.version) {
    fail(`${file.replace(PLUGIN_ROOT + '/', '')} frontmatter version ${v[1]} 与 manifest ${manifest.version} 不一致`);
  }
}
for (const [dir, label] of [
  ['agents', '子代理'],
  ['commands', '命令'],
]) {
  const d = join(PLUGIN_ROOT, dir);
  if (!existsSync(d) || !readdirSync(d).some((f) => f.endsWith('.md'))) fail(`${dir}/ 下没有${label}文件`);
}
ok('技能 / 子代理 / 命令文件齐全');

// ── 4a. 子命令单一来源 ──────────────────────────────────────
const cliSrc = readOr(join(PLUGIN_ROOT, 'engine', 'cli.mjs'));
const commands = new Set(['help', 'version']);
for (const m of cliSrc.matchAll(/cmd === '([\w-]+)'/g)) commands.add(m[1]);
for (const m of cliSrc.matchAll(/case '([\w-]+)':/g)) commands.add(m[1]);
if (commands.size < 5) fail(`CLI 子命令解析异常（${[...commands].join(',')}），检查 cli.mjs 结构`);

const docFiles = [
  'README.md',
  'qoder.md',
  'commands/demo-video.md',
  'skills/demo-video-production/SKILL.md',
  'skills/demo-video-production/references/operating-manual.md',
  'skills/demo-video-production/references/pipeline-reference.md',
  'skills/demo-video-storyboard/SKILL.md',
].map((p) => join(PLUGIN_ROOT, p));

const unknown = new Map();
for (const file of docFiles) {
  const text = readOr(file);
  if (!text) {
    fail(`文档缺失：${file.replace(PLUGIN_ROOT + '/', '')}`);
    continue;
  }
  for (const m of text.matchAll(/cli\.mjs\s+([a-z][\w-]*)/g)) {
    if (!commands.has(m[1])) unknown.set(m[1], file.replace(PLUGIN_ROOT + '/', ''));
  }
}
if (unknown.size) {
  for (const [cmd, file] of unknown) fail(`文档引用了 CLI 不存在的子命令 "${cmd}"（${file}）`);
} else {
  ok(`文档子命令与 CLI 一致（${commands.size} 个）`);
}

// ── 4b. DV_ROOT 定位片段单一来源 ─────────────────────────────
// 从 cli.mjs 垫片与各文档中提取「ls -d … cut -d' ' -f2-」片段，去空白/转义后逐段比对，
// 这样跨行写法、JS 模板转义（\$）与纯 bash 写法都能正确对齐。
const squash = (s) => s.replace(/[\\\s]/g, '');
const extractLocator = (text) => [...text.matchAll(/ls -d[\s\S]*?cut -d\s*' '\s*-f2-/g)].map((m) => squash(m[0]));
const expectedLocator = extractLocator(cliSrc)[0];
if (!expectedLocator) {
  fail('cli.mjs 中未找到 DV_ROOT 定位片段（垫片被改动？同步更新 check.mjs）');
} else {
  const stale = [];
  for (const file of docFiles) {
    for (const found of extractLocator(readOr(file))) {
      if (found !== expectedLocator) {
        stale.push(`${file.replace(PLUGIN_ROOT + '/', '')}: ${found.slice(0, 90)}…`);
      }
    }
  }
  if (stale.length) {
    for (const s of stale) fail(`DV_ROOT 定位片段与 cli.mjs 不一致（多市场并存会取错版本）：${s}`);
  } else {
    ok('DV_ROOT 定位片段与 cli.mjs 同源');
  }
}

// ── 输出 ────────────────────────────────────────────────────
for (const m of oks) console.log(`✓ ${m}`);
for (const m of errors) console.error(`✗ ${m}`);
if (errors.length) {
  console.error(`\n自检失败：${errors.length} 项`);
  process.exitCode = 1;
} else {
  console.log(`\n自检通过（${oks.length} 项）`);
}
