-- 0033: やることの備考（User決定 2026-10-26）
--
-- 変更:
--   tasks.note … 備考。やることの文面とは別に、細かいこと・手順・連絡先などを書く（500字まで）。NULL＝なし
--   idx_tasks_note … このマイグレーションの印（備考のあるものだけの小さな索引）
-- ロールバック: 旧 Worker は列を読まない（備考が見えなくなるだけ）。
ALTER TABLE tasks ADD COLUMN note TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_note ON tasks (shop_code) WHERE note IS NOT NULL;
