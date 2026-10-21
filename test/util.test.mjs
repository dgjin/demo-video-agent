import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isUpToDate, mapLimit } from '../engine/lib/util.mjs';

test('mapLimit：结果顺序与输入一致（即使完成顺序不同）', async () => {
  const out = await mapLimit([30, 10, 20], 3, async (ms) => {
    await new Promise((r) => setTimeout(r, ms));
    return ms * 2;
  });
  assert.deepEqual(out, [60, 20, 40]);
});

test('mapLimit：并发度不超过 limit', async () => {
  let running = 0;
  let peak = 0;
  await mapLimit(Array.from({ length: 9 }, (_, i) => i), 3, async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
  });
  assert.equal(peak, 3);
});

test('mapLimit：空数组与 limit=0 不报错', async () => {
  assert.deepEqual(await mapLimit([], 3, async () => 1), []);
  assert.deepEqual(await mapLimit([1, 2], 0, async (x) => x), [1, 2]);
});

test('mapLimit：任一任务失败整体 reject', async () => {
  await assert.rejects(
    mapLimit([1, 2, 3], 2, async (x) => {
      if (x === 2) throw new Error('boom');
      return x;
    }),
    /boom/
  );
});

/** 造一个指定 mtime 的文件（秒），用于断点续做判定 */
function touch(file, sec) {
  writeFileSync(file, 'x');
  utimesSync(file, sec, sec);
}

test('isUpToDate：产物存在且不旧于全部输入时为真', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dv-fresh-'));
  const out = join(dir, 'out.webm');
  const a = join(dir, 'a.mp3');
  const b = join(dir, 'b.vtt');
  touch(a, 1000);
  touch(b, 2000);
  touch(out, 3000);
  assert.equal(isUpToDate(out, [a, b]), true);
});

test('isUpToDate：任一输入更新则需重做；产物缺失也需重做', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dv-stale-'));
  const out = join(dir, 'out.webm');
  const a = join(dir, 'a.mp3');
  const b = join(dir, 'b.vtt');
  touch(a, 1000);
  touch(b, 5000);
  touch(out, 3000);
  assert.equal(isUpToDate(out, [a, b]), false);
  assert.equal(isUpToDate(join(dir, 'nope.webm'), [a]), false);
});

test('isUpToDate：不存在的输入被忽略（如可选的 base.css）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dv-missing-'));
  const out = join(dir, 'out.webm');
  touch(out, 3000);
  assert.equal(isUpToDate(out, [join(dir, 'not-exist.css')]), true);
});
