import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: '-4%',
    edgeTtsBin: '',
    proxy: [],
    fixes: [],
  },
  compose: { crf: 20, preset: 'medium', audioBitrate: '192k', sampleRate: 44100, padSeconds: 5 },
  scenes: [],
};

/**
 * 加载项目配置：configPath 所在目录即项目根目录，所有相对路径以它为基准。
 * 动态 import 带时间戳避免同进程多次加载拿到旧模块。
 */
export async function loadConfig(configPath) {
  const abs = resolve(configPath);
  if (!existsSync(abs)) {
    throw new Error(`找不到配置文件 ${abs}；先运行 demo-video init <目录> 生成脚手架`);
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
