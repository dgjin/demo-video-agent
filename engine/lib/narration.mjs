/**
 * narration.md 解析：每幕以 `## m00 · 片头（约 12s）` 这样的标题开头。
 * 幕ID 允许字母/数字/下划线/连字符（如 m0、m01、m8b、intro）。
 * 幕内非空行拼成 TTS 文本；标题行、引用、代码块、分隔线忽略。
 */
const HEADING = /^##\s*([A-Za-z0-9_-]+)\s*·\s*(.*)$/;

export function parseNarration(markdown) {
  const scenes = [];
  let cur = null;
  let inCode = false;
  for (const line of markdown.split(/\r?\n/)) {
    const t = line.trim();
    // 围栏代码块整体跳过（含其中的内容），避免示例命令被读进旁白
    if (t.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const m = line.match(HEADING);
    if (m) {
      cur = { id: m[1], title: m[2].trim(), text: '' };
      scenes.push(cur);
      continue;
    }
    if (!cur) continue;
    if (!t || t.startsWith('#') || t.startsWith('>') || t === '---') continue;
    cur.text += (cur.text ? ' ' : '') + t;
  }
  return scenes
    .map((s) => ({ ...s, text: s.text.trim() }))
    .filter((s) => s.text.length > 0);
}
