// ── Auth ─────────────────────────────────────────────────────────────────────
export const LOGIN_WINDOW_MS   = 15 * 60 * 1000    // brute-force window
export const LOGIN_MAX_FAILS   = 5                  // max failures per window
export const TOKEN_EXPIRY_MS   = 30 * 24 * 60 * 60 * 1000  // auth token lifetime
export const PBKDF2_ITERATIONS = 100_000           // PIN hash stretching (SHA-256 base)
export const ACCOUNT_DELETION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const ACCOUNT_DELETION_INTERNAL_HEADER = 'account-delete-v1'

// ── IP rate limit (cross-store brute force / room code probing) ──────────────
export const IP_RATE_WINDOW_MS = 15 * 60 * 1000
export const IP_MAX_FAILS      = 30
// login_attempts / ip_attempts はレート制限窓を超えて保持しない。
// global cleanupは日次cronのため、実際の削除は窓終了後の次回cron（最長約24時間15分）となる。
export const SECURITY_ATTEMPT_RETENTION_MS = Math.max(LOGIN_WINDOW_MS, IP_RATE_WINDOW_MS)

// ── Payload ───────────────────────────────────────────────────────────────────
// **UTF-8 のバイト数**で判定する（DATA-002 第2セッション）。
// 旧 MAX_PAYLOAD_CHARS は JSON.stringify().length ＝ UTF-16 code unit 数で見ており、
// 日本語（1文字=3バイト）中心の payload では実際の3倍まで通っていた。
// D1 の row 上限（2MB）と Worker のメモリを守るのが目的なので、単位はバイトが正しい。
export const MAX_PAYLOAD_BYTES = 1_000_000          // 1 MB JSON guard（UTF-8 bytes）
export const MAX_PUSH_SUBSCRIPTION_BYTES = 8 * 1024 // PushSubscription JSON guard

// GET /store/:code/sessions/:id/lines で1回に返す明細の上限。
// Free上限150品目に対して十分な余裕を持たせつつ、1セッションぶんの転送を有界にする。
// 超えた分は truncated を立てて打ち切る（F-002 の転送量問題を新経路へ持ち込まないため）。
export const MAX_SESSION_LINES = 2_000

// ── D1 の実行上限（2026-08-09 に公式資料で確認）────────────────────────────────
// https://developers.cloudflare.com/d1/platform/limits/
//
// この4つは実装の前提であって、推測値ではない。値を変えるときは必ず公式資料を再確認する。
export const D1_MAX_BOUND_PARAMS         = 100        // Maximum bound parameters per query
export const D1_MAX_STATEMENT_BYTES      = 100_000    // Maximum SQL statement length
export const D1_MAX_QUERY_DURATION_MS    = 30_000     // Maximum SQL query duration
export const D1_QUERIES_PER_INVOCATION_FREE = 50      // Queries per Worker invocation (Free)
export const D1_QUERIES_PER_INVOCATION_PAID = 1_000   // 同（Workers Paid）

// **未確定**: batch() 内の各 statement が上の「Queries per Worker invocation」へ
// 1件ずつ数えられるのかは、公式資料に明記がない。limits ページは
// 「Limits for individual queries apply to each individual statement contained within a
// batch statement」と書くが、これは statement 長やbound parameter などの
// *individual query* 制限の話で、invocation あたりの本数の数え方には触れていない。
// batch API のページにも記載がない。
//
// したがって実装は**厳しい側（1 statement = 1 query）を仮定**して上限を決める。
// 実D1での計測は未実施。実測は release gate へ残す（WEB-07）。
export const D1_BATCH_STATEMENTS_COUNT_INDIVIDUALLY = true

// 1リクエストの D1 呼び出しのうち、明細 batch 以外に消費する本数。
//   verifyAuth: auth_tokens SELECT + stores SELECT = 2
//   持ち主確認: sessions / orders / movements の SELECT = 1
// 実測ではなくコード上の本数。経路を増やしたらここも増やす。
//
// 経路ごとの実際の合計は batch の大きさで決まるため、この定数だけでは足りない。
// 実際の合計本数は writeAtomicity.sqlite.test.js / ledgerLifecycle.sqlite.test.js の
// counters で経路ごとに固定する。
//
// 実測（実SQLiteハーネス・batch 内 statement も1本ずつ計上／2026-08-17）:
//
//   | 経路                              | queries | maxBoundParams |
//   |-----------------------------------|--------:|---------------:|
//   | 棚卸完了 1品目                     |       9 |              9 |
//   | 棚卸完了 150品目                   |      16 |             99 |
//   | 棚卸完了 351品目（R-001の実データ） |      27 |             99 |
//   | 棚卸完了 500品目（上限）           |      35 |             99 |
//   | 過去取込 500行 / replace 0件        |      34 |             99 |
//   | 過去取込 500行 / replace 50件（上限）|      40 |             99 |
//   | 取込の取消                         |       6 |              3 |
//
// いずれも認証2本を足しても Free の 50 に収まる。
export const D1_QUERIES_OVERHEAD_PER_REQUEST = 3

