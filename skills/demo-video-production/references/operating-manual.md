# 演示视频制作操作手册

本手册是 `demo-video-agent` 的完整操作指南，面向第一次使用本插件的人，也供 `demo-video-production` 技能在制作过程中查阅。按顺序读完第 1–2 章即可跑通内置示例；第 3–10 章是真实项目的完整制作流程；第 11–14 章用于迭代、排障与交付。

配套文档：

- `pipeline-reference.md`：配置字段、CLI、`ctx` API、overlay 协议的速查字典。
- `calibration-and-pitfalls.md`：音画校准公式与踩坑记录（原理与边界条件）。
- 插件根目录 `README.md`：能力概览与安装。

约定：先解析插件根目录 `DV_ROOT`，命令统一用绝对路径（不要假设当前目录是插件根目录）；`<项目>` 指你自己的演示项目目录，`<幕ID>` 指 `m0`、`m01`、`m8b` 之类。

```bash
DV_ROOT="${DV_HOME:-$(ls -d "$HOME/.qoder/plugins/cache"/*/demo-video-agent/* 2>/dev/null | while read -r p; do echo "$(basename "$p") $p"; done | sort -V | tail -1 | cut -d' ' -f2-)}"
echo "$DV_ROOT"   # 为空说明插件未安装/未启用；源码开发时可用 export DV_HOME="$PWD"
```

安装过 `setup --link` 后，可将命令中的 `node "$DV_ROOT/engine/cli.mjs"` 换成 `demo-video`。

---

## 1. 一次性环境准备

### 1.1 依赖清单

| 依赖 | 版本/形态 | 用途 | 安装 |
| --- | --- | --- | --- |
| Node.js | ≥ 18 | 运行引擎 | `brew install node` 或 nvm |
| ffmpeg / ffprobe | 任意较新版本 | 度量时长、合成、抽帧 | `brew install ffmpeg` |
| edge-tts | 可执行文件 | 生成 mp3 + 句级 VTT | `pip install edge-tts` |
| Google Chrome | 桌面版 | Playwright `channel: 'chrome'` 录屏 | 官网安装 |
| Playwright | 由 `npm install` 安装 | 浏览器自动化与录屏 | 见 1.2 |
| Playwright ffmpeg | 随 Playwright 下载 | `recordVideo` 编码 webm | `npx playwright install ffmpeg` |

说明：

- 无桌面环境（CI/服务器）需要虚拟显示（如 xvfb），并改用 `browser.headless: true`。
- edge-tts 走微软在线语音服务，内网/受限网络需要 HTTP 代理（见 1.4）。
- 若被录制项目自己已安装 Playwright，引擎会优先复用它，插件内可以不装。

### 1.2 安装插件依赖

```bash
node "$DV_ROOT/engine/cli.mjs" setup   # 安装 playwright 与录屏 ffmpeg（等价于 npm install + npx playwright install ffmpeg）
```

插件安装副本不带 `node_modules`，`setup` 或首次 `record` 会自动安装；`DV_NO_AUTO_INSTALL=1` 可禁用自动安装。

### 1.3 体检

```bash
node "$DV_ROOT/engine/cli.mjs" doctor
```

预期输出九行，除 `config` 外均为 `✓`：

```text
✓ plugin     demo-video-agent v0.3.0 · ~/.qoder/plugins/cache/local/demo-video-agent/0.3.0
✓ node       22.x
✓ ffmpeg     可执行
✓ ffprobe    可执行
✓ edge-tts   ~/Library/Python/3.12/bin/edge-tts
✓ playwright 模块可用（channel 不可用时自动回退内置 chromium）
✓ pw-ffmpeg  ~/Library/Caches/ms-playwright/ffmpeg-1013
· config     未找到 .../demo-video.config.mjs（init 后可检查）
✓ voice      zh-CN-XiaoxiaoNeural（温暖女声）
```

- 最后一行 `· config` 是提示项，不影响退出码；进入具体项目后配置会从当前目录向上自动查找，也可加 `--config` 复查。
- `✗` 表示硬性缺失，按右列提示安装；多数项可用 `setup` 一键修复。`pw-ffmpeg` 缺失只影响录屏，不影响 TTS 与合成。
- edge-tts 装在用户目录未进 `PATH` 也能被自动探测（macOS `~/Library/Python/*/bin`、Linux `~/.local/bin`、Windows `%APPDATA%\Python\*\Scripts`）；仍找不到时用 `--edge-tts /绝对路径` 或环境变量 `EDGE_TTS`。

```bash
node "$DV_ROOT/engine/cli.mjs" doctor --config ../my-demo/demo-video.config.mjs
node "$DV_ROOT/engine/cli.mjs" doctor --edge-tts /usr/local/bin/edge-tts
```

### 1.4 环境变量

| 变量 | 作用 | 示例 |
| --- | --- | --- |
| `DV_TTS_PROXY` | TTS 代理列表，逗号分隔，优先于配置 | `http://127.0.0.1:7890,http://127.0.0.1:7891` |
| `EDGE_TTS` | edge-tts 可执行文件路径 | `/usr/local/bin/edge-tts` |
| `DV_BASE_URL` | 脚手架配置里引用的站点地址 | `http://127.0.0.1:5173` |

