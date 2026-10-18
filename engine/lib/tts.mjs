import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseNarration } from './narration.mjs';
import { readDurationsOrEmpty, writeDurations } from './durations.mjs';
import { ensureDir, exec, log, probeDuration } from './util.mjs';

/**
 * 定位 edge-tts：显式配置 > 环境变量 > pip 用户目录 > Homebrew/PATH。
 * 不可用时返回空串，由调用方给出安装提示。
 */
export function resolveEdgeTts(cfg) {
  const candidates = [cfg?.tts?.edgeTtsBin, process.env.EDGE_TTS];
  const pyRoot = join(homedir(), 'Library', 'Python');
  if (existsSync(pyRoot)) {
    for (const v of readdirSync(pyRoot)) candidates.push(join(pyRoot, v, 'bin', 'edge-tts'));
  }
  candidates.push(
    join(homedir(), '.local', 'bin', 'edge-tts'),
    '/opt/homebrew/bin/edge-tts',
    '/usr/local/bin/edge-tts'
  );
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  try {
    exec('which', ['edge-tts']);
    return 'edge-tts';
  } catch {
    return '';
  }
}

/**
 * 多音字读音修正：仅作用于合成文本。
 * 例：数据语境「行」应读 háng，edge-tts 常读 xíng——合成前替换为同音字，字幕生成后还原原文。
 */
export function applyFixes(text, fixes = []) {
  return fixes.reduce((s, [from, to]) => (from ? s.split(from).join(to) : s), text);
}

export function revertFixes(text, fixes = []) {
  return fixes.reduce((s, [from, to]) => (to ? s.split(to).join(from) : s), text);
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
function synthesize(bin, args, proxies) {
  const plan = proxies.length ? [...proxies, ...proxies] : [null, null];
  let lastErr;
  for (const proxy of plan) {
    try {
      exec(bin, proxy ? [...args, '--proxy', proxy] : args, { timeout: 180000 });
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

  for (const sc of wanted) {
    const mp3 = join(audioDir, `${sc.id}.mp3`);
    const vtt = join(audioDir, `${sc.id}.vtt`);
    const txt = join(audioDir, `${sc.id}.txt`);
    writeFileSync(txt, applyFixes(sc.text, cfg.tts.fixes), 'utf8');

    const args = ['--voice', cfg.tts.voice, '--file', txt, '--write-media', mp3];
    if (cfg.tts.rate) args.push(`--rate=${cfg.tts.rate}`);
    if (withVtt) args.push('--write-subtitles', vtt);

    const usedProxy = synthesize(bin, args, proxies);

    if (!existsSync(mp3)) throw new Error(`${sc.id} 未生成 mp3`);
    const sec = probeDuration(mp3);
    if (!Number.isFinite(sec) || sec <= 0) throw new Error(`${sc.id} mp3 时长无效`);

    // 合成文本中的同音替换只用于发音，字幕必须还原原文
    if (withVtt && existsSync(vtt)) {
      const raw = readFileSync(vtt, 'utf8');
      const restored = revertFixes(raw, cfg.tts.fixes);
      if (restored !== raw) writeFileSync(vtt, restored, 'utf8');
    }

    durations[sc.id] = Math.round(sec * 1000);
    log('tts', `${sc.id} ${sec.toFixed(1)}s${withVtt ? ' +vtt' : ''} (${usedProxy || '直连'}) ${sc.title}`);
  }

  writeDurations(cfg, durations);
  log('tts', `durations -> ${join(audioDir, 'durations.json')}（本次 ${wanted.length} 幕）`);
}
