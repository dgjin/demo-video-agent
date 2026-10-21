import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNarration } from '../engine/lib/narration.mjs';

test('parseNarration：按 「## id · 标题」切幕，幕内非空行拼成文本', () => {
  const md = [
    '## m00 · 片头（约 12s）',
    '第一句。',
    '第二句。',
    '',
    '## m01 · 正文',
    '内容。',
  ].join('\n');
  assert.deepEqual(parseNarration(md), [
    { id: 'm00', title: '片头（约 12s）', text: '第一句。 第二句。' },
    { id: 'm01', title: '正文', text: '内容。' },
  ]);
});

test('parseNarration：忽略引用 / 代码块 / 分隔线 / 子标题', () => {
  const md = [
    '## m00 · 测试',
    '> 引用说明',
    '```',
    'code',
    '```',
    '---',
    '### 子标题',
    '真正的旁白。',
  ].join('\n');
  assert.deepEqual(parseNarration(md), [{ id: 'm00', title: '测试', text: '真正的旁白。' }]);
});

test('parseNarration：无文本的幕被过滤；首个标题前的内容被忽略', () => {
  const md = ['开头废话', '## m00 · 空幕', '', '## m01 · 有内容', '说话。'].join('\n');
  assert.deepEqual(parseNarration(md), [{ id: 'm01', title: '有内容', text: '说话。' }]);
});

test('parseNarration：幕 ID 允许字母数字下划线与连字符', () => {
  const md = ['## intro-1 · A', '文本A。', '## m8b_2 · B', '文本B。'].join('\n');
  const ids = parseNarration(md).map((s) => s.id);
  assert.deepEqual(ids, ['intro-1', 'm8b_2']);
});
