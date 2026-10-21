#!/usr/bin/env node
import { chmodSync, cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCompose } from './lib/compose.mjs';
import { findConfig, loadConfig } from './lib/config.mjs';
import { ensurePlaywright, findPwFfmpeg, installPwFfmpeg, isPlaywrightReady, PLUGIN_ROOT, readManifest } from './lib/deps.mjs';
import { extractFrames } from './lib/frames.mjs';
import { runRecord } from './lib/record.mjs';
import { resolveEdgeTts, runTts } from './lib/tts.mjs';
import { ensureDir, hasBinary, installHint } from './lib/util.mjs';
import { normalizeGender, resolveVoice, VOICE_PRESETS } from './lib/voices.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, 'templates', 'project');
const CLI = join(HERE, 'cli.mjs');
const MANIFEST = readManifest();

const HELP = `demo-video —— 旁白驱动的演示视频流水线（v${MANIFEST.version}）

用法：
  demo-video setup    [--link] [--force] 一键安装依赖（playwright / 录屏 ffmpeg），--link 生成全局 demo-video 命令
  demo-video doctor                     检查 node / ffmpeg / edge-tts / playwright / 录屏 ffmpeg
  demo-video init <目录> [--force]      生成新项目脚手架（配置 / 文稿 / overlay）
  demo-video voices   [--gender male|female]
                                        列出内置解说音色（角色 / 男女声）
  demo-video tts      [--scenes a,b] [--no-vtt] [--voice <音色或角色>] [--role <角色>] [--gender male|female]
                                        合成旁白 mp3 + 句级 VTT + durations.json
  demo-video record   [--scenes a,b] [--dry] [--no-record] [--force]
                                        分幕录屏（--dry 每幕 8s 彩排；--no-record 只跑操作链）
                                        素材幕 scene.asset：视频自动适配画幅，多图按 VTT 句首切换
                                        终端幕 scene.terminal：asciinema v2 .cast 回放成终端画面
                                        断点续做：已有录屏且比输入（配置/画面源/音频）新时跳过，--force 强制重录
  demo-video compose  [--force]         按音频时长合成并拼接成片（已合成的分幕默认复用）
  demo-video frames   --at 3,8 [--scene m1] [--width 1280]
                                        抽帧验收（--scene 时 --at 为该幕内相对秒）
  demo-video all      [--scenes a,b] [--dry] [--no-record] [--force] [--at 3,8] [--role <角色>]
                                        tts → record → compose（带 --at 时追加抽帧）

通用参数：
  --config <path>   指定项目配置，默认从当前目录向上查找 demo-video.config.mjs（也可用 DV_CONFIG）
  --voice <id|角色> 任意 edge-tts voice id，或 voices 列出的角色 key（warm / news / sunny…）
  --role <角色>     按角色选音色，覆盖配置里的 tts.role
  --gender <性别>   male / female（也接受 男 / 女），覆盖配置里的 tts.gender

环境变量：
  DV_HOME / DV_CONFIG / DV_TTS_PROXY / EDGE_TTS / DV_BASE_URL / DV_NO_AUTO_INSTALL

示例：
  node "${CLI}" setup
  node "${CLI}" voices --gender male
  node "${CLI}" tts --role news --config "${join(HERE, '..', 'examples', 'hello-video', 'demo-video.config.mjs')}"
`;

function parseArgs(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      if (inline !== undefined) flags[k] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else {
      flags._.push(a);
    }
  }
  return flags;
}

function init(flags) {
  const target = resolve(flags._[1] || 'demo-video');
  if (existsSync(target) && readdirSync(target).length && !flags.force) {
    throw new Error(`${target} 已存在且非空；如需覆盖请加 --force`);
  }
  cpSync(TEMPLATE, target, { recursive: true, force: !!flags.force });
  // 模板中的 gitignore 重命名为 .gitignore（避免 npm/Git 对模板目录做特殊处理）
  const tplIgnore = join(target, 'gitignore');
  if (existsSync(tplIgnore) && !existsSync(join(target, '.gitignore'))) {
    renameSync(tplIgnore, join(target, '.gitignore'));
  }
  console.log(`✓ 已创建项目 ${target}\n`);
  console.log('下一步：');
  console.log('  1) 编辑 narration.md（每幕以 "## m00 · 片头" 开头）与 overlay/*.html');
  console.log(`  2) node "${CLI}" tts --config "${join(target, 'demo-video.config.mjs')}"`);
  console.log(`  3) node "${CLI}" record --config "${join(target, 'demo-video.config.mjs')}"`);
  console.log(`  4) node "${CLI}" compose --config "${join(target, 'demo-video.config.mjs')}"`);
  console.log(`  5) node "${CLI}" frames --at 3,8 --config "${join(target, 'demo-video.config.mjs')}"`);
}

