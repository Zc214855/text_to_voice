import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const proxy = {
  '/volc-api': {
    target: 'https://openspeech.bytedance.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/volc-api/, '')
  },
  '/edge-api': {
    target: 'http://127.0.0.1:5174',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/edge-api/, '/api/edge-tts'),
    timeout: 120_000,
  },
  '/api/library': {
    target: 'http://127.0.0.1:5174',
    changeOrigin: true,
    timeout: 300_000,
  },
}

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy,
  },
  preview: {
    port: 4173,
    proxy,
  },
})
