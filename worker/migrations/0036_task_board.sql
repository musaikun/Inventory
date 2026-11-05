-- 0036: 日誌の予定ボード（予約台帳の形・User決定 2026-11-05・モック docs/mocks/journal-board.html）
--
-- 変更:
--   tasks.end_time … 終わりの時刻 'HH:MM'（due_time が始まり）。NULL＝終わりなし（「◯時までに」の1点）
--   tasks.category … 中身の種類 'prep'（仕込み）/ 'clean'（清掃）/ 'order'（発注・納品）。NULL＝やること
--   idx_tasks_end_time … このマイグレーションの印（終わりのある予定だけの小さな索引）
-- ロールバック: 旧 Worker は列を読まない（終わりの時刻と種類が見えなくなるだけ）。
ALTER TABLE tasks ADD COLUMN end_time TEXT;
ALTER TABLE tasks ADD COLUMN category TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_end_time ON tasks (shop_code, task_date) WHERE end_time IS NOT NULL;
