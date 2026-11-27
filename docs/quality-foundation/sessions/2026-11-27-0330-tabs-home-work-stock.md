# 2026-11-27 — 下部ナビを ホーム／業務／在庫 に・レポートと設定はショートカットへ

- version: 0.218.6 → **0.219.0**

User: ホームの「ショートカット」の文言は不要では。設定のタブも不要では。HACCP が入ったら
レポートをホームに入れて、タブを ホーム／業務／在庫／HACCP の4つにしたい → 相談のうえ「全て進めて」

変更:
- `HomeTop.vue`: 見出し「ショートカット」を外した。ショートカットに「レポート」（`canSeeReport` の人だけ）を足し、「設定」の行き先を重ねて開く画面に
- `HomeFooterNav.vue`: タブは ホーム／業務（以前の「業務管理」）／在庫 の3つ。業務を在庫より前に
- `SessionListPage.vue`: タブは home・calendar・sessions だけ（保存されていた report・dashboard はホームに読み替え）。
  レポートは `ManagerDashboard`（重ねて開く形・`_showDashboard`）、設定は新しい `SettingsPage.vue`（`_showSettings`。中身は前の設定タブと同じ）。
  どちらも戻る・Escape で閉じる（モーダルの層）。レポートの「単価を確認」は閉じてから在庫タブへ
- `ManagerDashboard.vue`: 重ねて開いたときの見出しを「在庫分析」→「レポート」
- `App.vue`: 棚卸から戻るとき・ゲストの出口で設定も閉じる。戻るで設定を閉じる。PC の「品目マスタ」は設定を開く
- docs: `spec.md`・`project-status.md`・`test-cases.md`（U-01）を現行に
- HACCP の4つめのタブは HACCP を作るときに（使う店だけ出す・チェック表は業務と同じ仕組みで、HACCP タブは記録・帳票として見る場所、の方向で相談済み）

検証: `cd app && npm run build` OK ／ `npm test` 247 files・2314 pass（タブ前提のテストを新しい形に直した）／
`cd e2e && npx playwright test` 3 passed ／ 実ブラウザでホーム・設定・レポートの画面を確認 ／ `node scripts/check-docs-links.mjs`

残件: 管理者のショートカットは7つになり、最後の行が「設定」1つだけになる（3列）
