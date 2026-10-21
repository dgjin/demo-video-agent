import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, exec, hasBinary, installHint, log, probeDuration } from './util.mjs';

/**
 * 音画合成：每幕 webm（无声）+ mp3（旁白）→ mp4，再 concat 拼接为成片。
 * 音频为主时间轴 T = 音频时长；视频不足 T 用 tpad 冻帧补齐，超长裁尾。
 */
export function runCompose(cfg) {
  for (const bin of ['ffmpeg', 'ffprobe']) {
    if (!hasBinary(bin)) throw new Error(`缺少 ${bin}：${installHint(bin)}`);
  }
  ensureDir(cfg.paths.out);
  const { crf, preset, audioBitrate, sampleRate, padSeconds } = cfg.compose;

  let total = 0;
  for (const sc of cfg.scenes) {
    const v = join(cfg.paths.videos, `${sc.id}.webm`);
    const a = join(cfg.paths.audio, `${sc.id}.mp3`);
    if (!existsSync(v) || !existsSync(a)) {
      throw new Error(`缺少 ${sc.id} 的素材：${!existsSync(v) ? v : a}`);
    }
    const vd = probeDuration(v);
    const ad = probeDuration(a);
    const out = join(cfg.paths.out, `${sc.id}.mp4`);
    exec('ffmpeg', [
      '-y', '-i', v, '-i', a,
      '-filter_complex', `[0:v]tpad=stop_mode=clone:stop_duration=${padSeconds},fps=${cfg.fps}[v]`,
      '-map', '[v]', '-map', '1:a', '-t', ad.toFixed(3),
      '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', audioBitrate, '-ar', String(sampleRate),
      '-movflags', '+faststart', out,
    ]);
    const od = probeDuration(out);
    log('compose', `${sc.id}: video=${vd.toFixed(1)}s audio=${ad.toFixed(1)}s -> ${od.toFixed(1)}s${vd < ad ? ' (tpad 补齐)' : ''}`);
    total += od;
  }

  const list = cfg.scenes.map((s) => `file '${s.id}.mp4'`).join('\n') + '\n';
  writeFileSync(join(cfg.paths.out, 'concat.txt'), list);
  const final = join(cfg.paths.out, cfg.finalVideo);
  exec('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
    '-c', 'copy', '-movflags', '+faststart', final,
  ], { cwd: cfg.paths.out });

  const fd = probeDuration(final);
  log('compose', `FINAL -> ${final}`);
  log('compose', `总时长 ${(fd / 60).toFixed(2)} min (${fd.toFixed(1)}s)，分幕合计 ${(total / 60).toFixed(2)} min`);
  return final;
}
