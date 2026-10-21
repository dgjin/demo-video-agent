import { existsSync, renameSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAssetScene } from './asset.mjs';
import { selectScenes } from './config.mjs';
import { ensurePlaywright } from './deps.mjs';
import { readDurations } from './durations.mjs';
import { prepareTerminalScene } from './terminal.mjs';
import { bounded, ensureDir, isUpToDate, log, probeDuration } from './util.mjs';

/**
 * Playwright 解析顺序：被录制项目自身的依赖 > 插件自身依赖（缺失时自动安装）。
 * 保留此导出供 doctor 与外部调用。
 */
export async function loadPlaywright(projectDir) {
  return ensurePlaywright(projectDir);
}

/** 启动浏览器：指定 channel 失败时回退 Playwright 内置 chromium，避免无 Chrome 环境直接失败 */
async function launch(chromium, cfg) {
  const base = { headless: cfg.browser.headless };
  if (cfg.browser.channel) {
    try {
      return await chromium.launch({ ...base, channel: cfg.browser.channel });
    } catch (e) {
      const reason = String(e.message || e).split('\n')[0].slice(0, 160);
      log('record', `channel=${cfg.browser.channel} 启动失败（${reason}），回退内置 chromium`);
    }
  }
  return chromium.launch(base);
}

const step = (msg) => console.log(`[record] ${msg}`);
const TIMEOUT = Symbol('scene-timeout');

/** 注入仿真光标与心跳：光标让鼠标轨迹可感知，心跳用于事后判断浏览器是否卡顿 */
function initScript() {
  const css = [
    '.dv-cursor{position:fixed;width:18px;height:18px;border-radius:50%;',
    'border:2px solid rgba(59,130,246,.9);background:rgba(59,130,246,.22);',
    'box-shadow:0 0 0 4px rgba(59,130,246,.14);pointer-events:none;z-index:2147483647;',
    'transform:translate(-50%,-50%);transition:left .08s linear,top .08s linear}',
    '.dv-cursor.click{transform:translate(-50%,-50%) scale(.68);background:rgba(59,130,246,.55)}',
  ].join('');
  const inject = () => {
    if (!document.querySelector('style[data-dv]')) {
      const st = document.createElement('style');
      st.dataset.dv = '1';
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    }
    if (!document.querySelector('.dv-cursor') && document.body) {
      const d = document.createElement('div');
      d.className = 'dv-cursor';
      document.body.appendChild(d);
    }
    window.__hbLog = [];
    setInterval(() => window.__hbLog.push(Date.now()), 500);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject, { once: true });
  } else {
    inject();
  }
}

export async function moveMouse(page, x, y) {
  await bounded(page.mouse.move(x, y, { steps: 10 }), 2500);
  await bounded(
    page.evaluate(
      ({ x, y }) => {
        const d = document.querySelector('.dv-cursor');
        if (d) {
          d.style.left = x + 'px';
          d.style.top = y + 'px';
        }
      },
      { x, y }
    ),
    2000
  );
}

/**
 * 坐标点击：先取 boundingBox（带超时）→ 移动仿真光标 → mouse.click。
 * loc 为 Playwright Locator；永不抛错，失败返回 false 让整幕继续。
 */
export async function clickLoc(page, loc, settle = 260, label = '') {
  const bb = await bounded(loc.first().boundingBox(), 3000);
  if (!bb) {
    step(`click[${label}] bbox=null → locator.click 兜底`);
    await bounded(loc.first().click({ timeout: 3000 }), 4500);
    return false;
  }
  const cx = bb.x + bb.width / 2;
  const cy = bb.y + bb.height / 2;
  await moveMouse(page, cx, cy);
  await page.waitForTimeout(settle);
  await bounded(page.evaluate(() => document.querySelector('.dv-cursor')?.classList.add('click')), 1200);
  await bounded(page.mouse.click(cx, cy), 3000);
  await page.waitForTimeout(140);
  await bounded(
    page.evaluate(() => setTimeout(() => document.querySelector('.dv-cursor')?.classList.remove('click'), 180)),
    1200
  );
  step(`click[${label}] ok`);
  return true;
}

