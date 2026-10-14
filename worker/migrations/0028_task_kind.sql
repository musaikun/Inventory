-- 0028: アプリが自動で作るやること（スタッフの参加申請・User決定 2026-10-14）
--
-- 変更:
--   tasks.kind        … 自動で作ったやることの種類（'staff_join' ＝ 参加申請の承認）。NULL＝人が作ったもの
--   tasks.ref_id      … 何についてのやることか（staff_join ならスタッフ ID）。承認・お断りで自動で完了にする
--   tasks.reminded_at … 1日たっても終わっていないときに、担当へもう一度知らせた時刻
--   idx_tasks_kind    … このマイグレーションの印
-- 既存データ: すべて NULL（人が作ったやること）。
-- ロールバック: 旧 Worker は新しい列を読まない（自動のやることは普通のやることとして見える）。
ALTER TABLE tasks ADD COLUMN kind TEXT;
ALTER TABLE tasks ADD COLUMN ref_id TEXT;
ALTER TABLE tasks ADD COLUMN reminded_at TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_kind ON tasks (shop_code, kind, ref_id);
