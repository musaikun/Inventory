-- 申し送り（User決定 2026-10-25・モック docs/mocks/journal-calendar-v4.html）
-- kind: 'tell'（📣 伝える＝読むだけ）| 'ask'（🙏 頼む＝その人のやることになる）
-- task_id: 頼んだとき・伝えたことを後から「やることにする」と作ったやること
-- reads_json: 「確認」を押した人 [{ id, name, at }]（伝えるだけのもの）
CREATE TABLE IF NOT EXISTS handoffs (
  id          TEXT NOT NULL,
  shop_code   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  body        TEXT NOT NULL,
  by_name     TEXT,
  by_id       TEXT,
  to_id       TEXT,
  to_name     TEXT,
  task_id     TEXT,
  reads_json  TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  deleted_at  TEXT,
  PRIMARY KEY (shop_code, id)
);
CREATE INDEX IF NOT EXISTS idx_handoffs_created ON handoffs(shop_code, created_at);
