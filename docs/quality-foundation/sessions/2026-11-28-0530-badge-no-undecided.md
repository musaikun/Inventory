# 2026-11-28 — 締め切り未定の進行中は業務タブの数に入れない

- version: 0.223.0 → **0.223.1**

User: 未定の進行中も数に入れないで（前回 0.223.0 の残件）

- `useTasks.js` の `todayOpenCount`: 締め切りがあるものは締め切りの日から、締め切りの無い進行中は数えない。期間の無いふつうのやることは今まで通り（その日から・期限切れも）
- `useTasks.test.js`: 未定の進行中・期間の無いふつうのやることを足して確かめる

検証: `cd app && npm run build` OK ／ `npm test` 249 files・2327 pass ／ `node scripts/check-docs-links.mjs`
