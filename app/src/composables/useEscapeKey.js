import { onMounted, onUnmounted } from 'vue'

/**
 * Escape キー押下時にコールバックを実行
 * モーダルを閉じる用途の共通ユーティリティ
 */
export function useEscapeKey(callback) {
  const handler = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      callback()
    }
  }
  onMounted(()   => document.addEventListener('keydown', handler))
  onUnmounted(() => document.removeEventListener('keydown', handler))
}
