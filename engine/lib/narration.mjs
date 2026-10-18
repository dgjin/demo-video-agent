/**
 * narration.md 解析：每幕以 `## <幕ID> · <幕名>（约 Xs）` 开头。
 * 幕ID 允许字母/数字/下划线/连字符（如 m0、m01、m8b、intro）。
 * 幕内非空行拼成 TTS 文本；标题行、引用、代码块、分隔线忽略。
 */
const HEADING = /^##\s*([A-Za-z0-9_-]+)\s*·\s*(.*)$/;

export function parseNarration(markdown) {
  const scenes = [];
  let cur = null;
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(HEADING);
    if (m) {
      cur = { id: m[1], title: m[2].trim(), text: '' };
      scenes.push(cur);
      continue;
    }
    if (!cur) continue;
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('>') || t.startsWith('```') || t === '---') continue;
    cur.text += (cur.text ? ' ' : '') + t;
  }
  return scenes
    .map((s) => ({ ...s, text: s.text.trim() }))
    .filter((s) => s.text.length > 0);
}
