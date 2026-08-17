-- 0016: 棚卸完了を「最初の1要求だけが確定できる」形にする（DATA-002 再レビュー §3 / §4 / §5）
--
-- 背景 A（完了の上書き）:
--   `POST /sessions/:id/complete` の UPDATE には現在 status の条件が無かった。
--   一度完了したセッションへ別内容の complete を送ると、明細・snapshot・件数・合計・revision を
--   まるごと差し替えられた。完了は「その時点の棚卸結果」の確定なので、
--   後から別の内容で書き換えられてはならない。
--
-- 背景 B（所有権 marker）:
--   0015 の過去棚卸取込は「この要求で session upsert が成功した」印に
--   `sessions.ended_at = <この要求の時刻>` を使っていた。ミリ秒精度の時刻は
--   排他的 token にならない。同じミリ秒に内容の違う要求 A / B が届くと、
--   B へ 409 を返しながら B の明細・snapshot だけが A の session へ入りうる。
--
-- 変更:
--   完了要求の claim table を1つ追加する。1行 = 1セッションの確定済み完了。
--   fingerprint は **server が検証済みの値だけから作る canonical intent** の SHA-256
--   （種別・canonical日付・件数・合計・明細行）。client が送る値をそのまま指紋にしない。
--
--   claim の INSERT は完了本体と同じ db.batch（=1トランザクション）に置き、
--   `status <> 'completed'` を条件にする。PRIMARY KEY と合わせて、
--     ・同じセッションへ2回目の別内容 complete が来ても claim を取れない
--     ・並行して届いた2要求のうち片方だけが claim を取る
--   となる。以降の UPDATE / DELETE / INSERT / snapshot はすべて
--   「自分の fingerprint の claim 行が存在すること」に従属させるため、
--   claim を取れなかった側の書き込みは1行も残らない。
--
--   時刻ではなく fingerprint を guard にするので、同一ミリ秒でも区別できる。
--
--   取込側（0015 の import_batch_requests）も同じ方式へ揃える。こちらは
--   `(shop_code, session_id)` で引く経路（session削除・history削除との整合）が増えるため
--   索引を足す。
--
-- ロールバック:
--   **可能**。新規テーブルと索引の追加だけで、既存の行・列・制約・トリガに触れない。
--   戻す場合は DROP TABLE session_completions と DROP INDEX。0012 のような不可逆点ではない。
--   claim が無い状態へ戻ると、完了の上書き防止と replay 判定が 0016 適用前の挙動に戻るだけで、
--   保存済みの棚卸データそのものは壊れない。
--
-- 既存データ（切替境界）:
--   **0016 適用前に完了したセッションは claim 行を持たない。**
--   推測で fingerprint を作らない（当時の明細から再計算しても、当時の要求と同一である保証がない）。
--   claim を持たない completed セッションへ complete が届いた場合は、
--   内容が同じでも `409 completion_intent_conflict`（reason=`already_completed`）で fail-closed にする。
--   保存済みデータは無傷で、client は詳細APIで内容を確認できる。
--   移行と maintenance 条件は docs/quality-foundation/web-release-readiness.md を正とする。

CREATE TABLE IF NOT EXISTS session_completions (
  shop_code    TEXT    NOT NULL,
  session_id   TEXT    NOT NULL,
  fingerprint  TEXT    NOT NULL,
  type         TEXT    NOT NULL,
  taken_at     TEXT,
  item_count   INTEGER NOT NULL,
  total_value  INTEGER,
  completed_at TEXT    NOT NULL,
  PRIMARY KEY (shop_code, session_id)
);

-- 削除済み・削除保留のアカウントへ新しい完了記録を書かせない（0011 / 0012 / 0015 と同じ方針）。
CREATE TRIGGER IF NOT EXISTS trg_session_completions_active_insert
BEFORE INSERT ON session_completions
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

-- 取込台帳を session 単位で引けるようにする。
-- 通常の session 削除・history 削除で、対応する台帳行を同じトランザクションで消すため
-- （残すと「削除済みの取込」を replay で保存済みと誤回答する・§5）。
CREATE INDEX IF NOT EXISTS idx_import_requests_session
  ON import_batch_requests(shop_code, session_id);
