import { defineConfig } from 'vitest/config'

// ユニットテスト専用設定（PWAプラグインは読み込まない）。
// app/ と worker/ の *.test.js を対象にする。
export default defineConfig({
  // worker/ は app/ の外にあるため、ファイルアクセスを親ディレクトリまで許可する
  server: { fs: { allow: ['..'] } },
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.js', '../worker/src/**/*.test.js'],
  },
})
