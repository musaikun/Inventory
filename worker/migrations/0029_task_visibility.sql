-- 0029: 管理者だけに見せるやること（User決定 2026-10-15）
--
-- 変更:
--   tasks.visibility … 'admins' ＝ オーナーと管理者だけに見せる（面談・給与・クレームなど）。NULL＝店のみんな。
--                      サーバーが管理者以外には一覧に入れない（端末にも残さない）。参加申請の自動のやることも 'admins'
--   idx_tasks_visibility … このマイグレーションの印
-- 既存データ: NULL（みんなに見える）。参加申請のやること（kind='staff_join'）だけ 'admins' にそろえる。
-- ロールバック: 旧 Worker は列を読まない（管理者だけのやることも、みんなに見えるようになる）。
ALTER TABLE tasks ADD COLUMN visibility TEXT;
UPDATE tasks SET visibility = 'admins' WHERE kind = 'staff_join';
CREATE INDEX IF NOT EXISTS idx_tasks_visibility ON tasks (shop_code, visibility);
