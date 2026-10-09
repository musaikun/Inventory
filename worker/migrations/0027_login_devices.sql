-- 0027: 信頼済み端末（PIN の締め出し対策・2026-10-09 User指示のセキュリティ強化）
--
-- 背景: 店舗ごとに「15分に5回の失敗」で止めていたため、店舗コードを知る第三者が PIN を
--   5回まちがえるだけで、店主も15分ログインできなかった（締め出し）。
-- 変更:
--   login_devices … 一度ログインに成功した端末の鍵（ハッシュ）。この鍵を持つ端末の失敗は、その端末の分だけで数える
--   login_attempts.device_key_hash … 失敗した端末の鍵（NULL＝鍵の無い端末。これまでどおり店舗全体でまとめて止める）
--   idx_login_attempts_device … このマイグレーションの印
-- 総当たりへの強さは変わらない（鍵の無い端末の失敗は今までどおり店舗全体で15分に5回）。
-- 既存データ: 既存の失敗はすべて NULL（鍵の無い端末）。信頼済み端末は次にログインした端末から増える。
-- ロールバック: 旧 Worker は新しい表・列を読まない。DROP TABLE login_devices で戻る（列は残してよい）。
CREATE TABLE IF NOT EXISTS login_devices (
  shop_code    TEXT NOT NULL,
  key_hash     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (shop_code, key_hash)
);
ALTER TABLE login_attempts ADD COLUMN device_key_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_login_attempts_device ON login_attempts (shop_code, device_key_hash, attempted_at);
