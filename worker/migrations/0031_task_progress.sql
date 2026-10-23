-- 0031: 進行中のやること（何日もかかる仕事・User決定 2026-10-23・モック docs/mocks/journal-inprogress.html / journal-today-modern.html）
--
-- 背景:
--   製氷機の修理・新メニューの準備のように1日で終わらないやることを、期限切れのまま残さず、経過を引き継げるようにする。
--   日付（task_date）は期限ではなく「次に見る日」として使う（その日の日誌に出る・過ぎても期限切れにしない）。
--
-- 変更:
--   tasks.progress     … 'doing'（進行中）/ 'waiting'（待ち）。NULL＝ふつうのやること
--   tasks.wait_note    … 何を待っているか（一言）
--   tasks.deadline     … 本当の期限（YYYY-MM-DD・任意）
--   tasks.steps_json   … 小さな手順 [{ id, text, done }]（任意）
--   tasks.last_note / last_note_by / last_note_at … 最後の経過（カードにすぐ出すための写し）
--   task_notes … 経過（1行＝1つの書き込み。足していくだけで直さない＝証跡）。時刻はサーバーが刻む
--   idx_task_notes_task … このマイグレーションの印
-- 既存データ: すべて NULL（ふつうのやること）。
-- ロールバック: 旧 Worker は新しい列と表を読まない（進行中はふつうのやることとして見える）。
ALTER TABLE tasks ADD COLUMN progress TEXT;
ALTER TABLE tasks ADD COLUMN wait_note TEXT;
ALTER TABLE tasks ADD COLUMN deadline TEXT;
ALTER TABLE tasks ADD COLUMN steps_json TEXT;
ALTER TABLE tasks ADD COLUMN last_note TEXT;
ALTER TABLE tasks ADD COLUMN last_note_by TEXT;
ALTER TABLE tasks ADD COLUMN last_note_at TEXT;
CREATE TABLE IF NOT EXISTS task_notes (
  id         TEXT PRIMARY KEY,
  shop_code  TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  body       TEXT NOT NULL,
  by_name    TEXT NOT NULL DEFAULT '',
  by_id      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes (shop_code, task_id, created_at);
