# 流水线参考

## 项目目录

```text
my-demo/
  demo-video.config.mjs   # 配置（幕顺序、TTS、登录态、输出名）
  narration.md            # 分幕旁白（TTS 文本 + 时长来源）
  overlay/                # 纯展示幕 HTML（片头/片尾/过渡/导览）
  assets/                 # 素材幕的源文件（真机录屏/实拍/截图）与终端幕的 .cast（入库）
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
    role: 'warm',                        // 角色选音色：warm/lively/news/sunny/steady…
    // gender: 'male',                   // 或只按性别选
    // voice: 'zh-CN-XiaoxiaoNeural',    // 显式指定（优先级最高，任意 edge-tts voice）
    rate: '-4%',
    concurrency: 3,                     // 多幕并行合成数；网络不稳可调 1 串行
    edgeTtsBin: '',                     // 留空自动探测
    proxy: ['http://127.0.0.1:7890'],   // 按顺序重试
    defaultFixes: true,                 // 内置多音字词典，中文音色自动启用
    fixes: [['一行命令', '一航命令']],   // 追加/覆盖内置词，等长同音替换
  },
  compose: { crf: 20, preset: 'medium', audioBitrate: '192k', sampleRate: 44100, padSeconds: 5 },
  scenes: [
    { id: 'm00', title: '片头', overlay: 'overlay/title.html' },
    { id: 'm1', title: '主界面', auth: true, async run(ctx) { /* ... */ } },
    // 素材幕：视频导入 / 截图序列（二选一）
    { id: 'm2', title: 'App 演示', asset: 'assets/app-demo.mp4' },
    { id: 'm3', title: '界面走查', asset: ['assets/shot-01.png', 'assets/shot-02.png'], fit: 'contain' },
    // 终端幕：asciinema v2 录制回放
    { id: 'm4', title: '命令行演示', terminal: 'assets/demo.cast' },
  ],
};
```

字段说明：

- `scenes` 的顺序即成片顺序；`id` 必须与 `narration.md` 标题一致。
- 画面源四选一（互斥）：`overlay`（纯展示 HTML）、`run()`（真实操作）、`asset`（导入素材）、`terminal`（终端录制回放）。
- `asset` 单个视频（mp4/webm/mov/gif）：自动适配画幅并去原声，短于旁白时冻帧补齐、超长裁尾；或图片数组（png/jpg…）：按该幕 VTT 句首自动切换，推荐一句一图，末图撑到幕尾。
- `terminal` 指向 asciinema v2 的 `.cast`：回放速度按该幕旁白时长自动缩放（0.25×–4×），放完落在幕尾附近；支持 SGR 16 色/加粗/暗淡/下划线、`\r` 覆盖、`\b`、`\t`、清行清屏，光标定位类 CSI 忽略（不支持全屏 TUI）。
- `fit` 仅素材幕有效：`'contain'`（默认，等比居中留黑边）/ `'cover'`（裁切填满，适合竖屏录屏）。
- 纯素材项目（所有幕都是 `asset`）不加载浏览器与 playwright，仅依赖 ffmpeg 与 edge-tts。
- `auth: true` 的幕使用 `auth.storageState`；文件不存在且提供了 `login(page)` 时自动登录并保存。
- `tts.role` / `tts.gender`：按角色或男女声选音色（`demo-video voices` 列出），`tts.voice` 显式指定时优先；单幕可在 scene 上写 `role` / `gender` / `voice` 覆盖。
- `tts.defaultFixes` 默认 `true`：中文音色自动套用内置词典（命令行 / 重新 / 会计 / 角色…）；`fixes` 追加或覆盖，值为 `null` 关闭某条内置词。
- `tts.fixes` 是 `[原文, 同音字]` 数组，**必须等长且同音同调**；只影响合成文本，VTT 按字符位置精确还原（不会误改原文里本来就有的同音字）。
- `browser.channel` 默认 `chrome`；启动失败时自动回退 Playwright 内置 chromium。
- `dirs` 可改为绝对路径（多项目共享素材时使用）。

