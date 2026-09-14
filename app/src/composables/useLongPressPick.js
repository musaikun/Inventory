import { ref } from 'vue'

/**
 * 行を長押しして「この品目をどの分類先へ入れるか」を開く操作。
 *
 * 振り分けは既定で「分類先を固定して品目を連打する」向きになっている。同じ分類先が
 * 続く限りはそれが最速だが、分類先がばらばらな品目が続くとホイールを回し直す往復が
 * 毎回入る。長押しはその往復を消すための逆向きの入口で、置き換えではない。
 *
 * ドラッグにしないのは速さのため。掴む→運ぶ→狙う→離す は接触時間が長く、
 * タップ2回より遅い。長押しは「発火」だけ拾えば済むので、指を離した後は
 * ただのタップになる。
 *
 * 一覧は縦スクロール（touch-action: pan-y）を browser 側が持っている。ジェスチャが
 * 始まってから touch-action を変えても取り返せないため、スクロールや横スワイプと
 * competition しない形にする。＝ 動いたら長押しを降ろして、相手に譲る。
 *
 * @param {object}   opts
 * @param {Function} opts.enabled 操作を受け付けるか（ゲスト・読み取り専用は false）
 * @param {Function} opts.onPick  長押しが成立したとき呼ぶ（品目名, 押した行の要素）
 */

// iOS の既定は 500ms、Android は 400ms 前後。ここはそれより短くする。
// 誤発火してもシートが出るだけで何も壊れないので、待ち時間のほうが損になる。
export const LONG_PRESS_MS = 250
// これ以上動いたらスクロール／横スワイプの意図とみなして降りる
export const LONG_PRESS_SLOP = 8
// 長押しで開いた直後は、指を離した後の click（ghost click）が
// シートの上へ降ってくる。開いた瞬間の1発だけ食べる。
const GUARD_MS = 400

export function useLongPressPick({ enabled = () => true, onPick } = {}) {
  const pressing = ref('')        // 長押し判定中の品目名（押されている実感を行に出す）
  let _timer = null, _sx = 0, _sy = 0, _row = null, _item = ''
  let _fired = false, _guardUntil = 0

  const now = () => (typeof performance === 'object' ? performance.now() : Date.now())

  function _clear() {
    clearTimeout(_timer)
    _timer = null
    _row = null
    _item = ''
    pressing.value = ''
  }

  /** 長押しを降ろす（スクロール・横スワイプ・画面遷移に譲る） */
  function cancelLongPress() {
    if (!_timer && !pressing.value) return
    _clear()
  }

  function onRowPressStart(e, item, row) {
    _fired = false
    cancelLongPress()
    if (!enabled()) return
    const t = e.changedTouches?.[0]
    if (!t) return
    _sx = t.clientX; _sy = t.clientY
    _item = item
    _row = row ?? e.currentTarget ?? null
    pressing.value = item
    _timer = setTimeout(() => {
      const target = _row, name = _item
      _clear()
      if (!name) return
      _fired = true
      _guardUntil = now() + GUARD_MS
      onPick?.(name, target)
    }, LONG_PRESS_MS)
  }

  function onRowPressMove(e) {
    if (!_timer) return
    const t = e.changedTouches?.[0]
    if (!t) return
    if (Math.abs(t.clientX - _sx) > LONG_PRESS_SLOP || Math.abs(t.clientY - _sy) > LONG_PRESS_SLOP) {
      cancelLongPress()
    }
  }

  function onRowPressEnd() {
    // 成立していれば、指を離した時刻から guard を測り直す。押している時間は人によって
    // 違うので、開いた時刻を基準にすると長く押した人だけ ghost click を食べ損ねる。
    if (_fired) _guardUntil = now() + GUARD_MS
    cancelLongPress()
  }

  /** 長押しが成立した直後の click か。行の click ハンドラの先頭で見る */
  function consumeLongPress() {
    if (!_fired) return false
    _fired = false
    return true
  }

  /** 開いた直後に降ってくる click を無視する窓の中か */
  function pickGuarded() { return now() < _guardUntil }

  return {
    pressing,
    onRowPressStart, onRowPressMove, onRowPressEnd,
    cancelLongPress, consumeLongPress, pickGuarded,
  }
}
