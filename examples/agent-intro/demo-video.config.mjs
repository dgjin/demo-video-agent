export default {
  name: 'demo-video-agent 介绍片',
  narration: 'narration.md',
  finalVideo: 'demo-video-agent-intro.mp4',
  viewport: { width: 1920, height: 1080 },
  fps: 25,

  tts: {
    role: 'news',
    rate: '-4%',
    proxy: process.env.DV_TTS_PROXY ? process.env.DV_TTS_PROXY.split(',') : [],
    fixes: [],
  },

  compose: { crf: 18, preset: 'medium', padSeconds: 5 },

  scenes: [
    { id: 'm00', title: '片头', overlay: 'overlay/m00-title.html' },
    { id: 'm01', title: '流水线', overlay: 'overlay/m01-pipeline.html' },
    { id: 'm02', title: '环境准备', overlay: 'overlay/m02-doctor.html' },
    { id: 'm03', title: '两种画面', overlay: 'overlay/m03-scenes.html' },
    { id: 'm04', title: '通用化设计', overlay: 'overlay/m04-portable.html' },
    { id: 'm05', title: '抽帧验收', overlay: 'overlay/m05-verify.html' },
    { id: 'm06', title: '片尾', overlay: 'overlay/m06-outro.html' },
  ],
};
