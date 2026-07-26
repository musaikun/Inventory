-- 店舗プラン（'free' | 'pro'）。課金導入の土台。
-- トライアル（全機能開放）は created_at から一定日数で導出するため専用列は持たない。
-- 実際の機能ゲート（無料/有料の線引き）は未確定のため、本マイグレーションは列の追加のみ。
ALTER TABLE stores ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';

-- 既存店舗は早期利用者として PRO に据え置く（トライアルは新規登録から適用）。
UPDATE stores SET plan = 'pro';

-- 列追加マイグレーションのセンチネル（migrate.sh の適用判定用）。
CREATE INDEX IF NOT EXISTS idx_stores_plan ON stores(plan);
