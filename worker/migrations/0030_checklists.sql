-- 0030: チェック表（中の項目＋繰り返し・User決定 2026-10-19・モック docs/mocks/journal-checklist.html）
--
-- 背景:
--   開店チェック・退店チェックのような「項目のあるやること」を、繰り返しで毎日（曜日・毎月N日）出す。
--   中身はひな形として1つ持ち、日ごとの✓はその日の記録に分けて残す（終わらなかった日は持ち越さず「未完了」で残る）。
--
-- 変更:
--   checklists … 1行＝1つのチェック表（ひな形）。店ごと。作る・直すのは管理者だけ（ルーターで確かめる）
--     items_json   項目 [{ id, text }]（並びのまま）
--     repeat_mode  'none'（1回きり）/ 'daily' / 'weekly' / 'monthly'
--     repeat_days  weekly: 曜日（0=日〜6=土）のカンマ区切り / monthly: 日（1〜31。月に無い日は月末）
--     start_date   none: その日 / 繰り返し: 予定を数え始める日（繰り返しを変えた日。以前の日は記録のある日だけ出す）
--     due_time     'HH:MM' か NULL（終日）
--     assign_mode  'anyone' / 'person'（assignee_id・assignee_name）
--     paused       1 ＝ お休み（今日から先に出さない。記録は残る）
--     deleted_at   消した印（他の端末へ「消した」を届けるため行は残す）
--   checklist_runs … 1行＝あるチェック表の、ある日の記録
--     items_json   その日の項目（最初の✓のときのひな形の写し。あとで表を直しても、その日の記録は崩れない）
--     marks_json   { 項目 id: { s: 'done'|'skip', by, byId, at, reason? } }。時刻はサーバーが刻む
--   idx_checklist_runs_date … 店舗×日付で引く（このマイグレーションの印）
--
-- ロールバック:
--   可能。新しい表だけ。DROP TABLE checklist_runs; DROP TABLE checklists; で戻る（旧 Worker はこの表を読まない）。
CREATE TABLE IF NOT EXISTS checklists (
  id            TEXT PRIMARY KEY,
  shop_code     TEXT NOT NULL,
  name          TEXT NOT NULL,
  items_json    TEXT NOT NULL DEFAULT '[]',
  repeat_mode   TEXT NOT NULL DEFAULT 'none',
  repeat_days   TEXT,
  start_date    TEXT NOT NULL,
  due_time      TEXT,
  assign_mode   TEXT NOT NULL DEFAULT 'anyone',
  assignee_id   TEXT,
  assignee_name TEXT,
  paused        INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_checklists_shop ON checklists (shop_code);
CREATE TABLE IF NOT EXISTS checklist_runs (
  shop_code     TEXT NOT NULL,
  checklist_id  TEXT NOT NULL,
  run_date      TEXT NOT NULL,
  items_json    TEXT NOT NULL,
  marks_json    TEXT NOT NULL DEFAULT '{}',
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (shop_code, checklist_id, run_date)
);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_date ON checklist_runs (shop_code, run_date);