// 明細 batch へ割り当てられる statement 数。Free の 50 から overhead を引き、
// 将来の1〜2本の追加に耐える余白を残す。
export const D1_BATCH_STATEMENT_BUDGET =
  D1_QUERIES_PER_INVOCATION_FREE - D1_QUERIES_OVERHEAD_PER_REQUEST - 6   // = 41

/**
 * 1 statement へ何行まとめられるかを bound parameter 上限から求める。
 * 明細は「行ごとの値 × N ＋ 文ごとの固定値」でパラメータを消費する。
 *
 * @param {number} perRow   1行あたりのbound parameter数
 * @param {number} fixed    文ごとの固定bound parameter数
 */
export function rowsPerStatement(perRow, fixed) {
  return Math.max(1, Math.floor((D1_MAX_BOUND_PARAMS - fixed) / perRow))
}

// 各明細テーブルのまとめ行数。JOIN 元（sessions / orders / movements）で持ち主を確認するため、
// 文ごとの固定パラメータに id と shop_code を含む。
//
// inventory_lines は加えて「この要求が勝者である」claim へ従属する（DATA-002 §3 / §4）。
// claim は `sessions s` と相関する EXISTS なので、増える bound parameter は fingerprint の1個だけ:
//   takenAt(1) + id(1) + shop(1) + fingerprint(1) = 4
export const INVENTORY_ROWS_PER_STATEMENT = rowsPerStatement(5, 4)   // item,qty,unit,price,value ／ takenAt,id,shop,claim = 19
export const ORDER_ROWS_PER_STATEMENT     = rowsPerStatement(7, 4)   // item,qty,unit,stock,lot,post,excluded ／ date,createdAt,id,shop = 13
export const MOVEMENT_ROWS_PER_STATEMENT  = rowsPerStatement(3, 4)   // item,qty,unit ／ date,createdAt,id,shop = 32

// 1リクエストで受け付ける明細行の上限（棚卸完了 / 発注 / 入出庫 共通・DATA-001）。
//
// MAX_PAYLOAD_BYTES はJSON全体のバイト数しか見ないため、短い行を大量に並べると
// 上限内のまま数万行のwriteを1トランザクションへ詰め込める。件数でも縛る。
//
// 上限の根拠: 3テーブルのうち1文あたりの行数が最も少ない order_lines（13行/文）で、
// 「DELETE 1本 + ヘッダ 1本 + ceil(N/13) 本」が D1_BATCH_STATEMENT_BUDGET に収まること。
//   ceil(500/13) + 2 = 41 statements ≦ 41
// 旧値 5,000 は N+2 statements を生み、Free の 50 はもちろん Paid の 1,000 も超えていた。
export const MAX_LINES_PER_REQUEST = 500

// 過去棚卸取込で1リクエストに指定できる「上書き対象セッション」の上限。
// 削除は5文（inventory_lines / store_history / session_completions /
// import_batch_requests / sessions）へ IN 句で集約するので、
// 件数が増えても statement 数は変わらない。上限は bound parameter 側で決まる。
//
// 2026-08-16: 削除の権限判定を preflight SELECT から**文中の原子 guard**へ移した
// （DATA-002 §3 / TOCTOU）。当初の guard は同じ ID 一覧をもう一度 IN 句で参照したため
// 1文あたり 2N + 4 となり、上限を 40 まで下げていた。
//
// 2026-08-17: guard を**取込台帳（claim）への従属**へ置き換えた（DATA-002 再レビュー §4）。
// 件数条件を評価するのは台帳 INSERT の1文だけで、以降の文は
// 「自分の fingerprint の台帳行が存在するか」だけを見る。ID 一覧の二重参照が無くなり、
// 1文あたりの bound parameter は次のとおり:
//   台帳 INSERT   : 値9 + 件数guard(shop 1 + IN N + date 1 + count 1) = N + 12
//   replace DELETE: shop(1) + IN(N) + 台帳EXISTS(4)                    = N + 5
// N = 50 でも 62 / 55 で D1_MAX_BOUND_PARAMS(100) に収まるため、50 へ戻す。
// 超過は書き込み前に 400 invalid_replace で拒否する。
//
// 上書き削除は件数によらず **5文**へ集約する（inventory_lines / store_history /
// session_completions / import_batch_requests / sessions）。セッションに属するものを
// 全部消さないと、旧 claim・旧台帳が孤児として残る（DATA-002 再レビュー HIGH）。
// 1件5文だと 50 件で 250 文になり、Free の invocation 上限を1リクエストで超える。
export const MAX_REPLACE_SESSIONS = 50

