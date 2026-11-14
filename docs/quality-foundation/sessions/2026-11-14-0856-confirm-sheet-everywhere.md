# 2026-11-14 — 確認とお知らせを、すべてアプリの中のシートに

- version: 0.210.0 → **0.211.0**

User: 残りのダイアログも、統一感と世界観を合わせる
- 標準の `confirm()` / `window.confirm()` 20か所と `alert()` / `window.alert()` 17か所を、`composables/askConfirm.js` の `askConfirm`・`notify`（新）へ。App に置いた `ConfirmSheet` 1つで出る。製品コードに標準の confirm / alert は残っていない
  - 確認: 設定（表示のリセット）、ルームの共有（ルームを閉じる）、品目マスタの全削除、履歴の削除、レポートの記録の削除、セッションの削除（`useSessionLauncher.remove`）、振り分けのグループ削除、チャットの送信取り消し、オーナーの名前、ログアウト、日誌（やること・メモを消す）、業務の追加（捨てて閉じる・イベントを消す・定期を消す）、チェック表（閉じる・消す）、進み具合（消す）、品目の全入れ替え（`confirmMasterImport` は async に）
  - お知らせ（ボタン1つ）: 権限が無い（`denyMessage`）、並び替えの名前の重複、PDF・ファイルの読み込み失敗、品目マスタの削除をやめた
  - 書き方を揃えた: 題は「〜しますか？」、本文に結果、ボタンに動詞（「削除する」「消す」「ルームを閉じる」「ログアウト」）。消す・閉じる・捨てるは赤（`danger`）。「よろしいですか？」「本当に」は題と重なるので外した
  - `notify` は確認を出している最中なら、それが閉じてから出す（落とさない）
- test: `test-stubs/askConfirmBridge.js`（新）で、従来の `confirm` / `alert` の stub へ橋渡し（8ファイルに1行ずつ）。`masterImportWarning.test.js` は async とシートの中身を見る形に書き直し。`askConfirm.test.js` に notify 2件
- 検証: `cd app && npm run build` OK ／ `npm test` 240 files・2271 pass ／ `cd e2e && npx playwright test` 1 passed ／ ローカル Worker＋実ブラウザで ルームを閉じる（キャンセル）・ホストがホームへ戻る・ログアウト をシートで確認 ／ `node scripts/check-docs-links.mjs`
- feature-checklist: 同期・API・D1・認可は変更なし（N/A）。確認のあとの処理は同じ。標準と違い訊いている間も裏が動くが、対象は押した本人の操作（削除・閉じる）で、App の完了系だけ `_ask()` で stale を見ている
- 残件: 標準の `prompt()` が3か所（並び替えの名前など・入力欄のあるシートが要る）。PC の UI は User が考え直す
