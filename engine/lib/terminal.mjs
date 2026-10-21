import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { ensureDir, log } from './util.mjs';

/**
 * 终端幕：把 asciinema v2 录制（.cast）回放成画面。
 *
 * 实现方式：生成一个自包含回放 HTML（黑底终端窗口 + 逐事件渲染），
 * 复用 overlay 录制链路（.stage / body.playing 约定）由 Playwright 录屏，
 * 产物与其它幕一致（videos/<id>.webm），compose 层零改动。
 *
 * ANSI 支持范围（刻意克制）：SGR 16 色/加粗/暗淡/下划线、\r 回车覆盖、
 * \b 退格、\t、\x1b[K 清行、\x1b[2J 清屏；光标移动等其它 CSI 丢弃。
 * 不支持全屏 TUI（vim/top 之类依赖光标定位的程序）。
 */

const SGR_FG = {
  30: 'k', 31: 'r', 32: 'g', 33: 'y', 34: 'b', 35: 'm', 36: 'c', 37: 'w',
  90: 'K', 91: 'R', 92: 'G', 93: 'Y', 94: 'B', 95: 'M', 96: 'C', 97: 'W',
};

/**
 * 解析 asciinema v2 cast：
 * 第一行 header JSON（version 2 / width / height…），后续每行 [time, type, data]。
 * 只保留输出事件（type === 'o'），按时间升序。返回 { header, events, duration }。
 */
export function parseCast(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  let header = {};
  const events = [];
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // 非 JSON 行（编辑器噪声）直接忽略
    }
    if (!Array.isArray(obj)) {
      if (header.version === undefined && typeof obj === 'object' && obj) header = obj;
      continue;
    }
    const [t, type, data] = obj;
    if (typeof t === 'number' && type === 'o' && typeof data === 'string') {
      events.push({ t, data });
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { header, events, duration: events.length ? events[events.length - 1].t : 0 };
}

/** 回放速度：让 cast 在目标时长的 92% 内放完（clamp 0.25×–4×） */
export function scaleSpeed(castDuration, targetSec) {
  if (!(castDuration > 0) || !(targetSec > 0)) return 1;
  return Math.min(4, Math.max(0.25, castDuration / (targetSec * 0.92)));
}

/**
 * 终端渲染状态：lines 为已提交行，cur 为当前行。
 * 行内容为单元格数组 [{ ch, cls }]，col 为当前行光标列——
 * 这样 \r 回到行首后写入是覆盖而非清空（真实终端语义，兼容 "text\r\n" 写法）。
 */
export function newTermState() {
  return { lines: [], cur: [], col: 0, cls: '' };
}

function applySgr(state, params) {
  const set = new Set(state.cls.split(' ').filter(Boolean));
  for (const p of String(params).split(';')) {
    const n = Number(p || 0);
    if (n === 0) set.clear();
    else if (n === 1) set.add('b');
    else if (n === 2) set.add('dim');
    else if (n === 4) set.add('u');
    else if (n === 22) {
      set.delete('b');
      set.delete('dim');
    } else if (n === 24) set.delete('u');
    else if (n === 39) [...set].filter((c) => c.startsWith('fg-')).forEach((c) => set.delete(c));
    else if (SGR_FG[n]) {
      [...set].filter((c) => c.startsWith('fg-')).forEach((c) => set.delete(c));
      set.add(`fg-${SGR_FG[n]}`);
    }
  }
  state.cls = [...set].join(' ');
}

