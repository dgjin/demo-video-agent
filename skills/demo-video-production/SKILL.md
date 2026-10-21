---
name: demo-video-production
description: 负责把分幕文稿制作成带旁白的演示视频：edge-tts 配音与句级 VTT、Playwright 分幕录屏（真实操作幕与 overlay 动画展示页）、素材导入幕（App 真机录屏 / 实拍 / 渲染视频 / 截图序列）、终端幕（asciinema 录制回放）、ffmpeg 音画合成与抽帧验收。当用户要求录制演示视频、录屏讲解、demo video、screen recording with voiceover、TTS 配音、字幕对齐、片头片尾动画、重录某一幕、给已有录屏/截图/命令行录制配旁白，或把文档/架构图做成视频时使用。
description_zh: 旁白驱动的演示视频制作流水线：分幕文稿 → TTS 配音与句级 VTT → 分幕画面（浏览器录屏 / overlay 动画页 / 素材导入 / 终端回放）→ ffmpeg 合成 → 抽帧验收，支持任意 Web 系统与多语言配音。
version: 0.5.0
user-invocable: true
---

# 演示视频制作

用「旁白为主时间轴」的流水线把文稿变成成片：**narration.md → edge-tts（mp3 + 句级 VTT）→ 分幕画面 → ffmpeg 合成 → 抽帧验收**。画面源四类：overlay 展示页（Playwright 录制）、真实操作幕（Playwright 编排）、素材幕（导入视频/截图，不经浏览器）、终端幕（asciinema 录制回放）。

首次使用先读 `references/operating-manual.md`：环境准备、示例验收、分幕设计、逐步制作、验收清单与排障。

分幕结构与旁白写作由 `demo-video-storyboard` 技能负责；本技能从 `narration.md` 开始，专注把文稿变成可验收的成片。

## 定位插件（所有命令的前提）

插件可能被安装到不同 marketplace 与版本目录下，先解析插件根目录 `DV_ROOT`：

```bash
DV_ROOT="${DV_HOME:-$(ls -d "$HOME/.qoder/plugins/cache"/*/demo-video-agent/* 2>/dev/null | while read -r p; do echo "$(basename "$p") $p"; done | sort -V | tail -1 | cut -d' ' -f2-)}"
echo "$DV_ROOT"
```

- 输出为空：插件未安装或未启用，先让用户在 Qoder 插件面板（或 `qodercli plugin install --scope user ./demo-video-agent`）安装 `demo-video-agent`。
- 在源码仓库里开发时，可在仓库根目录执行 `export DV_HOME="$PWD"`。
- 已运行过 `setup --link` 时，可直接把下文的 `node "$DV_ROOT/engine/cli.mjs"` 替换为 `demo-video`。
- 只要 `DV_ROOT` 已确定，后续命令都要用绝对路径，不要假设当前目录是插件根目录。
- 斜杠命令 `/demo-video` 提供同一流程的快捷入口（参数同名）。

## 适用场景

- 为 Web 系统/产品制作演示讲解视频（含真实操作录屏）
- 给已有演示片新增、修改、重录某一幕，或重建片头片尾
- 需要 TTS 配音、字幕时间轴、音画严格对齐
- 把架构图 / 文档页做成带解说的视频
- 给已有素材配旁白：App 真机录屏、实拍视频、3D 渲染、设计动图、截图序列（素材幕）
- 给命令行演示配旁白：asciinema 录制（`.cast`）直接回放成终端画面（终端幕）

不适用：剪辑已有实拍素材（不带旁白重配）、复杂特效合成、直播推流。

## 核心原则（必须遵守）

