import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'タナオロ',
        short_name: 'タナオロ',
        description: '飲食店の棚卸を音声でスピード入力。複数端末リアルタイム同期対応。',
        theme_color: '#2563eb',
        background_color: '#f1f5f9',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        lang: 'ja',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        importScripts: ['push-sw.js'],
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // 旧ビルドのプリキャッシュ（旧ハッシュ index-XXXX.css 等）を破棄。
        // これが無いと古いCSS/JS参照が残り 404 が発生し続ける。
        cleanupOutdatedCaches: true,
        // 新SWを待機させず即時有効化し、全クライアントを更新後の資産へ揃える。
        // デプロイのたびに index.html と各ハッシュ資産がアトミックに差し替わる。
        clientsClaim: true,
        skipWaiting:  true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\./,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
})
