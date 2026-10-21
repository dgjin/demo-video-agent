/**
 * 素材幕示例：导入已有视频 / 截图序列，配 edge-tts 旁白出片。
 * 全程不经浏览器——纯素材项目无需安装 playwright。
 *
 * 流水线：
 *   demo-video tts      文稿 → mp3 + 句级 VTT + audio/durations.json
 *   demo-video record   素材 → videos/<id>.webm（多图按 VTT 句首切换）
 *   demo-video compose  以音频为主时间轴合成并拼接
 *   demo-video frames   抽帧验收
 */
export default {
  name: '素材幕示例',
  finalVideo: 'asset-demo.mp4',
  viewport: { width: 1920, height: 1080 },
  fps: 25,

  tts: {
    // 音色三选一（voice > role > gender），都不写即默认「温暖女声」
    role: '',
  },

  scenes: [
    // 截图序列：三张图按本幕三句旁白的句首时刻自动切换，末图撑到幕尾
    { id: 'm00', title: '截图序列', asset: ['assets/shot-01.png', 'assets/shot-02.png', 'assets/shot-03.png'] },

    // 视频素材：自动适配画幅（fit: 'contain' 留黑边 | 'cover' 裁切填满，默认 contain）；
    // 本素材 6s 短于旁白时长，合成层会冻帧补齐
    { id: 'm01', title: '视频素材', asset: 'assets/clip.mp4' },
  ],
};
