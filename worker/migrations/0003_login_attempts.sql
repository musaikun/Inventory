-- ログイン総当たり対策: 失敗試行の記録（15分5回でブロック）
-- 成功ログイン時に該当 shop_code の行は削除される。
-- 古い行は Cron Trigger で定期掃除する想定（db-design-v2 Step 4）。
CREATE TABLE IF NOT EXISTS login_attempts (
  shop_code    TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(shop_code, attempted_at);
