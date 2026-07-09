-- 発注支援: 発注レコードの永続化（学習の生データ）。
-- orders = 発注ヘッダ（発注日・仕入先・軸）。order_lines = 品目ごとの生データ。
-- 学習（曜日別・適正在庫）はクライアントが order_lines から算出するため、
-- 発注後在庫だけでなく現在在庫・発注数・その時点のLOT・除外フラグまで保存する。

CREATE TABLE IF NOT EXISTS orders (
  id         TEXT PRIMARY KEY,
  shop_code  TEXT NOT NULL,
  order_date TEXT NOT NULL,              -- YYYY-MM-DD（発注日）
  supplier   TEXT NOT NULL DEFAULT '',
  axis       TEXT NOT NULL DEFAULT '',
  session_id TEXT,
  saved_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_shop_date ON orders(shop_code, order_date);

CREATE TABLE IF NOT EXISTS order_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   TEXT NOT NULL,
  shop_code  TEXT NOT NULL,
  order_date TEXT NOT NULL,
  item       TEXT NOT NULL,
  qty        REAL NOT NULL,             -- 発注数（LOT数）
  unit       TEXT NOT NULL DEFAULT '',
  stock      REAL,                      -- 発注時の現在在庫
  lot        REAL NOT NULL DEFAULT 1,   -- その時点の入数（数値）
  post_stock REAL,                      -- 発注後在庫 = stock + qty*lot（学習対象）
  excluded   INTEGER NOT NULL DEFAULT 0,-- 1=学習除外（臨時発注・誤入力など）
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_lines_learn ON order_lines(shop_code, item, order_date);