export async function ensureInView(page, loc) {
  await bounded(loc.first().scrollIntoViewIfNeeded(), 3500);
  await page.waitForTimeout(250);
}

export async function scrollAt(page, x, y, totalDy, steps = 6) {
  await moveMouse(page, x, y);
  const d = totalDy / steps;
  for (let i = 0; i < steps; i++) {
    await bounded(page.mouse.wheel(0, d), 1500);
    await page.waitForTimeout(55);
  }
}

async function findTextRect(page, text) {
  return bounded(
    page.evaluate((t) => {
      const els = [...document.querySelectorAll('*')].filter(
        (e) => e.childElementCount === 0 && (e.textContent || '').trim() === t
      );
      for (const e of els) {
        const r = e.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }
      return null;
    }, text),
    3000
  );
}

/** 悬停精确文本元素：滚动入视 → 移动仿真光标 → 停留 */
export async function hoverText(page, text, holdMs = 380) {
  const rect = await findTextRect(page, text);
  if (!rect) {
    step(`hover[${text}] not found`);
    return false;
  }
  await moveMouse(page, rect.x + rect.w / 2, rect.y + rect.h / 2);
  await page.waitForTimeout(holdMs);
  step(`hover[${text}] ok`);
  return true;
}

/** 录制纯展示 HTML 幕：等 .stage 就绪 → 注入加载耗时 --delta → body.playing 触发动画 */
async function armOverlay(cfg, page, sc, t0) {
  // terminal 幕传入的是已生成的临时回放页绝对路径，overlay 幕为项目内相对路径
  const file = isAbsolute(sc.overlay) ? sc.overlay : join(cfg.projectDir, sc.overlay);
  if (!existsSync(file)) throw new Error(`${sc.id} 的 overlay 不存在：${file}`);
  await bounded(page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 15000 }), 20000);
  await bounded(page.waitForSelector('.stage', { timeout: 8000 }), 9000);
  const delta = (Date.now() - t0) / 1000;
  await page.evaluate((d) => {
    document.documentElement.style.setProperty('--delta', `${d.toFixed(3)}s`);
    document.body.classList.add('playing');
  }, delta);
  await page.waitForTimeout(120);
  step(`${sc.id} overlay armed delta=${delta.toFixed(2)}s`);
}

function heartbeatSummary(hb) {
  if (!Array.isArray(hb) || hb.length < 2) return 'n/a';
  let max = 0;
  let at = 0;
  for (let i = 1; i < hb.length; i++) {
    const d = hb[i] - hb[i - 1];
    if (d > max) {
      max = d;
      at = hb[i - 1];
    }
  }
  return `samples=${hb.length} maxGap=${(max / 1000).toFixed(1)}s@end=${new Date(at).toTimeString().slice(0, 8)}`;
}

