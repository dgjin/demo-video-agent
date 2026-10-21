import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseNarration } from './narration.mjs';
import { applyPronunciation, compileFixes, restoreVtt } from './pronunciation.mjs';
import { readDurationsOrEmpty, writeDurations } from './durations.mjs';
import { ensureDir, exec, log, probeDuration } from './util.mjs';
import { resolveSceneVoice, voiceLabel } from './voices.mjs';

/**
 * 定位 edge-tts：显式配置 > 环境变量 > 常见安装目录 > PATH > Python 模块。
 * 返回 { cmd, args, label }；不可用时返回 null，由调用方给出安装提示。
 */
export function resolveEdgeTts(cfg) {
  const explicit = cfg?.tts?.edgeTtsBin || process.env.EDGE_TTS;
  if (explicit) return { cmd: explicit, args: [], label: explicit };

  for (const bin of candidateBins()) {
    if (bin && existsSync(bin)) return { cmd: bin, args: [], label: bin };
  }

  try {
    exec('edge-tts', ['--help'], { timeout: 15000, stdio: ['ignore', 'ignore', 'ignore'] });
    return { cmd: 'edge-tts', args: [], label: 'edge-tts (PATH)' };
  } catch {
    /* 继续尝试 Python 模块 */
  }
  return pythonModule();
}

/** 常见安装位置（覆盖 macOS / Linux / Windows 的 pip 用户目录） */
function candidateBins() {
  const out = [];
  if (process.platform === 'win32') {
    const roots = [
      process.env.APPDATA && join(process.env.APPDATA, 'Python'),
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Python'),
    ].filter(Boolean);
    for (const root of roots) {
      if (!existsSync(root)) continue;
      for (const v of readdirSync(root)) out.push(join(root, v, 'Scripts', 'edge-tts.exe'));
    }
    return out;
  }
  const pyRoot = join(homedir(), 'Library', 'Python');
  if (existsSync(pyRoot)) {
    for (const v of readdirSync(pyRoot)) out.push(join(pyRoot, v, 'bin', 'edge-tts'));
  }
  out.push(
    join(homedir(), '.local', 'bin', 'edge-tts'),
    '/opt/homebrew/bin/edge-tts',
    '/usr/local/bin/edge-tts',
    '/usr/bin/edge-tts'
  );
  return out;
}

/** 已安装 edge-tts 但脚本不在 PATH 时，退回 `python -m edge_tts` */
function pythonModule() {
  const pythons =
    process.platform === 'win32'
      ? [
          ['py', ['-3', '-m', 'edge_tts']],
          ['python', ['-m', 'edge_tts']],
        ]
      : [
          ['python3', ['-m', 'edge_tts']],
          ['python', ['-m', 'edge_tts']],
        ];
  for (const [cmd, args] of pythons) {
    try {
      exec(cmd, [...args, '--help'], { timeout: 15000, stdio: ['ignore', 'ignore', 'ignore'] });
      return { cmd, args, label: `${cmd} ${args.join(' ')}` };
    } catch {
      /* 尝试下一个解释器 */
    }
  }
  return null;
}

