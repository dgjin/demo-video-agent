import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VOICE_PRESETS,
  findPreset,
  normalizeGender,
  resolveSceneVoice,
  resolveVoice,
  voiceLabel,
} from '../engine/lib/voices.mjs';

test('normalizeGender：接受英文与中文别名，无法识别返回 null', () => {
  assert.equal(normalizeGender('male'), 'male');
  assert.equal(normalizeGender('男'), 'male');
  assert.equal(normalizeGender('女声'), 'female');
  assert.equal(normalizeGender('F'), 'female');
  assert.equal(normalizeGender('随便'), null);
});

test('findPreset：key / 中文标签 / voice id 三种写法都能命中', () => {
  const byKey = findPreset('warm');
  assert.equal(byKey.voice, 'zh-CN-XiaoxiaoNeural');
  assert.equal(findPreset('温暖女声'), byKey);
  assert.equal(findPreset('zh-CN-XiaoxiaoNeural'), byKey);
  assert.equal(findPreset('不存在'), null);
});

test('resolveVoice：优先级 voice > role > gender > 默认', () => {
  assert.equal(resolveVoice({}).source, 'default');
  assert.equal(resolveVoice({ gender: 'male' }).voice, 'zh-CN-YunyangNeural');
  assert.equal(resolveVoice({ role: 'sunny' }).voice, 'zh-CN-YunxiNeural');
  assert.equal(resolveVoice({ voice: 'en-US-AriaNeural' }).voice, 'en-US-AriaNeural');
  // voice 存在时 role/gender 不再生效
  assert.equal(
    resolveVoice({ voice: 'en-US-AriaNeural', role: 'sunny', gender: 'male' }).voice,
    'en-US-AriaNeural'
  );
});

test('resolveVoice：未知角色 / 未知性别抛错（不静默退回默认音色）', () => {
  assert.throws(() => resolveVoice({ role: '不存在' }), /未知角色/);
  assert.throws(() => resolveVoice({ gender: 'x' }), /未知性别/);
});

test('resolveSceneVoice：无覆盖返回 null，有覆盖时按幕取值', () => {
  const tts = { voice: 'zh-CN-XiaoxiaoNeural' };
  assert.equal(resolveSceneVoice(tts, {}), null);
  assert.equal(resolveSceneVoice(tts, { role: 'news' }), 'zh-CN-YunyangNeural');
  assert.equal(resolveSceneVoice(tts, { gender: 'male' }), 'zh-CN-YunyangNeural');
});

test('voiceLabel：预设返回中文标签，自定义音色返回原值', () => {
  assert.equal(voiceLabel('zh-CN-XiaoxiaoNeural'), '温暖女声');
  assert.equal(voiceLabel('en-US-AriaNeural'), 'en-US-AriaNeural');
});

test('VOICE_PRESETS：每个预设字段完整且 key 唯一', () => {
  const keys = new Set();
  for (const p of VOICE_PRESETS) {
    assert.ok(p.key && p.label && p.voice && p.gender && p.tone, `预设字段缺失：${p.key}`);
    assert.equal(keys.has(p.key), false, `预设 key 重复：${p.key}`);
    keys.add(p.key);
  }
});
