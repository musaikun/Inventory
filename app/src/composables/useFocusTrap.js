import { onMounted, onUnmounted } from 'vue'

/**
 * モーダル内へキーボードフォーカスを閉じ込め、閉じたときに開く前の要素へ戻す。
 *
 * PLAY-002 のアクセシビリティ要件。`role="dialog" aria-modal="true"` を付けても、
 * ブラウザは Tab の移動範囲を制限しない。トラップが無いと Tab で背後の画面へ抜けてしまい、
 * 「削除中に背後のボタンを操作できる」状態になる。
 *
 * 可視性（display/offsetParent）の判定は行わない。この画面は局面ごとに v-if で
 * 要素そのものを差し替えるため、DOM にある＝操作できる要素、として扱ってよい。
 * （jsdom では offsetParent が常に null になるため、可視性で絞るとテストで破綻する。）
 *
 * @param {import('vue').Ref<HTMLElement|null>} containerRef トラップ対象のコンテナ
 * @returns {{ focusFirst: () => void }} 局面切り替え時にフォーカスを先頭へ移すための関数
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap(containerRef) {
  let restoreTo = null

  const items = () => {
    const root = containerRef.value
    return root ? Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)) : []
  }

  /**
   * 局面が変わったときに呼ぶ。操作対象が無い局面（処理中など）では
   * コンテナ自身へフォーカスを移し、トラップの外へ出さない。
   */
  function focusFirst() {
    const list = items()
    if (list.length) list[0].focus()
    else containerRef.value?.focus()
  }

  function onKeydown(e) {
    if (e.key !== 'Tab') return
    const root = containerRef.value
    if (!root) return

    const list = items()
    if (!list.length) { e.preventDefault(); root.focus(); return }

    const first  = list[0]
    const last   = list[list.length - 1]
    const active = document.activeElement

    // 何らかの理由で外へ出ていたら引き戻す
    if (!root.contains(active)) { e.preventDefault(); first.focus(); return }

    if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }

  onMounted(() => {
    restoreTo = document.activeElement
    // capture: 他のキーハンドラより先に Tab を処理する
    document.addEventListener('keydown', onKeydown, true)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', onKeydown, true)
    // 閉じた後は開く前の要素へ戻す。削除完了などで元の要素が DOM から消えている場合は何もしない
    if (restoreTo && document.contains(restoreTo) && typeof restoreTo.focus === 'function') {
      restoreTo.focus()
    }
  })

  return { focusFirst }
}