1. **音频是主时间轴**：每幕目标时长 = 该幕 mp3 时长（`audio/durations.json`）；视频不足用 tpad 冻帧补齐，超长裁尾。不要按字数估算时长。
2. **VTT 句级时间戳是唯一对齐全源**：TTS 后先读该幕的 VTT（如 `audio/m03.vtt`），再定 `at()` 与 `--d`，不许凭感觉。
3. **所有浏览器调用加硬超时护栏**（`bounded`，永不 reject）；单次挂起会把整幕拖成数百秒。
4. **动画不自动播放**：overlay 页面由录制引擎注入 `--delta` 并加 `body.playing` 触发，delay 用 `calc(var(--d) - var(--delta))` 抵消加载耗时。
5. **每幕独立浏览器实例**：一幕异常不影响其他幕；单幕可重录。
6. **先彩排后正式**：`--no-record` 验证操作链 → 正式录制 → compose → 抽帧。

## 前置检查

```bash
node "$DV_ROOT/engine/cli.mjs" setup             # 首次：自动安装 playwright 与录屏 ffmpeg
node "$DV_ROOT/engine/cli.mjs" doctor            # node / ffmpeg / edge-tts / playwright / config
node "$DV_ROOT/engine/cli.mjs" doctor --config my-demo/demo-video.config.mjs
```

- 插件安装副本不带 `node_modules`；`setup` 或首次 `record` 会自动在插件目录安装 playwright（`DV_NO_AUTO_INSTALL=1` 可禁用）。
- 被测系统必须已启动且**是最新代码**：后端常驻进程（tsx / node）不会热加载新路由，改动后先重启再录。
- 需要登录的幕：在 `config.auth` 提供 `login(page)` 或复用 `storageState` 文件；纯 overlay 幕不加 `auth: true`。
- TTS 支持多语言：`tts.voice` 换成 `en-US-AriaNeural`、`ja-JP-NanamiNeural` 等即可，默认中文女声。
- 选解说人：`tts.role`（warm / lively / news / sunny / steady / youth / dongbei / shaanxi）或 `tts.gender`（male / female），`demo-video voices` 列清单；单幕可用 scene.role 换人。
- 网络受限时给 TTS 配代理：`DV_TTS_PROXY=http://127.0.0.1:7890,http://127.0.0.1:7891`。

## 工作流

### 0. 现场勘察与分幕（真实操作幕必做）

跑通关键路径，确认：登录方式、主界面元素选择器、数据源默认值、查询缓存行为、页面是否 1920×1080 无滚动。把每个交互点写成一句话，作为分幕草案。

完整的勘察清单、幕结构模板与旁白写作规则见 `demo-video-storyboard` 技能；本步骤只需确认文稿已具备：幕 ID、逐句旁白、画面类型与交互点说明。

### 1. 建项目

```bash
node "$DV_ROOT/engine/cli.mjs" init my-demo
```

生成 `demo-video.config.mjs`、`narration.md`、`overlay/title.html`、`overlay/outro.html`。之后可直接在项目目录内执行命令（配置会从当前目录向上自动查找），也可以用 `--config` 显式指定。

### 2. 写旁白文稿

如果文稿已由 `demo-video-storyboard` 产出，直接进入下一步；自写时至少遵守：

- 每幕一行标题，如 `## m03 · 多轮问数（约 26s）`；幕 ID 与 `config.scenes` 一致（支持 `m0`、`m01`、`m8b`、`intro`）。
- 一句话一个句号（VTT 按句切分）；单句 ≤ 40 字；每幕 15–120s。
- 数字口头化（「一百二十万」而非「1,200,000」）；术语全片统一。
- 多音字由内置词典自动纠正（命令行 / 重新 / 会计 / 角色…），字幕按位置还原；项目特有读法写进 `tts.fixes`，等长同音替换，同名覆盖内置词。
- 幕间避免重复问候；新增开场幕后检查后续幕是否语义重叠。

### 3. 配音 + VTT

```bash
node "$DV_ROOT/engine/cli.mjs" tts --config my-demo/demo-video.config.mjs
node "$DV_ROOT/engine/cli.mjs" tts --config my-demo/demo-video.config.mjs --scenes m5   # 只重生成某幕
```