代理机制：每个代理尝试两轮；配置顺序即重试顺序。直连成功时日志显示 `(直连)`，走代理时显示代理地址。

### 1.5 五分钟验收：跑通内置示例

```bash
# 网络需要代理时
export DV_TTS_PROXY=http://127.0.0.1:7890

node "$DV_ROOT/engine/cli.mjs" all --config "$DV_ROOT/examples/hello-video/demo-video.config.mjs" --at 2,6,10
```

预期：

- TTS 两幕：`m00` 约 8.3s、`m01` 约 3.3s；
- 录制两幕：`m00` 约 8s、`m01` 约 4s，各 0.3–0.7MB；
- 合成：`out/hello-demo.mp4`，总时长约 11.7s；
- 抽帧：`diag/frame-2s.png`、`frame-6s.png`、`frame-10s.png`。

打开成片与抽帧图，确认：片头标题入场、副标题出现、片尾「示例完成」、全程无光标圆点、无黑帧。若这一步通过，说明整条链路（TTS、录屏、合成、抽帧）在本机可用。

---

## 2. 新建项目

### 2.1 初始化

```bash
node "$DV_ROOT/engine/cli.mjs" init ../my-demo
```

目标目录已存在且非空时会拒绝；确认要覆盖时加 `--force`。生成内容：

```text
my-demo/
  demo-video.config.mjs   # 配置：幕顺序、TTS、登录态、输出名
  narration.md            # 分幕旁白（TTS 文本来源）
  overlay/title.html      # 片头模板
  overlay/outro.html      # 片尾模板
  .gitignore              # 排除 mp3/webm/mp4/diag/登录态
```

### 2.2 推荐实施顺序

1. 勘察被测系统，列出关键路径与交互点（第 3 章）。
2. 写 `narration.md`，确定分幕与每幕时长预算（第 4 章）。
3. 填 `demo-video.config.mjs`，幕顺序与文稿一一对应（第 5 章）。
4. 跑 `tts`，拿到真实时长与 VTT（第 6 章）。
5. 做 overlay 幕（第 7 章）或写真实操作幕 `run(ctx)`（第 8 章）。
6. 彩排 → 录制 → 合成 → 抽帧验收（第 9–10 章）。
7. 按验收清单修正，重复 5–6 步；交付时按第 13 章归档。

### 2.3 版本管理

`.gitignore` 已排除 `audio/*.mp3`、`audio/*.txt`、`videos/`、`out/`、`diag/`、`*.mp4`、`.auth-state.json`。应当入库的是：`narration.md`、`demo-video.config.mjs`、`overlay/`、`audio/*.vtt`、`audio/durations.json`。成片与录屏作为附件交付，不进仓库。

---

## 3. 分幕设计

### 3.1 两种幕

| 类型 | 配置方式 | 适用场景 | 画面来源 |
| --- | --- | --- | --- |
| overlay 展示幕 | `overlay: 'overlay/xxx.html'` | 片头、片尾、过渡、架构图导览、能力总结 | 本地 HTML，动画由引擎触发 |
| 真实操作幕 | `async run(ctx) { ... }` | 真实界面操作、查询演示、表单流程 | Playwright 操作被测系统 |

两者二选一；同一幕不要既写 `overlay` 又写 `run`（引擎优先 `overlay`）。

### 3.2 幕 ID 与顺序

- 幕 ID 允许字母、数字、下划线、连字符：`m0`、`m01`、`m8b`、`intro`。
- `config.scenes` 的数组顺序即成片顺序；`narration.md` 中的幕可以乱序书写，但建议同序。
- 在已有两幕之间插入新幕时，用字母后缀（如 `m8b`）避免重排后续编号；代价是必须同时改 `config.scenes` 的插入位置。
- 新增幕必须同时存在于 `narration.md` 与 `config.scenes`，否则 TTS 或录制会报缺失。

### 3.3 时长预算

- 每幕时长 = 该幕 mp3 实测时长，不是估算值。
- 中文女声（`zh-CN-XiaoxiaoNeural`，`rate: '-4%'`）约 4.5–5 字/秒，可用于写稿时预估。
- 单幕建议 15–120s；单句 ≤ 40 字（VTT 按句切分，过长句子不便对齐）。
- 全片 8–15 幕、10–16 分钟较适合系统演示；片头 ≤ 25s，片尾 ≤ 90s。

### 3.4 叙事结构参考

```text
m00 片头：标题 / 团队 / 演示数据声明
m0  总览：系统定位、核心能力一页图
m01 架构导览：架构图逐层高亮（可用 Archify 交互页）
m1–m8 功能演示：每个能力一幕，真实操作为主
m8b 治理/闭环：双面板展示机制（overlay）
m9  收尾：总结与价值
m10 片尾：优势、环境、技术栈、致谢
```

### 3.5 勘察清单（真实操作幕必做）

逐项确认并记录：

- [ ] 站点地址、启动方式、是否需要登录；
- [ ] 登录页元素选择器（label/placeholder/按钮文案）；
- [ ] 每个交互点的稳定选择器（优先 role + name、label、可见文本）；
- [ ] 下拉框/页签的默认值（不同数据源、不同页面可能不同）；
- [ ] 查询类操作是否有服务端缓存，如何确定性清缓存；
- [ ] 1920×1080 下是否出现滚动条、关键区域是否完整可见；
- [ ] 操作耗时量级（点击到结果出现），用于设置停留时间。

