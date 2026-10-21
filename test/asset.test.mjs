import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planImageSwitches, vttCueStarts } from '../engine/lib/asset.mjs';

test('planImageSwitches：图数等于句数时按每个句首切换', () => {
  const { switches, useCount, note } = planImageSwitches(3, [0, 2.7, 5.7], 8.7);
  assert.deepEqual(switches, [0, 2.7, 5.7]);
  assert.equal(useCount, 3);
  assert.match(note, /VTT 句首切换/);
});

test('planImageSwitches：图片多于句数时截断到句数', () => {
  const { switches, useCount, note } = planImageSwitches(5, [0, 2.7], 8);
  assert.deepEqual(switches, [0, 2.7]);
  assert.equal(useCount, 2);
  assert.match(note, /2 图/);
});

test('planImageSwitches：句数多于图片时只取前 N 个切换点（末图撑尾）', () => {
  const { switches, useCount } = planImageSwitches(2, [0, 2, 4, 6], 9);
  assert.deepEqual(switches, [0, 2]);
  assert.equal(useCount, 2);
});

test('planImageSwitches：只有一句或没有 VTT 时按目标时长均分', () => {
  const a = planImageSwitches(3, [0], 9);
  assert.deepEqual(a.switches, [0, 3, 6]);
  assert.equal(a.useCount, 3);
  assert.match(a.note, /均分（无 VTT）/);

  const b = planImageSwitches(2, [], 5);
  assert.deepEqual(b.switches, [0, 2.5]);
});

test('vttCueStarts：解析句首时刻并升序排序，忽略非法行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dv-test-'));
  const file = join(dir, 'm00.vtt');
  writeFileSync(
    file,
    [
      'WEBVTT',
      '',
      '00:00:02,500 --> 00:00:04,000',
      '第二句',
      '',
      '00:00:00,100 --> 00:00:02,400',
      '第一句',
      '',
      'NOTE 这不是 cue',
      '',
    ].join('\n'),
    'utf8'
  );
  assert.deepEqual(vttCueStarts(file), [0.1, 2.5]);
});

test('vttCueStarts：VTT 不存在时返回空数组', () => {
  assert.deepEqual(vttCueStarts(join(tmpdir(), 'not-exist-' + Date.now() + '.vtt')), []);
});
