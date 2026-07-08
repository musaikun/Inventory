-- セッションに種類を追加（棚卸 / 発注確認）
-- 既存行は 'stock'（棚卸）として扱う＝後方互換
ALTER TABLE sessions ADD COLUMN type TEXT NOT NULL DEFAULT 'stock';
CREATE INDEX IF NOT EXISTS idx_sessions_shop_type ON sessions(shop_code, type);
