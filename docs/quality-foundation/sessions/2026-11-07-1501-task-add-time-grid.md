# 2026-11-07 — 業務の追加: 時刻をモーダルの中で選ぶ・カレンダーを左右スワイプ・チェック表の名前欄

- version: 0.195.0 → **0.195.1**

User: 時計のモーダルを重ねず1つのモーダルで完結、カレンダーは左右スワイプで月送り、チェック表の名前を入力欄らしく
- 新規 `TimeGrid.vue`（時0〜23・分5分ごとを押すだけ）。TaskAddSheet の時刻モーダルは 始まり／終わり の切り替え＋TimeGrid（始まりを決めると終わりへ、分で閉じる）。端末の type=time は使わない
- TaskAddSheet と CopyDatesSheet のカレンダーに左右スワイプ（useHorizontalSwipe）
- ChecklistTemplatesPage: 見出しは「チェック表を作る／直す」、名前は見出し付き・枠と地の色のある入力欄に
- 直す画面（TaskRow・ChecklistsPage）は新規 `InlinePick.vue`（その場で開くカレンダー／TimeGrid）に置き換え
- 検証: app vitest 2218 pass（スワイプ・時刻の選び方のテスト追加）、build OK、画面を確認
- 残件: 在庫系（入出庫・期限ロット・書き出し等）の日付欄は端末の入力のまま
