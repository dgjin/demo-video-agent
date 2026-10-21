import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FIXES,
  applyPronunciation,
  compileFixes,
  restoreVtt,
} from '../engine/lib/pronunciation.mjs';

const ZH = 'zh-CN-XiaoxiaoNeural';

test('compileFixes：中文音色启用全部内置词典', () => {
  const fixes = compileFixes({ voice: ZH });
  assert.equal(fixes.length, DEFAULT_FIXES.length);
  assert.deepEqual(fixes.find(([from]) => from === '命令行'), ['命令行', '命令航']);
});

test('compileFixes：非中文音色不启用内置词典（自定义条目仍生效）', () => {
  assert.equal(compileFixes({ voice: 'en-US-AriaNeural' }).length, 0);
  const custom = compileFixes({ voice: 'en-US-AriaNeural', fixes: [['readme', 'read me']] });
  // readme(6) 与 read me(7) 不等长，必须被丢弃
  assert.equal(custom.length, 0);
});

test('compileFixes：defaultFixes=false 整体关闭内置词典', () => {
  assert.equal(compileFixes({ voice: ZH, defaultFixes: false }).length, 0);
});

test('compileFixes：项目 fixes 同名覆盖内置值', () => {
  const fixes = compileFixes({ voice: ZH, fixes: [['命令行', '命令刚']] });
  assert.deepEqual(fixes.find(([from]) => from === '命令行'), ['命令行', '命令刚']);
});

test('compileFixes：值为 null 表示屏蔽单条内置词', () => {
  const fixes = compileFixes({ voice: ZH, fixes: [['命令行', null]] });
  assert.equal(fixes.some(([from]) => from === '命令行'), false);
});

test('compileFixes：不等长条目被丢弃、结果按长度降序（最长优先）', () => {
  const fixes = compileFixes({ voice: ZH, fixes: [['测试', '测试测']] });
  assert.equal(fixes.some(([from]) => from === '测试'), false);
  const lens = fixes.map(([from]) => from.length);
  assert.deepEqual(lens, [...lens].sort((a, b) => b - a));
});

test('applyPronunciation：命中最长词并记录位置', () => {
  const entries = compileFixes({ voice: ZH });
  const { text, ranges } = applyPronunciation('先看一行命令的输出', entries);
  assert.equal(text, '先看一航命令的输出');
  assert.deepEqual(ranges, [[2, '一行命令']]);
});

test('applyPronunciation：同段文本内的多个替换都记录', () => {
  const entries = [
    ['命令行', '命令航'],
    ['银行', '银航'],
  ];
  const { text, ranges } = applyPronunciation('命令行连着银行', entries);
  assert.equal(text, '命令航连着银航');
  assert.deepEqual(ranges, [
    [0, '命令行'],
    [5, '银行'],
  ]);
});

test('applyPronunciation：无命中或空词典时原样返回', () => {
  assert.deepEqual(applyPronunciation('普通文本', []), { text: '普通文本', ranges: [] });
  const entries = compileFixes({ voice: ZH });
  const r = applyPronunciation('完全无关的句子', entries);
  assert.equal(r.text, '完全无关的句子');
  assert.deepEqual(r.ranges, []);
});

test('restoreVtt：按位置把字幕还原为原文，未替换的字不动', () => {
  const spoken = '命令航 连着 银航';
  const ranges = [
    [0, '命令行'],
    [7, '银行'],
  ];
  const vtt = ['WEBVTT', '', '00:00:00,100 --> 00:00:02,000', '命令航 连着 银航', ''].join('\n');
  const out = restoreVtt(vtt, spoken, ranges);
  assert.match(out, /命令行 连着 银行/);
  // 时间轴行与文件头不受影响
  assert.match(out, /00:00:00,100 --> 00:00:02,000/);
  assert.match(out, /^WEBVTT/);
});

test('restoreVtt：原文自带的同音字不会被误改', () => {
  // 原文里第一个「航」是正常用字，只有第二个「银航」来自替换
  const spoken = '航班信息与银航';
  const ranges = [[5, '银行']];
  const vtt = ['WEBVTT', '', '00:00:00,000 --> 00:00:01,000', '航班信息与银航', ''].join('\n');
  const out = restoreVtt(vtt, spoken, ranges);
  assert.match(out, /航班信息与银行/);
});

test('restoreVtt：TTS 改写数字等对不上的 cue 原样保留', () => {
  const spoken = '银航';
  const ranges = [[0, '银行']];
  const vtt = ['WEBVTT', '', '00:00:00,000 --> 00:00:01,000', '第一步', ''].join('\n');
  assert.equal(restoreVtt(vtt, spoken, ranges), vtt);
});

test('restoreVtt：无替换时直接返回原 VTT', () => {
  const vtt = 'WEBVTT\n\n00:00:00,000 --> 00:00:01,000\n你好\n';
  assert.equal(restoreVtt(vtt, '你好', []), vtt);
});
