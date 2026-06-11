-- IP 単位レート制限（ログイン総当たり・ルームコード探索の横断対策）
CREATE TABLE IF NOT EXISTS ip_attempts (
  ip           TEXT NOT NULL,
  kind         TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ip_attempts ON ip_attempts(ip, kind, attempted_at);
