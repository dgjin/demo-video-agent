import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function durationsPath(cfg) {
  return join(cfg.paths.audio, 'durations.json');
}

/** 读取各幕 TTS 时长（毫秒）；文件缺失时抛错并给出下一步 */
export function readDurations(cfg) {
  const p = durationsPath(cfg);
  if (!existsSync(p)) throw new Error(`缺少 ${p}：先运行 demo-video tts 生成旁白与时长`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** 容错读取：TTS 增量生成时允许文件尚不存在 */
export function readDurationsOrEmpty(cfg) {
  const p = durationsPath(cfg);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

export function writeDurations(cfg, data) {
  writeFileSync(durationsPath(cfg), JSON.stringify(data, null, 2) + '\n');
}

/** 幕在成片中的起始秒数（前置各幕时长累加） */
export function sceneStartSeconds(cfg, id, durations) {
  let start = 0;
  for (const s of cfg.scenes) {
    if (s.id === id) return start;
    start += (durations[s.id] || 0) / 1000;
  }
  throw new Error(`配置中不存在幕：${id}`);
}
