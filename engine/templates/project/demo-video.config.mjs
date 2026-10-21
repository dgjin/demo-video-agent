/**
 * 演示视频项目配置（所有相对路径以本文件所在目录为基准）
 *
 * 流水线：
 *   demo-video tts      文稿 → mp3 + 句级 VTT + audio/durations.json
 *   demo-video record   按 durations.json 逐幕录屏（overlay 展示幕 / 真实操作幕）
 *   demo-video compose  以音频为主时间轴合成并拼接
 *   demo-video frames   抽帧验收
 */
export default {
  name: '示例演示视频',
  finalVideo: '示例-演示讲解.mp4',
  viewport: { width: 1920, height: 1080 },
  fps: 25,

  // 录屏目标站点（纯 overlay 项目可留空）
  baseUrl: process.env.DV_BASE_URL || 'http://127.0.0.1:3000',

  /**
   * 登录态（只有 auth:true 的幕才会用到）：
   * - 已有登录态文件：直接填 storageState
   * - 没有：提供 login(page) 首次录制前自动登录并保存
   */
  auth: {
    storageState: '.auth-state.json',
    // async login(page) {
    //   await page.getByLabel('用户名').fill('admin');
    //   await page.getByLabel('密码').fill('admin123');
    //   await page.getByRole('button', { name: '登录' }).click();
    //   await page.waitForLoadState('networkidle');
    // },
  },

  tts: {
    // 音色三选一（优先级 voice > role > gender），都不写即默认「温暖女声」
    // 角色清单：warm / lively / news / sunny / steady / youth / dongbei / shaanxi（demo-video voices）
    role: '',
    // gender: 'male',   // 只想按男女声选时填它
    // voice: 'zh-CN-XiaoxiaoNeural',   // 任意 edge-tts voice，英文/日文也在这里换
    rate: '-4%',
    // 访问微软 TTS 需要代理时填写，按顺序重试；也可用环境变量 DV_TTS_PROXY=a,b
    proxy: process.env.DV_TTS_PROXY ? process.env.DV_TTS_PROXY.split(',') : [],
    // 多音字：内置词典默认开启（命令行 / 重新 / 会计 / 角色…），中文音色自动生效
    // 想整体关闭：defaultFixes: false
    defaultFixes: true,
    // 追加或覆盖内置词：必须等长、同音同调；值为 null 表示关闭该条
    fixes: [
      // ['重载', '崇载'],
      // ['处理', null],
    ],
  },

  scenes: [
    // 纯展示幕：overlay 指向 HTML 文件，页面需包含 .stage 容器与 body.playing 动画约定
    { id: 'm00', title: '片头', overlay: 'overlay/title.html' },

    // 素材幕（App 真机录屏 / 实拍 / 渲染 / 截图序列）：不经浏览器，纯素材项目无需 playwright
    // 单个视频自动适配画幅（fit: 'contain' 留黑边 | 'cover' 裁切填满）；
    // 多张图片按该幕旁白的句首时刻自动切换，末图撑到幕尾
    // { id: 'm1', title: 'App 演示', asset: 'assets/app-demo.mp4' },
    // { id: 'm2', title: '界面走查', asset: ['assets/shot-01.png', 'assets/shot-02.png'] },

    // 终端幕：把 asciinema 录制（asciinema rec demo.cast）回放成终端画面
    // 回放速度自动贴合该幕旁白时长；支持 SGR 颜色/加粗、回车覆盖、清行清屏，不支持全屏 TUI
    // { id: 'm2b', title: '命令行演示', terminal: 'assets/demo.cast' },

    // 真实操作幕（示例，按需启用；选择器改成你自己系统的即可）：
    // { id: 'm3', title: '主界面', auth: true, async run({ page, at, clickLoc, hoverText }) {
    //   await at(1.5);
    //   await hoverText(page, '开始演示');
    //   await at(4.0);
    //   await clickLoc(page, page.getByRole('button', { name: '开始演示' }), 260, '开始演示');
    // } },

    { id: 'm01', title: '片尾', overlay: 'overlay/outro.html' },
  ],
};