---

## 4. 编写 narration.md

### 4.1 格式规则

每幕以二级标题开头：

```markdown
## m03 · 多轮问数（约 26s）

第一句旁白。第二句旁白。第三句旁白。
```

解析规则（`engine/lib/narration.mjs`）：

- 标题正则：`^##\s*([A-Za-z0-9_-]+)\s*·\s*(.*)$`。`·` 是必须的分隔符（中文间隔号）。
- 幕内**非空行**拼成该幕 TTS 文本（行间补空格）。
- 忽略：以 `#` 开头的行、以 `>` 开头的引用、代码块围栏 ```、`---` 分隔线。
- 只有标题没有正文的幕会被丢弃（不会生成音频）。
- 幕标题中的「约 Xs」只是给写稿人看的，不参与计算。

### 4.2 语言规范

- 一句话一个句号；避免一段超长无标点文本（VTT 会只有一条 cue，无法细对齐）。
- 数字口头化：写「一百二十万」而不是「1,200,000」；百分比写「百分之三十五」。
- 术语全片统一（同一功能不要两种叫法）。
- 幕间不要重复问候；新增开场幕后检查后续幕是否语义重复。
- 涉及演示数据时，在片头或片尾明确声明「所有数据均为演示数据」。
- 不要把账号、密钥、真实业务数据写进文稿或画面。

### 4.3 示例

```markdown
## m00 · 片头（约 12s）

欢迎观看示例系统演示。本视频中的所有数据均为演示数据，不涉及任何真实业务信息。

## m1 · 主界面（约 40s）

进入系统后，左侧是功能导航，中间是问数工作区。我们先从一次自然语言问数开始。

## m10 · 片尾（约 30s）

以上就是本次演示的全部内容。系统支持本地单机部署，一键启动。感谢观看。
```

### 4.4 检查点

- [ ] 每个幕 ID 与 `config.scenes` 完全一致（含大小写）；
- [ ] 没有空幕（标题下无正文）；
- [ ] 单句长度 ≤ 40 字，句末标点完整；
- [ ] 数字、术语、功能名称与画面一致；
- [ ] 片头/片尾包含必要的声明与致谢，且不重复。

---

## 5. 配置 demo-video.config.mjs

### 5.1 完整骨架

```js
const BASE_URL = process.env.DV_BASE_URL || 'http://127.0.0.1:3000';

export default {
  name: '项目名',
  narration: 'narration.md',
  finalVideo: '演示讲解.mp4',
  viewport: { width: 1920, height: 1080 },
  fps: 25,
  baseUrl: BASE_URL,

  auth: {
    storageState: '.auth-state.json',
    // 引擎已打开 baseUrl，这里只需完成登录动作
    async login(page) {
      await page.getByLabel('用户名').fill(process.env.DEMO_USER || 'admin');
      await page.getByLabel('密码').fill(process.env.DEMO_PASS || '');
      await page.getByRole('button', { name: '登录' }).click();
      await page.waitForLoadState('networkidle');
    },
  },

  tts: {
    role: 'warm',        // 角色：warm / lively / news / sunny / steady / youth…（demo-video voices）
    // gender: 'male',   // 或只按性别选；voice 显式指定时优先级最高
    rate: '-4%',
    proxy: process.env.DV_TTS_PROXY ? process.env.DV_TTS_PROXY.split(',') : [],
    defaultFixes: true,   // 内置词典：命令行 / 重新 / 会计 / 角色…
    fixes: [
      ['一行命令', '一航命令'],   // 追加：必须等长、同音同调
    ],
  },

  compose: { crf: 20, preset: 'medium', audioBitrate: '192k', sampleRate: 44100, padSeconds: 5 },

  scenes: [
    { id: 'm00', title: '片头', overlay: 'overlay/title.html' },
    { id: 'm1', title: '主界面', auth: true, async run({ page, at, clickLoc }) {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await at(2.0);
      await clickLoc(page, page.getByRole('button', { name: '开始问数' }), 260, '开始问数');
    } },
    { id: 'm10', title: '片尾', overlay: 'overlay/outro.html' },
  ],
};
```

### 5.2 常用字段

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `name` | `demo-video` | 项目名，仅日志展示 |
| `narration` | `narration.md` | 相对项目根 |
| `finalVideo` | `demo.mp4` | 成片文件名，输出到 `out/` |
| `viewport` | 1920×1080 | 录制视口，也是 overlay 的页面尺寸 |
| `fps` | 25 | 合成帧率 |
| `baseUrl` | `http://127.0.0.1:3000` | **仅用于自动登录**；真实操作幕需自己 `page.goto` |
| `dirs` | audio/videos/out/diag | 可改为绝对路径 |
| `browser.channel` | `chrome` | 复用本机 Chrome；可改 `chromium` 并安装对应浏览器 |
| `browser.headless` | `true` | 需要观察录制过程时设 `false` |
| `auth.storageState` | 无 | 相对项目根，登录态 JSON |
| `tts.voice` | 空（按 role/gender 解析） | 任意 edge-tts voice id；显式指定时优先级最高 |
| `tts.role` | `warm` | 角色选音色：warm/lively/news/sunny/steady/youth/dongbei/shaanxi |
| `tts.gender` | 空 | `male` / `female`（也接受 男 / 女），未指定角色时生效 |
| `tts.rate` | `-4%` | 语速，负值更慢 |
| `tts.defaultFixes` | `true` | 内置多音字词典，仅中文音色生效 |
| `tts.fixes` | `[]` | 追加/覆盖内置词，`[原文, 同音字]` 等长数组，只改合成文本 |
| `compose.crf` | 20 | 18 更清晰、体积更大；暗色渐变多时建议 18 |
| `compose.padSeconds` | 5 | tpad 冻帧上限，需大于正常的视频-音频差 |

