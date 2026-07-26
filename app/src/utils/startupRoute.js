// 起動時の URL から初期ビューを決める純粋ロジック（App.vue の onMounted から使う）。
// 公開Web削除リソース（Play Console の Data deletion URL）は、未インストール・未ログインでも
// 到達できる必要があるため、room / store / セッション復元より先に判定する。

// 公開削除ページを開くべき URL か。`?delete-account`（値なし）を受け付ける。
export function isDeleteAccountRoute(search) {
  try {
    return new URLSearchParams(search ?? '').has('delete-account')
  } catch (_) {
    return false
  }
}
