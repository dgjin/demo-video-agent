import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../engine/lib/config.mjs';

/** 一份合法的最小配置（合并 DEFAULTS 后的形状） */
function base(overrides = {}) {
  return {
    viewport: { width: 1920, height: 1080 },
    fps: 25,
    finalVideo: 'demo.mp4',
    narration: 'narration.md',
    dirs: { audio: 'audio', videos: 'videos', out: 'out', frames: 'diag' },
    compose: { crf: 20, padSeconds: 5 },
    tts: { concurrency: 3 },
    scenes: [{ id: 'm00', overlay: 'overlay/m00.html' }],
    ...overrides,
  };
}

const joined = (cfg) => validateConfig(cfg).join('\n');

test('validateConfig：合法配置无错误', () => {
  assert.deepEqual(validateConfig(base()), []);
  assert.deepEqual(validateConfig(base({ scenes: [{ id: 'a', asset: ['a.png', 'b.png'] }] })), []);
  assert.deepEqual(validateConfig(base({ scenes: [{ id: 'a', asset: 'clip.mp4', fit: 'cover' }] })), []);
  assert.deepEqual(validateConfig(base({ scenes: [{ id: 'a', run: () => {} }] })), []);
  assert.deepEqual(validateConfig(base({ scenes: [{ id: 'a', terminal: 'demo.cast' }] })), []);
});

test('validateConfig：viewport / fps / crf 越界或类型错误带字段路径', () => {
  assert.match(joined(base({ viewport: { width: '1920', height: 1080 } })), /viewport\.width/);
  assert.match(joined(base({ viewport: { width: 1920, height: 0 } })), /viewport\.height/);
  assert.match(joined(base({ fps: 200 })), /fps.*1–120/);
  assert.match(joined(base({ compose: { crf: 99, padSeconds: 5 } })), /compose\.crf/);
  assert.match(joined(base({ compose: { crf: 20, padSeconds: 'x' } })), /compose\.padSeconds/);
});

test('validateConfig：幕缺画面源 / 多画面源冲突', () => {
  assert.match(joined(base({ scenes: [{ id: 'm00' }] })), /缺少画面源/);
  assert.match(
    joined(base({ scenes: [{ id: 'm00', overlay: 'a.html', asset: 'b.mp4' }] })),
    /asset.*不能与 overlay/
  );
  assert.match(
    joined(base({ scenes: [{ id: 'm00', terminal: 'a.cast', asset: 'b.mp4' }] })),
    /terminal.*不能与/
  );
});

test('validateConfig：asset / fit / terminal 取值校验', () => {
  assert.match(joined(base({ scenes: [{ id: 'm00', asset: [] }] })), /asset.*非空路径数组/);
  assert.match(joined(base({ scenes: [{ id: 'm00', asset: 123 }] })), /asset/);
  assert.match(joined(base({ scenes: [{ id: 'm00', asset: 'a.png', fit: 'contains' }] })), /fit/);
  assert.match(joined(base({ scenes: [{ id: 'm00', terminal: '' }] })), /terminal/);
});

test('validateConfig：错误信息包含幕 ID，便于定位', () => {
  const errs = joined(base({ scenes: [{ id: 'm03', asset: 'a.png', fit: 'x' }] }));
  assert.match(errs, /scenes\[0\]\(m03\)/);
});
