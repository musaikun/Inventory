import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// 試験ページ専用。通常のApp build / PWAには含めない。
export default defineConfig({
  root: fileURLToPath(new URL('./dev/rive', import.meta.url)),
  base: './',
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url))] },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist-rive', import.meta.url)),
    emptyOutDir: true,
  },
})
