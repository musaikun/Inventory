# TEST-003 — テストの見直し

- 状態の正本は [`../task-list.md`](../task-list.md)
- 着手: 2026-10-12 / Claude Code（User指示「Docsとテストを見直したい」）

## 調査（2026-10-12・`develop@8e37bae`）

- App 216 files / 2125 tests（約2分）、Worker 47 files / 700 tests（11秒）。skip・todo 0。
- **書かれているのに実在しないテスト**: 権限表（App `services/permissions.js` と Worker `src/permissions.js`）の冒頭に
  「同じ中身にする。テストで突き合わせる」とあるが、突き合わせるテストが無かった。
- **遅い**: `AxisAssignFocus.groups.test.js` が30秒（テスト時間全体の約36%）。rAF を本物の時間で60フレームずつ待つため。
- **重複**: `App.*.test.js` 14本がそれぞれ約50〜200行（計約1500行）の同じ準備（API・analytics のモック、マウント）を持つ。
- **専用テストの無い部品**: Worker `validate.js`・`moneyGuard.js`・`presenceHandler.js`（他のテスト経由のみ）、
  App `useStockView`・`notifyPrefs`。account削除が shop_code を持つ全テーブルを消すことを確かめるテストも無い
  （新しいテーブルを足したときに削除漏れを検出できない）。

## 段階

| 段 | 内容 | 状態 |
|---|---|---|
| 1 | 権限表の App/Worker 一致テスト（`worker/test/permissionsParity.test.js`）。`vitest.config.js` の古いコメント | 完了 2026-10-12 |
| 2 | 遅いテストを偽の時計に | 未着手 |
| 3 | Worker `validate`・`moneyGuard`・`presence` の直接テスト、account削除の全テーブル網羅テスト | 未着手 |
| 4 | App テストの準備部分を共通化 | 未着手 |

## 検証（段1）

- 定数（ROLES・GRANT_KEYS・PERMS・GRANT_PERMS）の一致、役割6種（3役割＋owner＋不明2種）×足し引き34通り×権限20種（19＋存在しない1）の `can()`、
  `normalizeGrants`・`extraGrants` の一致。要点（アルバイトの権限・金額とスタッフ管理は足し引きでも増えない・管理者/オーナーは全部）も固定。
- App 側の `GRANT_PERMS.itemEdit` から1つ外すと2件落ちることを確認して戻した。
- Worker 48 files / 706 tests pass。
