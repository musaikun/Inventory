import { ref, computed } from 'vue'

/**
 * 一覧の行を左スワイプして「非表示」にする操作。
 *
 * 2段階にする。iOS の Mail などと同じ形で、指の移動量で意図の強さを読み分ける。
 *   浅いスワイプ … 「非表示」ボタンが出て止まる → 押すと確認ダイアログ
 *   全スワイプ   … 行の半分以上まで引いて離す   → 確認を挟まずその場で非表示
 * 非表示は破壊的な操作ではない（一覧から戻せる）ので、はっきり引き切った操作にまで
 * 確認を出すと、たくさん隠すときにダイアログの往復だけが残る。
 *
 * 棚卸の表（InventoryTable）と振り分けの品目一覧（AxisAssignFocus）で同じ操作にするため、
 * ここに1つだけ持つ。片方だけ手を入れて操作感がずれるのを防ぐ。
 *
 * @param {object}   opts
 * @param {Function} opts.enabled 操作を受け付けるか（ゲスト・読み取り専用は false）
 * @param {Function} opts.onHide  非表示が確定したとき呼ぶ（品目名）
 */
export const REVEAL_AT = 40   // これ以上引いたらアクションを表示

const ACTION_W   = 96    // 非表示アクションの幅(px)
const OPEN_SNAP  = 56    // これ以上で離すとスナップして開いたまま
const FULL_MIN   = 160   // 全スワイプと認める最小の移動量(px)
const FULL_RATIO = 0.5   // 行幅に対する割合（広い画面ほど深く引かせる）

// アクションの色。出てきた時点（灰）から閾値（赤）へ、引いた量に比例して寄せる。
// 「あとどれだけ引けば確定するか」を、離す前に色の濃さで読めるようにするため。
const SWIPE_C0 = [100, 116, 139]   // #64748b 出た直後
const SWIPE_C1 = [220,  38,  38]   // #dc2626 引き切って確定する状態

