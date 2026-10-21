import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './util.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 插件根目录：engine/lib -> engine -> 插件根（源码仓库与安装副本都成立） */
export const PLUGIN_ROOT = resolve(HERE, '..', '..');

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/** 读取插件清单；缺失时返回最小信息，便于源码目录直接运行 */
export function readManifest() {
  const file = join(PLUGIN_ROOT, '.qoder-plugin', 'plugin.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { name: 'demo-video-agent', version: '0.0.0' };
  }
}

/**
 * 解析 playwright：被录制项目自身依赖 > 插件自身依赖 > DV_PLAYWRIGHT 指定目录。
 * 这样既能复用目标工程的 Playwright，也能在插件安装副本里独立工作。
 */
export function resolvePlaywright(projectDir = process.cwd()) {
  const anchors = [join(projectDir, 'package.json'), join(PLUGIN_ROOT, 'package.json')];
  if (process.env.DV_PLAYWRIGHT) {
    anchors.unshift(join(resolve(process.env.DV_PLAYWRIGHT), 'package.json'));
  }
  for (const anchor of anchors) {
    try {
      return createRequire(anchor)('playwright');
    } catch {
      /* 尝试下一个锚点 */
    }
  }
  return null;
}

export function isPlaywrightReady(projectDir = process.cwd()) {
  return !!resolvePlaywright(projectDir);
}

/**
 * 取 playwright 模块；缺失时默认自动在插件目录执行 npm install。
 * 插件被 Qoder 安装到缓存目录后 node_modules 不会随包复制，这一步保证开箱可用。
 */
export function ensurePlaywright(projectDir = process.cwd(), opts = {}) {
  const ready = resolvePlaywright(projectDir);
  if (ready) return ready;

  const auto = opts.autoInstall !== false && process.env.DV_NO_AUTO_INSTALL !== '1';
  if (!auto) {
    throw new Error(
      '缺少 playwright：运行 demo-video setup 一键安装，或在被录制项目中安装 playwright',
    );
  }
  if (!existsSync(join(PLUGIN_ROOT, 'package.json'))) {
    throw new Error(`插件目录缺少 package.json：${PLUGIN_ROOT}`);
  }

  log('setup', `缺少 playwright，正在安装依赖 -> ${PLUGIN_ROOT}`);
  const r = spawnSync(NPM, ['install', '--no-audit', '--no-fund', '--omit=dev'], {
    cwd: PLUGIN_ROOT,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    throw new Error('npm install 失败：请在插件目录手动执行 npm install');
  }
  const after = resolvePlaywright(projectDir);
  if (!after) {
    throw new Error('playwright 安装后仍不可用：检查 npm 网络与插件目录 node_modules');
  }
  return after;
}

/** Playwright 录屏依赖它自带的 ffmpeg（ms-playwright/ffmpeg-*），未安装时录制会直接失败 */
export function findPwFfmpeg() {
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

export function installPwFfmpeg() {
  const r = spawnSync(NPX, ['playwright', 'install', 'ffmpeg'], {
    cwd: PLUGIN_ROOT,
    stdio: 'inherit',
  });
  return r.status === 0;
}
