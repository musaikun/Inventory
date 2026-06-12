CREATE TABLE IF NOT EXISTS stores (
  shop_code   TEXT PRIMARY KEY,
  active_room TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS store_configs (
  shop_code   TEXT PRIMARY KEY,
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS store_inventory (
  shop_code      TEXT PRIMARY KEY,
  inventory_json TEXT NOT NULL DEFAULT '{}',
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS store_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code     TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(shop_code, snapshot_date)
);
