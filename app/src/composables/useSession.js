import { ref, computed, watch } from 'vue'
import { isAuthenticated, updateSession, completeSession as completeSessionApi, getSessions } from './useAuth.js'
import { shopCode } from './useStore.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

// ── セッションライフサイクル集約（モジュールスコープ シングルトン）─────────────
// D1 sessions テーブルの状態（active / incomplete / completed）への書き込みを
// この1ファイルに集約し、直列化することで「active が completed を上書きする」
// 類の競合を構造的に排除する。
//
// 不変条件:
//   - pendingSession = 現在の D1 セッション { id, shopCode, startedAt, status, itemCount }
//   - touch() は active の保存（デバウンス）。確定後（_finalized）は無視される
//   - markActive() は active の即時保存（保留 touch をキャンセル）
//   - complete() は完了確定。保留中の touch を必ずキャンセルする
//   - begin()/resume()/markActive()/clear() で _finalized をリセット
//
// **completed への遷移は `POST /sessions/:id/complete` だけが行う。**
// 汎用 PUT で completed にすると `inventory_lines` も `store_history` も持たない
// 完了セッションを作れるため、server は `409 use_complete_endpoint` で塞いでいる
// （DATA-002 §状態遷移）。ここから updateSession(id,'completed') を呼ぶ経路は無い。

const pendingSession = ref(null)
let _touchTimer = null
let _finalized  = false   // 確定状態(completed/incomplete)を書いたら true → touch を無視

/**
 * 実行中の完了要求（sessionId 単位で1本）。
 *
 * 完了は3か所から起こる — 完了ボタン、完了済みセッションでホームへ戻る、
 * ホストからの session_ended 受信。これらが重なると同じセッションへ完了APIが
 * 複数本走り、片方の失敗でもう片方の成功が上書きされたり、後片付けが二重に走る。
 * 同じセッションへの2つ目以降は**実行中の1本に合流させる**。
 */
let _completing = null    // { id, promise }
export const isCompleting = ref(false)

/**
 * 完了要求の結果が確認できていない（応答が返らなかった・5xx・通信断）。
 *
 * このとき**サーバー側が完了しているかどうか分からない**。ここで `active` を書き戻すと、
 * サーバーで確定した completed を後から active へ巻き戻し、明細と履歴を持ったまま
 * 「進行中」に見えるセッションを作る。結果が確定するまで active は書かない。
 *
 * 解除されるのは
 *   - 同じ完了要求の再試行が成功したとき
 *   - サーバーの状態を読み直して確定できたとき（verifyCompletion）
 *   - セッションを開始・再開・破棄したとき
 * だけ。
 */
export const completionUnknown = ref(false)

/** 完了処理中、または結果が不明。競合する操作（ホーム・戻る・切替・破棄）を止める */
export const completionBusy = computed(() => isCompleting.value || completionUnknown.value)

/**
 * 結果が確認できていない完了要求。**端末へ永続化する。**
 *
 * メモリだけに置くと、応答喪失のあとに再読込した端末は「ただの進行中セッション」として
 * 復帰する。そこから完了し直すと body が組み立て直され（`auditLog` が1件増えているだけでも）、
 * server の fingerprint と一致せず `409 completion_intent_conflict` で
 * **二度と確定できない**。結果不明と送信済み body をセットで残し、復帰後は同じ body を送る。
 *
 * 形: `{ sessionId, shopCode, type, body }`
 */
let _intent = null

/** durable intent の schema version。形を変えたら上げる（読めない版は捨てる） */
const INTENT_VERSION = 1

/** intent の段階。'sending' = 送信したが結果不明 / 'confirmed' = server は受理済み */
const PHASE_SENDING   = 'sending'
const PHASE_CONFIRMED = 'confirmed'

/**
 * セッションライフサイクルの世代。**アカウント切替でもセッション開始/再開でも増やす。**
 *
 * 完了要求は世代・店舗・sessionId を**送信開始時に捕まえ**、応答を適用する直前に
 * 突き合わせる。`_completing` の参照を消しても実行中の Promise は止まらないため、
 * 旧アカウントの応答が後から返って現在の pendingSession を completed にし、
 * 呼び出し側が旧 snapshot を現在の履歴へ確定して現在の draft を消す経路があった。
 *
 * アカウント世代だけでは足りない。**同一店舗・同一 sessionId で resume すると
 * 店舗も sessionId も一致してしまい**、前のライフサイクルの応答が新しい方へ適用される
 * （中断→再開を挟んだ完了要求が、再開後の画面を確定させてしまう）。
 * `begin()` / `resume()` / `clear()` でも進める。
 */
