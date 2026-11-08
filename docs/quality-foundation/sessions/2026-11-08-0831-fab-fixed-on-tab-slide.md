# 2026-11-08 — タブを移ったとき＋のボタンがずれた所に出てから下がる

- version: 0.197.0 → **0.197.1**

User: （画面録画）在庫・業務管理の＋が最初ずれた位置に出て、そこから下に動く。固定にしてほしい
- 原因: タブの面を滑らせる animation が `transform` を使っていた。transform の間は中の `position: fixed`（＋）が画面ではなく面に付くため、面の下端（下のメニューの分だけ上）を基準に出て、animation が終わると画面基準に戻って下がる
- 変更: `SessionListPage.vue` の面の animation を `position: relative` ＋ `left` に（transform を使わない）。`JournalPage.vue` に重複していた `.jp-fab`（absolute）の指定を削除し、既存の fixed の指定だけに
- 検証: app vitest 全件 pass、build OK。実機での見え方は未確認（develop preview で確認してほしい）
