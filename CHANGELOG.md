# 更新日志

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
