-- 0019: 入出庫の取り消しを「印を付けて残す」形にし、登録した人を残す
--
-- 背景（User決定 2026-10-03）:
--   ホームの品目シートで入庫・出庫をその場で登録できるようにした。間違えたときは取り消せるが、
--   取り消した記録も残し、24時間以内なら元に戻せるようにする。消すのではなく印を付ける。
--   取り消した分を残しても、入出庫全体の数%で、読み出しにも影響しない（店舗×日付の索引で引く）。
--
-- 変更:
--   movements.deleted_at … 取り消した時刻（サーバー時刻）。NULL なら有効。理論在庫・カレンダーの★は NULL だけを数える
--   movements.created_by … 登録した端末の名前（品目シートの日の明細に出す）
--   idx_movements_deleted … 取り消し済みの掃除や集計を店舗ごとに引くための索引（このマイグレーションの印にもする）
--
-- ロールバック:
--   可能。列と索引の追加だけ。戻すときは DROP INDEX idx_movements_deleted のうえ、列は残しても害はない
--   （旧 Worker は列を読まないため、取り消した入出庫が有効として数えられる点だけ注意）。
ALTER TABLE movements ADD COLUMN deleted_at TEXT;
ALTER TABLE movements ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_movements_deleted ON movements(shop_code, deleted_at);
