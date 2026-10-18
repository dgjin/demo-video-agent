import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readDurations, sceneStartSeconds } from './durations.mjs';
import { ensureDir, exec, log } from './util.mjs';

/**
 * 抽帧验收：从成片按时间点导出一帧 PNG。
 * --scene m1 时 --at 解释为「该幕内相对秒数」，否则为成片绝对秒数。
 */
export function extractFrames(cfg, opts) {
  const final = join(cfg.paths.out, cfg.finalVideo);
  if (!existsSync(final)) throw new Error(`找不到成片 ${final}：先运行 demo-video compose`);

  const times = String(opts.at || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (!times.length) throw new Error('缺少 --at 抽帧时间，如 --at 5,30 或 --scene m1 --at 2,8');

  let start = 0;
  let prefix = '';
  if (opts.scene) {
    start = sceneStartSeconds(cfg, opts.scene, readDurations(cfg));
    prefix = `${opts.scene}-`;
  }

  ensureDir(cfg.paths.frames);
  const outFiles = [];
  for (const t of times) {
    const abs = start + t;
    const out = join(cfg.paths.frames, `frame-${prefix}${t}s.png`);
    exec('ffmpeg', [
      '-y', '-ss', abs.toFixed(3), '-i', final, '-frames:v', '1',
      ...(opts.width ? ['-vf', `scale=${opts.width}:-2`] : []),
      out,
    ]);
    if (!existsSync(out)) {
      log('frames', `⚠ ${abs.toFixed(1)}s 超出成片时长或无可用帧，已跳过`);
      continue;
    }
    log('frames', `frame-${prefix}${t}s.png (成片 ${abs.toFixed(1)}s)`);
    outFiles.push(out);
  }
  return outFiles;
}
