/**
 * 解说音色目录：把 edge-tts 的 voice id 收敛成「性别 + 角色」两种选法。
 *
 * 配置优先级：tts.voice > tts.role > tts.gender > 默认（温暖女声）。
 * tts.voice 仍接受任意 edge-tts voice id（如 en-US-AriaNeural），预设只是别名。
 */

export const VOICE_PRESETS = [
  {
    key: 'warm',
    label: '温暖女声',
    voice: 'zh-CN-XiaoxiaoNeural',
    gender: 'female',
    tone: '温和清晰，产品解说的默认选择',
  },
  {
    key: 'lively',
    label: '活泼女声',
    voice: 'zh-CN-XiaoyiNeural',
    gender: 'female',
    tone: '轻快有起伏，适合轻松的演示与教程',
  },
  {
    key: 'news',
    label: '新闻男声',
    voice: 'zh-CN-YunyangNeural',
    gender: 'male',
    tone: '标准播音腔，适合正式发布与汇报',
  },
  {
    key: 'sunny',
    label: '阳光男声',
    voice: 'zh-CN-YunxiNeural',
    gender: 'male',
    tone: '年轻自然，适合开发者与社区内容',
  },
  {
    key: 'steady',
    label: '沉稳男声',
    voice: 'zh-CN-YunjianNeural',
    gender: 'male',
    tone: '低沉有力，适合纪录片式旁白',
  },
  {
    key: 'youth',
    label: '少年音',
    voice: 'zh-CN-YunxiaNeural',
    gender: 'male',
    tone: '少年感，适合轻量教程与科普',
  },
  {
    key: 'dongbei',
    label: '东北女声',
    voice: 'zh-CN-liaoning-XiaobeiNeural',
    gender: 'female',
    tone: '方言音色，适合接地气的内容',
  },
  {
    key: 'shaanxi',
    label: '陕西女声',
    voice: 'zh-CN-shaanxi-XiaoniNeural',
    gender: 'female',
    tone: '方言音色，适合地域化内容',
  },
];

const GENDER_ALIASES = {
  female: 'female',
  f: 'female',
  woman: 'female',
  女: 'female',
  女声: 'female',
  male: 'male',
  m: 'male',
  man: 'male',
  男: 'male',
  男声: 'male',
};

/** male / female / 男 / 女 … 统一成 male|female；无法识别返回 null */
export function normalizeGender(value) {
  if (!value) return null;
  return GENDER_ALIASES[String(value).trim().toLowerCase()] || null;
}

/** 按 key、中文标签或 edge voice id 查预设 */
export function findPreset(value) {
  if (!value) return null;
  const v = String(value).trim();
  return (
    VOICE_PRESETS.find(
      (p) => p.key === v.toLowerCase() || p.label === v || p.voice.toLowerCase() === v.toLowerCase()
    ) || null
  );
}

/**
 * 解析最终音色。返回 { voice, preset, source }，source 说明命中的是哪一层。
 * 角色/性别写错时抛错并列出可用项，避免静默退回默认音色。
 */
export function resolveVoice(tts = {}) {
  if (tts.voice) {
    const preset = findPreset(tts.voice);
    return { voice: preset ? preset.voice : String(tts.voice).trim(), preset, source: 'voice' };
  }

  const role = tts.role || tts.persona;
  if (role) {
    const preset = findPreset(role);
    if (!preset) {
      throw new Error(
        `未知角色 ${role}；可用：${VOICE_PRESETS.map((p) => `${p.key}(${p.label})`).join('、')}`
      );
    }
    return { voice: preset.voice, preset, source: 'role' };
  }

  if (tts.gender) {
    const gender = normalizeGender(tts.gender);
    if (!gender) throw new Error(`未知性别 ${tts.gender}；可用：male / female（或 男 / 女）`);
    const preset = VOICE_PRESETS.find((p) => p.gender === gender);
    return { voice: preset.voice, preset, source: 'gender' };
  }

  return { voice: VOICE_PRESETS[0].voice, preset: VOICE_PRESETS[0], source: 'default' };
}

/** 单幕音色覆盖：scene.voice / scene.role / scene.gender 任一存在时返回该幕 voice */
export function resolveSceneVoice(tts, scene = {}) {
  if (!scene.voice && !scene.role && !scene.gender) return null;
  return resolveVoice({ ...tts, voice: scene.voice || '', role: scene.role || '', gender: scene.gender || '' }).voice;
}

/** 预设的中文名，用于日志 */
export function voiceLabel(voice) {
  return findPreset(voice)?.label || voice;
}