// ── 完了 snapshot の metadata 上限（DATA-002 §1）──────────────────────────────
// snapshot の主要項目（items / itemCount / totalValue / date / sessionId / type）は
// server が検証済み inventory rows から canonical 化する。それ以外の任意 metadata は
// allowlist した鍵だけを、下の件数上限まで受け付ける。
// MAX_PAYLOAD_BYTES だけでは「短い要素を大量に並べる」形を止められないため件数でも縛る。
export const MAX_SNAPSHOT_ITEMS        = 2_000   // 未入力ぶんを含む表示用 items
export const MAX_SNAPSHOT_LOG_ENTRIES  = 5_000   // entryLog / auditLog（MAX_AUDIT_LOG と揃える）
export const MAX_SNAPSHOT_PARTICIPANTS = 50      // 参加者別集計（MAX_PARTICIPANTS 20 の余裕分）
// 参加者別の品目ごとの入力時刻（epoch ms）。端末時計なので広めに許容し、
// 桁違いの値（秒・マイクロ秒の取り違え）だけを弾く。2100-01-01 まで。
export const MAX_ENTRY_AT_MS           = 4_102_444_800_000

// ── 完了後ゲスト閲覧（result エンドポイントの有効期間）────────────────────────
export const RESULT_WINDOW_DAYS = 3   // 訂正期間（SessionDetailPage の CORRECTION_DAYS と一致）

// ── Durable Object room ───────────────────────────────────────────────────────
export const ROOM_TTL_MS       = 24 * 60 * 60 * 1000  // alarm / inactivity TTL
export const MAX_PARTICIPANTS  = 20
// 変更履歴（操作ログ）。参加者別の重複カウントと品目ごとの履歴の**正本**なので、
// 品目数を大きく上回る件数（1品目を複数人が直す）を保持できる必要がある。
// DO storage は1つの値が 128KiB 上限。全件を1キーに書くと 500件前後で put が落ちるため、
// AUDIT_CHUNK_SIZE 件ずつ別キー（audit:000000, audit:000001, …）に分ける。
// 追記は末尾チャンクだけを読み書きするので、1入力あたりの負荷も件数に比例しない。
export const MAX_AUDIT_LOG     = 5_000
export const AUDIT_CHUNK_SIZE  = 100
// チャットは1キーにまとめて保存するので 128KiB 上限が直接効く。
// 監査ログの上限を上げたときに巻き込まれないよう、別の定数として持つ。
export const MAX_CHAT_MESSAGES = 200
export const WS_RATE_WINDOW_MS = 2_000              // per-connection rate window
export const WS_RATE_MAX_MSG   = 20                 // max messages per window

// ── Field length limits (slice guards) ───────────────────────────────────────
export const MAX_TOKEN_LEN       = 64
export const MAX_DEVICE_ID_LEN   = 64
export const MAX_DEVICE_NAME_LEN = 30
export const MAX_INGREDIENT_LEN  = 200
export const MAX_UNIT_LEN        = 50
export const MAX_CHAT_TEXT_LEN   = 500
export const MAX_ORDER_QTY       = 1_000_000        // 発注数の上限（有限・非現実的な巨大値/Infinityを弾く）

// ── 数量の業務契約（DATA-001）────────────────────────────────────────────────
// 3経路とも「有限であること」を必須にする。NaN / Infinity を 0 へ丸めない
// （在庫0と入力不能を同じ値にすると、欠測が「棚に無い」として理論在庫へ伝播する）。
//   棚卸 : 0 を許す（在庫なしは正当な記録）。負数は棚卸の意味を持たないため拒否。
//   発注 : 0 と負数を拒否（発注しない行は送らない）。
//   入出庫: 0 と負数を拒否（数量のない入出庫は記録の意味がない）。
export const MAX_INVENTORY_QTY   = 1_000_000
export const MAX_MOVEMENT_QTY    = 1_000_000
export const MAX_UNIT_PRICE      = 100_000_000      // 単価の上限（円）
export const MAX_NOTE_LEN        = 500              // 入出庫メモ
export const MAX_SUPPLIER_LEN    = 100              // 発注の仕入先・軸名
export const MAX_ID_LEN          = 64               // client採番ID（order/movement）
export const MAX_PDF_BYTES        = 5 * 1024 * 1024  // /pdf 受付の上限（5MB・経済的DoS対策 S-D）
export const MAX_STORE_NAME_LEN  = 50
