-- 入出庫（入庫/出庫）レコードの永続化。発注(orders)と同型の別倉庫。
-- movements = 入出庫ヘッダ（日付・種別・メモ・紐付け発注ID）。movement_lines = 品目ごとの生データ。
-- 理論在庫はクライアントが棚卸スナップショット＋movement_lines から算出する。
-- 発注のような同時編集は無いため、リアルタイム同期はせず「保存時POST＋開始時ロード」で扱う。

CREATE TABLE IF NOT EXISTS movements (
  id         TEXT PRIMARY KEY,
  shop_code  TEXT NOT NULL,
  move_date  TEXT NOT NULL,              -- YYYY-MM-DD（入出庫日）
  type       TEXT NOT NULL DEFAULT 'in', -- 'in'（入庫）| 'out'（出庫）
  note       TEXT NOT NULL DEFAULT '',
  order_id   TEXT,                       -- 発注からの納品取込で作られた入庫の元発注ID（任意）
  saved_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movements_shop_date ON movements(shop_code, move_date);

CREATE TABLE IF NOT EXISTS movement_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_id TEXT NOT NULL,
  shop_code   TEXT NOT NULL,
  move_date   TEXT NOT NULL,
  item        TEXT NOT NULL,
  qty         REAL NOT NULL,             -- 数量（バラ換算後）
  unit        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movement_lines_item ON movement_lines(shop_code, item, move_date);
