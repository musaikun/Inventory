// テスト用スタブ: `virtual:pwa-register/vue` は vite-plugin-pwa が提供する仮想モジュールで、
// PWA プラグインを読み込まない vitest.config.js では解決できないため alias でここへ差し替える。
import { ref } from 'vue'

export function useRegisterSW() {
  return {
    needRefresh: ref(false),
    offlineReady: ref(false),
    updateServiceWorker: async () => {},
  }
}
