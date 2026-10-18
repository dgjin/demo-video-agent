#!/usr/bin/env node
import { cpSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCompose } from './lib/compose.mjs';
import { loadConfig } from './lib/config.mjs';
import { extractFrames } from './lib/frames.mjs';
import { loadPlaywright, runRecord } from './lib/record.mjs';
import { resolveEdgeTts, runTts } from './lib/tts.mjs';
import { hasBinary } from './lib/util.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, 'templates', 'project');
const CLI = join(HERE, 'cli.mjs');

const HELP = `demo-video —— 旁白驱动的演示视频流水线

用法：
  demo-video init <目录> [--force]      生成新项目脚手架（配置 / 文稿 / overlay）
  demo-video doctor                     检查 node / ffmpeg / edge-tts / playwright / 录屏 ffmpeg
  demo-video tts      [--scenes a,b] [--no-vtt]
                                        合成旁白 mp3 + 句级 VTT + durations.json
  demo-video record   [--scenes a,b] [--dry] [--no-record]
                                        分幕录屏（--dry 每幕 8s 彩排；--no-record 只跑操作链）
  demo-video compose                    按音频时长合成并拼接成片
  demo-video frames   --at 3,8 [--scene m1] [--width 1280]
                                        抽帧验收（--scene 时 --at 为该幕内相对秒）
  demo-video all      [--scenes a,b] [--dry] [--no-record] [--at 3,8]
                                        tts → record → compose（带 --at 时追加抽帧）

通用参数：
  --config <path>   指定项目配置文件，默认 ./demo-video.config.mjs

示例：
  node ${CLI} tts --config examples/hello-video/demo-video.config.mjs
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
  console.log('  1) 编辑 narration.md（每幕 "## <幕ID> · <幕名>" 开头）与 overlay/*.html');
  console.log(`  2) node ${CLI} tts --config ${join(target, 'demo-video.config.mjs')}`);
  console.log(`  3) node ${CLI} record --config ${join(target, 'demo-video.config.mjs')}`);
  console.log(`  4) node ${CLI} compose --config ${join(target, 'demo-video.config.mjs')}`);
  console.log(`  5) node ${CLI} frames --at 3,8 --config ${join(target, 'demo-video.config.mjs')}`);
}

/** Playwright 录屏依赖它自带的 ffmpeg（ms-playwright/ffmpeg-*），未安装时录制会直接失败 */
function findPlaywrightFfmpeg() {
  const base =
    process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA || '', 'ms-playwright')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
        : join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(base)) return '';
  // ffmpeg revision 随 Playwright 版本递增：取最大且内部确实有可执行文件的目录
  const hit = readdirSync(base)
    .filter((name) => /^ffmpeg-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .find((name) => {
      const dir = join(base, name);
      return readdirSync(dir).some((f) => f.startsWith('ffmpeg-'));
    });
  return hit ? join(base, hit) : '';
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

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) ok('node', process.versions.node);
  else bad('node', `${process.versions.node}（需要 >= 18）`);

  for (const bin of ['ffmpeg', 'ffprobe']) {
    if (hasBinary(bin)) ok(bin, '可执行');
    else bad(bin, '未安装：brew install ffmpeg');
  }

  const edge = resolveEdgeTts({ tts: { edgeTtsBin: flags['edge-tts'] || '' } });
  if (edge) ok('edge-tts', edge);
  else bad('edge-tts', '未安装：pip install edge-tts，或配置 tts.edgeTtsBin');

  try {
    await loadPlaywright(process.cwd());
    ok('playwright', '模块可用（首次录制会自动使用本机 Chrome）');
    const pwFfmpeg = findPlaywrightFfmpeg();
    if (pwFfmpeg) ok('pw-ffmpeg', pwFfmpeg);
    else bad('pw-ffmpeg', '录屏依赖：npx playwright install ffmpeg');
  } catch (e) {
    bad('playwright', e.message);
  }

  const cfgPath = resolve(flags.config || 'demo-video.config.mjs');
  if (existsSync(cfgPath)) {
    const cfg = await loadConfig(cfgPath);
    ok('config', `${cfg.scenes.length} 幕 · ${cfg.projectDir}`);
  } else {
    note('config', `未找到 ${cfgPath}（init 后可检查）`);
  }

  for (const [mark, name, detail] of rows) {
    console.log(`${mark} ${String(name).padEnd(10)} ${detail}`);
  }
  process.exitCode = failed ? 1 : 0;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cmd = flags._[0] || 'help';
  if (cmd === 'help' || flags.help) {
    console.log(HELP);
    return;
  }
  if (cmd === 'init') return init(flags);
  if (cmd === 'doctor') return doctor(flags);

  const cfg = await loadConfig(resolve(flags.config || 'demo-video.config.mjs'));
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
      runTts(cfg, { scenes, vtt: !flags['no-vtt'] });
      break;
    case 'record':
      await runRecord(cfg, { scenes, dry: !!flags.dry, noRecord: !!flags['no-record'] });
      break;
    case 'compose':
      runCompose(cfg);
      break;
    case 'frames':
      extractFrames(cfg, frameOpts);
      break;
    case 'all': {
      runTts(cfg, { scenes, vtt: !flags['no-vtt'] });
      await runRecord(cfg, { scenes, dry: !!flags.dry, noRecord: !!flags['no-record'] });
      if (!flags['no-record']) runCompose(cfg);
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
