# 演示视频制作 Agent（demo-video-agent）

一个 Qoder 插件：把「旁白文稿 → TTS 配音 → 分幕录屏 → 音画合成 → 抽帧验收」封装为可复用的 Agent 能力。

源自《智能问数据分析系统》演示视频流水线的工程实践（15 幕、16 分钟成片），抽取为通用工具：声明式配置 + 可插拔场景函数，内置音画对齐、首帧遮蔽、挂起判据、多音字修正等踩坑经验。

## 能力

- **音频为主时间轴**：每幕时长取 TTS 实测值，视频不足 tpad 冻帧补齐、超长裁尾。
- **句级 VTT 对齐**：edge-tts 输出句级字幕，作为 `at()` / `--d` 的唯一校准源。
- **两类幕**：overlay 动画展示页（片头/片尾/导览）与真实操作幕（Playwright 编排）。
- **可彩排、可单幕重录**：`--dry` 每幕 8s 彩排、`--no-record` 只跑操作链、`--scenes` 指定幕。
- **抽帧验收**：`frames --scene m1 --at 5,30` 按幕内相对时间导出 PNG。
- **多音字修正**：合成层同音替换（如「行」→「航」），字幕自动还原原文。

## 环境要求

- Node.js ≥ 18
- ffmpeg / ffprobe（`brew install ffmpeg`）
- edge-tts（`pip install edge-tts`）
- Chrome（Playwright `channel: 'chrome'`；无桌面环境需 xvfb）

## 安装与体检

```bash
cd demo-video-agent
npm install                      # 安装 playwright（如被录制项目已有可复用）
npx playwright install ffmpeg    # Playwright 录屏依赖它自带的 ffmpeg
node engine/cli.mjs doctor
```

`doctor` 输出 node / ffmpeg / ffprobe / edge-tts / playwright / pw-ffmpeg / config 七项体检结果。

## 快速开始（自带示例）

```bash
# 示例：两幕 overlay，约 12 秒成片
DV_TTS_PROXY=http://127.0.0.1:7890,http://127.0.0.1:7891 \
  node engine/cli.mjs all --config examples/hello-video/demo-video.config.mjs

# 产物
#   examples/hello-video/out/hello-demo.mp4
#   examples/hello-video/diag/frame-*.png
```

## 新建真实项目

```bash
node engine/cli.mjs init ../my-demo
# 1) 编辑 my-demo/narration.md（每幕 "## <幕ID> · <幕名>"）
# 2) 编辑 my-demo/overlay/*.html 与 demo-video.config.mjs（真实操作幕写 run(ctx)）
node engine/cli.mjs tts    --config ../my-demo/demo-video.config.mjs
node engine/cli.mjs record --config ../my-demo/demo-video.config.mjs --no-record   # 彩排
node engine/cli.mjs record --config ../my-demo/demo-video.config.mjs
node engine/cli.mjs compose --config ../my-demo/demo-video.config.mjs
node engine/cli.mjs frames  --config ../my-demo/demo-video.config.mjs --at 3,8 --scene m00
```

## 在 Qoder 中使用

- 技能 `demo-video-production`：完整工作流、校准公式、故障速查。
- 子代理 `demo-video-director`：面向「给系统做一个演示视频」的端到端交付。

## 目录结构

```text
demo-video-agent/
  .qoder-plugin/plugin.json        # Qoder 插件清单
  skills/demo-video-production/
    SKILL.md                       # 工作流与硬性约束
    references/
      pipeline-reference.md        # 配置、CLI、ctx API、overlay 协议
      calibration-and-pitfalls.md  # 音画校准与踩坑
  agents/demo-video-director.md    # 演示视频导演子代理
  engine/
    cli.mjs                        # 命令入口
    lib/{tts,record,compose,frames,narration,config,durations,util}.mjs
    templates/project/             # init 脚手架
  examples/hello-video/            # 最小可运行示例
```

## 验证记录

- `node engine/cli.mjs doctor`：node 22 / ffmpeg / ffprobe / edge-tts / playwright / pw-ffmpeg / config 全部通过。
- `examples/hello-video` 全链路：TTS m00=8.3s、m01=3.3s；录制 m00=8.3s、m01=4.3s（m00 与配音基本等长，tpad 仅补 0.01s；m01 超长由合成裁尾）；compose 成片 11.7s（H.264 + AAC）；抽帧 2s/6s/10s 画面正常（标题入场、hint、片尾字幕），展示幕光标已隐藏。
- Playwright 1.64 首次录制需 `npx playwright install ffmpeg`（未安装时录屏直接失败），`doctor` 会检查 `ms-playwright/ffmpeg-*`。
- `init` 脚手架：生成 config / narration / overlay / .gitignore，配置可被命令行加载。
- `validate_qoder_plugin.py` 离线校验通过（manifest、skills、agents、logo 路径有效）。

## 已知限制

- 真实操作幕需要针对被测系统编写 Playwright 场景函数，无法自动理解任意 UI。
- 仅支持旁白音轨；不含背景音乐与系统声音采集。
- 字幕 VTT 用于校准与交付，不默认烧录进画面。
- 录屏依赖 Chrome/Chromium；CI 无桌面环境需虚拟显示。
- 暗色大面积平坦渐变在 VP8 录屏后可能出现轻微块状伪影，合成会继承；缓解方式见 `calibration-and-pitfalls.md`「画面质量与编码伪影」。

## 来源

- 上游实践：`/Users/dgjin/dgjinapp/智能问数据分析系统/scripts/demo-video`（narration → generate-tts → record → compose，含 m00 片头、m01 架构图导览、m8b 双闭环、m8c 记忆体、m10 片尾）。
- 本仓库将其抽象为通用 CLI，并补充 overlay 模板、抽帧验收命令与插件包装。
