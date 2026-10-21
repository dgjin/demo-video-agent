import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';

/** 建目录（幂等） */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/** 同步执行外部命令，捕获 stdout（ffprobe 等需要读取输出），stderr 透传但默认丢弃 */
export function exec(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/**
 * 异步执行外部命令（spawn），用于需要并发的场景（如多幕 TTS）。
 * execFileSync 会阻塞事件循环，并发调用仍串行，所以并发路径必须走这里。
 * opts: { timeout?: ms, cwd?: string }；非 0 退出码 reject，错误对象带 stderr/code。
 */
export function execAsync(cmd, args, opts = {}) {
  const { timeout = 0, cwd } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    let stdout = '';
    let stderr = '';
    let timer = null;
    if (timeout > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(Object.assign(new Error(`${cmd} 超时（${timeout}ms）`), { stderr, timeout: true }));
      }, timeout);
    }
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`${cmd} 退出码 ${code}`), { stderr, code }));
    });
  });
}

/**
 * 限流并发执行（不引入依赖）。保持结果顺序与 items 一致；
 * 任一任务 reject 时整体 reject（其余任务自然跑完，产物保留）。
 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const size = Math.max(1, Math.min(Number(limit) || 1, items.length));
  const workers = Array.from({ length: size }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
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

/** 文件 mtime（毫秒），不存在返回 0 */
export function mtimeMs(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 断点续做判定：产物存在，且不比任一输入旧（输入缺省忽略）。
 * 用于录屏与合成阶段跳过已完成的幕；--force 由调用方绕过。
 */
export function isUpToDate(artifact, inputs = []) {
  const t = mtimeMs(artifact);
  if (!t) return false;
  return inputs.every((f) => mtimeMs(f) <= t);
}

export function log(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}

