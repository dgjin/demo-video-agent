export default {
  name: 'Terminal Demo',
  finalVideo: 'terminal-demo.mp4',
  tts: {
    proxy: process.env.DV_TTS_PROXY ? process.env.DV_TTS_PROXY.split(',') : [],
    fixes: [],
  },
  scenes: [
    { id: 'm00', title: '片头', overlay: 'overlay/title.html' },
    // 终端幕：cast 用 asciinema rec assets/demo.cast 录制，回放速度自动贴合旁白时长
    { id: 'm01', title: '命令行演示', terminal: 'assets/demo.cast' },
  ],
};