export function useRowHideSwipe({ enabled = () => true, onHide } = {}) {
  const swipeItem     = ref(null)   // ドラッグ/オープン中の品目名
  const swipeDx       = ref(0)      // 現在の移動量（<=0）
  const swipeDragging = ref(false)  // 指が触れている間（transition を切る）
  const swipeW        = ref(0)      // 触れている行の幅（全スワイプの判定に使う）
  const hideDialogItem = ref(null)  // 確認ダイアログ対象
  let _sx = 0, _sy = 0, _dir = null, _baseDx = 0, _suppressClick = false

  // 全スワイプの閾値。行幅が測れない環境でも FULL_MIN で成立させる。
  const fullAt = computed(() => Math.max(FULL_MIN, Math.round(swipeW.value * FULL_RATIO)))
  // 引き切っているか（離した瞬間に非表示になる状態）
  const swipeFull = computed(() => -swipeDx.value >= fullAt.value)
  // 抵抗をかけ始める位置。閾値より手前で重くすると全スワイプに届かなくなるので下限に入れる。
  const dragMax = computed(() => Math.max(ACTION_W, swipeW.value, fullAt.value))
  // アクションは引いた分だけ広がる（引き切ると行を覆う）。既定幅より狭くはしない。
  const swipeActionW = computed(() => Math.max(ACTION_W, -swipeDx.value))

  const swipeProgress = computed(() => {
    const span = fullAt.value - REVEAL_AT
    if (span <= 0) return 1
    return Math.min(1, Math.max(0, (-swipeDx.value - REVEAL_AT) / span))
  })
  const swipeActionColor = computed(() => {
    const p = swipeProgress.value
    const [r, g, b] = SWIPE_C0.map((v, i) => Math.round(v + (SWIPE_C1[i] - v) * p))
    return `rgb(${r}, ${g}, ${b})`
  })

  function resetSwipe() { swipeItem.value = null; swipeDx.value = 0; swipeDragging.value = false }

  /** 直前がスワイプ操作だったか。行の click ハンドラの先頭で見る */
  function consumeClick() {
    if (!_suppressClick) return false
    _suppressClick = false
    return true
  }

  function onRowTouchStart(e, item) {
    if (!enabled()) return
    // 前の操作で立てた抑止を持ち越さない。全スワイプでは行が消えるため、touchend 後の click が
    // どこにも届かず（あるいは繰り上がってきた別の行に届いて）抑止が消費されないことがある。
    // 次の指が触れた時点で必ず落とす。
    _suppressClick = false
    if (swipeItem.value && swipeItem.value !== item) resetSwipe()  // 別行に触れたら閉じる
    const t = e.changedTouches[0]
    _sx = t.clientX; _sy = t.clientY; _dir = null
    _baseDx = (swipeItem.value === item) ? swipeDx.value : 0
    swipeW.value = e.currentTarget?.getBoundingClientRect?.().width || 0
    swipeItem.value = item
    swipeDragging.value = true
  }

  function onRowTouchMove(e) {
    if (!swipeDragging.value) return
    const t  = e.changedTouches[0]
    const dx = t.clientX - _sx
    const dy = t.clientY - _sy
    if (_dir === null) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      _dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
    }
    if (_dir !== 'h') return   // 縦スクロールは妨げない
    // 横だと決まったら、この指はこの行のもの。親の横スワイプ（タブ送り・カード切替）へ渡さない。
    e.stopPropagation?.()
    let nx = _baseDx + dx
    if (nx > 0) nx = 0
    const max = dragMax.value
    if (nx < -max) nx = -max - (-max - nx) * 0.3  // 端で抵抗
    swipeDx.value = nx
  }

  function onRowTouchEnd(e) {
    if (!swipeDragging.value) return
    swipeDragging.value = false
    if (_dir !== 'h') return
    e?.stopPropagation?.()
    _suppressClick = true
    if (swipeFull.value) { _commitFullSwipeHide(); return }
    swipeDx.value = (-swipeDx.value >= OPEN_SNAP) ? -ACTION_W : 0   // スナップ開/閉
    if (swipeDx.value === 0) swipeItem.value = null
  }

  /**
   * ジェスチャがシステムに取られたとき（iOS の画面端スワイプ、通知・着信など）。
   * touchend は来ないので、ここで受けないと **引かれた位置のまま固定**される。
   *
   * それ自体も見た目の壊れだが、危ないのはその次だ。触れた行の続きとして扱われるため
   * `_baseDx` が引かれた位置（= 閾値を越えた深さ）を引き継ぎ、**指を数px横へ動かして
   * 離すだけで「全スワイプ」と判定されて確認なしに非表示になる**。
   * 取り消されたジェスチャは何も確定させず、閉じた状態へ戻す。
   */
  function onRowTouchCancel() {
    if (!swipeDragging.value) return
    _dir = null
    resetSwipe()
  }

  /**
   * 全スワイプで離したとき。確認ダイアログを出さずにそのまま非表示にする。
   *
   * 呼び出し側が一覧を更新するとこの行は外れるので、こちらでアニメーションは持たない
   * （持たせると「消えたはずの行」の残骸を掴んだままになりうる）。受け取られなかった場合は
   * resetSwipe() で元の位置に戻り、何も起きなかったのと同じになる。
   */
  function _commitFullSwipeHide() {
    const it = swipeItem.value
    resetSwipe()
    if (it) onHide?.(it)
  }

  function openHideDialog(item) { hideDialogItem.value = item }
  function confirmHideDialog() {
    const it = hideDialogItem.value
    hideDialogItem.value = null
    resetSwipe()
    if (it) onHide?.(it)
  }
  function cancelHideDialog() { hideDialogItem.value = null; resetSwipe() }  // 行は滑らかに戻る

  return {
    swipeItem, swipeDx, swipeDragging, swipeFull, swipeActionW, swipeActionColor,
    hideDialogItem,
    onRowTouchStart, onRowTouchMove, onRowTouchEnd, onRowTouchCancel,
    openHideDialog, confirmHideDialog, cancelHideDialog,
    resetSwipe, consumeClick,
  }
}
