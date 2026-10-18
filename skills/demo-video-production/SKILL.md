---
name: demo-video-production
description: 制作带中文旁白的产品/系统演示视频：分幕旁白文稿、edge-tts 配音与句级 VTT、Playwright 分幕录屏（真实操作幕与 overlay 动画展示页）、ffmpeg 音画合成与抽帧验收。当用户要求录制演示视频、录屏讲解、TTS 配音、字幕对齐、片头片尾动画、重录某一幕，或把文档/架构图做成视频时使用。
---

# 演示视频制作

用「旁白为主时间轴」的流水线把文稿变成成片：**narration.md → edge-tts（mp3 + 句级 VTT）→ Playwright 分幕录屏 → ffmpeg 合成 → 抽帧验收**。

首次使用先读 `references/operating-manual.md`：环境准备、示例验收、分幕设计、逐步制作、验收清单与排障。

## 适用场景

- 为 Web 系统/产品制作演示讲解视频（含真实操作录屏）
- 给已有演示片新增、修改、重录某一幕，或重建片头片尾
- 需要 TTS 配音、字幕时间轴、音画严格对齐
- 把架构图 / 文档页做成带解说的视频

不适用：剪辑已有实拍素材、复杂特效合成、直播推流。

## 核心原则（必须遵守）

1. **音频是主时间轴**：每幕目标时长 = 该幕 mp3 时长（`audio/durations.json`）；视频不足用 tpad 冻帧补齐，超长裁尾。不要按字数估算时长。
2. **VTT 句级时间戳是唯一对齐全源**：TTS 后先读 `audio/<幕ID>.vtt`，再定 `at()` 与 `--d`，不许凭感觉。
3. **所有浏览器调用加硬超时护栏**（`bounded`，永不 reject）；单次挂起会把整幕拖成数百秒。
4. **动画不自动播放**：overlay 页面由录制引擎注入 `--delta` 并加 `body.playing` 触发，delay 用 `calc(var(--d) - var(--delta))` 抵消加载耗时。
5. **每幕独立浏览器实例**：一幕异常不影响其他幕；单幕可重录。
6. **先彩排后正式**：`--no-record` 验证操作链 → 正式录制 → compose → 抽帧。

## 前置检查

```bash
node <plugin>/engine/cli.mjs doctor            # node / ffmpeg / edge-tts / playwright
node <plugin>/engine/cli.mjs doctor --config <项目>/demo-video.config.mjs
```

- 被测系统必须已启动且**是最新代码**：后端常驻进程（tsx / node）不会热加载新路由，改动后先重启再录。
- 需要登录的幕：在 `config.auth` 提供 `login(page)` 或复用 `storageState` 文件；纯 overlay 幕不加 `auth: true`。
- 网络受限时给 TTS 配代理：`DV_TTS_PROXY=http://127.0.0.1:7890,http://127.0.0.1:7891`。

## 工作流

### 0. 现场勘察（真实操作幕必做）

跑通关键路径，确认：登录方式、主界面元素选择器、数据源默认值、查询缓存行为、页面是否 1920×1080 无滚动。把每个交互点写成一句话，作为分幕草案。

### 1. 建项目

```bash
node <plugin>/engine/cli.mjs init my-demo
```

生成 `demo-video.config.mjs`、`narration.md`、`overlay/title.html`、`overlay/outro.html`。

### 2. 写旁白文稿

- 每幕一行标题：`## <幕ID> · <幕名>（约 Xs）`，幕ID 与 `config.scenes` 一致（支持 `m0`、`m01`、`m8b`、`intro`）。
- 一句话一个句号（VTT 按句切分）；单句 ≤ 40 字；每幕 15–120s。
- 数字口头化（「一百二十万」而非「1,200,000」）；术语全片统一。
- 多音字/易读错词写进 `tts.fixes`（合成前同音替换，字幕自动还原），如数据语境「行」→「航」。
- 幕间避免重复问候；新增开场幕后检查后续幕是否语义重叠。

### 3. 配音 + VTT

```bash
node <plugin>/engine/cli.mjs tts --config my-demo/demo-video.config.mjs
node <plugin>/engine/cli.mjs tts --config ... --scenes m5     # 只重生成某幕
```