/** 把一段 cast 输出应用到状态上（就地修改，返回 state） */
export function applyAnsi(state, text) {
  const put = (ch) => {
    const cell = { ch, cls: state.cls };
    if (state.col < state.cur.length) state.cur[state.col] = cell;
    else state.cur.push(cell);
    state.col += 1;
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\x1b') {
      const m = /^\x1b\[([0-9;?]*)([A-Za-z])/.exec(text.slice(i));
      if (m) {
        const [, params, final] = m;
        if (final === 'm') applySgr(state, params);
        else if (final === 'K') state.cur.length = Math.min(state.cur.length, state.col); // 清光标到行尾
        else if (final === 'J' && (params === '2' || params === '3')) {
          state.lines = [];
          state.cur = [];
          state.col = 0;
        }
        // 其余 CSI（光标移动等）丢弃
        i += m[0].length;
        continue;
      }
      i += 1; // 孤立 ESC 丢弃
      continue;
    }
    if (ch === '\n') {
      state.lines.push(state.cur);
      state.cur = [];
      state.col = 0;
    } else if (ch === '\r') {
      state.col = 0;
    } else if (ch === '\b') {
      state.col = Math.max(0, state.col - 1);
    } else if (ch === '\t') {
      for (let k = 0; k < 4; k++) put(' ');
    } else {
      put(ch);
    }
    i += 1;
  }
  return state;
}

/** 状态 → HTML（转义文本，连续同样式字符合并成 span；空行保留行高） */
export function stateToHtml(state, opts = {}) {
  const esc = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const row = (cells) => {
    if (!cells.length) return '<div class="line">&nbsp;</div>';
    let html = '';
    let i = 0;
    while (i < cells.length) {
      const cls = cells[i].cls;
      let text = '';
      while (i < cells.length && cells[i].cls === cls) text += cells[i++].ch;
      html += cls ? `<span class="${esc(cls)}">${esc(text)}</span>` : esc(text);
    }
    return `<div class="line">${html}</div>`;
  };
  const rows = [...state.lines, state.cur].map(row);
  if (opts.cursor && rows.length) {
    rows[rows.length - 1] = rows[rows.length - 1].replace(/<\/div>$/, '<span class="cur"></span></div>');
  }
  return rows.join('');
}

const escHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 生成自包含回放 HTML。
 * 渲染函数以源码形式内嵌，保证 Node 端（测试）与页面端（回放）共用同一份实现。
 */
