// ── Auth ─────────────────────────────────────────────────────────────────────
export const LOGIN_WINDOW_MS   = 15 * 60 * 1000    // brute-force window
export const LOGIN_MAX_FAILS   = 5                  // max failures per window
export const TOKEN_EXPIRY_MS   = 30 * 24 * 60 * 60 * 1000  // auth token lifetime
export const PBKDF2_ITERATIONS = 100_000           // PIN hash stretching (SHA-256 base)

// ── Plan / trial ──────────────────────────────────────────────────────────────
// 新規登録から TRIAL_DAYS 日間は全機能開放（pro 相当）。以降は stores.plan に従う。
// 無料/有料の具体的な機能ゲートは未確定のため、現状は算出のみ（サーバー強制は未実装）。
export const TRIAL_DAYS = 14

// ── IP rate limit (cross-store brute force / room code probing) ──────────────
export const IP_RATE_WINDOW_MS = 15 * 60 * 1000
export const IP_MAX_FAILS      = 30

// ── Payload ───────────────────────────────────────────────────────────────────
export const MAX_PAYLOAD_CHARS = 1_000_000          // ~1 MB JSON guard

// ── 完了後ゲスト閲覧（result エンドポイントの有効期間）────────────────────────
export const RESULT_WINDOW_DAYS = 3   // 訂正期間（SessionDetailPage の CORRECTION_DAYS と一致）

// ── Durable Object room ───────────────────────────────────────────────────────
export const ROOM_TTL_MS       = 24 * 60 * 60 * 1000  // alarm / inactivity TTL
export const MAX_PARTICIPANTS  = 20
export const MAX_AUDIT_LOG     = 200
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
export const MAX_PDF_BYTES        = 5 * 1024 * 1024  // /pdf 受付の上限（5MB・経済的DoS対策 S-D）
export const MAX_STORE_NAME_LEN  = 50
