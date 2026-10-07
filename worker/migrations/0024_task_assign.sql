-- 0024: やることの担当（スタッフのログイン 段 2-4・User決定 2026-10-07）
--
-- 変更:
--   tasks.assign_mode … 'anyone'（誰でも・誰か1人が完了＝今まで通り。NULL も同じ）/ 'all'（全員・一人ひとりが印）
--                       / 'person'（特定の人）/ 'none'（未定）
--   tasks.assignee_id / assignee_name … 'person' のときの担当（スタッフ ID か、オーナーの端末 ID）
--   tasks.done_list_json … 'all' のときの印 [{ id, name, at }]。サーバーが合流させる（端末の送った一覧で上書きしない）
--                          done_at は「承認済みのスタッフ全員が印を付けた」ときにサーバーが立てる
--   idx_tasks_assignee … このマイグレーションの印
-- 既存データ: 列は NULL＝「誰でも」。今までと同じ動き。
-- ロールバック: 旧 Worker は新しい列を読まない（全員・特定の担当は「誰でも」に見える）。
ALTER TABLE tasks ADD COLUMN assign_mode    TEXT;
ALTER TABLE tasks ADD COLUMN assignee_id    TEXT;
ALTER TABLE tasks ADD COLUMN assignee_name  TEXT;
ALTER TABLE tasks ADD COLUMN done_list_json TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (shop_code, assignee_id);
