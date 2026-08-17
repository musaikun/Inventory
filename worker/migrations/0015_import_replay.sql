-- 0015: 過去棚卸取込の「同じ要求か」を永続的に判定できるようにする（DATA-002 §2）
--
-- 背景:
--   取込は (shop_code, importBatchId, 日付) から決まる session_id へ収束するので、
--   セッションが重複することは無かった。しかし **上書き（replaceSessionIds）を伴う要求**は
--   応答喪失からの再送で復帰できなかった。
--
--     1. client が replaceSessionIds=[A] で取込を投げる
--     2. server は A を消して取込セッションを作り、成功を返す
--     3. 応答がネットワークで失われる
--     4. client がまったく同じ要求を再送する
--     5. A はもう存在しないので、上書き対象の事前検査が not_found で 409 を返す
--
--   client から見ると「取り込めなかった」ように見えるが、実際には取り込まれている。
--   取込済みのデータと矛盾する表示になり、取消して取り直す以外に復帰手段が無かった。
--
--   一方で「同じ batchId で中身の違う要求」は別の意図なので、通してはいけない。
--   その2つを区別するには、要求の内容そのもの（fingerprint）を永続化する必要がある。
--   session 行や store_history からは、削除済みの上書き対象集合を復元できない。
--
-- 変更:
--   取込要求の台帳を1テーブル追加する。1行 = 1つの (店舗, バッチ, 対象日) 要求。
--   fingerprint は「日付・明細・上書き対象集合」の SHA-256。
--     - 台帳に同じ key があり fingerprint も一致  → 前回と同じ結果をそのまま返す（冪等）
--     - 同じ key で fingerprint が違う            → 409 import_intent_conflict
--     - 台帳に無い                                 → 通常の検証と書き込みを行う
--   台帳の INSERT は取込本体と同じ db.batch（=1トランザクション）へ入れる。
--   並行して届いた同一要求は、PRIMARY KEY 違反で片方の batch ごと巻き戻り、
--   台帳を読み直して同じ成功結果へ収束する。
--
--   PRIMARY KEY を (shop_code, batch_id, import_date) にしているのは、
--   「1リクエスト = 1日ぶん・複数日は同じ batchId で繰り返す」という取込APIの設計に
--   合わせるため。同じバッチの別日付は**別の要求単位**であり、衝突ではない。
--
--   取消（DELETE /imports/:batchId）はこのバッチの台帳行も消す。
--   消さないと、取り消した後の再取込が「replay」と判定されて何も書かなくなる。
--
-- ロールバック:
--   **可能**。新規テーブルの追加だけで、既存の行・列・制約・トリガに触れない。
--   戻す場合は DROP TABLE import_batch_requests。0012 のような不可逆点ではない。
--   台帳が無い状態へ戻ると、応答喪失からの再送は 0015 適用前と同じ 409 に戻るだけで、
--   取込済みデータそのものは壊れない。
--
-- 適用前後で既存テーブルの行数は変わらない。
--
-- 既存の取込バッチ（このmigration適用前に作られたもの）は台帳行を持たない。
-- **その場合の現行契約は「黙って上書きしない」**:
--   - 台帳が無いと「前回と同じ要求か」を判定する材料が無い。明細から fingerprint を
--     再計算しても当時の要求と同一である保証がないため、**推測で fingerprint を作らない**。
--   - 同じ batchId + 同じ日付への再送は、内容が同じであっても
--     `409 legacy_import_unverified` で拒否する（fail-closed）。
--   - 取り込み直すには `DELETE /imports/:batchId` で**明示的に取り消して**から再取込する。
--     取消は台帳行も消すので、そのあとは通常どおり記録が始まる。
--   - 同じバッチの**別日付**は影響を受けない。
-- 運用上の扱いと preflight は docs/quality-foundation/web-release-readiness.md の
-- 「migration → Worker deploy の切替境界」を正とする。

CREATE TABLE IF NOT EXISTS import_batch_requests (
  shop_code   TEXT    NOT NULL,
  batch_id    TEXT    NOT NULL,
  import_date TEXT    NOT NULL,
  fingerprint TEXT    NOT NULL,
  session_id  TEXT    NOT NULL,
  item_count  INTEGER NOT NULL,
  total_value INTEGER,
  replaced    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  PRIMARY KEY (shop_code, batch_id, import_date)
);

-- 取消はバッチ単位。(shop_code, batch_id) で台帳行をまとめて消す。
CREATE INDEX IF NOT EXISTS idx_import_requests_batch
  ON import_batch_requests(shop_code, batch_id);

-- 削除済み・削除保留のアカウントへ新しい取込記録を書かせない（0011 / 0012 と同じ方針）。
CREATE TRIGGER IF NOT EXISTS trg_import_requests_active_insert
BEFORE INSERT ON import_batch_requests
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
