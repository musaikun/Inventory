-- D1 全データ削除スクリプト（スキーマは残す）
-- 使い方:
--   リモート: npx wrangler d1 execute inventory-store --remote --file=./migrations/reset-all.sql
--   ローカル: npx wrangler d1 execute inventory-store --local  --file=./migrations/reset-all.sql
-- ⚠️ 復元不可。店舗登録・PIN・ログイン・在庫・履歴がすべて消えます。

-- FK 参照順（子 → 親）で削除
DELETE FROM sessions;
DELETE FROM auth_tokens;
DELETE FROM store_history;
DELETE FROM store_inventory;
DELETE FROM store_configs;
DELETE FROM stores;

-- AUTOINCREMENT のカウンタもリセット
DELETE FROM sqlite_sequence WHERE name = 'store_history';
