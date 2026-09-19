import { ref, computed } from 'vue'

/**
 * 時間のかかる処理のあいだ「待っていればいい」と分かる表示を出す。
 *
 * 置き場所を1つにする理由: 取込・書き出し・読み込みは導線が何本もあり（データ管理／
 * 入出庫／設定）、画面ごとに旗を立てると、ある経路だけ無反応のまま残る。実際に
 * 「押したのに何も起きない」ように見えていた箇所が複数あった。
 *
 * ## 2つの出し方
 *
 * **既定（遅れて出す）**: 先に処理を始め、`SHOW_AFTER_MS` を過ぎてもまだ終わらない
 * ときだけ出す。速い処理で一瞬ちらつくのを防ぐ（Userの依頼も「時間がかかる場合に」）。
 * 通信やファイル読み込みなど、待っている間にブラウザが動ける処理はこちら。
 *
 * **`paintFirst`（先に描いてから始める）**: CSVの組み立てのような**同期処理**は、
 * 旗を立てただけでは画面が更新されないまま走り切ってしまう（main threadを占有するので
 * 遅延表示のタイマーも動かない）。先に出して2フレーム待ち、確実に描かれてから始める。
 */

// 遅延表示のしきい値。これより速く終わる処理では何も出さない
const SHOW_AFTER_MS = 180
// 一度出したらこれだけは出したままにする（出てすぐ消えるのは、ちらつきとして目に残る）
const MIN_VISIBLE_MS = 320

// いま出しているラベルの積み。入れ子でも外側のラベルを失わない
const _stack = ref([])

/** 画面に出す文言。空なら出さない。積みの一番上（最後に始めた処理）を出す */
export const busyLabel = computed(() => _stack.value[_stack.value.length - 1]?.label ?? '')
export const isBusy = computed(() => _stack.value.length > 0)

const _now = () => (typeof performance === 'object' ? performance.now() : Date.now())
const _sleep = ms => new Promise(r => setTimeout(r, ms))

// 「描かれた」と言えるまで待つ。1フレームでは、Vueのpatchが載る前に
// 呼び出し側の同期処理が始まってしまうことがある。
function _nextPaint() {
  if (typeof requestAnimationFrame !== 'function') return _sleep(32)
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
}

let _seq = 0
function _show(label) {
  const token = ++_seq
  _stack.value = [..._stack.value, { token, label }]
  return token
}
function _hide(token) {
  _stack.value = _stack.value.filter(x => x.token !== token)
}

/**
 * 時間のかかる処理を包む。成否にかかわらず必ず表示を片付ける。
 *
 * @param {string}   label 出す文言（例: '取り込み中…'）
 * @param {Function} fn    実際の処理。async でも同期でもよい
 * @param {object}   [opts]
 * @param {boolean}  [opts.paintFirst] 同期処理のとき true。先に描いてから始める
 * @returns fn の戻り値
 */
export async function runBusy(label, fn, { paintFirst = false } = {}) {
  let token = null
  let shownAt = 0

  const reveal = () => {
    if (token != null) return
    token = _show(label)
    shownAt = _now()
  }

  let timer = null
  if (paintFirst) {
    reveal()
    await _nextPaint()
  } else {
    timer = setTimeout(reveal, SHOW_AFTER_MS)
  }

  try {
    return await fn()
  } finally {
    clearTimeout(timer)
    if (token != null) {
      // 出した直後に消さない。残り時間だけ出したままにする
      const visible = _now() - shownAt
      if (visible < MIN_VISIBLE_MS) await _sleep(MIN_VISIBLE_MS - visible)
      _hide(token)
    }
  }
}

/**
 * 「重い」と判断する目安の件数。
 *
 * 同期処理は `paintFirst` が要るが、これを常に付けると小さい取込にも最低表示時間の
 * 足止めが入る（20件の取込で0.3秒待たされるのは損）。件数で分ける。
 * 下回る場合は遅延表示のまま渡す＝同期処理なら表示は出ないまま一瞬で終わる。
 */
export const HEAVY_ROWS = 200

/** testや画面遷移の後始末用。出しているものを全部畳む */
export function clearBusy() { _stack.value = [] }