字段全量字典见 `pipeline-reference.md`。

### 5.3 登录态两种方式

1. **复用已有文件**：把浏览器登录后的 `storageState` 保存为 `.auth-state.json`（或配置其他路径），`auth: true` 的幕直接加载。
2. **自动登录**：提供 `auth.login(page)`，首次正式录制前引擎会打开 `baseUrl` 执行登录并保存状态；之后复用文件。

注意：

- 只有 `auth: true` 的幕才使用登录态；片头/片尾等 overlay 幕不要加。
- `--dry` 与 `--no-record` 不触发自动登录流程。
- `.auth-state.json` 含会话凭证，必须 gitignore，不得交付。

### 5.4 检查点

- [ ] `node --check demo-video.config.mjs` 通过；
- [ ] `doctor --config` 能加载配置并显示正确的幕数；
- [ ] `scenes` 的 `id` 与 `narration.md` 一一对应；
- [ ] 需要登录的幕标了 `auth: true`，overlay 幕没标；
- [ ] 密钥、密码来自环境变量，没有硬编码进仓库。

---

## 6. 配音与 VTT（tts）

### 6.1 命令

```bash
# 全量：文稿中所有幕
node "$DV_ROOT/engine/cli.mjs" tts --config ../my-demo/demo-video.config.mjs

# 单幕重生成（改了一句旁白时）
node "$DV_ROOT/engine/cli.mjs" tts --config ../my-demo/demo-video.config.mjs --scenes m5

# 不生成 VTT（仅配音，不推荐，后续无法校准）
node "$DV_ROOT/engine/cli.mjs" tts --config ../my-demo/demo-video.config.mjs --no-vtt
```

产物：

```text
audio/<幕ID>.mp3      旁白音频
audio/<幕ID>.vtt      句级字幕（校准唯一来源）
audio/<幕ID>.txt      实际送去合成的文本（含同音替换，排查发音用）
audio/durations.json  { "m00": 8328, "m01": 3312 }（毫秒，增量合并写入）
```

### 6.2 读 VTT 校准

VTT 是句子级 cue，格式：

```text
WEBVTT

00:00:00.100 --> 00:00:03.240
欢迎观看示例系统演示。

00:00:03.300 --> 00:00:06.800
本视频中的所有数据均为演示数据。
```

- 每个 cue 的起点就是该句旁白的开始时刻。
- overlay 的 `--d` = 句首 + 0.3–0.6s；真实操作 `at()` = 句首 + 0.8–1.0s。
- 详细公式与边界见 `calibration-and-pitfalls.md`。

### 6.3 音色选择（男声 / 女声 / 角色）

三种写法，优先级 `voice` > `role` > `gender`，都不写就是「温暖女声」：

| 写法 | 示例 | 效果 |
| --- | --- | --- |
| 角色 | `role: 'news'` | 新闻男声（zh-CN-YunyangNeural） |
| 性别 | `gender: 'male'` | 男声默认档（新闻男声） |
| 音色 | `voice: 'zh-CN-YunxiNeural'` | 任意 edge-tts voice，含英文/日文 |

- 角色清单：`demo-video voices`；只看男声加 `--gender male`。
- 临时换人试听：`demo-video tts --role steady --scenes m00`（不改配置）。
- 单幕换人：在 `config.scenes` 对应幕写 `role` / `gender` / `voice`，其余幕不受影响。
- 改音色会改变整幕时长，必须重跑 `tts` 并重新校准该幕 overlay 的 `--d`。

### 6.4 多音字修正

引擎内置读音词典（`engine/lib/pronunciation.mjs`）：中文音色在合成前把易错词换成同音字，
字幕再按字符位置还原原文。命令行、重新、会计、角色、下载、渲染这类高频词无需任何配置。

1. 仍读错时，在 `tts.fixes` 追加等长、同音同调的替换，如 `['重载', '崇载']`。
2. 关掉某条内置词写 `['处理', null]`；整体关闭用 `tts: { defaultFixes: false }`。
3. 重生成该幕：`tts --scenes m1`，日志会打印「读音修正 N 处」。
4. 确认 `audio/m1.txt` 是替换后的字、`audio/m1.vtt` 已还原原文，再重录该幕。

键要带上下文（写「一行命令」而不是「一行」），否则会误伤「一行人」这类正常读音；
长度不等的条目会被引擎丢弃。

