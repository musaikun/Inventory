# 2026-11-14 — 確認をアプリの中のシートに・開閉を再読み込みで保つ・残件の片付け

- version: 0.208.0 → **0.209.0**

User: 前回の残件も続ける
- 確認: `composables/askConfirm.js`＋`components/ConfirmSheet.vue`（新）。`App.vue` の標準 `confirm()` 8か所をすべて置き換え（棚卸・発注の完了／ゲストの入力完了の報告／練習の終了2か所／完了結果が不明のまま戻る／ホストがホームへ戻る／新しい棚卸でルームを解散／前回の棚卸を発注の参考に入れる）。ボタンに結果を書く（「完了する」「報告する」「解散して始める」など）
  - 標準と違い、訊いている間も裏が動く。`_ask()` は答えのあとに `isLifecycleStale` と画面（`currentView`）を確かめ、変わっていたら取りやめ扱い。画面が切り替わったら出ている確認は閉じる。訊いている間の2つ目は重ねない（連打）
  - `ConfirmSheet` は訊いている間だけ mount する（`useEscapeKey` が mount 中ずっと「戻る」の層を積むため。出しっぱなしにしたら戻るのテスト16件が落ちた）
  - ほかの部品に残る標準 `confirm()`（10か所・設定や取込など）は未着手
- 開閉: `InventoryTable.vue` に `openStateKey`（セッションID）。開いているグループと「人が触った並び」を sessionStorage（`_table_open_v1`・直近1セッションぶん）へ。同じタブの再読み込みで戻る
- まとめ: 送り直しで確定した棚卸（`onGoHome` の再送経路）でも `StocktakeDoneSheet` を出す（`_showStockDone`）
- ゲスト: ホストが完了したときの通知を「ホストが{棚卸|発注}を完了しました。ルームを閉じます」に（発注でも「棚卸」と出ていた）。使い方の説明（onboarding）は棚卸の画面にいる間だけ出す — ランディングへ戻されたゲストの画面に、閉じていない説明が重なったまま残っていた
- 確認だけ（変更なし）: 棚卸の行の「編集／削除」が手入力の品目だけに出るのは仕様（`manualItems`。取り込んだ品目は品目リスト側で直す）
- test: `askConfirm.test.js`（新3件）、`InventoryTable.expand.test.js`（開閉の保存2件）。`App.complete`・`App.authLoss`・`App.auditPersist` は `askConfirm` を `confirm` の stub へ橋渡しする mock を足して従来の検証を維持。E2E は helper がシートの「完了する」を押す
- 検証: `cd app && npm run build` OK ／ `npm test` 239 files・2266 pass ／ `cd e2e && npx playwright test` 1 passed ／ ローカル Worker＋実ブラウザ2台（ホスト＋ゲスト）で 畳む→再読み込みで畳んだまま・完了の確認シート→完了→まとめ・ゲスト側の通知（標準ダイアログは出ない）を確認 ／ `node scripts/check-docs-links.mjs`
- feature-checklist: 同期・API・D1・認可は変更なし（N/A）。完了の流れは await が1つ増えたので、上の stale 判定で旧セッションへの答えを捨てる
- 残件（User 判断）: ホストが完了したとき、ゲストは通知のあとランディング（ログイン・店舗の登録）へ戻る。登録していないアルバイトには行き止まりなので、「終わりました」の画面を出すかどうか。PC の UI は User が考え直す
