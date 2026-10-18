export default {
  name: 'Hello Demo Video',
  finalVideo: 'hello-demo.mp4',
  tts: {
    proxy: process.env.DV_TTS_PROXY ? process.env.DV_TTS_PROXY.split(',') : [],
    fixes: [],
  },
  scenes: [
    { id: 'm00', title: '片头', overlay: 'overlay/intro.html' },
    { id: 'm01', title: '片尾', overlay: 'overlay/outro.html' },
  ],
};
