import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVoice } from './voices.mjs';

const DEFAULTS = {
  name: 'demo-video',
  narration: 'narration.md',
  finalVideo: 'demo.mp4',
  viewport: { width: 1920, height: 1080 },
  fps: 25,
  baseUrl: 'http://127.0.0.1:3000',
  dirs: { audio: 'audio', videos: 'videos', out: 'out', frames: 'diag' },
  browser: { channel: 'chrome', headless: true },
  auth: {},
  tts: {
    voice: '',
    role: '',
    gender: '',
    rate: '-4%',
    concurrency: 3,
    edgeTtsBin: '',
    proxy: [],
    defaultFixes: true,
    fixes: [],
  },
  compose: { crf: 20, preset: 'medium', audioBitrate: '192k', sampleRate: 44100, padSeconds: 5 },
  scenes: [],
};

const CONFIG_NAMES = ['demo-video.config.mjs', 'demo-video.config.js'];

const isPosInt = (v) => Number.isInteger(v) && v > 0;

/**
 * 配置字段级校验：把错误前置到 loadConfig（而不是等 ffmpeg 报错），
 * 返回错误列表（空数组表示通过），每条带字段路径。
 */
export function validateConfig(cfg) {
  const errs = [];
  const add = (path, msg) => errs.push(`${path} ${msg}`);
  const show = (v) => JSON.stringify(v);

  if (!isPosInt(cfg.viewport?.width)) add('viewport.width', `= ${show(cfg.viewport?.width)}（应为正整数）`);
  if (!isPosInt(cfg.viewport?.height)) add('viewport.height', `= ${show(cfg.viewport?.height)}（应为正整数）`);
  if (!isPosInt(cfg.fps) || cfg.fps > 120) add('fps', `= ${show(cfg.fps)}（应为 1–120 的整数）`);
  if (typeof cfg.finalVideo !== 'string' || !cfg.finalVideo.trim()) add('finalVideo', '应为非空文件名');
  if (typeof cfg.narration !== 'string' || !cfg.narration.trim()) add('narration', '应为非空路径');
  if (!Number.isInteger(cfg.compose?.crf) || cfg.compose.crf < 0 || cfg.compose.crf > 51) {
    add('compose.crf', `= ${show(cfg.compose?.crf)}（应为 0–51 的整数）`);
  }
  if (!(Number(cfg.compose?.padSeconds) >= 0)) add('compose.padSeconds', `= ${show(cfg.compose?.padSeconds)}（应为 >= 0 的数字）`);
  if (!isPosInt(cfg.tts?.concurrency)) add('tts.concurrency', `= ${show(cfg.tts?.concurrency)}（应为正整数）`);

  for (const [k, v] of Object.entries(cfg.dirs || {})) {
    if (typeof v !== 'string' || !v.trim()) add(`dirs.${k}`, '应为非空目录名');
  }

  cfg.scenes.forEach((sc, i) => {
    const at = `scenes[${i}](${sc.id})`;
    const hasSource = sc.overlay || typeof sc.run === 'function' || sc.asset != null || sc.terminal != null;
    if (!hasSource) add(at, '缺少画面源：overlay / run() / asset / terminal 四选一');
    if (sc.overlay !== undefined && (typeof sc.overlay !== 'string' || !sc.overlay.trim())) {
      add(`${at}.overlay`, '应为 overlay HTML 的相对路径');
    }
    if (sc.terminal !== undefined) {
      if (sc.overlay || typeof sc.run === 'function' || sc.asset != null) {
        add(`${at}.terminal`, '不能与 overlay / run() / asset 同时使用');
      }
      if (typeof sc.terminal !== 'string' || !sc.terminal.trim()) {
        add(`${at}.terminal`, '应为 .cast 录制文件的相对路径');
      }
    }
    if (sc.asset !== undefined) {
      if (sc.overlay || typeof sc.run === 'function') {
        add(`${at}.asset`, '不能与 overlay / run() 同时使用');
      }
      const items = Array.isArray(sc.asset) ? sc.asset : [sc.asset];
      if (!items.length || !items.every((f) => typeof f === 'string' && f.trim())) {
        add(`${at}.asset`, '应为单个文件路径或非空路径数组');
      }
      if (sc.fit !== undefined && !['contain', 'cover'].includes(sc.fit)) {
        add(`${at}.fit`, `= ${show(sc.fit)}（只能是 'contain' 或 'cover'）`);
      }
    }
  });
  return errs;
}

/**
 * 定位项目配置：--config / DV_CONFIG 优先，否则从当前目录向上查找。
 * 这样在项目子目录里执行命令也能找到项目根配置。
 */
export function findConfig(explicit) {
  const wanted = explicit || process.env.DV_CONFIG;
  if (wanted) return resolve(wanted);
  let dir = process.cwd();
  for (let depth = 0; depth < 12; depth++) {
    for (const name of CONFIG_NAMES) {
      const file = join(dir, name);
      if (existsSync(file)) return file;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(CONFIG_NAMES[0]);
}

/**
 * 加载项目配置：configPath 所在目录即项目根目录，所有相对路径以它为基准。
 * 动态 import 带时间戳避免同进程多次加载拿到旧模块。
 */
export async function loadConfig(configPath) {
  const abs = resolve(configPath);
  if (!existsSync(abs)) {
    throw new Error(`找不到配置文件 ${abs}；用 demo-video init my-demo 生成脚手架，或用 --config 指定`);
  }
  const mod = await import(pathToFileURL(abs).href + `?v=${Date.now()}`);
  const raw = mod.default || {};

  const cfg = {
    ...DEFAULTS,
    ...raw,
    tts: { ...DEFAULTS.tts, ...(raw.tts || {}) },
    browser: { ...DEFAULTS.browser, ...(raw.browser || {}) },
    viewport: { ...DEFAULTS.viewport, ...(raw.viewport || {}) },
    dirs: { ...DEFAULTS.dirs, ...(raw.dirs || {}) },
    compose: { ...DEFAULTS.compose, ...(raw.compose || {}) },
    auth: raw.auth || {},
    projectDir: dirname(abs),
    configPath: abs,
  };

  cfg.paths = Object.fromEntries(
    Object.entries(cfg.dirs).map(([k, v]) => [k, isAbsolute(v) ? v : join(cfg.projectDir, v)])
  );
  // 音色：voice > role > gender > 默认；解析结果写回 tts.voice，下游（TTS / 读音词典）只看这个
  const voice = resolveVoice(cfg.tts);
  cfg.tts.voice = voice.voice;
  cfg.tts.voicePreset = voice.preset?.label || '';
  cfg.tts.voiceSource = voice.source;
  cfg.scenes = (raw.scenes || []).map((s, i) => ({ ...s, id: String(s.id || `scene${i}`) }));
  if (!cfg.scenes.length) throw new Error('config.scenes 不能为空');

  const dup = cfg.scenes.map((s) => s.id).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (dup.length) throw new Error(`config.scenes 幕ID 重复：${[...new Set(dup)].join(', ')}`);

  const errs = validateConfig(cfg);
  if (errs.length) {
    throw new Error(`配置校验失败：\n  - ${errs.join('\n  - ')}`);
  }

  return cfg;
}

/** 按 id 过滤幕；未指定则全量，保持配置顺序 */
export function selectScenes(cfg, ids) {
  if (!ids || !ids.length) return cfg.scenes;
  const unknown = ids.filter((id) => !cfg.scenes.some((s) => s.id === id));
  if (unknown.length) throw new Error(`配置中不存在幕：${unknown.join(', ')}`);
  return cfg.scenes.filter((s) => ids.includes(s.id));
}
