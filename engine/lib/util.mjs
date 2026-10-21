import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

/** 建目录（幂等） */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/** 同步执行外部命令，捕获 stdout（ffprobe 等需要读取输出），stderr 透传但默认丢弃 */
export function exec(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/** ffprobe 读取媒体时长（秒，float） */
export function probeDuration(file) {
  const out = exec('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]).toString().trim();
  return parseFloat(out);
}

/** PATH 中是否存在可执行文件（Windows 用 where） */
export function hasBinary(bin) {
  try {
    exec(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/** 各平台依赖安装提示 */
export function installHint(bin) {
  if (bin === 'ffmpeg' || bin === 'ffprobe') {
    if (process.platform === 'darwin') return 'brew install ffmpeg';
    if (process.platform === 'win32') return 'winget install Gyan.FFmpeg（或到 ffmpeg.org 下载）';
    return 'sudo apt install ffmpeg（或使用发行版包管理器）';
  }
  if (bin === 'edge-tts') return 'pip install edge-tts';
  return `请安装 ${bin}`;
}

/**
 * 硬性超时护栏：永不 reject。
 * 超时或异常返回 fallback，用于包裹 Playwright/CDP 调用，避免单次挂起拖垮整幕录制。
 */
export function bounded(promise, ms, fallback = null) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export const fmt = (n) => `${n.toFixed(1)}s`;

export function log(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}