产出 `audio/` 下的 mp3、vtt 与 `durations.json`，文件名与幕 ID 相同。edge-tts 对同文本同参数确定性输出，重生成不会改变时长。多幕默认并行合成（`tts.concurrency`，默认 3）；网络不稳时可调成 1 串行排查。

换解说人：改配置或临时覆盖，例如 `tts --role news`、`tts --gender female`、`tts --voice zh-CN-YunxiNeural`；
`demo-video voices` 查看全部角色。换音色会改变整幕时长，需重新校准该幕。

### 4. 设计画面

- **overlay 展示幕**（片头/片尾/过渡/架构图导览）：写 HTML，遵守约定——`.stage` 容器、`.anim` + `--d`、`body.playing`、`--delta`、`#veil` 遮罩首帧、`.dv-cursor{display:none}`。
- **真实操作幕**：在 config 里写 `async run(ctx)`，用 `ctx` 助手编排（见 `references/pipeline-reference.md`）。
- **素材幕**：`scene.asset` 指向已有视频（mp4/webm/mov/gif，自动适配画幅，`fit: 'contain'` 留黑边 / `'cover'` 裁切填满）或图片数组（按该幕 VTT 句首自动切换，推荐一句一图，末图撑到幕尾）。素材原声不保留；纯素材项目无需浏览器与 playwright。
- **终端幕**：`scene.terminal` 指向 `asciinema rec demo.cast` 产出的 v2 cast，引擎自动生成终端回放页并按该幕旁白时长适配倍速（0.25×–4×）。支持 SGR 16 色 / 加粗 / 回车覆盖 / 清行清屏；不支持 vim/top 等全屏 TUI。cast 时长与旁白不必相等，引擎会拉伸或压缩。
- 交互动作不要依赖默认值（数据源下拉、默认 tab 可能因页面而异），显式定位并切换。

### 5. 校准（VTT → 画面）

读该幕对应的 VTT（如 `audio/m03.vtt`，文件名与幕 ID 相同）的句级时间戳：

- overlay 区块 `--d` = 对应句开始时刻 + 0.3–0.6s（标题可早于旁白 0.2s 入场）。
- 真实操作 `at(t)` = 句开始时刻 + 0.8–1.0s（`clickLoc` 内含 bbox → 移动光标 → settle → click 的固定开销）。
- 某幕画面长期半屏空白时，让面板外框/标题提前出现，仅内容按旁白逐条点亮。

### 6. 录屏

```bash
node "$DV_ROOT/engine/cli.mjs" record --config my-demo/demo-video.config.mjs --dry            # 每幕 8s 彩排
node "$DV_ROOT/engine/cli.mjs" record --config my-demo/demo-video.config.mjs --no-record      # 只跑操作链（全时长）
node "$DV_ROOT/engine/cli.mjs" record --config my-demo/demo-video.config.mjs --scenes m5      # 重录单幕
node "$DV_ROOT/engine/cli.mjs" record --config my-demo/demo-video.config.mjs                  # 正式录制
node "$DV_ROOT/engine/cli.mjs" record --config my-demo/demo-video.config.mjs --force          # 忽略已有产物强制重录
```

断点续做：某幕的 `videos/<id>.webm` 比它的全部输入（配置、overlay/base.css、素材/cast、`audio/<id>.mp3` 与 `.vtt`）新时自动跳过，日志会标注「已有最新录屏，跳过」。因此重跑 `tts` 后相关幕会自动重录，改文稿/画面也只影响对应幕；确实要重做时加 `--force`。

异常判据（任一命中即 kill 重录，不要原地诊断）：

- 单幕耗时远超 `durations` 量级；
- 单幕 webm 体积异常（正常几 MB，异常可达数百 MB）；
- 日志长时间无新行。

### 7. 合成

```bash
node "$DV_ROOT/engine/cli.mjs" compose --config my-demo/demo-video.config.mjs
```

以音频为时间轴逐幕编码（H.264 + AAC），不足 tpad 补齐、超长裁尾，再 concat 拼接。

