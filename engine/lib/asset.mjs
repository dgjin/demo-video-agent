import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join } from 'node:path';
import { ensureDir, exec, hasBinary, installHint, log, probeDuration } from './util.mjs';

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv', '.m4v', '.avi', '.gif']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);

/** 解析 VTT 的句首时刻（秒，升序）；图片序列按这些时刻切换 */
function vttCueStarts(file) {
  if (!existsSync(file)) return [];
  const starts = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->/);
    if (m) starts.push(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000);
  }
  return starts.sort((a, b) => a - b);
}

/** 画面适配滤镜：contain 等比缩放居中留黑边（默认）/ cover 裁切填满 */
function fitFilter(cfg, sc) {
  const { width: w, height: h } = cfg.viewport;
  if (sc.fit === 'cover') {
    return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  }
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
}

/** concat 清单里的路径转义（单引号） */
const esc = (p) => p.replaceAll("'", "'\\''");

/** 视频素材转码为无声 webm（适配画幅与帧率），时长交由合成层裁尾/补齐 */
function transcodeVideo(cfg, sc, src) {
  const dest = join(cfg.paths.videos, `${sc.id}.webm`);
  const args = ['-y'];
  if (extname(src).toLowerCase() === '.gif') args.push('-ignore_loop', '1');
  args.push(
    '-i', src, '-an',
    '-vf', `${fitFilter(cfg, sc)},fps=${cfg.fps}`,
    '-pix_fmt', 'yuv420p', '-c:v', 'libvpx', '-b:v', '2M', dest
  );
  exec('ffmpeg', args);
  return `视频 ${sc.fit === 'cover' ? 'cover' : 'contain'}`;
}

/**
 * 图片序列：多图按该幕 VTT 句首时刻切换（首图从 0 起显示到第二句首，
 * 依此类推，末图撑到幕尾）；无 VTT 时按目标时长均分；单图全程定格。
 * 图片多于句数时，多余图片忽略并提示。
 */
function buildFromImages(cfg, sc, files, targetSec) {
  const dest = join(cfg.paths.videos, `${sc.id}.webm`);
  const vf = `${fitFilter(cfg, sc)},fps=${cfg.fps}`;
  const enc = ['-pix_fmt', 'yuv420p', '-c:v', 'libvpx', '-b:v', '2M', dest];

  if (files.length === 1) {
    exec('ffmpeg', ['-y', '-loop', '1', '-i', files[0], '-vf', vf, '-t', targetSec.toFixed(3), ...enc]);
    return '单图定格';
  }

  const starts = vttCueStarts(join(cfg.paths.audio, `${sc.id}.vtt`));
  let switches;
  let note;
  if (starts.length >= 2) {
    // 切换点 = [0, 第2句首, …]；句数不足时截断，多余图片忽略
    switches = [0, ...starts.slice(1, files.length)];
    note = `${Math.min(files.length, switches.length)} 图 · VTT 句首切换`;
  } else {
    const step = targetSec / files.length;
    switches = Array.from({ length: files.length }, (_, i) => i * step);
    note = `${files.length} 图 · 均分（无 VTT）`;
  }

  const useCount = Math.min(files.length, switches.length);
  if (useCount < files.length) {
    log('asset', `${sc.id} 图片数（${files.length}）多于切换点（${useCount}），多余图片忽略`);
  }
  const cuts = [];
  for (let i = 0; i < useCount; i++) {
    const from = switches[i];
    const to = i + 1 < useCount ? Math.min(switches[i + 1], targetSec) : targetSec;
    cuts.push(Math.max(0.1, to - from));
  }

  const listFile = join(cfg.paths.videos, '.tmp', `${sc.id}-concat.txt`);
  const lines = [];
  for (let i = 0; i < useCount; i++) {
    lines.push(`file '${esc(files[i])}'`);
    if (i + 1 < useCount) lines.push(`duration ${cuts[i].toFixed(3)}`);
  }
  // concat demuxer 惯例：末帧文件重复列一次（不带 duration），否则最后一张可能丢失
  lines.push(`file '${esc(files[useCount - 1])}'`);
  writeFileSync(listFile, lines.join('\n') + '\n', 'utf8');

  exec('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', vf, '-t', targetSec.toFixed(3), ...enc,
  ]);
  return note;
}

/**
 * 素材幕：跳过浏览器，把已有视频/图片转成 videos/<id>.webm（无声），
 * 之后走与录屏幕完全相同的合成与抽帧验收链路。
 * sc.asset: 单个视频文件路径（mp4/webm/mov/gif…），或图片路径/数组（png/jpg…）。
 */
export function runAssetScene(cfg, sc, targetMs) {
  for (const bin of ['ffmpeg', 'ffprobe']) {
    if (!hasBinary(bin)) throw new Error(`缺少 ${bin}：${installHint(bin)}`);
  }
  ensureDir(cfg.paths.videos);
  ensureDir(join(cfg.paths.videos, '.tmp'));

  const items = (Array.isArray(sc.asset) ? sc.asset : [sc.asset]).map(String).filter(Boolean);
  if (!items.length) throw new Error(`${sc.id} asset 为空`);
  const files = items.map((f) => (isAbsolute(f) ? f : join(cfg.projectDir, f)));
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length) throw new Error(`${sc.id} asset 文件不存在：${missing.join(', ')}`);

  const exts = files.map((f) => extname(f).toLowerCase());
  const allImages = exts.every((e) => IMAGE_EXT.has(e));
  const isVideo = files.length === 1 && VIDEO_EXT.has(exts[0]);
  const targetSec = targetMs / 1000;

  let note;
  if (allImages) {
    note = buildFromImages(cfg, sc, files, targetSec);
  } else if (isVideo) {
    note = transcodeVideo(cfg, sc, files[0]);
  } else {
    throw new Error(
      `${sc.id} asset 需为单个视频（${[...VIDEO_EXT].join(' ')}），或一组同类型图片（${[...IMAGE_EXT].join(' ')}）`
    );
  }

  const dest = join(cfg.paths.videos, `${sc.id}.webm`);
  const vd = probeDuration(dest);
  const mb = statSync(dest).size / 1024 / 1024;
  log('record', `${sc.id} -> video=${vd.toFixed(1)}s audio=${targetSec.toFixed(1)}s ${mb.toFixed(1)}MB (asset ${note})`);
}
