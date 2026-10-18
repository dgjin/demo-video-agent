# 流水线参考

## 项目目录

```text
my-demo/
  demo-video.config.mjs   # 配置（幕顺序、TTS、登录态、输出名）
  narration.md            # 分幕旁白（TTS 文本 + 时长来源）
  overlay/                # 纯展示幕 HTML（片头/片尾/过渡/导览）
  audio/                  # 产物：<id>.mp3 <id>.vtt durations.json（vtt/durations 入库）
  videos/                 # 产物：<id>.webm（不入库）
  out/                    # 产物：<id>.mp4、成片、concat.txt（不入库）
  diag/                   # 产物：抽帧 PNG（不入库）
```

## 配置字段

```js
export default {
  name: '项目名',
  narration: 'narration.md',            // 相对项目根
  finalVideo: '演示讲解.mp4',            // out/ 下的成片文件名
  viewport: { width: 1920, height: 1080 },
  fps: 25,
  baseUrl: 'http://127.0.0.1:3000',     // 真实操作幕的起点
  dirs: { audio: 'audio', videos: 'videos', out: 'out', frames: 'diag' },
  browser: { channel: 'chrome', headless: true },
  auth: {
    storageState: '.auth-state.json',
    async login(page) { /* 可选：首次录制前自动登录 */ },
  },
  tts: {
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: '-4%',
    edgeTtsBin: '',                     // 留空自动探测
    proxy: ['http://127.0.0.1:7890'],   // 按顺序重试
    fixes: [['一行', '一航']],           // 合成层同音替换，VTT 还原
  },
  compose: { crf: 20, preset: 'medium', audioBitrate: '192k', sampleRate: 44100, padSeconds: 5 },
  scenes: [
    { id: 'm00', title: '片头', overlay: 'overlay/title.html' },
    { id: 'm1', title: '主界面', auth: true, async run(ctx) { /* ... */ } },
  ],
};
```

字段说明：

- `scenes` 的顺序即成片顺序；`id` 必须与 `narration.md` 标题一致。
- `overlay` 与 `run()` 二选一：前者是纯展示 HTML，后者是真实操作。
- `auth: true` 的幕使用 `auth.storageState`；文件不存在且提供了 `login(page)` 时自动登录并保存。
- `tts.fixes` 是 `[原文, 同音字]` 数组，只影响合成文本，VTT 自动还原原文。
- `dirs` 可改为绝对路径（多项目共享素材时使用）。

## CLI

| 命令 | 作用 | 关键参数 |
| --- | --- | --- |
| `init <目录>` | 生成脚手架 | `--force` |
| `doctor` | 依赖体检 | `--edge-tts <path>` `--config` |
| `tts` | 生成 mp3/VTT/durations | `--scenes a,b` `--no-vtt` |
| `record` | 分幕录屏 | `--scenes` `--dry`（每幕 8s）`--no-record`（只彩排） |
| `compose` | 合成并拼接 | — |
| `frames` | 抽帧验收 | `--at 3,8` `--scene m1` `--width 1280` |
| `all` | tts → record → compose | 支持以上全部 + `--at` 追加抽帧 |

通用：`--config <path>`，默认 `./demo-video.config.mjs`。

环境变量：

- `DV_TTS_PROXY`：代理列表（逗号分隔），优先于配置。
- `EDGE_TTS`：edge-tts 可执行文件路径。
- `DV_BASE_URL`：仅脚手架配置里引用，可自行扩展。

## 真实操作幕的 ctx 助手

```js
{ id: 'm2', title: '查询', auth: true, async run(ctx) {
  const { page, at, bounded, moveMouse, clickLoc, hoverText, ensureInView, scrollAt } = ctx;

  await at(2.0);                                   // 等到本幕第 2.0s（按 VTT 校准）
  await hoverText(page, '开始问数');                 // 悬停精确文本
  await moveMouse(page, 520, 380);                 // 移动仿真光标
  await clickLoc(page, page.getByRole('button', { name: '开始问数' }), 260, '开始问数');
  await ensureInView(page, page.getByText('导出'));
  await scrollAt(page, 960, 600, 420);
} },
```

| API | 说明 |
| --- | --- |
| `at(s)` | 绝对时间线等待（幕开始为 0）；负值立即返回 |
| `bounded(p, ms, fallback)` | 硬超时护栏，永不 reject |
| `clickLoc(page, locator, settle, label)` | bbox → 移动光标 → settle → 点击；失败不抛错 |
| `hoverText(page, text, holdMs)` | 精确文本悬停 |
| `ensureInView(page, locator)` | 滚动入视 |
| `scrollAt(page, x, y, dy, steps)` | 坐标滚动 |
| `page` | Playwright Page，可直接用任意 API（建议自行包 bounded） |

`clickLoc` 内部固定开销约 0.8–1.0s，`at()` 应把点击落点安排在旁白句首之后 0.8–1.0s。

## overlay 展示页约定

录制引擎会：打开 HTML → 等 `.stage` → 注入 `--delta`（加载耗时秒数）→ 加 `body.playing`。

页面必须：

```html
<div class="stage">...</div>
<style>
  .anim { opacity: 0; }
  body.playing .anim {
    animation: rise .9s ... forwards;
    animation-delay: calc(var(--d) - var(--delta));  /* --d 设计延迟，--delta 抵消加载耗时 */
  }
  #veil { position: fixed; inset: 0; background: <背景色>; opacity: 1; transition: opacity 1s ease 1s; }
  body.playing #veil { opacity: 0; }                  /* 遮蔽 Chromium 首帧残影 */
  .dv-cursor { display: none !important; }
</style>
```

每个动画元素写 `style="--d:1.6s"`。`--d` 相对页面播完时刻（即旁白零点），按 VTT 句首 + 0.3–0.6s 设置。

## 文件与产物

- `audio/durations.json`：`{ "m00": 30720, ... }`（毫秒），record/compose/frames 都以它为准。
- `audio/<id>.vtt`：edge-tts 句级时间戳（仅用于人工校准与交付字幕，不烧录进画面）。
- `videos/<id>.webm`：Playwright 原始录屏（无声）。
- `out/<id>.mp4` + `out/<finalVideo>`：逐幕编码与拼接结果。
- `diag/frame-*.png`：抽帧验收图。
