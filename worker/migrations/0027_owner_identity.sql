-- 0027: オーナーを1人にまとめる・やることの完了を固める（User決定 2026-10-14）
--
-- 変更:
--   stores.owner_name       … オーナーの名前（どの端末でも同じ）。管理画面で変える。NULL＝まだ決まっていない
--                              （最初にオーナーが開いたときの端末名で埋める）
--   stores.owner_unified_at … 既存の記録をオーナー1人へ寄せた時刻（店ごとに1回。Worker が初回に行う）
--   tasks.prev_done_at / prev_done_by_id … その日のうちに完了を取り消したときの元の完了。
--                              同じ人がその日のうちに付け直したら元の時刻へ戻す
--   idx_tasks_created_by    … このマイグレーションの印
-- 既存データ: 列は NULL。オーナーの端末 ID で記録された「誰が」は、店ごとに初回のアクセスで 'owner' へ寄せる。
-- ロールバック: 旧 Worker は新しい列を読まない（'owner' の ID はただの文字列として残る）。
ALTER TABLE stores ADD COLUMN owner_name TEXT;
ALTER TABLE stores ADD COLUMN owner_unified_at TEXT;
ALTER TABLE tasks ADD COLUMN prev_done_at TEXT;
ALTER TABLE tasks ADD COLUMN prev_done_by_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks (shop_code, created_by_id);
