import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneStartSeconds } from '../engine/lib/durations.mjs';

const cfg = {
  scenes: [{ id: 'm00' }, { id: 'm01' }, { id: 'm02' }],
};
const durations = { m00: 5000, m01: 3000, m02: 2000 };

test('sceneStartSeconds：返回前置各幕时长累加（毫秒转秒）', () => {
  assert.equal(sceneStartSeconds(cfg, 'm00', durations), 0);
  assert.equal(sceneStartSeconds(cfg, 'm01', durations), 5);
  assert.equal(sceneStartSeconds(cfg, 'm02', durations), 8);
});

test('sceneStartSeconds：缺失时长按 0 计（不中断）', () => {
  assert.equal(sceneStartSeconds(cfg, 'm02', { m00: 5000 }), 5);
});

test('sceneStartSeconds：未知幕抛错', () => {
  assert.throws(() => sceneStartSeconds(cfg, 'nope', durations), /不存在幕/);
});