let _lifecycleGeneration = 0

/**
 * intent を端末へ書く。**書けたかどうかを返す。**
 *
 * `body` を落とした marker へ切り下げない。marker だけを残して送信すると、
 * 送った内容が端末のどこにも無い状態で「結果不明」だけが残り、再送は
 * 組み立て直しになって `409 completion_intent_conflict` へ落ちる。
 * 書けないなら**そもそも送らない**（呼び出し側が完了APIを呼ばない）。
 */
function _writeIntent(intent) {
  try {
    localStorage.setItem(STORAGE_KEYS.completionIntent, JSON.stringify(intent))
    _intent = intent
    return true
  } catch (e) {
    console.error('[useSession] completion intent not persisted:', e?.name ?? e)
    return false
  }
}

function _clearIntent() {
  _intent = null
  try { localStorage.removeItem(STORAGE_KEYS.completionIntent) } catch (_) {}
}

// リロード復帰用に localStorage へ永続化（ID の変化＝再代入時のみ）
watch(pendingSession, (s) => {
  if (s?.id) localStorage.setItem(STORAGE_KEYS.pendingSession, JSON.stringify(s))
  else       localStorage.removeItem(STORAGE_KEYS.pendingSession)
})

function _canWrite() {
  return isAuthenticated.value && !!pendingSession.value?.id
}

// アカウント切替時のローカル全消去（進行中セッション）。watch が localStorage も消す。
// 世代を進めることで、実行中の完了要求の応答が新しいアカウントへ適用されなくなる。
export function resetLocalData() {
  _lifecycleGeneration++     // 旧アカウントの実行中要求を失効させる
  _cancelTouch()
  _finalized = false
  _completing = null
  isCompleting.value = false
  completionUnknown.value = false
  _clearIntent()
  pendingSession.value = null
}

function _cancelTouch() {
  clearTimeout(_touchTimer)
  _touchTimer = null
}

/**
 * 非同期処理の身元。**logical request を作った時点**で捕まえる。
 *
 * `complete()` だけでなく `verifyCompletion()` / `markActive()` / `touch()` の遅延送信も
 * 同じものを使う。await の間にアカウントやセッションが変わると、旧店舗の応答が
 * 現在の `pendingSession` へ適用され、App 側の後片付け（履歴確定・draft削除・遷移）まで
 * 現在のアカウントに対して走ってしまう。
 */
function _captureOrigin() {
  return {
    generation: _lifecycleGeneration,
    shop:       shopCode.value,
    sessionId:  pendingSession.value?.id ?? null,
  }
}

/** await 後に状態を変える直前へ必ず置く。true なら**一切変更しない** */
function _isStale(origin) {
  return origin.generation !== _lifecycleGeneration
      || origin.shop       !== shopCode.value
      || origin.sessionId  !== (pendingSession.value?.id ?? null)
}

/**
 * 呼び出し側（App）が await をまたいで同じ基準で再確認するための token。
 *
 * 完了APIの応答だけでなく、**ルーム解散や退出処理の await のあと**にも
 * 「いまも同じアカウント・同じセッションか」を確かめる必要がある。
 */
export function captureLifecycle() { return _captureOrigin() }

/** `captureLifecycle()` で取った token が失効しているか */
export function isLifecycleStale(token) { return !token || _isStale(token) }

/** stale で返す統一の結果 */
function _staleResult(origin, where) {
  console.warn(`[useSession] ${where}: discarding a stale account/session result:`, origin.sessionId)
  return { ok: false, stale: true, reason: 'stale', retryable: false, unknown: false }
}

