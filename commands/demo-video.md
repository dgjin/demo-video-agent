---
description: 演示视频导演：初始化项目、环境体检、TTS 配音、分幕录屏、合成成片、抽帧验收
argument-hint: [init my-demo | setup | doctor | voices | tts | record | compose | frames | all] [--config my-demo/demo-video.config.mjs] [--role news]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit]
---

# 演示视频流水线

## Arguments

用户输入：$ARGUMENTS（可为空）

## Instructions

1. 定位插件根目录（取已安装的最新版本，记为 DV_ROOT）：

   ```bash
   DV_ROOT="${DV_HOME:-$(ls -d "$HOME/.qoder/plugins/cache"/*/demo-video-agent/* 2>/dev/null | while read -r p; do echo "$(basename "$p") $p"; done | sort -V | tail -1 | cut -d' ' -f2-)}"
   echo "$DV_ROOT"
   ```

   - 该写法同时覆盖本地安装（`cache/local/...`）与市场安装（`cache/qoder-marketplace/...`）；
   - Windows PowerShell 等价写法：
     `Get-ChildItem "$env:USERPROFILE\.qoder\plugins\cache\*\demo-video-agent\*" | Select-Object -Last 1`；
   - 若输出为空：提示用户先在 Qoder 插件面板或 `qodercli plugin install` 安装并启用 `demo-video-agent`，不要继续执行。

2. 按参数选择动作：

   | 输入 | 行为 |
   | --- | --- |
   | 无参数 | 运行 `doctor`，汇报环境状态与下一步建议，不自动开始 TTS/录屏 |
   | `setup` | 安装 playwright 与录屏 ffmpeg；带 `--link` 时生成全局 `demo-video` 命令 |
   | `init my-demo` | 在 `./my-demo` 生成脚手架，并提示编辑 `narration.md`、`overlay/*.html` 与配置 |
   | 其他子命令 | 原样转发给 CLI；未给 `--config` 时从当前工作区向上查找 `demo-video.config.mjs` |

3. 分幕结构与旁白文稿遵循技能 `demo-video-storyboard`；制作执行遵循 `demo-video-production` 的硬性规则：

   - 时间轴以 `audio/durations.json` 与 VTT 句级时间戳为准，不按字数估算；
   - 正式录制前先 `--dry` / `--no-record` 彩排；
   - 合成后必须用 `frames` 抽帧验收（首句、关键交互、末句）；
   - 单幕异常按「耗时 × 文件体积 × 日志静默」判定挂起，kill 后重录，不原地诊断。

4. 汇报：执行的命令、产物绝对路径、成片时长、各幕时长、抽帧验收结果与未通过项。

## Notes

- 命令统一使用 `node "$DV_ROOT/engine/cli.mjs" doctor` 这类形式（子命令见上表）；已生成全局命令时可直接用 `demo-video doctor`。
- 依赖缺失先运行 `setup`；TTS 依赖微软在线服务，受限网络用 `DV_TTS_PROXY=http://127.0.0.1:7890,http://127.0.0.1:7891`。
- 不把账号、令牌、真实业务数据写进文稿、画面或片尾。
- 细节手册在插件 `skills/demo-video-production/references/` 下。
