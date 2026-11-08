# 2026-11-08 — 丸い＋を完全に統一・店の今の進行中は実施日から

- version: 0.197.2 → **0.197.3**

User: （画面録画）＋ボタンのデザインに差がある → 完全統一。店の今の進行中がすべて 11/8（作った日）になる → 実施日のほうがよい
- `style.css` に共通の `.app-fab`（58px・線の＋28px・同じ影・下のメニューの上に画面固定）。在庫（StockPage）・業務管理のカレンダー（JournalPage）・その日（DayTimeline）の＋をこれに。旧クラス名（sp-fab/jp-fab/dt-fab）は目印として残し、見た目の指定は削除。下のメニューの無い単独の在庫画面だけ下端20px
- `services/homeNow.js` progressBars: 始まりを `t.date`（追加の画面で選んだ日付）に。先の日なら「m/dから」
- 検証: app vitest 全件 pass、build OK
