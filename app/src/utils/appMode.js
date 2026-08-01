// アプリ版（Play Store の TWA）として動作しているかを判定する。
//
// TWA = Trusted Web Activity。中身は Web だが Android アプリの殻で動く。
// Google Play の課金ポリシー対策として、アプリ版では価格表示・外部決済導線を
// 出さず「無料機能＋店舗コードを持つユーザーのログイン入口」に振る舞いを切り替える。
//
// 判定方法（いずれか満たせば TWA とみなし、以後 localStorage に永続化）:
//   1. document.referrer が android-app:// で始まる（TWA 起動時の特徴）
//   2. 起動URLに ?twa=1 マーカー（TWA ビルド側の start_url に仕込む）
//   3. 過去に 1/2 で検知済み（リファラーは初回起動時しか入らないため永続化）

const TWA_KEY = 'tanaoro_is_twa'

function _detect() {
  if (typeof window === 'undefined') return false

  try {
    if (localStorage.getItem(TWA_KEY) === '1') return true
  } catch (_) {}

  let isTwa = false

  if (typeof document !== 'undefined' && document.referrer.startsWith('android-app://')) {
    isTwa = true
  }

  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('twa') === '1') isTwa = true
  } catch (_) {}

  if (isTwa) {
    try { localStorage.setItem(TWA_KEY, '1') } catch (_) {}
  }
  return isTwa
}

let _cached = null

export function isTwaApp() {
  if (_cached === null) _cached = _detect()
  return _cached
}
