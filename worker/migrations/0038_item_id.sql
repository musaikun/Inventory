-- 品目の変わらない ID（ITEM-001 段 I-2・2026-11-28）
-- 新しく書く明細に、品目名と並べて ID を残す。名前の列はそのまま（読み方は I-4 まで名前のまま）。
-- 古い行は NULL（I-3 で店の設定の itemIds から cron が埋める）。
-- 適用は Worker の更新より先（Worker はこの列へ書く）。
-- rollback: 列は NULL 可で既存の読み書きに影響しないため、残したまま Worker を戻せばよい
--           （SQLite の DROP COLUMN は使わない）。
ALTER TABLE inventory_lines ADD COLUMN item_id TEXT;
ALTER TABLE session_audit   ADD COLUMN item_id TEXT;
ALTER TABLE order_lines     ADD COLUMN item_id TEXT;
ALTER TABLE movement_lines  ADD COLUMN item_id TEXT;
-- 古い行（item_id が NULL）を cron で埋める（I-3・src/itemIdBackfill.js）ための部分 index。
-- 埋め終わると空になるので、毎時の「残っている店はあるか」の確認が表全体を読まずに済む。
CREATE INDEX IF NOT EXISTS idx_inventory_lines_no_item_id ON inventory_lines (shop_code) WHERE item_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_session_audit_no_item_id   ON session_audit (shop_code)   WHERE item_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_order_lines_no_item_id     ON order_lines (shop_code)     WHERE item_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_movement_lines_no_item_id  ON movement_lines (shop_code)  WHERE item_id IS NULL;
-- scripts/migrate.sh の適用済みの印（sentinel）を兼ねる（最後に作る）。I-4 で ID から引くときにも使う。
-- 途中で止まった場合（列だけ入って index が無い）は、残りの ALTER を手で外して再実行する（0034 と同じ扱い）。
CREATE INDEX IF NOT EXISTS idx_movement_lines_item_id ON movement_lines (shop_code, item_id);
