-- 0023: 「誰が」を本人へ（スタッフのログイン 段 2-2・User決定 2026-10-07）
--
-- 背景: 記録の「誰が」は端末名（自己申告）だった。スタッフがログインしているときは、
--   サーバーがトークンから本人の名前と ID を刻む（画面から名前を偽れない）。
--   オーナー（staff_id が NULL のトークン）は今まで通り端末名と端末 ID。
--
-- 変更:
--   sessions.started_by / started_by_id … 棚卸・発注を始めた人
--   sessions.completed_by / completed_by_id … 完了した人
--   tasks.done_by_id … やることを完了した人の ID（作った人の ID は created_by_id にある）
--   movements.created_by_id … 入出庫を記録した人の ID
--   スタッフを削除したら、ID が一致する記録の名前を「山田（削除済み）」へ書き換える（名前だけ残す）。
--   idx_sessions_started_by … このマイグレーションの印
--
-- 既存データ: 端末名だけの過去の記録はそのまま（本人へ結び付けない）。新しい列は NULL。
-- ロールバック: 旧 Worker は新しい列を読まない。列は残してよい。
ALTER TABLE sessions  ADD COLUMN started_by      TEXT;
ALTER TABLE sessions  ADD COLUMN started_by_id   TEXT;
ALTER TABLE sessions  ADD COLUMN completed_by    TEXT;
ALTER TABLE sessions  ADD COLUMN completed_by_id TEXT;
ALTER TABLE tasks     ADD COLUMN done_by_id      TEXT;
ALTER TABLE movements ADD COLUMN created_by_id   TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_started_by ON sessions (shop_code, started_by_id);