export function buildPlayerHtml(cast, opts = {}) {
  const targetSec = Math.max(0.5, Number(opts.targetSec) || 0);
  const speed = scaleSpeed(cast.duration, targetSec);
  const scaled = cast.events.map((e) => [Number((e.t / speed).toFixed(3)), e.data]);
  const title = String(opts.title || 'terminal');
  const cols = Math.min(200, Math.max(20, Number(cast.header?.width) || 100));
  const shell = String(cast.header?.env?.SHELL || 'shell').split('/').pop();

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${escHtml(title)}</title>
<style>
  :root { --delta: 0s; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #05070b; }
  .stage { height: 100%; display: flex; align-items: center; justify-content: center; }
  .term {
    width: min(1500px, 92vw); border-radius: 12px; overflow: hidden;
    background: #0b0f16; border: 1px solid rgba(148, 163, 184, .18);
    box-shadow: 0 30px 80px rgba(0, 0, 0, .55);
  }
  .bar {
    display: flex; align-items: center; gap: 8px; padding: 12px 16px;
    background: #11161f; border-bottom: 1px solid rgba(148, 163, 184, .12);
  }
  .bar i { width: 12px; height: 12px; border-radius: 50%; }
  .bar .r { background: #ff5f57; } .bar .y { background: #febc2e; } .bar .g { background: #28c840; }
  .bar span { margin-left: 10px; font: 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: #7c8aa0; letter-spacing: .5px; }
  .body {
    padding: 22px 24px; min-height: 60vh;
    font: 15px/1.55 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: clamp(11px, calc(92vw / ${cols} * 0.86), 19px);
    color: #d7dce6; white-space: pre-wrap; word-break: break-all;
  }
  .line { min-height: 1.3em; }
  .cur { display: inline-block; width: .62em; height: 1.05em; vertical-align: -0.14em; background: #9aa7bd; opacity: .85; animation: blink 1.05s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .fg-k { color: #6b7280; } .fg-r { color: #f87171; } .fg-g { color: #4ade80; } .fg-y { color: #fbbf24; }
  .fg-b { color: #60a5fa; } .fg-m { color: #c084fc; } .fg-c { color: #22d3ee; } .fg-w { color: #e5e7eb; }
  .fg-K { color: #9ca3af; } .fg-R { color: #fca5a5; } .fg-G { color: #86efac; } .fg-Y { color: #fde047; }
  .fg-B { color: #93c5fd; } .fg-M { color: #d8b4fe; } .fg-C { color: #67e8f9; } .fg-W { color: #ffffff; }
  .b { font-weight: 700; } .dim { opacity: .68; } .u { text-decoration: underline; }
  .dv-cursor { display: none !important; }
</style>
</head>
<body>
<div class="stage">
  <div class="term">
    <div class="bar"><i class="r"></i><i class="y"></i><i class="g"></i><span>${escHtml(title)} — ${escHtml(shell)} · ${cast.duration.toFixed(1)}s</span></div>
    <div class="body" id="out"></div>
  </div>
</div>
<script>
const EVENTS = ${JSON.stringify(scaled)};
const SGR_FG = ${JSON.stringify(SGR_FG)};
${newTermState.toString()}
${applySgr.toString()}
${applyAnsi.toString()}
${stateToHtml.toString()}
(function () {
  const out = document.getElementById('out');
  const state = newTermState();
  let i = 0;
  let started = false;
  let done = false;
  const draw = () => { out.innerHTML = stateToHtml(state, { cursor: !done }); };
  const start = () => {
    if (started) return;
    started = true;
    const t0 = performance.now();
    const tick = () => {
      const now = (performance.now() - t0) / 1000;
      let dirty = false;
      while (i < EVENTS.length && EVENTS[i][0] <= now) {
        applyAnsi(state, EVENTS[i][1]);
        i += 1;
        dirty = true;
      }
      if (dirty) draw();
      if (i < EVENTS.length) requestAnimationFrame(tick);
      else { done = true; draw(); }
    };
    requestAnimationFrame(tick);
  };
  draw();
  // 等待录制器注入 body.playing（与 overlay 幕同一约定）
  const iv = setInterval(() => {
    if (document.body.classList.contains('playing')) { clearInterval(iv); start(); }
  }, 50);
  if (document.body.classList.contains('playing')) { clearInterval(iv); start(); }
})();
</script>
</body>
</html>`;
}

/**
 * 生成终端幕回放页并返回其绝对路径（供 recordScene 以 overlay 方式录制）。
 * cast 时长按 targetMs 缩放：短 cast 拉伸、长 cast 加速，放完落在幕尾附近。
 */
export function prepareTerminalScene(cfg, sc, targetMs) {
  const file = isAbsolute(sc.terminal) ? sc.terminal : join(cfg.projectDir, sc.terminal);
  if (!existsSync(file)) {
    throw new Error(`${sc.id} 的 cast 文件不存在：${file}（用 asciinema rec ${sc.terminal} 录制）`);
  }
  const cast = parseCast(readFileSync(file, 'utf8'));
  if (!cast.events.length) throw new Error(`${sc.id} 的 cast 没有输出事件：${file}`);
  const dir = join(cfg.paths.videos, '.tmp');
  ensureDir(dir);
  const out = join(dir, `${sc.id}-terminal.html`);
  writeFileSync(out, buildPlayerHtml(cast, { targetSec: targetMs / 1000, title: sc.title || sc.id }), 'utf8');
  const speed = scaleSpeed(cast.duration, targetMs / 1000);
  log(
    'record',
    `${sc.id} 终端幕回放页：${cast.events.length} 事件 · cast ${cast.duration.toFixed(1)}s → 幕 ${(targetMs / 1000).toFixed(1)}s（${speed.toFixed(2)}×）`
  );
  return out;
}