export function useSession() {
  // 新規セッション開始（SessionListPage で createSession 済みのオブジェクトを受け取る）
  function begin(session) {
    _startFresh(session)
    pendingSession.value = session
  }

  // 中断セッションの再開
  function resume(session) {
    _startFresh(session)
    pendingSession.value = session
  }

  /**
   * 新しいセッションへ移るときの初期化。
   *
   * **実行中の完了要求への合流も断つ。** `_completing` を残したまま同じ id の
   * セッションを開き直すと、前のライフサイクルの（stale になった）要求へ合流し、
   * 決着しない Promise を待ち続ける。実行中の要求自体は origin 照合で失効する。
   *
   * ただし **未確定の完了要求（durable intent）は、同じ店舗・同じ session なら残す**。
   * 旧応答を stale として捨てるのは正しいが、そこで再送に必要な body まで失うと、
   * 「サーバーだけ completed・端末は active」へ戻る手段が無くなる（再レビュー2 §2）。
   * 残している間は `completionUnknown` を立て、確認・同一 body の再送が済むまで
   * active を書かせない。
   *
   * @param {object|null} next これから開くセッション（未指定なら intent を捨てる）
   */
  function _startFresh(next = null) {
    // 前のライフサイクルの実行中要求を失効させる（同じ sessionId で開き直しても）
    _lifecycleGeneration++
    _cancelTouch()
    _finalized = false
    _completing = null
    isCompleting.value = false

    const keep = !!_intent?.body
      && !!next?.id
      && _intent.sessionId === next.id
      && (!_intent.shopCode || !shopCode.value || _intent.shopCode === shopCode.value)
    if (keep) {
      completionUnknown.value = true
      return
    }
    completionUnknown.value = false
    _clearIntent()
  }

  /**
   * リロード後に localStorage から復帰。
   *
   * 進行中セッションだけでなく、**結果が確認できていない完了要求も復帰させる**。
   * ここで拾わないと、応答喪失後の端末は「ただの進行中セッション」として戻り、
   * `markActive()` が active を書き、再完了は別 body になって 409 で確定できなくなる。
   * 別店舗のぶんは復帰させない（アカウント境界）。
   */
  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.pendingSession)
      if (raw) pendingSession.value = JSON.parse(raw)
    } catch (_) {}

    try {
      const raw = localStorage.getItem(STORAGE_KEYS.completionIntent)
      const saved = raw ? JSON.parse(raw) : null
      const sameShop    = !saved?.shopCode || !shopCode.value || saved.shopCode === shopCode.value
      const sameSession = !!saved?.sessionId && saved.sessionId === pendingSession.value?.id
      if (saved && sameShop && sameSession) {
        _intent = saved
        completionUnknown.value = true
      } else if (saved) {
        _clearIntent()
      }
    } catch (_) {}

    return pendingSession.value
  }

  /**
   * 結果不明のまま残っている完了要求（再送用）。
   * `services/sessionCompletion.js` の戻り値と同じ形へ戻す。
   */
  function pendingCompletionIntent() {
    if (!_intent?.body) return null
    if (_intent.sessionId !== pendingSession.value?.id) return null
    return {
      ok: true,
      type: _intent.type,
      body: _intent.body,
      snapshot: _intent.body.snapshot ?? null,
    }
  }

  // 入力中の品目数を active として保存（デバウンス・確定後は無視）
  function touch(count) {
    if (!_canWrite() || _finalized || completionBusy.value) return
    _cancelTouch()
    // 発火は2秒後。その間にアカウント・セッションが変わっていたら送らない
    const origin = _captureOrigin()
    _touchTimer = setTimeout(() => {
      if (_isStale(origin) || !_canWrite() || _finalized || completionBusy.value) return
      updateSession(origin.sessionId, 'active', count).catch(() => {})
      if (pendingSession.value) pendingSession.value.itemCount = count
    }, 2000)
  }

  /**
   * active を即時保存（一覧へ戻る前のフラッシュ・中断再開時など）。保留 touch はキャンセル。
   *
   * **完了中・結果不明中・完了済みには書かない。** 完了要求の送信中にホームを押すと、
   * 以前はここが `status:'active'` を送っていた。完了APIより後に届けば、サーバー側で
   * 確定した completed が active へ巻き戻る（明細と履歴はあるのに進行中に見える）。
   * 応答が返らなかった場合も同じで、サーバーの状態が分からない以上 active は書けない。
   *
   * @returns {Promise<{ ok: boolean, reason?: string }>}
   */
  async function markActive(count) {
    if (isCompleting.value)      return { ok: false, reason: 'completing' }
    if (completionUnknown.value) return { ok: false, reason: 'completion_unknown' }
    // 完了済みセッションを端末から active へ戻す経路は残さない
    if (pendingSession.value?.status === 'completed') return { ok: false, reason: 'completed' }
    _cancelTouch()
    _finalized = false
    if (!_canWrite()) return { ok: false, reason: 'offline' }
    const origin = _captureOrigin()

    // **失敗を握り潰さない。** 以前は `.catch(() => {})` のあとで無条件に
    // `status = 'active'` を書いていた。server が `409 session_completed` を返しても
    // 端末は「進行中」と信じ続け、完了済みの詳細へ到達できなくなる。
    try {
      await updateSession(origin.sessionId, 'active', count)
    } catch (err) {
      // 応答が返るまでにアカウント・セッションが変わっていたら、いまの状態へ適用しない
      if (_isStale(origin)) return _staleResult(origin, 'markActive')
      console.error('[useSession] markActive failed:', origin.sessionId, err?.code ?? err?.message ?? err)
      // server 側は既に完了している。端末の表示をそれへ合わせる
      if (err?.status === 409 && err?.code === 'session_completed') {
        _finalized = true
        if (pendingSession.value) pendingSession.value.status = 'completed'
        return { ok: false, reason: 'session_completed' }
      }
      return { ok: false, reason: 'save_failed', retryable: true }
    }
    if (_isStale(origin)) return _staleResult(origin, 'markActive')
    if (pendingSession.value) pendingSession.value.status = 'active'
    return { ok: true }
  }

  /**
   * 完了結果が不明なとき、サーバーの状態を読み直して確定させる。
   *
   * 応答を取りこぼしただけでサーバーは完了しているかもしれない。読めた場合だけ
   * 不明状態を解除する（読めなければ不明のまま＝ active も書かない）。
   *
   * @returns {Promise<{ ok: boolean, completed?: boolean, reason?: string }>}
   */
  async function verifyCompletion() {
    const origin = _captureOrigin()
    if (!origin.sessionId) return { ok: false, reason: 'no_session' }
    if (!isAuthenticated.value) return { ok: false, reason: 'offline' }
    let list = null
    try {
      list = await getSessions()
    } catch (err) {
      if (_isStale(origin)) return _staleResult(origin, 'verifyCompletion')
      console.error('[useSession] verifyCompletion failed:', origin.sessionId, err?.message ?? err)
      // 状態を読めていない。**intent も結果不明も保持する**（消すと再送用の body を失う）
      return { ok: false, reason: 'unreachable' }
    }
    // 応答が返るまでにアカウント・セッションが変わっていたら、いまの状態へ適用しない
    if (_isStale(origin)) return _staleResult(origin, 'verifyCompletion')

    const found = Array.isArray(list) ? list.find(s => s?.id === origin.sessionId) : null
    if (!found) return { ok: false, reason: 'not_found' }
    const completed = found.status === 'completed'
    _finalized = completed
    if (pendingSession.value) pendingSession.value.status = found.status

    // **intent を消さない。`completionUnknown` も下ろさない。**
    // サーバーが completed でも、端末側の確定（履歴 commit・draft削除・遷移）はまだ。
    // ここで消すと、呼び出し側は保存済み body を失って現在の在庫から組み立て直し、
    // 内容が変わっていれば `409 completion_intent_conflict` で確定できなくなる。
    // 解除は `ackCompletionFinalized()` だけが行う。
    return { ok: true, completed }
  }

  /**
   * 端末側の確定（履歴 commit・draft削除・遷移）まで終わったことを App が知らせる。
   * **ここでだけ** durable intent を捨て、結果不明を解除する。
   *
   * 「API 成功」と「端末側の確定完了」を同一に扱わないための境界。API 成功直後に
   * 端末が落ちても、intent が残っているので再開できる。
   *
   * @param {string} sessionId 確定した session（別 session の ack では消さない）
   * @returns {boolean} 消したか
   */
  function ackCompletionFinalized(sessionId) {
    if (!_intent) { completionUnknown.value = false; return false }
    if (sessionId && _intent.sessionId !== sessionId) return false
    _clearIntent()
    completionUnknown.value = false
    return true
  }

  // 完了確定（保留 touch をキャンセルし、以降の active 書き込みを封じる）
  /**
   * 完了確定。明細・完了状態・スナップショットはサーバー側で1トランザクションとして
   * 書かれる（DATA-001）。
   *
   * **`request` は services/sessionCompletion.js が組み立てたものをそのまま送る。**
   * 失敗しても `updateSession(id, 'completed')` へフォールバックしない。かつては
   * そうしていたが、それは「明細の保存に失敗したのに、セッションだけ完了として残す」
   * という DATA-001 そのものの状態をクライアント側から作る動きだった。現在は server も
   * 汎用 PUT での完了を `409 use_complete_endpoint` で塞いでいる。
   *
   * **再試行は同じ body をそのまま送る。** server は canonical snapshot 全体から
   * fingerprint を作り、内容が1つでも違う再送を `409 completion_intent_conflict` で
   * 拒否する（除外は `savedAt` と `activeMs` だけ）。組み立て直した body で再送すると、
   * `auditLog` などが増えているだけで同じ session を確定できなくなる。
   *
   * 完了ボタン・ホームへ戻る・session_ended が重なっても、同じセッションへの
   * 完了要求は1本に束ねる（実行中のものへ合流する）。
   *
   * @param {object} request `{ type, body, snapshot }`（sessionCompletion.js の戻り値）
   * @returns {Promise<{ ok: boolean, reason?, retryable?, unknown?, conflict?, result? }>}
   */
  function complete(request = null) {
    const id = pendingSession.value?.id
    // 実行中の1本へ合流する。二重押し・二重経路でも完了要求は増やさない。
    if (_completing && _completing.id === id) return _completing.promise

    const promise = _complete(request).finally(() => {
      if (_completing?.promise === promise) { _completing = null; isCompleting.value = false }
    })
    _completing = { id, promise }
    isCompleting.value = true
    return promise
  }

  /**
   * サーバーが完了を受け付けていないと**断定できる**失敗か。
   *
   * 4xx（429を除く）は「サーバーが内容を見て拒否した」なので、サーバーの状態が分かる。
   * 通信断・5xx・応答なしは分からない＝結果不明として扱う。
   */
  function _isDefiniteFailure(err) {
    const s = err?.status
    return typeof s === 'number' && s >= 400 && s < 500 && s !== 429
  }

  /**
   * @param detail 失敗の技術的な内訳。**画面へ短く出す**ためのもの。
   *   スマホ（とくにPWA）では DevTools を開けず、原因が「通信」なのか
   *   「サーバーが 503 を返した」なのか利用者からは区別できない。
   *   同じ文言のまま押し直すしかない状況を作らないよう、判断材料を持って返す。
   */
  function _fail(reason, { unknown, retryable = true, conflict = false, detail = null } = {}) {
    _finalized = false
    completionUnknown.value = !!unknown
    return { ok: false, reason, retryable, unknown: !!unknown, conflict, detail }
  }

  /** 画面へ出す失敗の内訳（HTTPステータス / サーバーのコード / 通信断） */
  function _failureDetail(err) {
    const status = err?.status
    if (typeof status === 'number') {
      const head = err?.code ? `HTTP ${status} / ${err.code}` : `HTTP ${status}`
      // 検証環境の Worker は原因の要約を `detail` に載せて返す（本番は載せない）
      return err?.body?.detail ? `${head} — ${err.body.detail}` : head
    }
    // status を持たない = fetch 自体が失敗（通信断・CORS・中断）
    return `通信エラー: ${err?.message ?? 'unknown'}`
  }

  async function _complete(request) {
    _cancelTouch()
    _finalized = true
    // 未ログイン・セッション未確立。サーバーに書くものが無いので、ローカルの完了は成立する
    if (!_canWrite()) { completionUnknown.value = false; return { ok: true, reason: 'offline' } }
    const id = pendingSession.value.id

    // 組み立てに失敗した要求で API を呼ばない（呼び出し側が事前に弾く前提の防御）。
    if (!request?.body) {
      console.error('[useSession] complete called without a request body:', id)
      return _fail('no_payload', { unknown: false, retryable: false })
    }

    // 送信開始時の身元を捕まえる。応答を適用する直前に突き合わせ、
    // 別アカウント・別セッションへ結果を書かない。
    const origin = _captureOrigin()

    // **ネットワークへ出す前に端末へ書く。**
    // 以前は catch の中で初めて保存していたため、送信中に PC・タブが落ちると
    // catch が走らず、サーバーでは完了済みなのに端末には送った body が残らなかった。
    // `beforeunload` 等の unload 処理は実行の保証が無いので当てにしない。
    const intent = {
      v:         INTENT_VERSION,
      sessionId: id,
      shopCode:  origin.shop,
      type:      request.type,
      body:      request.body,
      phase:     PHASE_SENDING,
      at:        new Date().toISOString(),
    }
    if (!_writeIntent(intent)) {
      // 保存できないなら送らない。送った内容を復元できない状態で結果不明を作らない。
      return _fail('intent_not_persisted', { unknown: false, retryable: true })
    }
    // 送った以上、結果が確定するまでは「不明」。active は書かない
    completionUnknown.value = true

    try {
      const res = await completeSessionApi(id, request.body)
      // 応答が返るまでにアカウント・セッションが変わっていたら、いま画面にあるものへ
      // 適用しない。呼び出し側もこの結果で後片付け（履歴確定・draft削除・遷移）をしない。
      if (_isStale(origin)) return _staleResult(origin, 'complete')
      // stock はスナップショットが保存された場合だけ完了。送ったのに保存されていない状態は
      // 「一覧には出るが詳細が開けない」（R-001）そのもの。order は契約上 false を返す。
      if (request.type === 'stock' && res?.snapshotSaved !== true) {
        console.error('[useSession] complete without snapshot:', id)
        _clearIntent()
        // 応答は 200 なのに明細が保存されていない。**サーバーが古い**ときにここへ来る
        // （`snapshotSaved` を返すのは 2026-08-10 以降の Worker）。
        return _fail('snapshot_missing', { unknown: false, detail: 'サーバー応答に snapshotSaved が無い（Workerが古い可能性）' })
      }
      // **成功しても intent は消さない。** 端末側の確定（履歴 commit・後片付け）が
      // 終わってから `ackCompletionFinalized()` で消す。成功直後に端末が落ちても、
      // 保存済み body から同じ要求を replay して収束できる。
      _writeIntent({ ...intent, phase: PHASE_CONFIRMED, result: res ?? null })
      if (pendingSession.value) pendingSession.value.status = 'completed'
      return { ok: true, result: res ?? null }
    } catch (err) {
      if (_isStale(origin)) return _staleResult(origin, 'complete')
      console.error('[useSession] complete failed:', id, err?.code ?? err?.message ?? err)

      // 別内容で既に確定済み。再試行しても解消せず、server 側の記録は無傷のまま。
      // 未送信キューへも戻さない。サーバーの確定内容を正として扱う。
      if (err?.status === 409 && err?.code === 'completion_intent_conflict') {
        completionUnknown.value = false
        _clearIntent()
        if (pendingSession.value) pendingSession.value.status = 'completed'
        return { ok: false, reason: 'intent_conflict', retryable: false, unknown: false, conflict: true }
      }
      // claim はあるのに履歴が消えている。同じ session では復旧できない（fail-closed）。
      if (err?.status === 409 && err?.code === 'completion_record_missing') {
        _clearIntent()
        return _fail('record_missing', { unknown: false, retryable: false })
      }

      // 完了状態を付けないまま返す。次の再送で明細ごとやり直せる。
      // 応答が返らなかった＝サーバー側の状態が分からない。active は書かない。
      // intent は送信前に書いてあるので、結果不明ならそのまま残す。
      // サーバーが受け付けていないと断定できた失敗では捨て、最新の入力で作り直させる。
      const unknown = !_isDefiniteFailure(err)
      if (!unknown) _clearIntent()

      return _fail('save_failed', {
        unknown,
        retryable: err?.body?.retryable !== false && !_isDefiniteFailure(err),
        detail: _failureDetail(err),
      })
    }
  }

  // 一覧へ戻る・退出時にセッション参照を破棄
  function clear() {
    _startFresh()
    pendingSession.value = null
  }

  return {
    pendingSession, isCompleting, completionUnknown, completionBusy,
    begin, resume, restore, touch, markActive, complete, verifyCompletion, clear,
    pendingCompletionIntent, ackCompletionFinalized,
    captureLifecycle, isLifecycleStale,
  }
}
