/**
 * 完了した棚卸の結果を、アプリの見た目のまま他の人へ見せるための共有リンク。
 *
 * CSV / Excel で渡すと、受け取った側は別のアプリで開くことになり、
 * 分類・フラグ・入力者といった画面上の情報が落ちる。ここで作るのは
 * **アプリの品目一覧（InventoryTable）をそのまま開くURL**。
 *
 * URL の形はライブ招待リンクと同じ `?store=CODE&s=<sessionId>`。
 * App.vue の `_enterStoreLink` が入口を振り分けるが、参加へ回るのは
 * **`status.isActive` かつ `status.sessionId` がリンクの sessionId と一致する**ときだけで、
 * それ以外は結果表示になる。ここで配るのは完了済みセッションのIDなので、
 * 同じ店舗で次の棚卸が始まってもこのリンクは結果のままで、ルームには入れない
 * （完了したセッションを再開する導線も無い。一覧の「再開する」は進行中のみ）。
 * **店舗コードだけを鍵にしない**のはこのため。判定を「ライブなら参加」へ緩めると、
 * 結果を渡した相手が次回のルームへ入れるようになる。
 *
 * 見えるもの / 見えないもの:
 *   見える … 品目・数量・単位・分類・コード・フラグ・参加者別・変更履歴
 *   見えない … **単価・小計・在庫金額**（Worker の _sanitizeForGuest が落とす）
 * リンクを知っている人は誰でも開けるので、金額を出さない前提は変えない。
 */

/**
 * ゲストが結果を閲覧できる日数。
 * **Worker の `RESULT_WINDOW_DAYS`（worker/src/constants.js）と一致させること。**
 * ここはあくまで画面に残り日数を出すための表示用で、実際の可否はサーバーが決める。
 */
export const RESULT_WINDOW_DAYS = 3

/** 完了時刻（ms）。savedAt 優先、無ければ棚卸日の0時。Worker の _snapTs と同じ規則。 */
export function completedAtMs(snapshot) {
  const raw = snapshot?.savedAt ? new Date(snapshot.savedAt).getTime()
            : snapshot?.date    ? new Date(`${snapshot.date}T00:00:00`).getTime()
            : NaN
  return Number.isFinite(raw) ? raw : null
}

/**
 * 共有リンクを組み立てる。店舗コードかセッションIDが無ければ空文字。
 * @param {string} shopCode
 * @param {string} sessionId
 * @param {{ origin?: string, pathname?: string }} [loc] テスト用の差し替え
 */
export function buildResultUrl(shopCode, sessionId, loc = null) {
  if (!shopCode || !sessionId) return ''
  const origin   = loc?.origin   ?? (typeof window !== 'undefined' ? window.location.origin   : '')
  const pathname = loc?.pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '')
  if (!origin) return ''
  const base = origin + String(pathname).replace(/\/$/, '')
  return `${base}?store=${encodeURIComponent(shopCode)}&s=${encodeURIComponent(sessionId)}`
}

/** 閲覧できる残り日数。期限切れなら 0、判定できなければ null。 */
export function viewDaysRemaining(snapshot, now = Date.now()) {
  const ts = completedAtMs(snapshot)
  if (ts == null) return null
  const remaining = RESULT_WINDOW_DAYS * 86400_000 - (now - ts)
  return remaining <= 0 ? 0 : Math.ceil(remaining / 86400_000)
}

/** リンクに添える案内文。何が見えて何が見えないかを、渡す相手にも分かる形で書く。 */
export function resultShareText(snapshot) {
  const date = snapshot?.date ? String(snapshot.date).replace(/-/g, '/') : ''
  const days = viewDaysRemaining(snapshot)
  const head = date ? `${date} の棚卸結果です。` : '棚卸結果です。'
  const tail = days ? `（閲覧できるのはあと${days}日です）` : ''
  return `${head}下記リンクから確認できます。${tail}`
}
