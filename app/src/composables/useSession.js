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

/**
 * アカウントの世代。切替のたびに増やす。
 *
 * 完了要求は世代・店舗・sessionId を**送信開始時に捕まえ**、応答を適用する直前に
 * 突き合わせる。`_completing` の参照を消しても実行中の Promise は止まらないため、
 * 旧アカウントの応答が後から返って現在の pendingSession を completed にし、
 * 呼び出し側が旧 snapshot を現在の履歴へ確定して現在の draft を消す経路があった。
 */
let _accountGeneration = 0

function _persistIntent() {
  try {
    if (_intent) localStorage.setItem(STORAGE_KEYS.completionIntent, JSON.stringify(_intent))
    else localStorage.removeItem(STORAGE_KEYS.completionIntent)
  } catch (_) {
    // 容量不足などで body を残せない場合でも、結果不明そのものは失わせない。
    // 復帰後は body を組み立て直すことになり 409 になりうるが、その 409 は
    // 「サーバー側で確定済み」と分かる形で扱える（active を書き戻すより安全）。
    try { localStorage.setItem(STORAGE_KEYS.completionIntent, JSON.stringify({ ..._intent, body: null })) } catch (_) {}
  }
}

function _setIntent(next) {
  _intent = next
  _persistIntent()
}

function _clearIntent() {
  if (_intent === null) {
    try { localStorage.removeItem(STORAGE_KEYS.completionIntent) } catch (_) {}
    return
  }
  _setIntent(null)
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
  _accountGeneration++
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

export function useSession() {
  // 新規セッション開始（SessionListPage で createSession 済みのオブジェクトを受け取る）
  function begin(session) {
    _cancelTouch()
    _finalized = false
    completionUnknown.value = false
    _clearIntent()
    pendingSession.value = session
  }

  // 中断セッションの再開
  function resume(session) {
    _cancelTouch()
    _finalized = false
    completionUnknown.value = false
    _clearIntent()
    pendingSession.value = session
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
    _touchTimer = setTimeout(() => {
      if (!_canWrite() || _finalized || completionBusy.value) return
      updateSession(pendingSession.value.id, 'active', count).catch(() => {})
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

    // **失敗を握り潰さない。** 以前は `.catch(() => {})` のあとで無条件に
    // `status = 'active'` を書いていた。server が `409 session_completed` を返しても
    // 端末は「進行中」と信じ続け、完了済みの詳細へ到達できなくなる。
    try {
      await updateSession(pendingSession.value.id, 'active', count)
    } catch (err) {
      console.error('[useSession] markActive failed:', pendingSession.value?.id, err?.code ?? err?.message ?? err)
      // server 側は既に完了している。端末の表示をそれへ合わせる
      if (err?.status === 409 && err?.code === 'session_completed') {
        _finalized = true
        if (pendingSession.value) pendingSession.value.status = 'completed'
        return { ok: false, reason: 'session_completed' }
      }
      return { ok: false, reason: 'save_failed', retryable: true }
    }
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
    const id = pendingSession.value?.id
    if (!id) return { ok: false, reason: 'no_session' }
    if (!isAuthenticated.value) return { ok: false, reason: 'offline' }
    let list = null
    try {
      list = await getSessions()
    } catch (err) {
      console.error('[useSession] verifyCompletion failed:', id, err?.message ?? err)
      return { ok: false, reason: 'unreachable' }
    }
    const found = Array.isArray(list) ? list.find(s => s?.id === id) : null
    if (!found) return { ok: false, reason: 'not_found' }
    const completed = found.status === 'completed'
    completionUnknown.value = false
    _finalized = completed
    // 完了が確定したなら、保持していた再送用の要求はもう要らない
    if (completed) _clearIntent()
    if (pendingSession.value) pendingSession.value.status = found.status
    return { ok: true, completed }
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

  function _fail(reason, { unknown, retryable = true, conflict = false } = {}) {
    _finalized = false
    completionUnknown.value = !!unknown
    return { ok: false, reason, retryable, unknown: !!unknown, conflict }
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
    const origin = { generation: _accountGeneration, shop: shopCode.value, id }
    const stale  = () => _accountGeneration !== origin.generation
                      || shopCode.value !== origin.shop
                      || pendingSession.value?.id !== origin.id

    try {
      const res = await completeSessionApi(id, request.body)
      // 応答が返るまでにアカウント・セッションが変わっていたら、いま画面にあるものへ
      // 適用しない。呼び出し側もこの結果で後片付け（履歴確定・draft削除・遷移）をしない。
      if (stale()) {
        console.warn('[useSession] discarding completion result for a stale account/session:', origin.id)
        return { ok: false, reason: 'stale', stale: true, retryable: false, unknown: false }
      }
      // stock はスナップショットが保存された場合だけ完了。送ったのに保存されていない状態は
      // 「一覧には出るが詳細が開けない」（R-001）そのもの。order は契約上 false を返す。
      if (request.type === 'stock' && res?.snapshotSaved !== true) {
        console.error('[useSession] complete without snapshot:', id)
        return _fail('snapshot_missing', { unknown: false })
      }
      completionUnknown.value = false
      _clearIntent()
      if (pendingSession.value) pendingSession.value.status = 'completed'
      return { ok: true, result: res ?? null }
    } catch (err) {
      console.error('[useSession] complete failed:', id, err?.code ?? err?.message ?? err)
      if (stale()) {
        console.warn('[useSession] discarding completion failure for a stale account/session:', origin.id)
        return { ok: false, reason: 'stale', stale: true, retryable: false, unknown: false }
      }

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
      const unknown = !_isDefiniteFailure(err)
      // 結果不明のあいだは、送った body をそのまま端末へ残す（再読込をまたぐ）。
      // サーバーが受け付けていないと断定できた失敗では捨て、最新の入力で作り直させる。
      if (unknown) _setIntent({ sessionId: id, shopCode: origin.shop, type: request.type, body: request.body })
      else _clearIntent()

      return _fail('save_failed', {
        unknown,
        retryable: err?.body?.retryable !== false && !_isDefiniteFailure(err),
      })
    }
  }

  // 一覧へ戻る・退出時にセッション参照を破棄
  function clear() {
    _cancelTouch()
    _finalized = false
    completionUnknown.value = false
    _clearIntent()
    pendingSession.value = null
  }

  return {
    pendingSession, isCompleting, completionUnknown, completionBusy,
    begin, resume, restore, touch, markActive, complete, verifyCompletion, clear,
    pendingCompletionIntent,
  }
}
