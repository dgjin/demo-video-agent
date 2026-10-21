import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyAnsi,
  buildPlayerHtml,
  newTermState,
  parseCast,
  prepareTerminalScene,
  scaleSpeed,
  stateToHtml,
} from '../engine/lib/terminal.mjs';

const HEADER = JSON.stringify({ version: 2, width: 100, height: 30, timestamp: 1700000000 });

test('parseCast：解析 header 与输出事件，忽略非法行和非输出事件', () => {
  const text = [
    HEADER,
    '[0.5, "o", "hello"]',
    '[1.2, "i", "typed input"]', // 输入事件不参与回放
    'this is not json', // 编辑器噪声
    '[2.0, "o", " world"]',
    '',
  ].join('\n');
  const cast = parseCast(text);
  assert.equal(cast.header.width, 100);
  assert.deepEqual(
    cast.events.map((e) => [e.t, e.data]),
    [
      [0.5, 'hello'],
      [2.0, ' world'],
    ]
  );
  assert.equal(cast.duration, 2.0);
});

test('parseCast：事件按时间升序，空输入得到空事件与 0 时长', () => {
  const cast = parseCast([HEADER, '[3, "o", "b"]', '[1, "o", "a"]'].join('\n'));
  assert.deepEqual(cast.events.map((e) => e.data), ['a', 'b']);
  assert.equal(parseCast('').duration, 0);
  assert.deepEqual(parseCast('').events, []);
});

test('scaleSpeed：正常比值、无效输入与 0.25×–4× clamp', () => {
  // 10s 的 cast 放进 10s 的幕：speed = 10 / (10 * 0.92)
  assert.equal(scaleSpeed(10, 10).toFixed(3), '1.087');
  assert.equal(scaleSpeed(0, 10), 1);
  assert.equal(scaleSpeed(10, 0), 1);
  // 极短 cast + 极长幕 → 最慢 0.25×；极长 cast + 极短幕 → 最快 4×
  assert.equal(scaleSpeed(1, 1000), 0.25);
  assert.equal(scaleSpeed(1000, 1), 4);
});

test('applyAnsi：\\r 回到行首覆盖、\\n 提交行、\\t 展开为四空格、\\b 退格', () => {
  const s = newTermState();
  applyAnsi(s, 'abcdef\rxy'); // 回车后从行首覆盖写入，尾部保留（真实终端行为）
  assert.deepEqual(
    s.cur.map((c) => c.ch),
    ['x', 'y', 'c', 'd', 'e', 'f']
  );
  applyAnsi(s, '\n\tindent\b\bOK');
  // 回车已把行首改写为 'xy'，\n 提交该行；
  // 新行 = 四空格 + 'indent' 退两格 + 'OK'
  assert.equal(s.lines.length, 1);
  assert.equal(stateToHtml(s), '<div class="line">xycdef</div><div class="line">    indeOK</div>');
});

test('applyAnsi：命令行常见的 "text\\r\\n" 不会被 \\r 清空（回归）', () => {
  const s = newTermState();
  applyAnsi(s, '$ demo-video doctor\r\n');
  applyAnsi(s, '✓ done\r\n');
  assert.equal(
    stateToHtml(s),
    '<div class="line">$ demo-video doctor</div><div class="line">✓ done</div><div class="line">&nbsp;</div>'
  );
});

test('applyAnsi：\\x1b[K 清当前行，\\x1b[2J 清屏，光标移动等 CSI 被丢弃', () => {
  const s = newTermState();
  applyAnsi(s, 'progress 30%\r\x1b[Kdone');
  assert.equal(stateToHtml(s), '<div class="line">done</div>');

  applyAnsi(s, '\nsecond');
  applyAnsi(s, '\x1b[2J');
  assert.deepEqual(s.lines, []);
  assert.deepEqual(s.cur, []);

  applyAnsi(s, 'abc\x1b[3Ddef'); // 光标左移 3 格：不支持，直接丢弃控制序列
  assert.equal(stateToHtml(s), '<div class="line">abcdef</div>');
});

