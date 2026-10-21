/**
 * 多音字读音修正。
 *
 * edge-tts 只接受纯文本（不支持 SSML phoneme），所以唯一可行的纠音方式：
 * 合成前把易读错的词换成「同音同调、且替换字读音唯一」的字，字幕再按位置还原。
 *
 * 三条硬约束：
 * 1. 等长：原文与替换文长度必须一致，才能按字符位置精确还原字幕；
 * 2. 词级：键必须带上下文（「一行命令」而不是「一行」），避免误伤正常读音；
 * 3. 同音同调：替换字只在目标读音上成立（如「航」只读 háng），否则等于换个错法。
 */

/** 内置词典：按中文音色自动启用，可用 tts.defaultFixes=false 关闭 */
export const DEFAULT_FIXES = [
  // 行 háng（命令行、银行、行业…）
  ['命令行', '命令航'],
  ['一行命令', '一航命令'],
  ['一行代码', '一航代码'],
  ['行业', '航业'],
  ['银行', '银航'],
  ['换行', '换航'],
  ['多行', '多航'],

  // 重 chóng（重新、重试、重启…；zhòng 的词一律不动）
  ['重命名', '崇命名'],
  ['重新', '崇新'],
  ['重复', '虫复'],
  ['重启', '崇启'],
  ['重试', '崇试'],
  ['重连', '崇连'],
  ['重跑', '崇跑'],
  ['重录', '崇录'],
  ['重做', '崇做'],
  ['重写', '崇写'],

  // 其他高频易错词
  ['会计', '快计'],
  ['角色', '决色'],
  ['主角', '主决'],
  ['配角', '配决'],
  ['给予', '几予'],
  ['下载', '下再'],
  ['载入', '再入'],
  ['负载', '负再'],
  ['载体', '再体'],
  ['尽管', '紧管'],
  ['尽快', '紧快'],
  ['尽量', '紧量'],
  ['调研', '掉研'],
  ['调度', '掉度'],
  ['渲染', '绚染'],
  ['曝光', '抱光'],
  ['供给', '供几'],
  ['宿主', '素主'],
  ['诊断', '枕断'],
  ['阈值', '玉值'],
  ['堵塞', '堵色'],
  ['阻塞', '阻色'],
  ['帧率', '贞率'],
  ['帧数', '贞数'],
  ['处理', '楚理'],
];

/** 只有中文音色才需要这套词典 */
function isChineseVoice(voice = '') {
  return /^zh([-_]|$)/i.test(voice);
}

/**
 * 合并内置词典与项目配置，返回按「最长优先」排序的替换表。
 * tts.fixes 里的同名键覆盖内置值；值为 null / '' / 与原文相同时表示关闭该条。
 * 长度不等的条目直接丢弃（会破坏字幕位置映射）。
 */
export function compileFixes(tts = {}) {
  const merged = new Map();
  if (tts.defaultFixes !== false && isChineseVoice(tts.voice)) {
    for (const [from, to] of DEFAULT_FIXES) merged.set(from, to);
  }
  for (const entry of tts.fixes || []) {
    if (!Array.isArray(entry)) continue;
    const [from, to] = entry;
    if (!from) continue;
    if (to == null || to === '' || to === from) merged.delete(from);
    else merged.set(from, to);
  }
  return [...merged.entries()]
    .filter(([from, to]) => to && from !== to && [...from].length === [...to].length)
    .sort((a, b) => b[0].length - a[0].length);
}

/**
 * 一次性扫描替换（最长优先），返回替换结果与位置映射。
 * ranges: [替换段在合成文本中的起始下标, 原文片段]，等长替换故可直接反查。
 */
export function applyPronunciation(text, entries = []) {
  if (!entries.length) return { text, ranges: [] };
  const ranges = [];
  let out = '';
  let i = 0;
  while (i < text.length) {
    let hit = null;
    for (const entry of entries) {
      if (text.startsWith(entry[0], i)) {
        hit = entry;
        break;
      }
    }
    if (!hit) {
      out += text[i];
      i += 1;
      continue;
    }
    ranges.push([out.length, hit[0]]);
    out += hit[1];
    i += hit[0].length;
  }
  return { text: out, ranges };
}

/** 合成文本下标 → 原文单字；不在替换段内返回 null */
function originalAt(ranges, index) {
  for (const [start, from] of ranges) {
    const k = index - start;
    if (k >= 0 && k < from.length) return from[k];
  }
  return null;
}

/**
 * 还原 VTT 字幕。
 * 只在「确实被替换过的字符位置」上换回原文，因此原文里本来就有的同音字不会被误改。
 * 逐条 cue 在合成文本中顺序定位；数字被 TTS 改写成汉字等对不上的 cue 原样保留。
 */
export function restoreVtt(vtt, spoken, ranges = []) {
  if (!ranges.length) return vtt;

  // 合成文本去掉空白后建索引，便于与 cue 文本对齐
  const chars = [];
  const positions = [];
  for (let i = 0; i < spoken.length; i++) {
    if (/\s/.test(spoken[i])) continue;
    chars.push(spoken[i]);
    positions.push(i);
  }
  const flat = chars.join('');

  let cursor = 0;
  return vtt
    .split('\n')
    .map((line) => {
      if (!line || line === 'WEBVTT' || line.includes('-->') || /^\d+$/.test(line) || line.startsWith('NOTE')) {
        return line;
      }
      const cue = line.replace(/\s+/g, '');
      if (!cue) return line;
      const at = flat.indexOf(cue, cursor);
      if (at < 0) return line;
      cursor = at + cue.length;
      let k = 0;
      return [...line]
        .map((ch) => {
          if (/\s/.test(ch)) return ch;
          const orig = originalAt(ranges, positions[at + k]);
          k += 1;
          return orig ?? ch;
        })
        .join('');
    })
    .join('\n');
}
