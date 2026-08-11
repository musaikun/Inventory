-- 0012: store_history を「日付キー」から「セッションキー」へ移す（F-001 / DATA-002）
--
-- 背景:
--   store_history は UNIQUE(shop_code, snapshot_date) だった。同じ日に2回棚卸すると、
--   2回目の INSERT ... ON CONFLICT DO UPDATE が1回目のスナップショットを上書きし、
--   1回目の記録が消えていた。sessions / inventory_lines は session_id で分かれているのに、
--   表示・分析に使うスナップショットだけが日付で潰れていた。
--
-- 変更:
--   session_id 列を追加し、一意制約を (shop_code, session_id) へ移す。
--   session_id を持たない行（過去取込・旧データ）は従来どおり日付で一意にする。
--
-- **ロールバック不能点**:
--   SQLite は CREATE TABLE で宣言した UNIQUE 制約を ALTER で外せないため、
--   table を作り直して差し替える。DROP TABLE store_history を含むので、
--   このmigrationは適用後に戻せない。適用前に必ずバックアップ（D1 Time Travel の
--   保持期間内であることの確認を含む）を取ること。
--
-- 既存行の扱い:
--   snapshot_json には完了時の sessionId が入っている（useHistory.saveSnapshot）。
--   json_extract で拾えるものは session_id へ引き上げる。拾えない行（過去取込・
--   sessionId を持たない旧スナップショット）は session_id NULL のまま残す。
--
-- 適用前後で行数は変わらない。UNIQUE の張り替えだけを行う。

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS store_history_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_code     TEXT NOT NULL,
  session_id    TEXT,
  snapshot_date TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO store_history_v2 (id, shop_code, session_id, snapshot_date, snapshot_json, created_at)
SELECT
  id,
  shop_code,
  json_extract(snapshot_json, '$.sessionId'),
  snapshot_date,
  snapshot_json,
  created_at
FROM store_history;

DROP TABLE store_history;

ALTER TABLE store_history_v2 RENAME TO store_history;

-- セッション単位の一意制約。同日2回でも別セッションなら共存する。
CREATE UNIQUE INDEX IF NOT EXISTS idx_history_session
  ON store_history(shop_code, session_id)
  WHERE session_id IS NOT NULL;

-- session_id を持たない行（過去取込・旧データ）は従来どおり日付で一意。
-- 1日に複数の「セッション無し」スナップショットは作らない。
CREATE UNIQUE INDEX IF NOT EXISTS idx_history_legacy_date
  ON store_history(shop_code, snapshot_date)
  WHERE session_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_history_shop_date
  ON store_history(shop_code, snapshot_date);

-- DROP TABLE で 0011 のトリガも消えるため貼り直す。
-- 削除済み・削除保留のアカウントへ新しい履歴を書かせない（PLAY-001）。
CREATE TRIGGER IF NOT EXISTS trg_store_history_active_insert
BEFORE INSERT ON store_history
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;

PRAGMA foreign_keys = ON;
