# 2026-11-28 — ホームの背景を月ごとに（日本の12か月）

- version: 0.228.2 → **0.229.0**

User: 背景を季節・月のモチーフで、今のアプリの雰囲気で。海外では？ → 絵は少なく線画で、パーツを1つずつ別に動かせばチープにならない。
モック（季節: https://claude.ai/artifact/4DT6eWm4G13bRrSqeugYu6・12か月: https://claude.ai/artifact/NevPW7Y1BC9rKUUYu4ZwZQ）を見て「1月は初日の出にして実装」

変更:
- `services/seasonBg.js`（新）: 月ごとの輪の色（3色）とモチーフ。1月 初日の出（太陽・後ろの光・雲）／2月 梅／3月 菜の花／4月 桜／5月 若葉／6月 雨／7月 星／
  8月 花火／9月 月とすすき／10月 紅葉／11月 銀杏／12月 雪の結晶。モチーフは1つずつ速さ・遅れ・揺れ・回りが違う（乱数は使わず毎回同じ見た目）。
  南半球（緯度マイナス）は6か月ずらし、季節の無い地域（緯度±15°以内）は今の色・モチーフなし（緯度は天気の位置。無ければ日本）。月末の3日は次の月の色へ寄せる。
  線の太さは大きさによらず一定（`vector-effect: non-scaling-stroke`）
- `HomeTop.vue`: 背景の輪の色を月ごとに（本日の状況の輪はいつもの色）、モチーフの層を足す。動きの名前はクラス、速さ・遅れは style。止める条件は輪と同じ
- `composables/useSeasonBg.js`（新）・`storageKeys.seasonBg`: 端末ごとのオン・オフ（既定オン）。`SettingsList.vue` の「この端末」に「季節の背景」（押すと切り替え）。`lineIcons` に leaf
- docs: `spec.md` のホームの行

検証: `cd app && npm run build` OK ／ `npm test` 255 files・2352 pass（`seasonBg.test.js` 新4件）／ `cd e2e && npx playwright test` 15 passed ／
実ブラウザで 1・4・8・10月の日付にして目視（一時 spec・commit しない）／ `node scripts/check-docs-links.mjs`
