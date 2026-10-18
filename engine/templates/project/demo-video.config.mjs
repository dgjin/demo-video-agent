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
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: '-4%',
    // 访问微软 TTS 需要代理时填写，按顺序重试；也可用环境变量 DV_TTS_PROXY=a,b
    proxy: process.env.DV_TTS_PROXY ? process.env.DV_TTS_PROXY.split(',') : [],
    // 多音字读音修正：只改合成文本，字幕自动还原原文
    // 例：数据语境「行」应读 háng，避免被读成 xíng
    fixes: [
      ['一行', '一航'],
      ['万行', '万航'],
      ['行数', '航数'],
      ['行级', '航级'],
      ['行权限', '航权限'],
    ],
  },

  scenes: [
    // 纯展示幕：overlay 指向 HTML 文件，页面需包含 .stage 容器与 body.playing 动画约定
    { id: 'm00', title: '片头', overlay: 'overlay/title.html' },

    // 真实操作幕（示例，按需启用）：
    // { id: 'm1', title: '主界面', auth: true, async run({ page, at, clickLoc, hoverText }) {
    //   await at(1.5);
    //   await hoverText(page, '开始问数');
    //   await at(4.0);
    //   await clickLoc(page, page.getByRole('button', { name: '开始问数' }), 260, '开始问数');
    // } },

    { id: 'm01', title: '片尾', overlay: 'overlay/outro.html' },
  ],
};
