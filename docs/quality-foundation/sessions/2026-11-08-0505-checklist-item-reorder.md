# 2026-11-08 — チェック表: 項目を並べ替え

- version: 0.195.4 → **0.195.5**

User: チェック表の項目も並び替えできるようにしてほしい
- `ChecklistTemplatesPage.vue`: 各項目の左に ⋮⋮。長押しして上下へ運ぶ（`useListDragReorder`、導線の順番と同じ操作）。上下キーでも動く。↑ボタンは廃止。入力欄（書き直し）を押しても掴まない
- 検証: app vitest（ChecklistTemplatesPage に並べ替えのテスト追加）全件 pass、build OK、画面を確認
