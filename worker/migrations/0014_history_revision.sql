-- 0014: 履歴に server 側 revision を持たせ、取込セッションの重複をDBで禁じる（DATA-002 / IMPORT-001）
--
-- 背景 A（revision）:
--   store_history の新旧判定に使える server 側の値が無く、client が snapshot_json へ
--   書いた updatedAt / savedAt を見るしかなかった。端末の時計は簡単にずれるため、
--   時計が進んだ端末の古い版が「新しい」として採用され、正しい記録を上書きできた。
--   保存のたびに server が採番する revision と、server が記録する保存時刻を持たせる。
--
-- 背景 B（取込の一意性）:
--   過去棚卸取込は (shop_code, importBatchId, 日付) で1セッションのはずだが、
--   「SELECT して無ければ作る」だけでは同時に届いた2本が別セッションを作れた。
--   session_id を決定的に採番したうえで、DB側にも一意制約を置く。
--   取込セッションの started_at は必ず `<date>T00:00:00.000Z`（日付そのもの）。
--
-- ロールバック:
--   **可能**。列の追加とインデックスの作成だけで、既存の行と制約を書き換えない。
--   0012 と違い DROP TABLE を含まないので不可逆点ではない。
--   戻す場合はインデックスを DROP する（列は無害に残る）。
--
-- 既存データ:
--   revision は id（AUTOINCREMENT）で埋める。店舗ごとに単調増加していれば十分で、
--   採番後の upsert は「同じ店舗の最大値 + 1」を使うため衝突しない。
--   updated_at は created_at で埋める（それまでの保存時刻として最も近い値）。
--   一意インデックスは `import_batch_id IS NOT NULL` の部分インデックスなので、
--   通常の棚卸（import_batch_id IS NULL）は1行も対象にならない。

ALTER TABLE store_history ADD COLUMN revision   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_history ADD COLUMN updated_at TEXT;

UPDATE store_history SET revision   = id         WHERE revision = 0;
UPDATE store_history SET updated_at = created_at WHERE updated_at IS NULL;

-- 端末が「自分の持つ版より新しいか」を1回のクエリで判断できるようにする。
CREATE INDEX IF NOT EXISTS idx_history_revision
  ON store_history(shop_code, revision);

-- 同じ店舗・同じ取込バッチ・同じ日付のセッションは1件だけ。
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_import_unique
  ON sessions(shop_code, import_batch_id, started_at)
  WHERE import_batch_id IS NOT NULL;
