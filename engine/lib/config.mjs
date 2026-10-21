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
    edgeTtsBin: '',
    proxy: [],
    defaultFixes: true,
    fixes: [],
  },
  compose: { crf: 20, preset: 'medium', audioBitrate: '192k', sampleRate: 44100, padSeconds: 5 },
  scenes: [],
};

const CONFIG_NAMES = ['demo-video.config.mjs', 'demo-video.config.js'];

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

  return cfg;
}

/** 按 id 过滤幕；未指定则全量，保持配置顺序 */
export function selectScenes(cfg, ids) {
  if (!ids || !ids.length) return cfg.scenes;
  const unknown = ids.filter((id) => !cfg.scenes.some((s) => s.id === id));
  if (unknown.length) throw new Error(`配置中不存在幕：${unknown.join(', ')}`);
  return cfg.scenes.filter((s) => ids.includes(s.id));
}
