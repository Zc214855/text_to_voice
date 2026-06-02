import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/volc-api': {
        target: 'https://openspeech.bytedance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/volc-api/, '')
      },
      '/edge-api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/edge-api/, '/api/edge-tts'),
        timeout: 120_000,
      },
      '/voicebox-api': {
        target: 'http://127.0.0.1:17493',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/voicebox-api/, ''),
        timeout: 120_000,
      },
    },
  },
})