function resolveProxies(cfg) {
  if (process.env.DV_TTS_PROXY) {
    return process.env.DV_TTS_PROXY.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const p = cfg.tts.proxy;
  if (Array.isArray(p)) return p.filter(Boolean);
  return p ? [p] : [];
}

/** 每个代理尝试两轮；直连失败后才回退代理的语义由 proxies 顺序决定 */
function synthesize(spec, args, proxies) {
  const plan = proxies.length ? [...proxies, ...proxies] : [null, null];
  let lastErr;
  for (const proxy of plan) {
    try {
      const full = [...spec.args, ...args, ...(proxy ? ['--proxy', proxy] : [])];
      exec(spec.cmd, full, { timeout: 180000 });
      return proxy;
    } catch (e) {
      lastErr = e;
      const reason = String(e.stderr || e.message || e).split('\n')[0].slice(0, 160);
      log('tts', `重试（${proxy || '直连'}）：${reason}`);
    }
  }
  throw new Error(`edge-tts 连续失败：${String(lastErr?.stderr || lastErr?.message || lastErr).slice(0, 400)}`);
}

/**
 * 为指定幕生成 mp3 + VTT，并把时长写入 audio/durations.json。
 * opts: { scenes?: string[], vtt?: boolean }
 */
export function runTts(cfg, opts = {}) {
  const bin = resolveEdgeTts(cfg);
  if (!bin) {
    throw new Error('未找到 edge-tts：执行 pip install edge-tts，或配置 tts.edgeTtsBin / 环境变量 EDGE_TTS');
  }
  const narrationPath = join(cfg.projectDir, cfg.narration);
  if (!existsSync(narrationPath)) throw new Error(`找不到旁白文稿：${narrationPath}`);

  const all = parseNarration(readFileSync(narrationPath, 'utf8'));
  const wanted = opts.scenes?.length ? all.filter((s) => opts.scenes.includes(s.id)) : all;
  if (!wanted.length) {
    throw new Error(`旁白文稿中没有可合成的幕（${narrationPath}）`);
  }
  if (!opts.scenes?.length) {
    const missing = cfg.scenes.filter((s) => !all.some((w) => w.id === s.id));
    if (missing.length) {
      log('tts', `提示：config.scenes 中 ${missing.map((s) => s.id).join(', ')} 暂无旁白文本`);
    }
  }

  const audioDir = cfg.paths.audio;
  ensureDir(audioDir);
  const durations = readDurationsOrEmpty(cfg);
  const proxies = resolveProxies(cfg);
  const withVtt = opts.vtt !== false;
  // 单幕音色覆盖写在 config.scenes 上，合成时按幕 ID 取回来
  const sceneMeta = new Map(cfg.scenes.map((s) => [s.id, s]));

  for (const sc of wanted) {
    // 单幕可换角色：scene.voice / scene.role / scene.gender 覆盖全局音色
    const meta = sceneMeta.get(sc.id) || {};
    const voice = resolveSceneVoice(cfg.tts, meta) || cfg.tts.voice;
    // 内置词典 + 项目 tts.fixes（同名覆盖，值为 null 表示关闭该条），按本幕音色判断是否中文
    const fixes = compileFixes({ ...cfg.tts, voice });
    const mp3 = join(audioDir, `${sc.id}.mp3`);
    const vtt = join(audioDir, `${sc.id}.vtt`);
    const txt = join(audioDir, `${sc.id}.txt`);
    const { text: spoken, ranges } = applyPronunciation(sc.text, fixes);
    writeFileSync(txt, spoken, 'utf8');

    const args = ['--voice', voice, '--file', txt, '--write-media', mp3];
    if (cfg.tts.rate) args.push(`--rate=${cfg.tts.rate}`);
    if (withVtt) args.push('--write-subtitles', vtt);

    const usedProxy = synthesize(bin, args, proxies);

    if (!existsSync(mp3)) throw new Error(`${sc.id} 未生成 mp3`);
    const sec = probeDuration(mp3);
    if (!Number.isFinite(sec) || sec <= 0) throw new Error(`${sc.id} mp3 时长无效`);

    // 合成文本中的同音替换只用于发音，字幕必须还原原文
    if (withVtt && existsSync(vtt) && ranges.length) {
      const raw = readFileSync(vtt, 'utf8');
      const restored = restoreVtt(raw, spoken, ranges);
      if (restored !== raw) writeFileSync(vtt, restored, 'utf8');
    }

    durations[sc.id] = Math.round(sec * 1000);
    const fixed = ranges.length ? ` 读音修正 ${ranges.length} 处` : '';
    const sceneVoice = voice !== cfg.tts.voice ? ` · ${voiceLabel(voice)}` : '';
    log('tts', `${sc.id} ${sec.toFixed(1)}s${withVtt ? ' +vtt' : ''} (${usedProxy || '直连'})${fixed}${sceneVoice} ${sc.title}`);
  }

  writeDurations(cfg, durations);
  log('tts', `durations -> ${join(audioDir, 'durations.json')}（本次 ${wanted.length} 幕）`);
}
