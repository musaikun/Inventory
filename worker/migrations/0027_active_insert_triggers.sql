-- 0027: 削除中・削除済みの店へ書かせないトリガーを、0018 以降のテーブルにも付ける
--
-- 背景（TEST-003・User 了承 2026-10-13）:
--   0011 は業務テーブルごとに「削除中（deletion_pending_at）・削除済み（deleted_at）の店へは
--   INSERT できない」トリガーを付け、0012 / 0015 / 0016 / 0017 も同じ形で足してきた。
--   0018 以降に足したテーブルには付いていなかった。ルーターは削除中の店の token と API を
--   止めているので実害は確認していないが、account削除の契約（削除中は再 INSERT も拒否）を
--   テーブル単位で守る多重防御が欠けていた。worker/test/accountDeletionCoverage.sqlite.test.js が
--   「shop_code を持つ全テーブルにこのトリガーがある」ことを確かめる。
--
-- 変更（トリガーの追加だけ。既存の行・列・index には触れない）:
--   trg_discarded_sessions_active_insert … 0018 破棄して24時間取り戻せる下書き
--   trg_tasks_active_insert … 0020 やること
--   trg_staff_active_insert … 0022 スタッフ
--   trg_staff_invites_active_insert … 0022 招待
--   trg_staff_login_attempts_active_insert … 0022 暗証番号の失敗
--   trg_work_sessions_active_insert … 0025 開いていた記録
--   最後の trg_work_sessions_active_insert をこのマイグレーションの印にする（scripts/migrate.sh）。
--
-- 既存データ: 変わらない。INSERT（ON CONFLICT を含む）のときだけ、店が有効かを確かめる。
-- ロールバック: 可能。DROP TRIGGER で戻る（旧 Worker はトリガーの有無に依存しない）。

CREATE TRIGGER IF NOT EXISTS trg_discarded_sessions_active_insert
BEFORE INSERT ON discarded_sessions
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

CREATE TRIGGER IF NOT EXISTS trg_tasks_active_insert
BEFORE INSERT ON tasks
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

CREATE TRIGGER IF NOT EXISTS trg_staff_active_insert
BEFORE INSERT ON staff
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

CREATE TRIGGER IF NOT EXISTS trg_staff_invites_active_insert
BEFORE INSERT ON staff_invites
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

CREATE TRIGGER IF NOT EXISTS trg_staff_login_attempts_active_insert
BEFORE INSERT ON staff_login_attempts
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

CREATE TRIGGER IF NOT EXISTS trg_work_sessions_active_insert
BEFORE INSERT ON work_sessions
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
