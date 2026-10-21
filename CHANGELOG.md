# 更新日志

## 0.5.0 — 2026-10-21

工程质量与制作效率专项：

- 新增**终端幕**（`scene.terminal`）：读取 asciinema v2 `.cast`，生成黑底终端回放页并按该幕旁白时长自动适配倍速（0.25×–4×）后录制。支持 SGR 16 色 / 加粗 / 暗淡 / 下划线、`\r` 覆盖、`\b` 退格、`\t`、`\x1b[K` 清行与 `\x1b[2J` 清屏；渲染逻辑以源码内嵌方式与单测共用同一实现。新增 `engine/lib/terminal.mjs` 与示例 `examples/terminal-demo`。
- 新增**单元测试**：`node:test` 共 56 个用例（读音替换还原、素材图切换规划、旁白解析、音色解析、时长解析、限流并发、断点续做判定、配置校验、终端 ANSI 回放），`npm test` 一键执行。顺带修复 `narration.md` 围栏代码块内容被误读进旁白的缺陷。
- 新增**发布自检与 CI**：`npm run check` 校验 manifest 字段、版本一致（plugin.json / package.json / CHANGELOG / 技能 frontmatter）、技能/子代理/命令文件齐全、文档子命令与 CLI 一致（11 个）、`DV_ROOT` 定位片段与 `cli.mjs` 同源；`.github/workflows/ci.yml` 执行 `npm ci` + test + check + CLI 冒烟。
- **TTS 并发**：多幕旁白并行合成（`tts.concurrency`，默认 3）。`execFileSync` 会阻塞事件循环，改用 `spawn` 包装的 `execAsync` + `mapLimit` 限流保序；两幕实测 2.5s 完成。
- **断点续做**：`record` 与 `compose` 基于输入 mtime 复用产物（配置 / 画面源 / 音频任一更新才重做），`--force` 强制重做。改一幕只重录一幕，重跑配音后自动重录相关幕。
- **配置字段级校验**：加载时校验 `viewport/fps/finalVideo/narration/compose.crf/padSeconds/tts.concurrency/dirs` 与每幕画面源（四选一及互斥）、`asset` 形态、`fit` 枚举；报错带 `scenes[i](id).field` 路径。
- **overlay 入场时刻单一写法**：示例与模板中的硬编码 `calc(12.2s - var(--delta))` 全部收敛为 `--d: 12.2s` + `animation-delay: calc(var(--d) - var(--delta))`，双值动作用 `--d/--d2`，校准脚本与人工改时长只认一种写法。
- `doctor` 的幕类型分布新增 `terminal`；`record --dry/--no-record` 对终端幕同样生成回放页彩排。
- README / 操作手册 / SKILL / pipeline-reference / calibration-and-pitfalls / qoder.md / 导演指令 / 斜杠命令同步更新四类幕说明、断点续做与新坑（录屏偶发底边灰条、终端幕 ANSI 边界）。

## 0.4.0 — 2026-10-21

- 新增**素材幕**（`scene.asset`）：导入已有视频（mp4/webm/mov/mkv/m4v/avi/gif）或截图序列（png/jpg/jpeg/webp/bmp），配旁白出片——覆盖 App 真机录屏、实拍、3D 渲染、设计稿等非 Web 产品演示。
- 截图序列按该幕 VTT 句首时刻自动切换（推荐一句一图），无 VTT 时按幕时长均分；末图撑到幕尾，图片多于句数时忽略并提示。
- 视频素材自动适配画幅：`fit: 'contain'`（默认，等比居中留黑边）/ `'cover'`（裁切填满）；统一帧率与像素格式，去素材原声，短于旁白时沿用 tpad 冻帧补齐、超长裁尾。
- 纯素材项目不加载浏览器：playwright 改为惰性加载，仅存在 overlay/run 幕或登录态时初始化。
- `record --dry` / `--no-record` 正确跳过素材幕；`doctor` 的 config 行显示幕类型分布（如 `2 幕（asset 2）`）。
- 新增 `engine/lib/asset.mjs`；`init` 脚手架配置模板附素材幕示例注释。
- 新增示例工程 `examples/asset-demo`（三图截图序列 + 视频导入，约 17s 成片，全程不经浏览器）。
- 修复 `DV_ROOT` 定位命令：多市场目录并存（如 local 与 qoder-marketplace 同时安装）时 `sort -V` 按整行排序会受市场名干扰取错版本，改为按版本号（basename）排序取最新；同步更新 README / SKILL / 操作手册 / 斜杠命令与 `setup --link` 垫片。
- README / SKILL / pipeline-reference / qoder.md 同步更新三类幕说明与素材幕故障速查。

## 0.3.0 — 2026-10-19

- 套件定位升级为「演示视频导演」，按 Qoder 专家套件规范组织为「策划 + 制作」两个协作技能。
- 新增 `demo-video-storyboard` 技能：现场勘察、幕结构设计、narration.md 写作规范、时长预算与交棒检查。
- 新增 `qoder.md` 岗位指令与 MIT 许可证。
- 新增本更新日志；README 补充套件结构、网络访问与数据边界说明。
- manifest 补齐 `license` 与检索关键字，角色指令挂在 `agents/demo-video-director.md`。
- 示例与文档去除内部项目名，统一为通用示例。
- 清理命令示例中的占位符；技能正文补充网络访问与数据边界；README 验证记录更新到 0.3.0。
- 重绘插件图标：场记板 + 渐变播放键 + 声波，提供 SVG 与 1024×1024 PNG（约 31K，`assets/avatar.svg` / `assets/avatar.png`）。

## 0.2.2 — 2026-10-18

- 解说音色可选：8 个角色预设、性别选择与单幕换人；新增 `voices` 命令与 `--voice/--role/--gender` 覆盖参数。
- 换音色后自动按幕记录音色来源，`doctor` 展示当前音色。

## 0.2.1 — 2026-10-18

- 新增内置多音字读音词典（42 条），中文音色默认启用。
- 字幕按字符位置精确还原，避免全局替换误伤原文；`tts.defaultFixes` 可关闭。

## 0.2.0 — 2026-10-17

- 首个可发布版本：旁白驱动的 TTS、分幕录屏、合成与抽帧验收流水线。
- 插件根目录自动定位、依赖自检、示例项目与离线校验。
