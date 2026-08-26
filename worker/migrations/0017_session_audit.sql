-- 0017: 棚卸の操作ログ（変更履歴）を D1 に持つ
--
-- 背景:
--   変更履歴は「誰が・何を・いつ変えたか」の記録で、参加者別の重複カウントと
--   品目ごとの履歴の**正本**にあたる。商業利用では、数字が合わなかったときに
--   誰の入力を辿ればよいかを後から確認できることに価値がある。
--
--   0.83.0 までの置き場所はどちらも記録の正本になり得なかった:
--     - Durable Object … ルームの生存期間に縛られ、新しいセッションの開始で消える。
--       そもそも DO は「その場の調整役」であって system of record ではない。
--     - 端末の localStorage … 1台に依存する。完了前に端末を失えば記録ごと消える。
--   完了後は snapshot_json に入って D1 に残るが、**進行中は残らない**。
--   また DO の 1キー 128KiB 制限があるため、置き場所として上限も抱えていた。
--
-- 変更:
--   1操作 = 1行の table を1つ追加する。`id` は端末/DO が発行する監査エントリIDで、
--   これを PRIMARY KEY に使うことで **再送しても重複しない**（INSERT OR IGNORE）。
--   端末は入力のたびに1件ずつ送るのではなく、まとめて送る（1入力ごとに通信しない）。
--
--   `at` は端末時計の epoch ms。順序の根拠には使わず表示にだけ使う
--   （時計がずれた端末が「新しい」と主張できるため）。並べ替えは at → id の順で安定させる。
--
-- ロールバック:
--   **可能**。新規テーブルと索引の追加だけで、既存の行・列・制約・トリガに触れない。
--   戻す場合は DROP TABLE session_audit と DROP INDEX。0012 のような不可逆点ではない。
--   table が無い状態でも、Worker 側は書き込み失敗を握りつぶして棚卸を続行する
--   （記録の保存が棚卸そのものを止めてはならない）。0017 適用前の挙動に戻るだけ。
--
-- 既存データ:
--   過去に完了したセッションの操作ログは snapshot_json にしか無く、ここへは移さない。
--   履歴詳細は従来どおり snapshot_json を読むため、表示は変わらない。

CREATE TABLE IF NOT EXISTS session_audit (
  id            TEXT    NOT NULL,          -- 監査エントリID（端末/DOが発行・冪等キー）
  shop_code     TEXT    NOT NULL,
  session_id    TEXT    NOT NULL,
  item_name     TEXT    NOT NULL,
  action        TEXT    NOT NULL,          -- new / add / overwrite / remove / flag_recount / …
  delta         REAL,
  total_qty     REAL,
  unit          TEXT    NOT NULL DEFAULT '',
  entered_by    TEXT    NOT NULL DEFAULT '',   -- 表示名
  entered_by_id TEXT    NOT NULL DEFAULT '',   -- 端末ID（同名端末の区別・集計キー）
  at            INTEGER NOT NULL,          -- 端末時計の epoch ms（表示用）
  created_at    TEXT    NOT NULL,          -- server 時刻（ISO）
  PRIMARY KEY (shop_code, id)
);

-- セッションの全履歴を時系列で読む（詳細画面・再開時の復元）
CREATE INDEX IF NOT EXISTS idx_session_audit_session
  ON session_audit(shop_code, session_id, at);

-- 1品目の履歴だけを引く（品目ごとの変更履歴）
CREATE INDEX IF NOT EXISTS idx_session_audit_item
  ON session_audit(shop_code, session_id, item_name, at);

-- 削除済み・削除保留のアカウントへ新しい記録を書かせない（0011 / 0012 / 0015 / 0016 と同じ方針）。
CREATE TRIGGER IF NOT EXISTS trg_session_audit_active_insert
BEFORE INSERT ON session_audit
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
