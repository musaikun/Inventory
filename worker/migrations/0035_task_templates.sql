-- 0035: やることのお気に入り（ひな形・User決定 2026-11-05・モック docs/mocks/task-create.html）
--
-- 背景:
--   よく使うやること・チェック表・ルーティンを店で共有のひな形にして、追加の画面で押すだけで中身を入れる。
--
-- 変更:
--   task_templates … 1行＝1つのお気に入り。店ごと
--     kind      'task'（やること）/ 'checklist'（チェック表）/ 'routine'（ルーティン）/ 'progress'（進行中）/ 'someday'（いつか）
--     name      名前（追加の画面の名前にそのまま入る）
--     data_json 中身 { items?, dueTime?, dueTimes?, repeat?, repeatDays?, assign?, note? }（日付は持たない＝使うときに選ぶ）
--     sort      並び（小さい順）
--     deleted_at 外した印（他の端末へ「外した」を届けるため行は残す）
--   idx_task_templates_shop … 店ごとに引く（このマイグレーションの印）
--
-- ロールバック:
--   可能。新しい表だけ。DROP TABLE task_templates; で戻る（旧 Worker はこの表を読まない）。
CREATE TABLE IF NOT EXISTS task_templates (
  id            TEXT PRIMARY KEY,
  shop_code     TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'task',
  name          TEXT NOT NULL,
  data_json     TEXT NOT NULL DEFAULT '{}',
  sort          INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_templates_shop ON task_templates (shop_code, sort);
