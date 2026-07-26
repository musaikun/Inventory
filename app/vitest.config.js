import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// ユニットテスト専用設定（PWAプラグインは読み込まない）。
// app/ と worker/ の *.test.js を対象にする。
// vue プラグインは .vue をマウントするコンポーネントテスト用（ビルドと同じ既存依存）。
export default defineConfig({
  plugins: [vue()],
  // worker/ は app/ の外にあるため、ファイルアクセスを親ディレクトリまで許可する
  server: { fs: { allow: ['..'] } },
  resolve: {
    alias: {
      // vite-plugin-pwa の仮想モジュール。PWA プラグイン非搭載のテストではスタブへ差し替える。
      'virtual:pwa-register/vue': fileURLToPath(new URL('./src/test-stubs/pwaRegister.js', import.meta.url)),
    },
  },
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.js', '../worker/src/**/*.test.js'],
  },
})
