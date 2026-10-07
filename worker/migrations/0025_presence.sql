-- 0025: ログイン中の表示と作業の記録（スタッフのログイン 段 2-5・User決定 2026-10-07）
--
-- 背景: 管理者だけが「いま誰がアプリを開いているか」「いつ・どれくらい開いていたか」を見られるようにする。
--   アプリを開いている間、端末が 90秒ごとに知らせる（画面を消す・別のアプリへ移ると止まり、閉じたときも知らせる）。
--   設計案では店舗の Durable Object＋WebSocket だったが、常時つなぐ仕組みを増やさず HTTP の知らせで足りるため、こちらにした。
--
-- 変更:
--   work_sessions … 1行＝開いていた1回（5分以上あいたら別の1回）。actor_id はスタッフ ID（オーナーは端末 ID）
--     closed_at … 閉じたと知らせがあった時刻（いま開いているかの判定に使う。次の知らせでまた開く）
--   idx_work_sessions_seen … このマイグレーションの印。90日より古い行は消す
-- アカウント削除で消す（accountDeletion.js）。スタッフの削除では消さない（名前は（削除済み）で残す）。
-- ロールバック: DROP TABLE work_sessions。
CREATE TABLE IF NOT EXISTS work_sessions (
  id           TEXT PRIMARY KEY,
  shop_code    TEXT NOT NULL,
  actor_id     TEXT NOT NULL,
  staff_id     TEXT,
  name         TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  closed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_sessions_actor ON work_sessions (shop_code, actor_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_work_sessions_seen  ON work_sessions (shop_code, last_seen_at);