产出 `audio/<id>.mp3`、`audio/<id>.vtt`、`audio/durations.json`。edge-tts 对同文本同参数确定性输出，重生成不会改变时长。

### 4. 设计画面

- **overlay 展示幕**（片头/片尾/过渡/架构图导览）：写 HTML，遵守约定——`.stage` 容器、`.anim` + `--d`、`body.playing`、`--delta`、`#veil` 遮罩首帧、`.dv-cursor{display:none}`。
- **真实操作幕**：在 config 里写 `async run(ctx)`，用 `ctx` 助手编排（见 `references/pipeline-reference.md`）。
- 交互动作不要依赖默认值（数据源下拉、默认 tab 可能因页面而异），显式定位并切换。

### 5. 校准（VTT → 画面）

读 `audio/<幕ID>.vtt` 的句级时间戳：

- overlay 区块 `--d` = 对应句开始时刻 + 0.3–0.6s（标题可早于旁白 0.2s 入场）。
- 真实操作 `at(t)` = 句开始时刻 + 0.8–1.0s（`clickLoc` 内含 bbox → 移动光标 → settle → click 的固定开销）。
- 某幕画面长期半屏空白时，让面板外框/标题提前出现，仅内容按旁白逐条点亮。

### 6. 录屏

```bash
node <plugin>/engine/cli.mjs record --config ... --dry            # 每幕 8s 彩排
node <plugin>/engine/cli.mjs record --config ... --no-record      # 只跑操作链（全时长）
node <plugin>/engine/cli.mjs record --config ... --scenes m5      # 重录单幕
node <plugin>/engine/cli.mjs record --config ...                  # 正式录制
```

异常判据（任一命中即 kill 重录，不要原地诊断）：

- 单幕耗时远超 `durations` 量级；
- 单幕 webm 体积异常（正常几 MB，异常可达数百 MB）；
- 日志长时间无新行。

### 7. 合成

```bash
node <plugin>/engine/cli.mjs compose --config ...
```

以音频为时间轴逐幕编码（H.264 + AAC），不足 tpad 补齐、超长裁尾，再 concat 拼接。

### 8. 抽帧验收（必做）

```bash
node <plugin>/engine/cli.mjs frames --config ... --at 5,30 --scene m5 --width 1280
```

每幕至少核对：首句落地时的画面、关键交互完成后的画面、末句画面；overlay 幕核对每个区块出现时刻与旁白句一致；画面中的数字/文案必须与旁白一致。

### 9. 交付

- `.gitignore` 排除 `audio/*.mp3`、`videos/`、`out/`、`diag/`、成片 mp4、`.auth-state.json`；入库 `narration.md`、config、overlay、`audio/*.vtt`、`durations.json`。
- 只提交本任务相关文件；成片作为附件交付，不入库。

## 常见故障速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 首帧残影/花屏 | Chromium 录制首帧残留 | 确认 `#veil` 存在且 `body.playing` 后淡出 |
| 动画整体偏移 | 未注入 `--delta` 或 delay 未减 delta | 检查 armOverlay 与 CSS `calc` |
| 旁白与操作错位 | 用字数估算时间 | 重读 VTT，按句首 + 0.8–1.0s 校准 |
| 某幕视频数百 MB / 不退出 | 浏览器挂起 | kill 重录；检查 `bounded` 是否包住所有调用 |
| TTS 读错字 | 多音字 | 在 `tts.fixes` 加同音替换，重生成并确认 VTT 无替换字泄漏 |
| TTS 连续失败 | 网络/代理 | 配置 `DV_TTS_PROXY`，按序重试多个端口 |
| 页面 404 / 旧界面 | 后端旧进程未重启 | 重启服务后再录 |
| 查询类画面过快/无过程 | 服务端缓存命中 | 录制前走缓存失效入口，并加最小停留时间 |

更细的校准公式与踩坑记录见 `references/calibration-and-pitfalls.md`；配置字段、CLI、scene ctx API 见 `references/pipeline-reference.md`；从零到交付的完整步骤与检查表见 `references/operating-manual.md`。

## 完成标准

- compose 成功，成片时长 ≈ 各幕音频时长之和（±1s）。
- 抽帧验收全部通过，无黑帧、无 404、无错位文案。
- 单幕可独立重录，重录后只需重跑 compose。
- 仓库只入库源码与 VTT，产物被 gitignore。
