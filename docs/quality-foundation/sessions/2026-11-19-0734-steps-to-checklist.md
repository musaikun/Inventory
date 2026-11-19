# 2026-11-19 — 手で入れた手順をチェック表に入れる

- version: 0.214.0 → **0.215.0**

User: 進行中を登録するときチェック表を選ぶと手順として付く（それは良い）。逆に、チェック表を選ばずに手で入れた手順を、チェック表として登録したい
- `composables/stepsToChecklist.js`（新）: 名前を訊いて（初めは業務の名前・`askText`）、手順の文だけを `saveChecklistTemplate` で新しいチェック表に。✓ の有無は持ち込まない。同じ名前があれば閉じずに「同じ名前のチェック表があります」。権限はチェック表を作るのと同じ（`canAddTemplate`）
  - 同じ項目（同じ順）のチェック表がもうあれば、ボタンを出さない（チェック表から付けた手順・入れた直後）
- `ProgressSheet.vue`（進行中の手順）に「この手順をチェック表に入れる」、`TaskSteps.vue`（やることの子タスク）に「この子タスクをチェック表に入れる」。入れたら「チェック表「名前」に入れました」
- 入れたチェック表は、業務の追加の「チェック表」から選べる（実ブラウザで確認）
- test: `stepsToChecklist.test.js`（新4件）、`ProgressSheet.keep.test.js`（新2件）
- 検証: `cd app && npm run build` OK ／ `npm test` 245 files・2301 pass ／ `cd e2e && npx playwright test` 1 passed ／ ローカル Worker＋実ブラウザで 締め切り未定の進行中 → 手順を3つ手で足す → チェック表に入れる（名前の初めは業務名）→ 業務の追加の「チェック表」に出る を確認 ／ `node scripts/check-docs-links.mjs`
- feature-checklist: API・D1・認可は変更なし（既存のチェック表の保存を使う）
