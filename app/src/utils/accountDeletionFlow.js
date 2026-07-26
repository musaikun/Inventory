// アカウント削除フローの純粋ロジック（DeleteAccountModal から切り出してテスト可能にする）。
// - resolveRequestId: requestId を店舗にスコープして再利用/再生成する（越境replay誤認の防止）
// - mapDeletionError: DELETE /auth/account のエラーを UI 状態へ写像する

// backend と同じ UUID 形式（v1-8・variant 8-b）。保存値が壊れ/改変で非UUIDになった場合に
// そのまま送ると backend が 400 を返し、ユーザーが直せないデッドロックになるため検証する。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// 保存済みレコード（{ shop, id }）から、この店舗で使う requestId を決める。
// 別店舗のレコード・壊れた値・非UUIDの id は破棄し、genId() で新規生成する。
//
// 背景（Blocker）: requestId を店舗非依存の単一キーで保持すると、A店で削除成功したが
// 応答を失い receipt が7日残った状態で B店にログインし直した場合、B店の削除で A店の
// requestId を再送してしまう。backend は認証前に receipt を冪等判定するため、B店を
// 削除せず 200 alreadyDeleted を返し、UI が「B店削除成功」と誤認してローカルだけ消す。
// 店舗スコープにすることで、別店舗では必ず新しい requestId を使い、この誤認を防ぐ。
export function resolveRequestId(rawStored, shop, genId) {
  try {
    const saved = rawStored ? JSON.parse(rawStored) : null
    if (saved && saved.shop === shop && typeof saved.id === 'string' && UUID_RE.test(saved.id)) {
      return { id: saved.id, record: rawStored }
    }
  } catch (_) { /* 壊れた値は破棄して再生成 */ }
  const id = genId()
  return { id, record: JSON.stringify({ shop, id }) }
}

// DELETE /auth/account のエラー（api.js が err.status / err.code を付与）を UI 状態へ写像する。
// phase='form': 入力画面へ戻す軽微なエラー / phase='error': 再試行可能な失敗画面。
// keepId=true: close 時も requestId を保持し、同じ ID で再開/再試行できるようにする。
export function mapDeletionError(err) {
  const status = err?.status
  const code = err?.code
  if (status === 400 && code === 'confirmation_mismatch') {
    return { phase: 'form', message: '店舗コードが一致しません', resetConfirm: true }
  }
  if (status === 400) {
    return { phase: 'form', message: '入力内容を確認してください' }
  }
  if (status === 401) {
    return { phase: 'form', message: 'PIN またはログイン状態を確認してください', resetPin: true }
  }
  if (status === 429) {
    return {
      phase: 'error', retryable: false, keepId: true,
      message: 'PIN の入力回数が多すぎます。15分ほど待ってから、もう一度お試しください。',
    }
  }
  if (status === 409) {
    return {
      phase: 'error', retryable: false, keepId: true,
      message: '別の削除処理が進行中です。しばらくしてから、もう一度この画面を開いてください。',
    }
  }
  if (status === 503) {
    return {
      phase: 'error', retryable: true, keepId: true,
      message: '一時的に削除できませんでした。通信環境を確認して、もう一度お試しください。',
    }
  }
  // status なし（通信失敗など）: token を消さず同じ requestId で再試行できる
  return {
    phase: 'error', retryable: true, keepId: true,
    message: '通信に失敗しました。電波の良い場所で、もう一度お試しください。',
  }
}
