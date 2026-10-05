-- 0021: 通知の設定（端末ごと）と、送った通知の記録
--
-- 背景（User決定 2026-10-05）:
--   「棚卸リマインダー」を、ただの通知の設定にする。月末の棚卸（○日前）・しばらく棚卸していない・
--   途中のままの棚卸・やることの日（○日前）・だれかがやることを追加した・発注の締切（○時間前）を
--   端末ごとに選び、知らせる時刻も選べる。cron は毎時に変える。
--
-- 変更:
--   push_subscriptions.prefs_json … その端末の通知の設定（JSON。NULL なら既定の設定）
--   push_sent … 送った通知の印。毎時の cron で同じ通知を二度送らないため
--     endpoint  送り先の端末
--     sent_key  通知の種類と対象（例 'me:2026-10:1' = 2026年10月の月末の前日）
--   idx_push_sent_at … 古い印の掃除用（このマイグレーションの印）
--
-- ロールバック:
--   可能。push_sent は DROP TABLE で戻る。prefs_json は残しても旧 Worker は読まない。
ALTER TABLE push_subscriptions ADD COLUMN prefs_json TEXT;

CREATE TABLE IF NOT EXISTS push_sent (
  endpoint  TEXT NOT NULL,
  sent_key  TEXT NOT NULL,
  sent_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (endpoint, sent_key)
);
CREATE INDEX IF NOT EXISTS idx_push_sent_at ON push_sent(sent_at);
