/**
 * 再ログイン直後の再開順序（DATA-001 / App第2セッション §6）
 *
 * ## 直す壊れ方
 *
 * `clearAuthBlock()` は再送を開始するだけで完了を待たず、`onAuthDone()` はその直後に
 * `config` / `history` / `inventory` をリモートから読み込んでローカルへ反映していた。
 *
 * 同じ店舗へ再ログインした直後の端末には、**サーバーより新しい未送信の版**が残っている
 * （401 の原因になった保存そのもの）。先にリモートを読むと、その古い内容でローカルを
 * 上書きし、送るべき差分ごと消える。未送信キューには残っていても、送る中身が
 * 上書き済みになるため、結果として訂正が黙って無かったことになる。
 *
 * ## 契約
 *
 * 1. まず drain（未送信の再送）を**完了まで待つ**
 * 2. 送り切れたときだけ pull する
 * 3. 送り切れなければ pull しない。未送信はキューに残し、再送導線とバナーを保つ
 *
 * App がこの順序を直接書くと mount しないと検証できないため、順序だけをここへ出す。
 */

/**
 * @param {object}   arg
 * @param {Function} arg.drain   未送信の再送。`{ drained, pending }` を返す Promise
 * @param {Function} arg.pull    リモート反映（drain 成功時だけ呼ばれる）
 * @param {Function} [arg.onPendingLeft] 送り切れなかったときの通知（件数を受ける）
 * @returns {Promise<{ pulled: boolean, pending: number }>}
 */
export async function resumeAfterLogin({ drain, pull, onPendingLeft } = {}) {
  const result = (await drain?.()) ?? null
  // drained が明示的に false のときだけ止める。未対応の戻り値（旧実装・undefined）は
  // 従来どおり pull する（再ログインでリモートを一度も読まない方が壊れ方は大きい）。
  if (result && result.drained === false) {
    const pending = Number(result.pending) || 0
    onPendingLeft?.(pending)
    return { pulled: false, pending }
  }
  await pull?.()
  return { pulled: true, pending: 0 }
}
