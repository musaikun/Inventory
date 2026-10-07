-- 0026: やることの時刻と、担当の人への通知（TODO 本格化 A・User決定 2026-10-07）
--
-- 変更:
--   tasks.due_time … その日の時刻 'HH:MM'（NULL＝時刻なし）。一覧は時刻の順に並べる
--   push_subscriptions.actor_id … 通知を受ける端末が誰のものか（スタッフ ID、オーナーは端末 ID）。
--     スタッフはサーバーがトークンから入れる。担当になった人の端末にだけ「あなたの担当」を送るのに使う
--   idx_push_actor … このマイグレーションの印
-- 既存データ: どちらも NULL（時刻なし／誰の端末か不明＝担当の通知は届かない。次に通知を開いたときに入る）。
-- ロールバック: 旧 Worker は新しい列を読まない。
ALTER TABLE tasks ADD COLUMN due_time TEXT;
ALTER TABLE push_subscriptions ADD COLUMN actor_id TEXT;
CREATE INDEX IF NOT EXISTS idx_push_actor ON push_subscriptions (shop_code, actor_id);