test('applyAnsi：SGR 颜色/加粗/暗淡/下划线与 reset', () => {
  const s = newTermState();
  applyAnsi(s, '\x1b[31mred\x1b[0m plain \x1b[1;4mbold\x1b[22;24m');
  const html = stateToHtml(s);
  assert.match(html, /<span class="fg-r">red<\/span>/);
  assert.match(html, /plain /);
  assert.match(html, /<span class="b u">bold<\/span>/);

  const s2 = newTermState();
  applyAnsi(s2, '\x1b[91mA\x1b[39mB'); // 亮色 + 39 清除前景色
  assert.match(stateToHtml(s2), /<span class="fg-R">A<\/span>B/);

  const s3 = newTermState();
  applyAnsi(s3, '\x1b[32;42mX'); // 只支持前景色，背景色忽略
  assert.match(stateToHtml(s3), /<span class="fg-g">X<\/span>/);
});

test('stateToHtml：HTML 转义、空行保留行高、cursor 落在末行', () => {
  const s = newTermState();
  applyAnsi(s, '<b>"x"</b>\n');
  const html = stateToHtml(s, { cursor: true });
  assert.match(html, /&lt;b&gt;&quot;x&quot;&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /<div class="line">&nbsp;<span class="cur"><\/span><\/div>$/);
  assert.match(html, /<span class="cur"><\/span>/);
  assert.doesNotMatch(stateToHtml(s), /class="cur"/);
});

test('buildPlayerHtml：自包含回放页，事件按倍速预缩放且无原始 ESC 字符', () => {
  const cast = parseCast([HEADER, '[2, "o", "\\u001b[32mok\\u001b[0m\\n"]', '[4, "o", "done"]'].join('\n'));
  const html = buildPlayerHtml(cast, { targetSec: 5, title: '演示 <终端>' });
  assert.match(html, /^<!doctype html>/);
  // 标题转义
  assert.match(html, /演示 &lt;终端&gt;/);
  // 末事件时间 ≈ 幕长 92%（speed = 4 / (5*0.92) ≈ 0.87）
  const m = /const EVENTS = (\[.*?\]);/s.exec(html);
  assert.ok(m, '页面应内嵌 EVENTS');
  const scaled = JSON.parse(m[1]);
  assert.equal(scaled.length, 2);
  assert.ok(Math.abs(scaled[1][0] - 5 * 0.92) < 0.01, `末事件应落在 4.6s，实际 ${scaled[1][0]}`);
  // ESC 在 JSON 中转为 \u001b 文本，不把控制字符写进 HTML
  assert.ok(html.includes('\\u001b'));
  assert.ok(!html.includes('\x1b'));
  // 内嵌的渲染函数与 Node 侧同源
  assert.ok(html.includes(newTermState.toString()));
  assert.ok(html.includes(applyAnsi.toString()));
  // 终端幕也要隐藏引擎注入的仿真光标，否则录制画面左下角出现蓝点
  assert.ok(html.includes('.dv-cursor { display: none !important; }'));
});

/** 造一个最小项目：assets/demo.cast + config 所需路径 */
function project(castLines) {
  const dir = mkdtempSync(join(tmpdir(), 'dv-term-'));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'assets', 'demo.cast'), [HEADER, ...castLines, ''].join('\n'));
  return {
    cfg: { projectDir: dir, paths: { videos: join(dir, 'videos') } },
    dir,
  };
}

test('prepareTerminalScene：生成回放页到 videos/.tmp 并返回绝对路径', () => {
  const { cfg, dir } = project(['[0, "o", "hi\\n"]', '[1, "o", "bye"]']);
  const out = prepareTerminalScene(cfg, { id: 'm02', terminal: 'assets/demo.cast', title: '终端' }, 6000);
  assert.ok(out.startsWith(join(dir, 'videos', '.tmp')));
  const html = readFileSync(out, 'utf8');
  assert.match(html, /<div class="body" id="out">/);
  assert.match(html, /const EVENTS = \[\[0,/);
});

test('prepareTerminalScene：cast 缺失或无输出事件时给出可操作报错', () => {
  const { cfg } = project(['[0, "o", "x"]']);
  assert.throws(
    () => prepareTerminalScene(cfg, { id: 'm1', terminal: 'assets/nope.cast' }, 5000),
    /cast 文件不存在.*asciinema rec/
  );
  const empty = project(['[0, "i", "input-only"]']);
  assert.throws(
    () => prepareTerminalScene(empty.cfg, { id: 'm1', terminal: 'assets/demo.cast' }, 5000),
    /没有输出事件/
  );
});