### 8. 抽帧验收（必做）

```bash
node "$DV_ROOT/engine/cli.mjs" frames --config my-demo/demo-video.config.mjs --at 5,30 --scene m5 --width 1280
```

每幕至少核对：首句落地时的画面、关键交互完成后的画面、末句画面；overlay 幕核对每个区块出现时刻与旁白句一致；画面中的数字/文案必须与旁白一致。

### 9. 交付

- `.gitignore` 排除 `audio/*.mp3`、`videos/`、`out/`、`diag/`、成片 mp4、`.auth-state.json`；入库 `narration.md`、config、overlay、`audio/*.vtt`、`durations.json`。
- 只提交本任务相关文件；成片作为附件交付，不入库。

## 网络与数据边界

- TTS 仅把旁白文本发送到 Microsoft Edge TTS（HTTPS）；项目代码、页面内容与录屏文件不离开本机。
- `setup` 或首次录屏会从 npm registry 与 Playwright CDN 安装依赖；设置 `DV_NO_AUTO_INSTALL=1` 可关闭自动安装。
- 录屏、合成与抽帧全部在本地执行，不含遥测或上传逻辑。
- 文稿、画面与示例只使用演示数据，不写账号、令牌或真实业务数据。

## 常见故障速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 素材幕画面带黑边 | 素材画幅比与 16:9 不一致（如竖屏录屏） | 默认 contain；改 `fit: 'cover'` 裁切填满，或换图片序列 |
| 素材幕切换节奏与旁白不符 | 图片数与句数不匹配 | 推荐一句一图；多余图片会被忽略并有日志提示 |
| 终端幕画面为空/只有一行光标 | cast 内容是全屏 TUI（vim/top）或大量光标定位 | 只支持行式输出；重录为普通命令行输出，避免全屏程序 |
| 终端幕最后几行没放完 | cast 明显长于该幕旁白 | 加长旁白或精简 cast；引擎最多 4× 加速、超出会被幕尾裁掉 |
| 成片底部偶发一条灰边 | Chrome 录制窗口尺寸偶发异常（非代码问题） | `record --scenes <id> --force` 重录该幕即可；先抽 `videos/<id>.webm` 确认 |
| 首帧残影/花屏 | Chromium 录制首帧残留 | 确认 `#veil` 存在且 `body.playing` 后淡出 |
| 动画整体偏移 | 未注入 `--delta` 或 delay 未减 delta | 检查 armOverlay 与 CSS `calc` |
| 旁白与操作错位 | 用字数估算时间 | 重读 VTT，按句首 + 0.8–1.0s 校准 |
| 某幕视频数百 MB / 不退出 | 浏览器挂起 | kill 重录；检查 `bounded` 是否包住所有调用 |
| TTS 读错字 | 多音字 | 内置词典已覆盖高频词；仍读错则在 `tts.fixes` 加等长同音替换，重生成并确认 VTT 无替换字泄漏 |
| TTS 连续失败 | 网络/代理 | 配置 `DV_TTS_PROXY`，按序重试多个端口 |
| 页面 404 / 旧界面 | 后端旧进程未重启 | 重启服务后再录 |
| 查询类画面过快/无过程 | 服务端缓存命中 | 录制前走缓存失效入口，并加最小停留时间 |

更细的校准公式与踩坑记录见 `references/calibration-and-pitfalls.md`；配置字段、CLI、scene ctx API 见 `references/pipeline-reference.md`；从零到交付的完整步骤与检查表见 `references/operating-manual.md`。

## 完成标准

- compose 成功，成片时长 ≈ 各幕音频时长之和（±1s）。
- 抽帧验收全部通过，无黑帧、无 404、无错位文案。
- 单幕可独立重录，重录后只需重跑 compose（compose 也会按输入 mtime 复用未变的分幕）。
- 仓库只入库源码与 VTT，产物被 gitignore。
- 维护本插件时：`npm test`（56 个单测）与 `npm run check`（发布一致性自检）全过再发布。
