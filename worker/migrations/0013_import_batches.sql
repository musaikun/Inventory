-- 0013: 過去棚卸取込を「取込バッチ」として追跡できるようにする（IMPORT-001 / DATA-002）
--
-- 背景:
--   過去棚卸の取込は client 側で localStorage の history に日付キーで直接書き、
--   D1 へは saveSnapshotToD1() を投げっぱなしにしていた。そのため
--     ・同じ日に通常の棚卸があると、取込が黙って上書きした
--     ・server 保存の成否を確認せずに「取り込みました」と表示していた
--     ・取り込んだものだけをまとめて取り消す手段が無かった
--   完了済み棚卸は 0012 で session 単位になっているのに、取込だけが日付のままだった。
--
-- 変更:
--   sessions へ import_batch_id を足す。取込で作ったセッションだけがこの値を持ち、
--   通常の棚卸は NULL のまま。取消は import_batch_id で対象を限定するので、
--   別バッチや通常の棚卸を巻き込まない。
--
-- ロールバック:
--   **可能**。列の追加とインデックスの作成だけで、既存の行と制約を書き換えない。
--   戻す場合はインデックスを DROP すればよい（列は NULL のまま無害に残る）。
--   0012 と違い DROP TABLE を含まないので、不可逆点ではない。
--
-- 適用前後で行数は変わらない。既存 session は import_batch_id = NULL となり、
-- 「通常の棚卸」として従来どおり扱われる（後方互換）。

ALTER TABLE sessions ADD COLUMN import_batch_id TEXT;

-- 取込バッチ単位の取消・冪等な再取込で使う。
-- (shop_code, import_batch_id) で対象セッションを引き、(…, started_at) で日付照合する。
CREATE INDEX IF NOT EXISTS idx_sessions_import_batch
  ON sessions(shop_code, import_batch_id)
  WHERE import_batch_id IS NOT NULL;
