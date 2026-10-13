import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// ユニットテスト専用設定（PWAプラグインは読み込まない）。
// app/src の *.test.js を対象にする（worker/ のテストは worker/ で別に回す。TEST-002）。
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
  // ビルド時に埋める定数はテストでも定義しておく。
  // 未定義だと参照したコンポーネントが ReferenceError でマウントに失敗する。
  define: {
    __APP_VERSION__: JSON.stringify('test'),
    __BUILD_SHA__:   JSON.stringify('testsha'),
  },
  test: {
    globals: true,
    // DOM を使わない純粋な計算（services/・utils/）は node で回す。jsdom の準備はファイルごとに
    // 約1秒かかり、App 全体のテスト時間の大半を占めていた（TEST-003）。
    // services/・utils/ で DOM（localStorage・window など）が要るテストは、ファイル先頭に
    // `// @vitest-environment jsdom` を書く（書き忘れると ReferenceError で落ちるので気づける）。
    projects: [
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: ['src/services/**/*.test.js', 'src/utils/**/*.test.js'] },
      },
      {
        extends: true,
        test: {
          name: 'dom', environment: 'jsdom', include: ['src/**/*.test.js'],
          exclude: ['src/services/**/*.test.js', 'src/utils/**/*.test.js'],
        },
      },
    ],
  },
})