/** 生成全局 demo-video 启动器（POSIX）；升级插件后启动器会动态解析最新版本目录 */
function linkCli(force) {
  if (process.platform === 'win32') {
    console.log('· Windows 请直接用 node <插件>/engine/cli.mjs，或在 PATH 中自行添加包装脚本');
    return;
  }
  const binDir = process.env.DV_BIN_DIR || join(homedir(), '.local', 'bin');
  const file = join(binDir, 'demo-video');
  const content = `#!/bin/sh
# demo-video-agent launcher（由 demo-video setup --link 生成）
# 多市场（local / qoder-marketplace…）并存时按版本号取最新安装副本
DV_ROOT="\${DV_HOME:-$(ls -d "$HOME/.qoder/plugins/cache"/*/demo-video-agent/* 2>/dev/null | while read -r p; do echo "\$(basename "$p") $p"; done | sort -V | tail -1 | cut -d' ' -f2-)}"
if [ -z "$DV_ROOT" ]; then
  echo "未找到 demo-video-agent 插件；请先安装插件，或用 DV_HOME 指定插件根目录" >&2
  exit 1
fi
exec node "$DV_ROOT/engine/cli.mjs" "$@"
`;
  if (existsSync(file) && !force && !readFileSync(file, 'utf8').includes('demo-video-agent launcher')) {
    throw new Error(`${file} 已存在且不是本插件的启动器；确认覆盖请加 --force`);
  }
  ensureDir(binDir);
  writeFileSync(file, content, 'utf8');
  chmodSync(file, 0o755);
  console.log(`✓ 已生成命令 ${file}（确保 ${binDir} 在 PATH 中）`);
}

/** 一键安装插件自身依赖：playwright 模块 + Playwright 录屏 ffmpeg */
async function setup(flags) {
  console.log(`插件目录 ${PLUGIN_ROOT}`);
  let failed = false;

  if (isPlaywrightReady()) {
    console.log('✓ playwright 模块已就绪');
  } else {
    console.log('→ 安装 playwright 依赖…');
    try {
      ensurePlaywright(process.cwd());
      console.log('✓ playwright 已安装');
    } catch (e) {
      failed = true;
      console.log(`✗ ${e.message}`);
    }
  }

  const pwFfmpeg = findPwFfmpeg();
  if (pwFfmpeg) {
    console.log(`✓ pw-ffmpeg ${pwFfmpeg}`);
  } else {
    console.log('→ 安装 Playwright 录屏 ffmpeg…');
    if (installPwFfmpeg()) console.log('✓ pw-ffmpeg 已安装');
    else {
      failed = true;
      console.log('✗ playwright install ffmpeg 失败（网络受限时可稍后重试）');
    }
  }

  if (flags.link) {
    try {
      linkCli(!!flags.force);
    } catch (e) {
      failed = true;
      console.log(`✗ ${e.message}`);
    }
  }

  console.log('');
  await doctor(flags);
  if (failed) process.exitCode = 1;
}

async function doctor(flags) {
  const rows = [];
  let failed = false;
  const ok = (name, detail) => rows.push(['✓', name, detail]);
  const bad = (name, detail) => {
    failed = true;
    rows.push(['✗', name, detail]);
  };
  const note = (name, detail) => rows.push(['·', name, detail]);

  ok('plugin', `${MANIFEST.name} v${MANIFEST.version} · ${PLUGIN_ROOT}`);

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) ok('node', process.versions.node);
  else bad('node', `${process.versions.node}（需要 >= 18）`);

  for (const bin of ['ffmpeg', 'ffprobe']) {
    if (hasBinary(bin)) ok(bin, '可执行');
    else bad(bin, `未安装：${installHint(bin)}`);
  }

  const edge = resolveEdgeTts({ tts: { edgeTtsBin: flags['edge-tts'] || '' } });
  if (edge) ok('edge-tts', edge.label);
  else bad('edge-tts', '未安装：pip install edge-tts，或配置 tts.edgeTtsBin');

  if (isPlaywrightReady()) {
    ok('playwright', '模块可用（channel 不可用时自动回退内置 chromium）');
    const pwFfmpeg = findPwFfmpeg();
    if (pwFfmpeg) ok('pw-ffmpeg', pwFfmpeg);
    else bad('pw-ffmpeg', '录屏依赖：demo-video setup 或 npx playwright install ffmpeg');
  } else {
    bad('playwright', '未安装：运行 demo-video setup');
    const pwFfmpeg = findPwFfmpeg();
    if (pwFfmpeg) ok('pw-ffmpeg', pwFfmpeg);
    else note('pw-ffmpeg', '待 playwright 安装后由 setup 处理');
  }

  const cfgPath = findConfig(flags.config);
  if (existsSync(cfgPath)) {
    try {
      const cfg = await loadConfig(cfgPath);
      const kinds = cfg.scenes.map((s) => (s.terminal ? 'terminal' : s.asset ? 'asset' : s.overlay ? 'overlay' : 'run'));
      const dist = Object.entries(kinds.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {}))
        .map(([k, n]) => `${k} ${n}`)
        .join(' · ');
      ok('config', `${cfg.scenes.length} 幕（${dist}）· ${cfg.projectDir}`);
      ok('voice', `${cfg.tts.voice}（${cfg.tts.voicePreset || '自定义音色'}）`);
    } catch (e) {
      bad('config', `${cfgPath}：${e.message}`);
    }
  } else {
    note('config', `未找到 ${cfgPath}（init 后可检查）`);
  }

  for (const [mark, name, detail] of rows) {
    console.log(`${mark} ${String(name).padEnd(10)} ${detail}`);
  }
  if (failed) console.log('\n→ 运行 demo-video setup 可自动安装 playwright 与录屏 ffmpeg');
  process.exitCode = failed ? 1 : 0;
}