## CLI

| 命令 | 作用 | 关键参数 |
| --- | --- | --- |
| `setup` | 安装插件依赖（playwright + 录屏 ffmpeg） | `--link`（生成全局命令）`--force` |
| `init <目录>` | 生成脚手架 | `--force` |
| `doctor` | 依赖体检 | `--edge-tts <path>` `--config` |
| `tts` | 生成 mp3/VTT/durations | `--scenes a,b` `--no-vtt` |
| `record` | 分幕录屏 / 素材转码 / 终端回放页 | `--scenes` `--dry`（每幕 8s）`--no-record`（只彩排）`--force`（忽略续做） |
| `compose` | 合成并拼接（未变的分幕自动复用） | `--force` |
| `frames` | 抽帧验收 | `--at 3,8` `--scene m1` `--width 1280` |
| `all` | tts → record → compose | 支持以上全部 + `--at` 追加抽帧 |

通用：`--config <path>`；省略时从当前目录向上查找 `demo-video.config.mjs`。

环境变量：

- `DV_HOME`：源码开发时指定插件根目录（安装副本不需要）。
- `DV_CONFIG`：项目配置路径，优先于自动发现。
- `DV_TTS_PROXY`：代理列表（逗号分隔），优先于配置。
- `EDGE_TTS`：edge-tts 可执行文件路径。
- `DV_PLAYWRIGHT`：自备 playwright 的 node_modules 所在目录。
- `DV_NO_AUTO_INSTALL=1`：禁用插件目录的自动 npm install。
- `DV_BIN_DIR`：`setup --link` 生成启动器的目录（默认 `~/.local/bin`）。
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

单一写法：入场时刻一律用 `--d`（双值动画用 `--d` / `--d2`），不要在元素上另写 `calc(12.2s - var(--delta))` 的硬编码秒数——`--delta` 由引擎注入，硬编码会在时长调整后与旁白脱节，也让批量校准脚本漏改。

## 终端幕

```bash
# 1) 录制：asciinema v2（默认即 v2），录普通命令行输出，避免 vim/top 等全屏 TUI
asciinema rec assets/demo.cast
# 2) 配置：{ id: 'm4', title: '命令行演示', terminal: 'assets/demo.cast' }
# 3) 与其它幕一样：tts → record → compose
```

cast 格式：首行 header JSON（`version: 2`、`width/height`、可选 `env.SHELL`），其后每行 `[time, "o", data]`；非 JSON 行与输入事件会被忽略。

渲染要点：

- 回放速度 = `cast 时长 / (该幕旁白 × 0.92)`，clamp 在 0.25×–4×；cast 比旁白短会放慢，比旁白长会加速，末尾留约 8% 余量。
- 回放页是自包含 HTML（黑底终端窗口 + 标题栏 + 光标闪烁），由 `engine/lib/terminal.mjs` 生成到 `videos/.tmp/<id>-terminal.html`，随后以 overlay 方式录制；产物仍是 `videos/<id>.webm`，compose 无需区分。
- ANSI 支持：SGR 16 色 / 加粗 / 暗淡 / 下划线（22/24/39 复位）、`\r` 回车覆盖（字符级覆盖，不是清行）、`\b` 退格、`\t`、`\x1b[K` 清行尾、`\x1b[2J/3J` 清屏；其余 CSI（光标移动、行内定位）丢弃。
- `record --dry` / `--no-record` 同样会生成回放页并彩排；`doctor` 的幕类型分布显示 `terminal`。
- 示例：`examples/terminal-demo`（片头 + 终端幕两幕）。

## 文件与产物

- `audio/durations.json`：`{ "m00": 30720, ... }`（毫秒），record/compose/frames 都以它为准。
- `audio/<id>.vtt`：edge-tts 句级时间戳（仅用于人工校准与交付字幕，不烧录进画面）。
- `videos/<id>.webm`：Playwright 原始录屏（无声）。
- `out/<id>.mp4` + `out/<finalVideo>`：逐幕编码与拼接结果。
- `diag/frame-*.png`：抽帧验收图。
