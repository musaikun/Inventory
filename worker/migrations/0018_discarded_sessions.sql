-- 0018: 破棄したセッションを24時間だけ取り戻せるようにする
--
-- 背景（User要望 2026-10-01）:
--   途中まで進めた棚卸・発注を破棄すると、以前はその場でセッションと関連の行を消していた。
--   押し間違い・別の端末からの破棄で、数えた内容が戻せなかった。
--
-- 変更:
--   破棄は sessions.deleted_at（0004 で追加済みの列）を立てるだけにし、行は消さない。
--   ここには「いつ破棄したか」と、取り戻すときに数量を戻すための下書き（payload_json）を置く。
--   24時間を過ぎたものは Worker が関連の行ごと完全に消す（一覧を読むたび・破棄のたびに掃除する）。
--   完了したセッションはこの経路に乗らない（完了済みの削除はサーバーが拒否する）。
--
-- ロールバック:
--   可能。新規テーブルと索引の追加だけ。戻すときは DROP TABLE discarded_sessions。
--   ただし戻すと、破棄済み（deleted_at あり）の sessions 行は誰にも消されずに残る。
CREATE TABLE IF NOT EXISTS discarded_sessions (
  shop_code    TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  type         TEXT,
  item_count   INTEGER,
  started_at   TEXT,
  discarded_at TEXT NOT NULL,
  payload_json TEXT,
  PRIMARY KEY (shop_code, session_id)
);

CREATE INDEX IF NOT EXISTS idx_discarded_sessions_at
  ON discarded_sessions(shop_code, discarded_at);
