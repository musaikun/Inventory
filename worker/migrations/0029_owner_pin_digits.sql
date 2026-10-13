-- 0029: オーナー PIN を6桁へ（User 決定 2026-10-13・D-030）
--
-- 背景: オーナーの PIN は4桁（1万通り）で、アカウント単位の段階的なロック（0028）を入れても
--   1年で当たる見込みが約19%残っていた。新しく登録する店は6桁（スタッフと同じ決まり・pinPolicy.js）にし、
--   以前に4桁で登録した店は、次にログインしたときに6桁への変更を求める。
--
-- 変更:
--   stores.pin_digits … オーナー PIN の桁数。NULL は以前の4桁（変更を求める）、6 は変更済み・新規登録
--   idx_stores_pin_digits … まだ4桁の店を数える（移行の進み具合）。このマイグレーションの印にもする（scripts/migrate.sh）
--
-- 既存データ: すべて NULL（＝4桁）。登録は4桁しか受け付けていなかったので、実際の桁数と一致する。
-- ロールバック: 可能。DROP INDEX idx_stores_pin_digits。列は残しても旧 Worker は読まない
--   （ただし旧 Worker は4桁しか受け付けないため、6桁にした店は旧 Worker ではログインできない。戻すなら注意）。
ALTER TABLE stores ADD COLUMN pin_digits INTEGER;
CREATE INDEX IF NOT EXISTS idx_stores_pin_digits ON stores (pin_digits);