async function prepareAuth(cfg, chromium, statePath) {
  if (typeof cfg.auth?.login !== 'function') {
    throw new Error('存在需要登录态的幕：请在 config.auth 提供 login(page)，或放置已有 storageState 文件');
  }
  log('record', '准备登录态…');
  const browser = await launch(chromium, cfg);
  const context = await browser.newContext({ viewport: cfg.viewport });
  const page = await context.newPage();
  try {
    await page.goto(cfg.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await cfg.auth.login(page);
    ensureDir(dirname(statePath));
    await context.storageState({ path: statePath });
    log('record', `登录态已保存 ${statePath}`);
  } finally {
    await bounded(context.close(), 15000);
    await bounded(browser.close(), 15000);
  }
}

async function recordScene(cfg, chromium, sc, targetMs, opts) {
  const tmpDir = join(cfg.paths.videos, '.tmp');
  ensureDir(tmpDir);

  const browser = await launch(chromium, cfg);
  const context = await browser.newContext({
    viewport: cfg.viewport,
    ...(opts.noRecord ? {} : { recordVideo: { dir: tmpDir, size: cfg.viewport } }),
    ...(sc.auth && opts.statePath && existsSync(opts.statePath) ? { storageState: opts.statePath } : {}),
  });
  await context.addInitScript(initScript);
  const page = await context.newPage();

  const t0 = Date.now();
  const at = async (s) => {
    const wait = t0 + s * 1000 - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
  };
  const ctx = { page, at, bounded, moveMouse, clickLoc, hoverText, ensureInView, scrollAt, step };

  let videoPath = '';
  let hb = null;
  try {
    if (sc.overlay) {
      await armOverlay(cfg, page, sc, t0);
    } else if (typeof sc.run === 'function') {
      const result = await Promise.race([
        Promise.resolve()
          .then(() => sc.run(ctx))
          .then(() => 'ok')
          .catch((e) => {
            step(`${sc.id} run 异常：${e.message}`);
            return 'error';
          }),
        new Promise((resolve) => setTimeout(() => resolve(TIMEOUT), targetMs + 120000)),
      ]);
      if (result === TIMEOUT) step(`${sc.id} 场景函数超时（>${(targetMs / 1000) | 0}+120s），关闭浏览器中止`);
    } else {
      throw new Error(`${sc.id} 需要 overlay、run()、asset 或 terminal`);
    }

    const remain = targetMs - (Date.now() - t0);
    if (remain > 0) {
      await page.waitForTimeout(remain);
    } else {
      step(`${sc.id} 超出目标 ${((Date.now() - t0 - targetMs) / 1000).toFixed(1)}s（合成时裁尾）`);
    }

    hb = await bounded(page.evaluate(() => window.__hbLog || []), 4000);
    if (page.video()) videoPath = await page.video().path();
  } finally {
    await bounded(context.close(), 15000);
    await bounded(browser.close(), 15000);
  }

  if (opts.noRecord) {
    log('record', `${sc.id} 彩排完成 ${(((Date.now() - t0) / 1000).toFixed(1))}s（NOREC 不产出视频） ${heartbeatSummary(hb)}`);
    return;
  }
  if (!videoPath) {
    step(`${sc.id} 未拿到视频文件`);
    return;
  }

  const dest = join(cfg.paths.videos, `${sc.id}.webm`);
  renameSync(videoPath, dest);
  const vd = probeDuration(dest);
  const mb = statSync(dest).size / 1024 / 1024;
  log('record', `${sc.id} -> video=${vd.toFixed(1)}s audio=${(targetMs / 1000).toFixed(1)}s ${mb.toFixed(1)}MB ${heartbeatSummary(hb)}`);
  if (mb > 150) {
    log('record', `⚠ ${sc.id}.webm 体积异常（>150MB），疑似浏览器挂起，建议 kill 后重录`);
  }
}

/**
 * 该幕的输入文件集合：配置/文稿 + 画面源（overlay 及其 base.css、asset 素材）
 * + 音频时间轴（mp3/vtt）。任一输入比录屏产物新，就说明需要重录。
 */
function sceneInputFiles(cfg, sc) {
  const files = [cfg.configPath, join(cfg.projectDir, cfg.narration)];
  if (sc.overlay) {
    const overlay = join(cfg.projectDir, sc.overlay);
    files.push(overlay);
    const base = join(dirname(overlay), 'base.css');
    if (existsSync(base)) files.push(base);
  }
  if (sc.asset) {
    for (const f of Array.isArray(sc.asset) ? sc.asset : [sc.asset]) {
      files.push(isAbsolute(f) ? f : join(cfg.projectDir, f));
    }
  }
  if (sc.terminal) {
    files.push(isAbsolute(sc.terminal) ? sc.terminal : join(cfg.projectDir, sc.terminal));
  }
  // 音频重新合成过（时长可能变化）就必须重录/重转码，保证画面对齐新时间轴
  files.push(join(cfg.paths.audio, `${sc.id}.mp3`), join(cfg.paths.audio, `${sc.id}.vtt`));
  return files;
}

/**
 * 分幕录制。
 * opts: { scenes?: string[], dry?: boolean, noRecord?: boolean, force?: boolean }
 *   dry      每幕固定 8s（DUR 彩排），不要求先跑 TTS
 *   noRecord 只跑操作链不录视频（替代原 NOREC）
 *   force    忽略已有产物强制重录（断点续做默认跳过最新的幕）
 * 素材幕（sc.asset）不经浏览器：纯素材项目无需安装 playwright。
 */
export async function runRecord(cfg, opts = {}) {
  const scenes = selectScenes(cfg, opts.scenes);
  const durations = opts.dry ? {} : readDurations(cfg);
  ensureDir(cfg.paths.videos);

  const statePath = cfg.auth?.storageState ? join(cfg.projectDir, cfg.auth.storageState) : '';
  const needAuth = scenes.some((s) => s.auth);
  const needBrowser = needAuth || scenes.some((s) => !s.asset);
  // 浏览器仅在存在 overlay/run 幕或需要登录态时加载（缺 playwright 时 asset 幕仍可出片）
  const chromium = needBrowser ? (await loadPlaywright(cfg.projectDir)).chromium : null;
  if (!needBrowser) log('record', `全部 ${scenes.length} 幕为素材幕，跳过浏览器`);

  if (needAuth && !opts.dry && !opts.noRecord) {
    if (!statePath) throw new Error('存在 auth:true 的幕，但 config.auth.storageState 未配置');
    if (!existsSync(statePath)) await prepareAuth(cfg, chromium, statePath);
    else log('record', `复用登录态 ${statePath}`);
  }

  for (const sc of scenes) {
    const targetMs = opts.dry ? 8000 : durations[sc.id];
    if (!opts.dry && !targetMs) {
      throw new Error(`缺少 ${sc.id} 的 TTS 时长：先运行 demo-video tts --scenes ${sc.id}`);
    }
    // 断点续做：产物比全部输入新则跳过（--force 强制重录）
    const dest = join(cfg.paths.videos, `${sc.id}.webm`);
    if (!opts.dry && !opts.noRecord && !opts.force && isUpToDate(dest, sceneInputFiles(cfg, sc))) {
      log('record', `${sc.id} 已有最新录屏，跳过（--force 强制重录）`);
      continue;
    }
    if (sc.asset) {
      if (opts.dry || opts.noRecord) {
        log('record', `${sc.id} 素材幕跳过${opts.dry ? '（DRY）' : '（NOREC）'}`);
        continue;
      }
      runAssetScene(cfg, sc, targetMs);
      continue;
    }
    // 终端幕：先生成自包含回放页，再以伪 overlay 走同一录制链路（彩排同样适用）
    let scene = sc;
    if (sc.terminal) {
      scene = { ...sc, overlay: prepareTerminalScene(cfg, sc, targetMs) };
    }
    try {
      await recordScene(cfg, chromium, scene, targetMs, { ...opts, statePath });
    } catch (e) {
      if (!opts.noRecord && /Executable doesn't exist|ffmpeg/i.test(e.message)) {
        throw new Error(
          `${sc.id} 录制失败：${e.message}\n` +
            '提示：Playwright 录屏依赖自带 ffmpeg，请运行 demo-video setup 或 npx playwright install ffmpeg',
        );
      }
      throw e;
    }
  }
  log('record', `完成 ${scenes.length} 幕${opts.dry ? '（DRY）' : ''}${opts.noRecord ? '（NOREC）' : ''}`);
}