### 6.5 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `未找到 edge-tts` | 未安装或不在探测路径 | `pip install edge-tts`；或 `--edge-tts`/`EDGE_TTS` 指定 |
| 连续失败、日志有超时/403 | 网络或代理 | 配置 `DV_TTS_PROXY`，按顺序多写几个代理 |
| `mp3 时长无效` | 生成被中断/文件损坏 | 删除该幕 mp3 重跑 tts |
| VTT 与旁白句数不一致 | 句子缺标点或过长 | 补句号、拆分长句后重生成 |
| 字幕里出现替换字 | 手工改过 VTT | 重生成该幕，让引擎重新还原 |

### 6.6 检查点

- [ ] 每幕 `durations.json` 有值且 > 0；
- [ ] 试听片头、片尾与关键操作幕，发音、语速可接受；
- [ ] VTT 句数与文稿一致（逐句核对一遍）；
- [ ] 改动过的幕已重新生成，未影响其他幕的时长。

---

## 7. 制作 overlay 展示幕

### 7.1 最小可复制模板

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Title</title>
<style>
  :root { --delta: 0s; --bg: #0b1220; --fg: #e8eefc; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; }
  body {
    background: radial-gradient(1100px 680px at 50% 24%, #17253f 0%, var(--bg) 64%);
    color: var(--fg);
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .stage {
    width: 100%; height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 24px;
  }
  .anim { opacity: 0; transform: translateY(18px); }
  body.playing .anim {
    animation: rise .9s cubic-bezier(.2, .7, .2, 1) forwards;
    animation-delay: calc(var(--d, 0s) - var(--delta));
  }
  @keyframes rise { to { opacity: 1; transform: none; } }
  h1 { font-size: 88px; letter-spacing: 10px; }
  .lead { font-size: 30px; letter-spacing: 4px; color: #8fa3c8; }
  #veil {
    position: fixed; inset: 0; background: var(--bg); z-index: 99;
    pointer-events: none; opacity: 1; transition: opacity 1s ease 1s;
  }
  body.playing #veil { opacity: 0; }
  .dv-cursor { display: none !important; }
</style>
</head>
<body>
  <div class="stage">
    <h1 class="anim" style="--d:.5s">标题</h1>
    <p class="lead anim" style="--d:1.4s">副标题</p>
  </div>
  <div id="veil"></div>
</body>
</html>
```

### 7.2 页面约定（必须遵守）

| 约定 | 作用 |
| --- | --- |
| `.stage` 容器 | 引擎等它出现后才会触发动画 |
| `body.playing .anim` + `--d` | 动画只在录制时播放；`--d` 是设计延迟 |
| `animation-delay: calc(var(--d) - var(--delta))` | 抵消页面加载耗时（实测 0.03–0.05s，复杂页更大） |
| `#veil` 全屏遮罩 | 遮蔽 Chromium 录制首帧残影（0–0.6s 窗口） |
| `.dv-cursor { display: none !important; }` | 展示幕隐藏仿真光标，避免左下角圆点 |

引擎行为：打开 HTML → 等 `.stage` → 注入 `--delta` → 加 `body.playing` → 等待 120ms 后进入时长补齐。视频录制从浏览器上下文创建时就已开始，`--delta` 的作用是让动画零点与音频零点对齐。

### 7.3 校准流程

1. 先 `tts`，读该幕 `audio/<id>.vtt`，把每个想出现的内容对应到某一句。
2. 给元素设置 `style="--d:<句首秒数 + 0.3~0.6>s"`；标题类可以早 0.2s 入场。
3. 重录该幕：`record --scenes <id>`。
4. 抽帧核对：`frames --scene <id> --at 1,4,8`（相对该幕开始）。
5. 偏移超过 0.3s 时调整 `--d` 后重复 3–4。

### 7.4 布局建议

- 信息层级：徽标 → 主标题 → 副标题 → 卡片/区块 → 结论条。
- 展示幕每 3–6s 有一次视觉变化（区块入场、高亮切换），与旁白句一一对应。
- 避免长时间半屏空白：让面板外框与标题先入场，只让内容按旁白逐条点亮。
- 暗色大面积平坦渐变在录屏后可能出现轻微块状伪影；可提高 `compose.crf` 到 18，或给背景加细网格/纹理。详见踩坑文档。
- 页面固定 1920×1080，`overflow: hidden`；不要依赖滚动。

### 7.5 检查点

- [ ] 浏览器直接打开 HTML 时动画不播放（未被 `body.playing` 触发）；
- [ ] 录制后每个区块出现时刻与旁白句对应；
- [ ] 首帧无残影、无光标圆点；
- [ ] 抽帧无文字截断、无重叠。

---

## 8. 编写真实操作幕

### 8.1 骨架

```js
{ id: 'm2', title: '发起问数', auth: true, async run(ctx) {
  const { page, at, bounded, clickLoc, hoverText, ensureInView, scrollAt } = ctx;

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await at(1.5);
  await hoverText(page, '开始问数');

  await at(4.0);
  await clickLoc(page, page.getByRole('button', { name: '开始问数' }), 260, '开始问数');

  await at(9.0);
  await page.getByPlaceholder('请输入问题').fill('上个月销售额是多少');

  await at(12.0);
  await clickLoc(page, page.getByRole('button', { name: '提交' }), 260, '提交');

  await at(18.0);
  await ensureInView(page, page.getByText('查询结果'));
} },
```

关键点：

- **真实操作幕不会自动导航**，`run()` 里必须自己 `page.goto(...)`；`config.baseUrl` 只用于自动登录。
- `at(s)` 是幕内绝对时间线（幕开始为 0），负值立即返回。
- 时间点来自 VTT 句首；点击类动作安排到句首后 0.8–1.0s（`clickLoc` 内含 bbox → 移动光标 → settle → 点击的固定开销）。
- 需要等待结果时用 `at()` 配合 `waitFor*`；不要用固定 `waitForTimeout` 猜网络耗时。
- 选择器优先 `getByRole(..., { name })`、`getByLabel`、`getByPlaceholder`、可见文本；避免 `nth-child` 与坐标硬编码。
- 下拉框、页签不要依赖默认值：显式点击并选择目标项，再继续。

### 8.2 ctx 助手

| API | 说明 |
| --- | --- |
| `at(s)` | 幕内绝对时间线等待 |
| `bounded(promise, ms, fallback)` | 硬超时护栏，永不 reject |
| `clickLoc(page, locator, settle, label)` | bbox → 移动光标 → settle → 点击；失败返回 false 不抛错 |
| `hoverText(page, text, holdMs)` | 精确文本悬停（会滚动入视） |
| `ensureInView(page, locator)` | 滚动入视 + 250ms 停顿 |
| `scrollAt(page, x, y, dy, steps)` | 坐标滚动 |
| `moveMouse(page, x, y)` | 移动仿真光标 |
| `step(msg)` | 打印 `[record]` 日志 |

自定义的 Playwright 调用也要包 `bounded`；单次挂起会把整幕拖成数百秒。完整 API 与行为见 `pipeline-reference.md`。

### 8.3 彩排

```bash
# 每幕固定 8s，只验证脚本能跑通、选择器有效（不要求先 TTS）
node "$DV_ROOT/engine/cli.mjs" record --config ... --dry

# 按真实时长跑完整操作链，不产出视频（需要先 TTS）
node "$DV_ROOT/engine/cli.mjs" record --config ... --no-record
```

彩排日志关注：`click[xxx] ok`、`hover[xxx] ok`、无 `bbox=null`、无 `run 异常`。彩排通过不代表正式录制一定顺利，正式模式关闭/补齐开销更大，仍需按 9.3 的判据观察。

### 8.4 检查点

- [ ] `run()` 内已导航到起始页面；
- [ ] 所有交互点都有稳定选择器，且有失败兜底；
- [ ] 数据源/页签显式切换，未依赖默认值；
- [ ] 关键结果出现后有足够的停留时间（≥ 2s）供观众看清；
- [ ] `--no-record` 全片彩排无异常。

---

## 9. 录制

### 9.1 命令

```bash
# 正式录制全部幕
node "$DV_ROOT/engine/cli.mjs" record --config ../my-demo/demo-video.config.mjs

# 重录单幕
node "$DV_ROOT/engine/cli.mjs" record --config ... --scenes m5

# 每幕 8s 彩排（不产出可用成片素材）
node "$DV_ROOT/engine/cli.mjs" record --config ... --dry

# 只跑操作链，不录视频
node "$DV_ROOT/engine/cli.mjs" record --config ... --no-record
```

每幕独立浏览器实例；单幕异常不影响其他幕。录制视频先落在 `videos/.tmp/`，结束后重命名为 `videos/<幕ID>.webm`。

### 9.2 日志解读

```text
[record] m00 overlay armed delta=0.04s
[record] m2 -> video=38.2s audio=38.0s 5.1MB samples=76 maxGap=0.5s@end=10:12:33
```

- `video` / `audio`：实测视频时长与目标（音频）时长；`video > audio` 会在合成时裁尾，`video < audio` 由 tpad 补帧。
- `MB`：webm 体积，正常单幕几 MB。
- `samples` / `maxGap`：页面心跳，每 500ms 一次；`maxGap` 明显大于 0.5s 表示页面卡顿。
- overlay 幕会打印 `overlay armed delta=...`，delta 即页面加载耗时。

### 9.3 挂起判定与处置

任一命中即视为异常，直接终止并重录，不要原地做 lsof/sample 诊断：

1. 单幕耗时远超 `durations` 量级（例如 40s 的幕跑了 5 分钟）；
2. webm 体积异常（正常几 MB，异常可达数百 MB；引擎 >150MB 会警告）；
3. 日志长时间无新行、CPU 接近 0。

```bash
# 终止挂起的录制（在另一个终端）
pkill -f "engine/cli.mjs record"
rm -f videos/.tmp/*.webm videos/<幕ID>.webm
node "$DV_ROOT/engine/cli.mjs" record --config ... --scenes <幕ID>
```

### 9.4 登录态

- 首次正式录制会自动执行 `auth.login(page)` 并保存 `storageState`；之后复用。
- 登录态过期会出现 404/跳转登录页：删除 `.auth-state.json` 后重录该幕。
- `--dry` / `--no-record` 不触发自动登录。

### 9.5 检查点

- [ ] 每幕日志的 `video` 与 `audio` 接近（差 > 5s 要查原因）；
- [ ] 没有 >150MB 的 webm，没有长时间无日志；
- [ ] 重录单幕后，`videos/` 中该幕文件时间戳已更新；
- [ ] 登录态文件未入库。

---

## 10. 合成与抽帧验收

### 10.1 合成

```bash
node "$DV_ROOT/engine/cli.mjs" compose --config ../my-demo/demo-video.config.mjs
```

日志示例：

```text
[compose] m2: video=38.2s audio=38.0s -> 38.0s
[compose] m3: video=41.5s audio=44.0s -> 44.0s (tpad 补齐)
[compose] FINAL -> .../out/演示讲解.mp4
[compose] 总时长 12.34 min (740.4s)，分幕合计 12.34 min
```

- 以音频为时间轴逐幕编码：H.264（`crf` 默认 20）+ AAC 192k。
- 视频不足用 tpad 冻帧补齐（上限 `padSeconds`，默认 5s），超长裁尾。
- 然后 concat 拼接为成片。`compose` 始终全量重编码所有幕，不接受 `--scenes`。
- 缺少某幕 webm 或 mp3 会直接报错，按提示补录/补生成。

### 10.2 抽帧

```bash
# 成片绝对时间
node "$DV_ROOT/engine/cli.mjs" frames --config ... --at 5,30,120

# 某幕内相对时间（自动加上前置各幕时长）
node "$DV_ROOT/engine/cli.mjs" frames --config ... --scene m5 --at 1,8,20

# 缩小尺寸便于快速查看
node "$DV_ROOT/engine/cli.mjs" frames --config ... --scene m5 --at 8 --width 1280
```

输出到 `diag/frame-*.png`。超出成片时长的点会被跳过并给出警告。

### 10.3 验收清单（每幕）

- [ ] 首句旁白落地时，画面已是该幕预期内容（不是上一幕残留、不是黑屏）；
- [ ] 关键操作完成后的画面与旁白描述一致（按钮状态、结果区域）；
- [ ] 末句时画面没有提前结束或停在无关状态；
- [ ] 画面中的数字、文案、图表与旁白完全一致；
- [ ] overlay 幕每个区块出现时刻对应旁白句；
- [ ] 无 404、无报错弹窗、无调试面板、无鼠标光标残留；
- [ ] 无首帧残影、无黑帧、无块状伪影（明显时提高 crf 质量）。

全片验收：`compose` 总时长 ≈ 各幕音频之和（±1s）；片头片尾完整；字幕 VTT 与旁白一致。

---

## 11. 迭代：改一处要做什么

| 改动 | 必须执行的步骤 | 说明 |
| --- | --- | --- |
| 只改 overlay 画面（CSS/文案/布局） | 重录该幕 → compose → 抽帧 | 不影响音频时长 |
| 改旁白某一句 | `tts --scenes <幕>` → 重录该幕 → compose → 抽帧 | 该幕时长变化，重读 VTT 校准 `at()`/`--d` |
| 新增一幕 | 改 narration + config.scenes（插入正确位置）→ tts → record → compose | 幕 ID 唯一；注意新幕对后续幕绝对位置的影响 |
| 删除一幕 | 从 narration 与 config.scenes 同时移除 → compose | 旧 webm/mp3 可保留或清理 |
| 换音色/语速 | 全量 tts → 全量 record → compose | 所有幕时长都会变，VTT 全部重读 |
| 改合成参数（crf/preset） | compose → 抽帧 | 不需要重录 |
| 改登录方式 | 删除 `.auth-state.json` → 重录需登录的幕 | 先确认登录页选择器 |
| 被测系统改版 | 重启服务 → 彩排 → 重录受影响幕 → compose | 后端常驻进程不热加载新路由 |

时长变化的连锁影响：`at()` 与 `--d` 都是**幕内相对时间**，只受本幕 VTT 影响；但成片的绝对时间点（`frames --at` 不指定 `--scene` 时）会随前置幕时长变化，验收时建议用 `--scene`。

---

## 12. 故障排查

| 症状 | 可能原因 | 处理 |
| --- | --- | --- |
| `doctor` 报 `✗ pw-ffmpeg` | 未安装 Playwright 自带 ffmpeg | `npx playwright install ffmpeg` 后重跑 doctor |
| 录制启动即失败，提示 `Executable doesn't exist .../ffmpeg-mac` | 同上 | 同上；引擎会直接给出该提示 |
| `record` 卡住不退出、CPU 0 | 浏览器挂起 | 按 9.3 终止并重录单幕 |
| 单幕 webm 数百 MB | 浏览器挂起或页面动画异常 | 同上；检查 `bounded` 是否包住自定义调用 |
| 页面 404 / 旧界面 | 后端旧进程未重启 | 重启被测系统后再录 |
| 真实操作幕 `bbox=null`、点击无效 | 选择器过期/元素未渲染 | 彩排日志定位，改用 role/label 选择器；加 `ensureInView` |
| 动画整体偏移 | 未注入 `--delta` 或 CSS 未减 delta | 检查 `calc(var(--d) - var(--delta))` |
| 首帧残影/花屏 | Chromium 录制首帧残留 | 确认 `#veil` 存在且 `body.playing` 后淡出 |
| 片头/片尾左下角蓝点 | 展示幕未隐藏仿真光标 | 加 `.dv-cursor { display: none !important; }` |
| 画面某侧长期空白 | 内容入场太晚 | 外框/标题提前，内容按旁白逐条点亮 |
| 查询过程过快/消失 | 服务端缓存命中 | 录制前走缓存失效入口，结果后加停留 |
| 旁白与操作错位 | 按字数估算时间 | 重读 VTT，按句首 + 0.8–1.0s 校准 |
| TTS 读错字 | 多音字 | 先用内置词典（默认开启）；仍错则 `tts.fixes` 追加等长同音替换，重生成并核对 VTT |
| TTS 连续失败 | 网络/代理 | 配置 `DV_TTS_PROXY`，多写几个代理 |
| 合成报缺少素材 | 某幕未录或未生成音频 | 补跑 `tts` / `record --scenes <幕>` |
| `frames` 没有输出 | 时间点超出成片时长 | 用 `--scene` 相对时间，或确认成片时长 |
| 成片暗色区域有块状伪影 | VP8 录屏量化 | `compose.crf` 提到 18；避免大面积纯暗渐变；详见踩坑文档 |
| 中文路径相关异常 | 工具对中文路径兼容性差 | 项目目录尽量用英文；或改用绝对路径配置 |

---

## 13. 交付与归档

### 13.1 产物清单

| 文件 | 用途 | 入库 |
| --- | --- | --- |
| `narration.md` | 旁白源稿 | 是 |
| `demo-video.config.mjs` | 配置与场景函数 | 是 |
| `overlay/*.html` | 展示幕页面 | 是 |
| `audio/*.vtt` | 句级字幕/校准记录 | 是 |
| `audio/durations.json` | 各幕时长 | 是 |
| `audio/*.mp3` | 配音 | 否 |
| `videos/*.webm` | 原始录屏 | 否 |
| `out/*.mp4` | 成片与分幕 | 否 |
| `diag/*.png` | 抽帧验收图 | 否 |
| `.auth-state.json` | 浏览器登录态 | 否（敏感） |

### 13.2 交付前检查

- [ ] `compose` 成功，成片时长与音频总和一致；
- [ ] 全部幕抽帧验收通过，数字与旁白一致；
- [ ] 字幕 VTT 与旁白一致，无替换字泄漏；
- [ ] 片头/片尾包含演示数据声明与必要的环境/技术栈信息；
- [ ] 文稿、画面、配置中无账号、令牌、密钥、真实业务数据；
- [ ] 只提交源码与 VTT，产物被 `.gitignore` 排除。

### 13.3 敏感信息红线

- 登录账号密码只放本地环境变量或未入库的配置；
- `.env`、`.env.local`、`.auth-state.json` 一律不入库、不出现在画面中；
- 片尾展示的环境信息写到「本地单机部署 / 数据库类型 / 模型类型」即可，不披露地址、密钥与账号；
- 演示数据声明放在片头显著位置。

---

## 14. 附录

### 14.1 命令速查

```bash
node "$DV_ROOT/engine/cli.mjs" setup    [--link] [--force]
node "$DV_ROOT/engine/cli.mjs" init <目录> [--force]
node "$DV_ROOT/engine/cli.mjs" doctor [--config <cfg>] [--edge-tts <path>]

node "$DV_ROOT/engine/cli.mjs" tts     --config <cfg> [--scenes a,b] [--no-vtt]
node "$DV_ROOT/engine/cli.mjs" record  --config <cfg> [--scenes a,b] [--dry] [--no-record]
node "$DV_ROOT/engine/cli.mjs" compose --config <cfg>
node "$DV_ROOT/engine/cli.mjs" frames  --config <cfg> --at 3,8 [--scene m1] [--width 1280]

node "$DV_ROOT/engine/cli.mjs" all     --config <cfg> [--scenes a,b] [--dry] [--no-record] [--at 3,8]
```

`--config` 省略时从当前目录向上查找 `demo-video.config.mjs`（也可用 `DV_CONFIG` 指定）。

`--scenes` 只影响 `tts` 与 `record`；`compose` 始终全量重编码。

### 14.2 时间单位

| 位置 | 单位 | 示例 |
| --- | --- | --- |
| `durations.json` | 毫秒 | `8328` |
| `at()` / `--d` / `--at` / `--scene` | 秒 | `8.3` |
| VTT 时间戳 | `hh:mm:ss.mmm` | `00:00:08.328` |

### 14.3 30 分钟落地清单

- [ ] 环境体检全绿（含 `pw-ffmpeg`）；
- [ ] 内置示例跑通（`all` + 抽帧）；
- [ ] `init` 新项目，写 3–5 幕旁白；
- [ ] `tts` 生成音频与 VTT，试听；
- [ ] 做片头 + 1 个真实操作幕 + 片尾；
- [ ] `--no-record` 彩排通过；
- [ ] 正式录制、compose、抽帧验收；
- [ ] 按第 13 章归档并提交源码。

### 14.4 相关文档

- `pipeline-reference.md`：字段、CLI、ctx API、overlay 协议。
- `calibration-and-pitfalls.md`：校准公式、录制稳定性、编码伪影与踩坑。
- 插件根目录 `README.md`：安装、目录结构、验证记录与已知限制。
