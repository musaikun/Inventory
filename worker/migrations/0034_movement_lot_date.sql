-- 0034: 入庫ごとの日付（期限・買った日）（User決定 2026-10-27）
--
-- 変更:
--   movement_lines.lot_date … その入庫の日付 YYYY-MM-DD。期限のあるものは期限、ないものは買った日。NULL＝入れていない
--   movement_lines.lot_kind … lot_date の意味。'exp'（期限）| 'buy'（買った日）。NULL＝入れていない
--   idx_movement_lines_lot … このマイグレーションの印（日付のある行だけの小さな索引）
-- 同じ品目を別々に買ったら、入庫1回ごとに別の日付を持つ。残りは古い入庫から使ったとみなしてクライアントが出す。
-- ロールバック: 旧 Worker は列を読まない（日付が見えなくなるだけ。在庫の数は変わらない）。
ALTER TABLE movement_lines ADD COLUMN lot_date TEXT;
ALTER TABLE movement_lines ADD COLUMN lot_kind TEXT;
CREATE INDEX IF NOT EXISTS idx_movement_lines_lot ON movement_lines (shop_code, item) WHERE lot_date IS NOT NULL;
