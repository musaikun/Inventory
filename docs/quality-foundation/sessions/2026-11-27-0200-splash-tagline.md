# 2026-11-27 — 起動画面の一言を「お店の毎日を、ひとつに。」に

- version: 0.218.5 → **0.218.6**

User: 起動画面の下の一言を、将来 HACCP も入るので「店舗支援サービス」のような一言に。
候補から「お店の毎日を、ひとつに。」を選択。変えるのは起動画面だけ（説明文は今のまま）

- `app/src/appInfo.js` の `APP_TAGLINE` を変更（使っているのは `StartupSplash.vue` だけ）
- そのまま: `index.html` の description・og:description、`vite.config.js` の manifest の description、`AGENTS.md` の見出し（「在庫とやることを、ひとつに。」）

検証: `cd app && npm run build` OK ／ `npx vitest run src/components/StartupSplash.test.js` 3 pass ／ `node scripts/check-docs-links.mjs`
