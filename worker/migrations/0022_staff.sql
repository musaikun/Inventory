-- 0022: スタッフごとのログイン（段 2-1・User決定 2026-10-07）
--
-- 背景: 今の「1店舗1ログイン＋端末名」を、管理者とスタッフが本人としてログインする形にする。
--   招待（1人ずつ・10分・1回きり）→ スタッフが名前と6桁の暗証番号を入れる → 管理者が承認。
--   今の店舗ログイン（auth_tokens.staff_id が NULL）はオーナー（管理者の1人・外せない）として扱う。
--
-- 変更:
--   staff … 1行＝1人。status: pending（承認待ち）/ active / stopped（停止）/ rejected / deleted（削除済み）
--     role: arbeit（アルバイト）/ shain（社員）/ admin（管理者）。grants_json は人ごとの足し引き（段 2-3）
--     pending_key_hash … 承認待ちの端末が承認を受け取るための鍵（ハッシュ）。受け取ったら消す
--     削除済みでも行と名前は残す（その人がやった記録に「山田（削除済み）」と出すため）。暗証番号は消す
--   staff_invites … 招待。token_hash（生の招待鍵は保存しない）、10分で期限切れ、使ったら used_at
--   staff_login_attempts … 暗証番号の失敗（店舗×名前×端末で 15分に5回まで）
--   auth_tokens.staff_id … スタッフのトークン（NULL＝オーナー）
--   idx_staff_login_attempts … このマイグレーションの印
--
-- ロールバック:
--   新しい表は DROP TABLE で戻る。auth_tokens.staff_id は残しても旧 Worker は読まない
--   （ただし旧 Worker はスタッフのトークンをオーナーと同じに扱うので、戻すならスタッフのトークンを消すこと）。
CREATE TABLE IF NOT EXISTS staff (
  id               TEXT PRIMARY KEY,
  shop_code        TEXT NOT NULL,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL,
  grants_json      TEXT,
  pin_hash         TEXT,
  status           TEXT NOT NULL,
  pending_key_hash TEXT,
  created_at       TEXT NOT NULL,
  approved_at      TEXT,
  approved_by      TEXT,
  deleted_at       TEXT,
  last_seen_at     TEXT,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_shop ON staff(shop_code, status);

CREATE TABLE IF NOT EXISTS staff_invites (
  id          TEXT PRIMARY KEY,
  shop_code   TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_staff_invites_shop ON staff_invites(shop_code);

CREATE TABLE IF NOT EXISTS staff_login_attempts (
  shop_code    TEXT NOT NULL,
  staff_key    TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);

ALTER TABLE auth_tokens ADD COLUMN staff_id TEXT;

CREATE INDEX IF NOT EXISTS idx_staff_login_attempts ON staff_login_attempts(shop_code, staff_key, device_id, attempted_at);
