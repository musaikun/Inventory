-- DB設計 v2 マイグレーション
-- ・既存テーブルへの列追加（後方互換 — 既存データは壊れない）
-- ・inventory_lines 新設（分析の核）
-- ・item_par_levels 新設（将来の適正在庫アラート用）

-- ── stores: 論理削除 ──────────────────────────────────────────────────────────
ALTER TABLE stores ADD COLUMN deleted_at TEXT;

-- ── sessions: total_value / archive_key 追加 ──────────────────────────────────
ALTER TABLE sessions ADD COLUMN total_value REAL;
ALTER TABLE sessions ADD COLUMN archive_key TEXT;
ALTER TABLE sessions ADD COLUMN deleted_at  TEXT;

-- sessions の複合インデックス（shop_code + started_at で高速ページング）
CREATE INDEX IF NOT EXISTS idx_sessions_shop ON sessions(shop_code, started_at);

-- ── inventory_lines: 完了セッションの品目明細（分析の核）─────────────────────
CREATE TABLE IF NOT EXISTS inventory_lines (
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  shop_code   TEXT NOT NULL,
  taken_at    TEXT NOT NULL,
  item_name   TEXT NOT NULL,
  category    TEXT,
  qty         REAL NOT NULL,
  unit        TEXT,
  unit_price  REAL,
  line_value  REAL,
  PRIMARY KEY (session_id, item_name)
);
CREATE INDEX IF NOT EXISTS idx_lines_item ON inventory_lines(shop_code, item_name, taken_at);
CREATE INDEX IF NOT EXISTS idx_lines_date ON inventory_lines(shop_code, taken_at);

-- ── item_par_levels: 適正在庫マスタ（将来のアラート・発注予測用）──────────────
CREATE TABLE IF NOT EXISTS item_par_levels (
  shop_code     TEXT NOT NULL,
  item_name     TEXT NOT NULL,
  min_qty       REAL,
  max_qty       REAL,
  reorder_point REAL,
  reorder_qty   REAL,
  lead_days     INTEGER,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (shop_code, item_name)
);
