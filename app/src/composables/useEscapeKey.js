import { onMounted, onUnmounted } from 'vue'
import { pushModalLayer, isTopModalLayer } from './appMenuState.js'

/**
 * モーダルを閉じる共通の仕組み。Escape キーと、端末・ブラウザの「戻る」の両方に効く。
 *
 * 呼んだコンポーネントは表示中（mount〜unmount）のあいだ「モーダルの層」として積まれる。
 * 戻るは**いちばん上の層を1枚閉じる**（App の _closeTopLayer が最初に見る）。
 * 以前は戻るが画面ごとに書かれた順で判定され、ホームのタブ移動などがモーダルより先に効いて、
 * 各種設定を開いたまま裏の画面が戻っていた（User報告 2026-10-01）。
 * Escape も上の層だけが受ける（重なったモーダルがまとめて閉じない）。
 *
 * @param {() => void} callback 閉じる操作（確認が要るモーダルは確認を出すだけでよい）
 */
export function useEscapeKey(callback) {
  let layer = null
  let release = null
  const handler = (e) => {
    if (e.key !== 'Escape') return
    if (layer && !isTopModalLayer(layer)) return
    e.preventDefault()
    callback()
  }
  onMounted(() => {
    ;({ layer, release } = pushModalLayer(callback))
    document.addEventListener('keydown', handler)
  })
  onUnmounted(() => {
    release?.()
    document.removeEventListener('keydown', handler)
  })
}

/** 名前どおりの別名。Escape を持たない全画面の層でも、意味が読めるように */
export const useModalLayer = useEscapeKey
