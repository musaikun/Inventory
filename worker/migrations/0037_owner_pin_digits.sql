-- 0037: オーナーの暗証番号を6桁にそろえる（User決定 2026-11-10・案A: 4桁のままログインでき、1か月のうちに6桁へ）
--
-- 変更:
--   stores.pin_digits      … オーナーの暗証番号の桁数（4 / 6）。NULL＝この列より前の店（4桁）
--   stores.pin_upgrade_due … 6桁に変える期限（ISO）。4桁で初めてログインしたときに今から30日で入れる。6桁にしたら NULL
--   idx_stores_pin_upgrade … このマイグレーションの印（期限のある店だけの小さな索引）
-- ロールバック: 旧 Worker は列を読まない（4桁のまま使える。変更の画面と期限が出なくなるだけ）。
ALTER TABLE stores ADD COLUMN pin_digits INTEGER;
ALTER TABLE stores ADD COLUMN pin_upgrade_due TEXT;
CREATE INDEX IF NOT EXISTS idx_stores_pin_upgrade ON stores (pin_upgrade_due) WHERE pin_upgrade_due IS NOT NULL;
