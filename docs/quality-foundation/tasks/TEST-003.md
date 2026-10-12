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
| 2 | 遅いテストを偽の時計に（`AxisAssignFocus.groups.test.js` 30秒→約3秒） | 完了 2026-10-12 |
| 3 | account削除の全テーブル網羅（`worker/test/accountDeletionCoverage.sqlite.test.js`）、`validate.js`・`moneyGuard.js` の直接テスト。presence は `test/staff.test.js` が結合で通しているので足さない | 完了 2026-10-12 |
| 4 | App テストの準備を共通化（`app/src/test-support/appHarness.js`）。形が同じだった戻る系6本（pageBack・orderBack・stockBack・reloadPage・importBack・deleteBack）を移した | 完了 2026-10-12 |
| 次の候補 | 残り8本（complete・authLoss・auditPersist・hideUndo・hideRequest・guestBack・inviteUrl・deleteRoute）は useSync のモックや店舗 ABCDEF の作り方がそれぞれ違うので、そろえる価値を見てから。DOM を使わない純粋なテストを `node` 環境で回す（App 全体の時間の大半は jsdom の準備：環境 196秒・テスト本体 77秒） | 未着手 |

## 見つかったこと（User 判断）

- **削除中の店への書き込みを止めるトリガーが、0018 以降のテーブルに無い**。0011 は業務テーブルごとに
  「削除中・削除済みの店へは INSERT できない」トリガーを付け、0015〜0017 も同じ形で足していたが、
  `discarded_sessions`（0018）・`tasks`（0020）・`staff` / `staff_invites` / `staff_login_attempts`（0022）・
  `work_sessions`（0025）には無い。ルーターは削除中の店の token・API を止めているので、これは多重防御の欠け。
  直すなら migration 0027 でトリガーを足す（本番適用は User）。`accountDeletionCoverage` のテストが今の例外一覧を持ち、
  新しいテーブルが黙ってトリガー無しで増えるのを止める。
- **空白だけの数量が 0 として通る**。`parseQty(' ')`・`parseCount(' ')` は `Number(' ') === 0` で 0 を返す。
  「在庫0と入力不能を同じ値にしない」という validate.js の方針と食い違う。App は数値にしてから送るので実害は確認していない。
  直すなら trim して空なら拒否（入力の契約が変わるので User 判断）。

## 検証（段1）

- 定数（ROLES・GRANT_KEYS・PERMS・GRANT_PERMS）の一致、役割6種（3役割＋owner＋不明2種）×足し引き34通り×権限20種（19＋存在しない1）の `can()`、
  `normalizeGrants`・`extraGrants` の一致。要点（アルバイトの権限・金額とスタッフ管理は足し引きでも増えない・管理者/オーナーは全部）も固定。
- App 側の `GRANT_PERMS.itemEdit` から1つ外すと2件落ちることを確認して戻した。
- Worker 48 files / 706 tests pass。

## 検証（段2〜4）

- 段2: rAF・performance.now・setTimeout だけを偽にした（Date は本物。Vue は listener を付けた時刻と同じ時刻のイベントを捨てるため、
  Date を止めると新しく出た入力欄への input が無視される）。3回続けて 52件 pass・約3秒。並べ替えの長押しをわざと無くすと、
  元のテストと同じ4件が落ちる（検出力は同じ）。
- 段3: `accountDeletion.js` から `work_sessions` の削除を1行抜くと、新しい網羅テストは落ち、手書きモックの既存テスト（13件）は通ってしまうことを確認した。
  `validate.test.js` 13件、`moneyGuard.test.js` 8件。
- 段4: 6本のテスト件数は移行前後で同じ（34件）、1170行→997行。
- App 216 files / 2125 tests pass（114秒。移行前は134秒）、build 成功。Worker 51 files / 730 tests pass。