/** 列出内置解说音色；配置可读时用 ✓ 标出当前音色 */
async function listVoices(flags) {
  const gender = normalizeGender(flags.gender);
  if (flags.gender && !gender) throw new Error(`未知性别 ${flags.gender}；可用：male / female（或 男 / 女）`);

  let current = '';
  try {
    const cfgPath = findConfig(flags.config);
    if (existsSync(cfgPath)) current = (await loadConfig(cfgPath)).tts.voice;
  } catch {
    /* 配置不可用时只列目录 */
  }

  console.log('内置解说音色（edge-tts）：\n');
  for (const p of VOICE_PRESETS) {
    if (gender && p.gender !== gender) continue;
    const mark = p.voice === current ? '✓' : ' ';
    console.log(`${mark} ${p.key} · ${p.label} · ${p.gender === 'male' ? '男声' : '女声'} · ${p.voice} —— ${p.tone}`);
  }
  console.log('\n配置：tts: { role: \'news\' } / tts: { gender: \'male\' } / tts: { voice: \'zh-CN-YunxiNeural\' }');
  console.log('单幕换人：{ id: \'m01\', role: \'sunny\', overlay: ... }');
  console.log('临时试听：demo-video tts --role steady --scenes m00');
}

/** --voice / --role / --gender 覆盖配置里的音色 */
function applyVoiceFlags(cfg, flags) {
  if (!flags.voice && !flags.role && !flags.gender) return;
  const tts = { ...cfg.tts };
  if (flags.voice) {
    tts.voice = String(flags.voice);
    tts.role = '';
    tts.gender = '';
  } else if (flags.role) {
    tts.voice = '';
    tts.role = String(flags.role);
    tts.gender = '';
  } else {
    tts.voice = '';
    tts.role = '';
    tts.gender = String(flags.gender);
  }
  const picked = resolveVoice(tts);
  cfg.tts.voice = picked.voice;
  cfg.tts.voicePreset = picked.preset?.label || '';
  cfg.tts.voiceSource = 'cli';
  console.log(`· 本次音色 ${picked.voice}${picked.preset ? `（${picked.preset.label}）` : ''}`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cmd = flags._[0] || 'help';
  if (flags.version || cmd === 'version') {
    console.log(`${MANIFEST.name} v${MANIFEST.version}`);
    return;
  }
  if (cmd === 'help' || flags.help) {
    console.log(HELP);
    return;
  }
  if (cmd === 'init') return init(flags);
  if (cmd === 'setup') return setup(flags);
  if (cmd === 'doctor') return doctor(flags);
  if (cmd === 'voices') return listVoices(flags);

  const cfg = await loadConfig(findConfig(flags.config));
  applyVoiceFlags(cfg, flags);
  const scenes = flags.scenes
    ? String(flags.scenes).split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const frameOpts = {
    at: flags.at,
    scene: flags.scene,
    width: flags.width ? Number(flags.width) : 0,
  };

  switch (cmd) {
    case 'tts':
      await runTts(cfg, { scenes, vtt: !flags['no-vtt'] });
      break;
    case 'record':
      await runRecord(cfg, { scenes, dry: !!flags.dry, noRecord: !!flags['no-record'], force: !!flags.force });
      break;
    case 'compose':
      runCompose(cfg, { force: !!flags.force });
      break;
    case 'frames':
      extractFrames(cfg, frameOpts);
      break;
    case 'all': {
      await runTts(cfg, { scenes, vtt: !flags['no-vtt'] });
      await runRecord(cfg, { scenes, dry: !!flags.dry, noRecord: !!flags['no-record'], force: !!flags.force });
      if (!flags['no-record']) runCompose(cfg, { force: !!flags.force });
      if (flags.at && !flags['no-record']) extractFrames(cfg, frameOpts);
      break;
    }
    default:
      throw new Error(`未知命令 ${cmd}\n\n${HELP}`);
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exitCode = 1;
});
