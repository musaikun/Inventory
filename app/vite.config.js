import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync, existsSync, cpSync, createReadStream } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

/**
 * どのビルドかを示す commit SHA（短縮7桁）。
 *
 * `package.json` の version は**リリースの区切りでUser/PMだけ**が上げる。
 * セッションが変更ごとに上げていた頃は、複数セッションが同じ値を書いて採番が衝突し、
 * 値が偶然一致すると merge で競合すらせずに別々の変更が同じ番号を名乗った（D-025）。
 * 「どのビルドか」は SHA が持つので、version を触らずに済む。
 * 番号と違って、画面の表示から該当コミットを直接特定できる。
 *
 * CI では `GITHUB_SHA` を使う（`actions/checkout` は既定 `fetch-depth: 1` だが
 * `git rev-parse HEAD` は通る。env があるならプロセス生成を省く）。
 * git が無い環境（tarball ビルド等）では空にして、表示側で省く。
 */
function buildSha() {
  const fromEnv = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA
  if (fromEnv) return fromEnv.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch (_) {
    return ''
  }
}
const isProReview = process.env.VITE_DEPLOYMENT_CHANNEL === 'pro-review'
  && process.env.VITE_REVIEW_PLAN === 'pro'

// pdfjs の cMap（CJKフォント解決に必須）を配信する。node_modules から
// dist/cmaps へコピーし、dev では /cmaps/ を直接配信。オンデマンド取得なので
// PWA プリキャッシュには含めない（.bcmap は globPatterns 対象外）。
const CMAPS_SRC = fileURLToPath(new URL('./node_modules/pdfjs-dist/cmaps', import.meta.url))
function pdfCmaps() {
  let outDir = 'dist'
  let root = process.cwd()
  return {
    name: 'pdfjs-cmaps',
    configResolved(c) { outDir = c.build.outDir; root = c.root },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/cmaps/')) return next()
        const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/cmaps\//, ''))
        const file = join(CMAPS_SRC, rel)
        if (file.startsWith(CMAPS_SRC) && existsSync(file)) {
          res.setHeader('Content-Type', 'application/octet-stream')
          createReadStream(file).pipe(res)
        } else next()
      })
    },
    closeBundle() {
      if (existsSync(CMAPS_SRC)) cpSync(CMAPS_SRC, resolve(root, outDir, 'cmaps'), { recursive: true })
    },
  }
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__:   JSON.stringify(buildSha()),
  },
  plugins: [
    vue(),
    pdfCmaps(),
    VitePWA({
      registerType: 'autoUpdate',
      // Cloudflare Access 配下では manifest 取得にも認証 Cookie が必要。
      // Pro Review だけ crossorigin=use-credentials を付ける。
      useCredentials: isProReview,
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
        // SPA フォールバック（index.html）に飲まれてはいけないパスを除外する。
        // - /cmaps/*.bcmap: PDF取込のcMap
        // - 公開legalページ: インストール済みPWAから拡張子なしURL（/privacy 等）を開いても
        //   アプリ本体ではなく実ページへ到達させる（Play審査で参照される公開URL）
        navigateFallbackDenylist: [/^\/cmaps\//, /^\/privacy/, /^\/terms/, /^\/support/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\./,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            // PDF取込のcMapは初回のみ取得しキャッシュ（オフライン取込対応）
            urlPattern: /\/cmaps\/.*\.bcmap$/,
            handler: 'CacheFirst',
            options: { cacheName: 'pdf-cmaps', expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
})
