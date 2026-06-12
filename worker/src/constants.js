// ── Auth ─────────────────────────────────────────────────────────────────────
export const LOGIN_WINDOW_MS   = 15 * 60 * 1000    // brute-force window
export const LOGIN_MAX_FAILS   = 5                  // max failures per window
export const TOKEN_EXPIRY_MS   = 30 * 24 * 60 * 60 * 1000  // auth token lifetime

// ── IP rate limit (cross-store brute force / room code probing) ──────────────
export const IP_RATE_WINDOW_MS = 15 * 60 * 1000
export const IP_MAX_FAILS      = 30

// ── Payload ───────────────────────────────────────────────────────────────────
export const MAX_PAYLOAD_CHARS = 1_000_000          // ~1 MB JSON guard

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
export const MAX_STORE_NAME_LEN  = 50
