-- 品目の変わらない ID（ITEM-001 段 I-2・2026-11-28）
-- 新しく書く明細に、品目名と並べて ID を残す。名前の列はそのまま（読み方は I-4 まで名前のまま）。
-- 古い行は NULL（I-3 で店の設定の itemIds から埋める）。
-- 適用は Worker の更新より先（Worker はこの列へ書く）。
-- rollback: 列は NULL 可で既存の読み書きに影響しないため、残したまま Worker を戻せばよい
--           （SQLite の DROP COLUMN は使わない）。
ALTER TABLE inventory_lines ADD COLUMN item_id TEXT;
ALTER TABLE session_audit   ADD COLUMN item_id TEXT;
ALTER TABLE order_lines     ADD COLUMN item_id TEXT;
ALTER TABLE movement_lines  ADD COLUMN item_id TEXT;
-- scripts/migrate.sh の適用済みの印（sentinel）を兼ねる。I-4 で ID から引くときにも使う。
-- 途中で止まった場合（列だけ入って index が無い）は、残りの ALTER を手で外して再実行する（0034 と同じ扱い）。
CREATE INDEX IF NOT EXISTS idx_movement_lines_item_id ON movement_lines (shop_code, item_id);
