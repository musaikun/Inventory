-- 0020: カレンダーの「やること」（店で共有するTODO）
--
-- 背景（User決定 2026-10-04）:
--   履歴カレンダーを下部ナビの「カレンダー」タブにし、日ごとに 予定（自動）・やること・記録 を並べる。
--   やることは店で共有し、他の人が追加したら通知とカレンダーの「新着」で知らせる。
--   「誰が」は今は端末名（スタッフごとのログインができたら本人に置き換える）。
--
-- 変更:
--   tasks … 1行＝1件のやること。消すときは deleted_at を立てて残す（他の端末へ消したことを伝えるため）
--     id          端末が作るID（重複送信しても1件）
--     task_date   やる日（YYYY-MM-DD）
--     body        内容（200文字まで）
--     created_by / created_by_id  追加した端末の名前とID（自分の追加を「新着」に数えないため）
--     done_at / done_by           完了した時刻と端末名（NULL なら未完了）
--     updated_at  最後に変えた時刻（端末の時刻。新しい方を残す）
--   idx_tasks_date … 店舗×日付で引く（カレンダーの読み出し・このマイグレーションの印）
--
-- ロールバック:
--   可能。新しい表だけ。DROP TABLE tasks で戻る（旧 Worker はこの表を読まない）。
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  shop_code     TEXT NOT NULL,
  task_date     TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_by    TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  done_at       TEXT,
  done_by       TEXT,
  deleted_at    TEXT,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(shop_code, task_date);
