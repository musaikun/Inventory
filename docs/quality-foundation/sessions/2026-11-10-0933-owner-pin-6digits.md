# 2026-11-10 — オーナーの暗証番号を6桁に（D-036・案A・期限1か月）＋変更の画面

- version: 0.198.8 → **0.199.0**

User: 桁数はそろえる。4桁の店は案A（期限1か月）。変更の画面も作る
- Worker: 登録は6桁（`pinProblem`・弱い並び不可）。ログインは4桁も可、4桁で初めて入ったら `stores.pin_upgrade_due`=30日後、応答と `/auth/me` に `pinUpgrade { due, overdue }`（6桁なら null）。新規 `POST /auth/pin`（オーナーだけ・今の番号の間違いはログインと同じ回数制限・IP制限）。アカウント削除の PIN は4桁/6桁。文言「PIN」→「暗証番号」
- migration **0037_owner_pin_digits**（`stores.pin_digits`・`pin_upgrade_due`・印 `idx_stores_pin_upgrade`、`scripts/migrate.sh` に登録）。列が無くてもログイン・登録は止めない（fail-open）
- App: ログイン欄は4/6桁、登録は6桁。`PinChangeSheet.vue`（upgrade=ホームで「6桁に変えてください」・期限まで「あとで」＝その日は出さない・期限後は閉じられない／change=設定）。設定に「暗証番号を変える」（4桁なら「4桁」と期限）。削除画面も4/6桁
- docs: decisions D-036（他セッションの D-035 と衝突したので番号を変えた）、api-design・spec・security-review・account-deletion-contract・enterprise-design・pricing・play-reviewer-guide
- 検証: worker vitest 766 pass（`test/ownerPin.sqlite.test.js` 新規）、app vitest 2244 pass（`PinChangeSheet.test.js` 新規）、build OK、E2E 1 passed（helper を6桁に）。ローカル Worker に4桁の店を入れて実ブラウザで: 4桁で入れる→知らせ（12/10まで）→あとで→再読み込みで出ない→設定に「4桁」→6桁に変える→4桁は拒否・6桁で入れて知らせなし
- **本番に出す順番**: 先に migration 0037（Production Backend の apply）→ Worker → フロント。順番が逆でもログインは止まらない（期限・知らせが出ないだけ）。ただし新しいフロントの登録は6桁なので、Worker が古いままだと登録できない（古い Worker は4桁しか受けない）→ Worker を先に
