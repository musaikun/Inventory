-- 0028: 暗証番号の総当たりを、アカウント単位で段階的に止める（オーナーとスタッフ）
--
-- 背景（User の合格ライン 2026-10-13）:
--   ① 100万通りを試す以前に、数十回程度で攻撃コストが急激に上がる
--   ② IP を変えるだけでは突破できない
--   ③ API を直接叩いても同じ制限
--   ④ 店のスタッフ3〜10人が同時に使っても影響しない（店の Wi-Fi では全員が同じグローバル IP）
--   さらに、同時リクエストで上限をすり抜けられないこと。
--
--   それまでは、スタッフは「店×名前×端末ID（送る側が決める）」で15分5回、オーナーは「店」で15分5回の
--   固定窓だった。端末IDを変えれば数え直しになり、数えてから確かめて記録するまでが別の文なので、
--   同時に送れば上限を超えて試せた。また固定窓なので、何日かければ何回でも試せた。
--
-- 変更:
--   login_guard … 1行＝1つのアカウント（店×オーナー、店×スタッフの名前）。
--     fails        … 最後の成功（またはこの記録の消滅）からの試行回数。確かめる**前**に1つ数える
--     locked_until … この時刻（epoch ms）まで試させない。5回ごとに 15分→30分→1時間→…→24時間（上限）
--     last_at      … 最後に試した時刻（epoch ms）。7日あいたら数え直す
--   数える・止めるの判定は1つの UPSERT（RETURNING）で行う（同時リクエストでもすり抜けない）。
--   正しい暗証番号なら行を消す。IP や端末IDは持たない（IP 単位の制限は ip_attempts が別に受け持つ）。
--   idx_login_guard_last … 掃除（毎時の cron）用。このマイグレーションの印にもする（scripts/migrate.sh）
--   trg_login_guard_active_insert … 削除中・削除済みの店へは書かせない（0011 / 0027 と同じ）
--
-- 既存データ: 無し（新しい表）。staff_login_attempts は使わなくなるが、旧 Worker へ戻すときのために残す。
-- ロールバック: 可能。DROP TABLE login_guard（旧 Worker はこの表を読まない）。
CREATE TABLE IF NOT EXISTS login_guard (
  shop_code    TEXT    NOT NULL,
  account_key  TEXT    NOT NULL,
  fails        INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  last_at      INTEGER NOT NULL,
  PRIMARY KEY (shop_code, account_key)
);
CREATE INDEX IF NOT EXISTS idx_login_guard_last ON login_guard (last_at);

CREATE TRIGGER IF NOT EXISTS trg_login_guard_active_insert
BEFORE INSERT ON login_guard
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
