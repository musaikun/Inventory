-- stores テーブルに認証フィールドを追加
ALTER TABLE stores ADD COLUMN store_name TEXT;
ALTER TABLE stores ADD COLUMN pin_hash   TEXT;

-- 認証トークンテーブル（30日有効、ログアウトで削除）
CREATE TABLE IF NOT EXISTS auth_tokens (
  token      TEXT PRIMARY KEY,
  shop_code  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 棚卸セッションテーブル
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT    PRIMARY KEY,
  shop_code   TEXT    NOT NULL,
  started_at  TEXT    NOT NULL,
  ended_at    TEXT,
  status      TEXT    NOT NULL DEFAULT 'active',  -- 'active' | 'completed' | 'incomplete'
  item_count  INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (shop_code) REFERENCES stores(shop_code)
);

CREATE INDEX IF NOT EXISTS idx_sessions_shop_code ON sessions(shop_code);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_shop   ON auth_tokens(shop_code);
