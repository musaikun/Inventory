# 横断改善タスクボード

最終更新: 2026-08-19

**このファイルが状態の正本です。** 状態・優先度・担当を変えるときは、まずここを更新します。
根拠・実装・検証証拠・完了条件は [`tasks/`](tasks/) 配下の各タスクファイルにあります。

- 状態: `未着手` / `進行中` / `レビュー待ち` / `保留` / `完了` / `リスク受容`
- 担当: `未割当` / `Codex` / `Claude Code` / `User`
- P0 は認可・データ境界または**現在のWeb公開**を直接blockする項目

現在は[Web公開準備](web-release-readiness.md)に含まれるP0/P1と品質基盤だけを実装し、
新機能、Stripe、trial、TWA、Google Play提出作業は原則保留します。
D-021以前の2週間計画は[履歴](sprint-plan-2026-07-27.md)として保持します。

> **CCセッションの実行計画は [`cc-session-plan.md`](cc-session-plan.md) にあります。**
> Codexレビューの修正を3セッションへ分け、各回の範囲、受入条件、必須test、
> 引き渡し方法をまとめた**指示出し用の一時文書**です。
> CC側の作業を始めるときは、まずそちらを読んでください（状態の正本は本ファイルのままです）。

## 現在のマイルストーン: Web Free版

| ID | P | 状態 | 担当 | Web公開との関係 | 詳細 |
|---|---:|---|---|---|---|
| WEB-001 | P0 | 進行中 | Codex | 公開契約・独立採点基盤を更新中。production変更はWEB-01のUser判断待ち | [WEB-001.md](tasks/WEB-001.md) |
| PLAY-002 | P0 | レビュー待ち | User | code review済み。canonicalと実機確認待ち | [PLAY-002.md](tasks/PLAY-002.md) |
| PLAY-003 | P1 | 保留 | Codex | canonical/release candidate確定後にWeb最終照合 | [PLAY-003.md](tasks/PLAY-003.md) |
| OPS-001 | P1 | 保留 | Codex | 事前調査済み。最小observability・構造化log・互換日確認 | [OPS-001.md](tasks/OPS-001.md) |
| PRIV-001 | P1 | 保留 | Codex | release candidateで分析無効・通信なしを検証 | [PRIV-001.md](tasks/PRIV-001.md) |
| IMPORT-001 | P1 | レビュー待ち | Claude Code | 品目マスタ取込・過去棚卸取込の非破壊性・preview・error明細を公開契約へ適合 | [IMPORT-001.md](tasks/IMPORT-001.md) |
| DATA-002 | P1 | レビュー待ち | Claude Code | 別端末で履歴詳細を読めない実害と参照不整合。sessionId identityとserver原子性まで実装。stock/order別の完了契約、完了確定の一意化（claim/fingerprint）、replaceの原子guardまで修正（**App側7点の追随が必要**） | [DATA-002.md](tasks/DATA-002.md) |
| SEC-005 | P1 | 未着手 | Codex | 公開登録とlegacy店舗作成の濫用防止 | [SEC-005.md](tasks/SEC-005.md) |
| DATA-001 | P1 | レビュー待ち | Codex | 棚卸完了を含む複数writeの部分失敗防止。完了失敗時の状態保持とpending latest-winsを含む | [DATA-001.md](tasks/DATA-001.md) |
| TEST-002 | P1 | 保留 | Codex | package分離済み、critical integration/E2Eが残る | [TEST-002.md](tasks/TEST-002.md) |

`DO-001`は重要な既知P1ですが、現時点の監査ではdata破壊を伴わないため、
ownerと回避策を付けてWeb公開後へ送れる候補です。正式なrelease受容はWEB-001で判断します。

## 次のマイルストーン

| ID | P | 状態 | 担当 | 対象 | 詳細 |
|---|---:|---|---|---|---|
| PLAY-004 | P1 | 保留 | Claude Code | TWA、reviewer、store listing、screenshots | [PLAY-004.md](tasks/PLAY-004.md) |
| DO-001 | P1 | 未着手 | Codex | 公開後の同期UX改善候補 | [DO-001.md](tasks/DO-001.md) |
| UI-001 | P2 | レビュー待ち | Claude Code | デスクトップ表示（>=1024px サイドナビ + 本文カラム） | [UI-001.md](tasks/UI-001.md) |

`UI-001`はUser指示で**実装済み**ですが、`WEB-01`〜`WEB-10`のどのgateにも含まれません。
gateへ追加するか公開後へ送るかは[提案箱](../proposals.md)のPMトリアージ待ちです。
モバイル表示は非改変のため、release gate側の375px検証をやり直す必要はありません。
実ブラウザでの目視確認は未実施です。

14日trial/StripeはD-021のA1将来フローとして保持します。W1完了前に実装タスクを開始しません。
Web登録へのtrial適用とStripe/backendの単独公開順はUser判断待ちです。

## 完了

2026-07完了分の詳細は [`tasks/completed-2026-07.md`](tasks/completed-2026-07.md)。
2026-08完了分は [`CI-001.md`](tasks/CI-001.md)、[`DEP-001.md`](tasks/DEP-001.md)、
[`DOC-001.md`](tasks/DOC-001.md)。
各詳細内の「未実施」は完了記録時点の状態です。
2026-07完了分は`develop@96233d4`まで、CI-001は`develop@7d47cb4`で初回完了し、
現在HEAD `develop@bc9fb85`のpreview CIも成功済みです。
DEP-001、PLAY-002/003/004の直近成果は`develop@bc9fb85`までにcommit / push済みです。
Pro Reviewは2026-08-01にdeploy済みですが、本番Pages / Workerの現行化と本番D1 migrationは未実施です。

| ID | P | 完了日 | 担当 | 概要 |
|---|---:|---|---|---|
| SEC-001 | P0 | 2026-07-25 | Codex | WebSocket の参加完了前メッセージを遮断 |
| SEC-002 | P0 | 2026-07-25 | Codex | 注文 upsert の店舗境界を保証 |
| PLAY-001 | P0 | 2026-07-25 | Codex | account削除backendと関連data削除 |
| SEC-003 | P1 | 2026-07-25 | Codex | Push 購読 API の認証・検証を追加 |
| BUG-001 | P1 | 2026-07-25 | Codex | cron の存在しない列参照を修正 |
| SEC-004 | P1 | 2026-07-26 | Codex | ホスト認可境界を fail-closed 化 |
| TEST-001 | P1 | 2026-07-26 | Codex | 仕入先順の仕様を決め App テストを復旧 |
| DOC-000 | P2 | 2026-07-25 | Codex | 共有監査・引き継ぎ基盤を作成 |
| REPO-001 | P3 | 2026-07-25 | Codex | ローカル生成物を `.gitignore` に追加 |
| CI-001 | P1 | 2026-08-02 | Codex | `develop` のtest/buildとPages preview自動実行 |
| DEP-001 | P1 | 2026-08-02 | Codex | 本番依存の high 脆弱性を解消または隔離 |
| DOC-001 | P1 | 2026-08-06 | Codex | docsの正本・現行・将来・履歴をWeb先行へ整理 |

## 保留（P2 / P3）

詳細は [`tasks/backlog.md`](tasks/backlog.md)。スプリント後に優先度を再評価します。

| ID | P | 状態 | 担当 | 概要 |
|---|---:|---|---|---|
| REF-001 | P2 | 保留 | 未割当 | 大型コンポーネントと composable を段階分割 |
| PERF-001 | P2 | 保留 | 未割当 | フロント bundle を分割 |
| SEC-006 | P2 | 保留 | 未割当 | 店舗コード・PIN・保存トークンを再評価 |
| CFG-001 | P2 | 保留 | 未割当 | Claude Code の古い hook/command を可搬化 |

## 統合済みの課題（新規IDは作らない）

以下は独立したタスクIDを持たず、既存タスクの中で扱います。

| 課題 | 統合先 |
|---|---|
| CIのNode 20で`node:sqlite`が起動せず、依存packageのengine要件とも不一致 | [CI-001](tasks/CI-001.md) |
| AppのVitestがWorkerテストを重複実行する問題（分離済み。critical E2E等は未完） | [TEST-002](tasks/TEST-002.md) |
| `postcss` / `xlsx` の production high 脆弱性 | [DEP-001](tasks/DEP-001.md) |
| TWAでの価格・購入面（D-021のP1） | [PLAY-004](tasks/PLAY-004.md) |
| Free 2台制限のserver整合（D-016のW1公開面） | [WEB-001](tasks/WEB-001.md) |
| 履歴の端末依存とデータ源の不整合（`R-001` / `F-001`〜`F-004`） | [DATA-002](tasks/DATA-002.md) |
| ホームを棚卸中心の順路へ戻す画面再編（旧 `UI-002`。実体fileを持たず`UI-001.md`へ誤リンクしていた） | [UI-001](tasks/UI-001.md) |

実使用バグの報告全文・コード根拠・本番D1の調査結果は [`bug-reports.md`](bug-reports.md) に保存しています。

## 変更履歴

- 2026-08-19（レビュー修正3回目）: Codex の残P1 1件を修正し、`レビュー待ち / Claude Code` を維持。
  `MasterManagePage` / `MovementPage` の画面内「‹ 戻る」が `@back` → App の直接 view 切替で
  import中断guardを迂回していた（モーダルに focus trap が無く、キーボードTabで背景の戻るへ到達できる）。
  App へ共通ハンドラ `onPageBack()` を追加して両ページの `@back` を集約し、`isBackBlocked()` が
  true なら view を切り替えない。guard解除後は通常どおり戻れる。両ページ×2件の回帰testを
  `App.importBack.test.js` へ追加（修正前に2件失敗を確認）。
  focus trap / inert 化はa11yの別課題として残risk記録に留めた。
  検証: App 95 files / 1135 passed、build成功、Worker 26 files / 545 passed。`worker/**` に差分なし。
- 2026-08-19（レビュー修正2回目）: Codex の `Changes requested` P1 2件を修正し、`レビュー待ち / Claude Code` を維持。
  (1) PWA / ブラウザBackがモーダルのclose禁止を迂回していた。`App._closeTopLayer()` は
  `master`/`movement` から直接 view を切り替えるため、`requestClose()` を通らず unmount され
  `importBatchId` と計画を失っていた。`appMenuState.js` へ Back guard の登録口を追加し
  （既存の削除モーダルと同じパターン）、`App.vue` の `_closeTopLayer()` 先頭で参照する。
  **`App.vue` を import 1行 + ガード1行だけ変更した**（当初の変更禁止指定に対する例外。
  `_closeTopLayer()` は App にしか無く、この経路はここでしか塞げない。第1・第2セッションは merge 済み）。
  (2) `tokenizeCSV` がセル途中の引用符を引用開始として受理し、閉じたあとの文字も許可していたため
  `foo"bar"baz` が**エラーなしで `foobarbaz`** になっていた（全取込入口で品目名が無通知で変わる）。
  引用符はセル先頭でだけ開始可・閉じたら区切りまで、の厳密な状態機械にし `CSV_ERROR_BAD_QUOTE` を追加。
  引用符前後の空白のみ許容（値は変わらないため）。
  検証: App 95 files / 1131 passed、build成功、Worker 26 files / 545 passed。`worker/**` に差分なし。
- 2026-08-19（レビュー修正）: Codex の `Changes requested` P1 3件を修正し、`レビュー待ち / Claude Code` を維持。
  (1) 取消必須の409（`mustCancel`）でも modal を閉じられないようにした。閉じると
  `useDataImport.closeStocktake()` が計画と `importBatchId` を捨て、履歴に別の取消導線が無いため
  `DELETE /imports/:batchId` を二度と呼べなくなっていた（前回「閉じてよい」とした判断の訂正）。
  (2) `resultCsvParser` / `deliveryImportParser` にヘッダとの列数照合を追加。列がずれた行を
  正常データとして受理していた（納品取込では品目名まで別列へずれる）。
  (3) 過去棚卸取込で、日付空欄の実データ行を無通知で捨てず行エラーとして preview へ出すようにした。
  追加10 testが修正前に失敗することを確認済み。
  検証: App 94 files / 1110 passed、build成功、Worker 26 files / 545 passed。
  `worker/**`・`App.vue`・`useStore.js`・`useDataImport.js`・`api.js` に差分なし。
- 2026-08-19: `IMPORT-001` の branch へ `develop@2060090` を merge し、`レビュー待ち / Claude Code` を維持。
  競合は `session-log.md` / `task-list.md` の2fileだけで、**コード側の競合はゼロ**（両方の記録を残して解決）。
  あわせて `DATA-002` から送られていた**引継ぎ6（`409 legacy_import_unverified` の導線）**へ対応した。
  0015のreplay台帳が返す `legacy_import_unverified` / `import_record_missing` / `import_intent_conflict` は
  サーバー側にデータが残るため、再試行は出さず**取消の導線を必ず残す**（統合前の分類のままだと
  「取り消してください」と言われているのに取消ボタンが消えた。develop単独・branch単独では起きない統合時のみの不具合）。
  検証: App 94 files / 1096 passed、build成功、Worker 26 files / 545 passed。
  `worker/**`・`App.vue`・`useStore.js`・`useDataImport.js`・`api.js` に差分なし。
  **migration 0012〜0016は本番未適用。`migration → Worker → App` の順で出す必要がある。**
  詳細は [`IMPORT-001.md`](tasks/IMPORT-001.md)。
- 2026-08-19: DATA-001 の再レビュー残件をCodexが直接修正し、`進行中` →
  `レビュー待ち / Codex`へ戻した。解散開始時点ですでにWebSocketがCONNECTINGだと、
  未open socketを閉じられず旧ルームへ遅延joinする問題を修正。接続試行中socketの追跡、
  接続世代による遅延callback失効、退出/account切替cleanup、旧Promiseによる新room stateの
  巻き戻し防止と回帰testを追加した。`worker/**`・migrationは変更していない。
- 2026-08-17: DATA-001 の App第2セッション（完了ライフサイクル・同期キュー）を実装し、
  `進行中` → `レビュー待ち / Claude Code` へ戻した。第1修正セッションが確定した
  **stock/order 別の完了契約**へ App を合わせ、snapshot なしで完了APIを呼ぶ経路を無くした
  （発注は `{ itemCount }` だけを送る）。完了中・結果不明中に `active` を書き戻さない
  busy/unknown状態、完了要求の同一body再送（409 `completion_intent_conflict` 対策）、
  保存レーンの直列化、generationの作成時capture、snapshot ackの版一致、
  再ログインの drain→pull 順序、App mount testの5秒timeout要因の除去を含む。
  `DATA-002` の「Appへの引継ぎ7点」のうち **6（`409 legacy_import_unverified` の導線）は未対応**で、
  過去棚卸取込UIを扱う `IMPORT-001` へ送る。`worker/**`・migrationは変更していない
  （0012〜0016は引き続き未適用で、**migration → Worker → App の順**で出す必要がある）。
  `DATA-002` / `IMPORT-001` / `WEB-001` / `SEC-005` / `WEB-07` の状態・担当は変更していない。
- 2026-08-17（追加3）: 独立レビュー指摘を修正（状態は`レビュー待ち / Claude Code`のまま）。
  過去棚卸replaceの削除を3文→**5文**にし、旧`session_completions`・旧`import_batch_requests`まで
  同一transactionで消すようにした（孤児claim・stale台帳が通常操作で発生していた）。
  取消の対象取得SELECTを削除と同じ`db.batch`の先頭へ移し、`removed`/`sessionIds`が
  実際に消した対象と一致するようにした（事前SELECTの失敗も`cancel_failed`に含む）。
  migration 0015のコメントを`legacy_import_unverified`の現行契約へ修正（SQLは不変）。
  実測: 取込500行+replace50件=40 queries/99 binds、取消=6/3。`app/src`は差分ゼロ。
- 2026-08-17（追加2）: 再レビューHIGH 2件を修正。完了fingerprintの対象を**canonical snapshot全体**へ広げ
  （`code`/`category`/`auditLog` などを変えた再送が replay 成功し、server旧内容・端末新内容になる食い違いを解消。
  除外は `savedAt` / `activeMs` の2つだけ）、台帳を持たない既存取込を
  409 `legacy_import_unverified` で fail-closed にした（復旧は `DELETE /imports/:batchId` → 再取込）。
  切替境界の文書矛盾（必須 vs 許容）を解消し、現行docsの最終照合を 0016 まで へ同期、
  新しい409/400のHTTP伝播testを追加。`app/src`は差分ゼロ。
- 2026-08-17: DATA-002 の再レビュー指摘を修正し、`レビュー待ち / Claude Code` を維持。
  汎用PUTからの完了迂回を409 `use_complete_endpoint`で塞ぎ、棚卸日を`takenAt`ひとつに統一
  （不一致は400 `snapshot_date_mismatch`）、完了確定をserver生成fingerprintのclaimで一意化
  （**migration 0016 追加・未適用**／内容の違う再送は409 `completion_intent_conflict`）、
  過去取込の所有権guardから時刻markerを廃止して同じclaim方式へ統一、
  stale ledger/claimでの偽の成功をfail-closedにし、session/history/batch/account削除と整合させた。
  `MAX_REPLACE_SESSIONS`はguard再設計により40→**50へ復帰**。
  migration切替境界（preflight件数・maintenance条件）を`web-release-readiness.md`へ明文化し、
  現行docsのmigration記載を0010〜0016へそろえた。`app/src`は差分ゼロ。
  **App側5点の追随が必要**（詳細は [`DATA-002.md`](tasks/DATA-002.md)）。
  `DATA-001` / `IMPORT-001` / `WEB-001` / `WEB-07` の状態・担当は変更していない。
- 2026-08-16: DATA-002 の第1修正セッション（Worker / D1 / API整合性）を実装し、
  `レビュー待ち / Claude Code` へ戻した。stock/orderで完了契約を分離（orderは`store_history`を書かず
  正本は`orders`/`order_lines`）、stock snapshotをserver側でcanonical化、completed→activeの巻き戻しを409で禁止、
  過去棚卸replaceを要求台帳（**migration 0015 追加・未適用**）で応答喪失から復帰可能にし、
  replace権限を文中の原子guardへ移した。`POST /sessions`の不正typeがHTTP 400で返るようにし、
  revision応答を書込みと同じ`db.batch`で確定させた。migration 0014 / 0015 をリリース手順へ反映。
  `app/src`は差分ゼロ。**App側3経路（`session_ended`・完了済みからのホーム遷移・order完了）の追随が必要**で、
  必要な payload は [`DATA-002.md`](tasks/DATA-002.md) に記録した。
  `DATA-001` / `IMPORT-001` / `WEB-001` / `SEC-005` の状態・担当は変更していない。
- 2026-08-16: CC第3修正セッション（`develop@e095282` 起点）で `IMPORT-001` の取込データ品質を6点修正し、
  **レビュー待ち / Claude Code** へ戻した。ヘッダ有無の推測を選択値へ反映しない（`商品A` `品目セット` を
  見出し扱いにしない）、結果不明が残るあいだの modal close を3経路とも塞ぐ、HTTP失敗と通信結果不明を
  `status` の有無で分けて永続的4xxを再試行しない、Worker契約と同じ数量・単価上限をclientでも拒否、
  通貨記号を先頭1個だけ許可、閏年を含む実在日検証を両parserで共用。
  `worker/`、`App.vue`、`useStore.js`、`useDataImport.js`、`api.js` は無変更。
  **migration 0012・0013は本番未適用のまま。実D1・実browserは未確認。**
  ブラウザー更新・強制終了をまたぐ `importBatchId` の永続化は対象外で残riskに記録した。
  Codex承認前に `完了`・`WEB-07` 通過・release可としない。詳細は [`IMPORT-001.md`](tasks/IMPORT-001.md)。
- 2026-08-10: CCレビュー修正 第1〜第3セッションを実装し、`DATA-001` / `DATA-002` / `IMPORT-001` を
  **レビュー待ち / Claude Code** へ。第1=完了失敗時の状態保持とpending latest-wins、
  第2=sessionId中心の履歴identityと棚卸完了のserver原子性（migration 0012）、
  第3=品目取込のCSV厳格化・alias衝突の非破壊化・preview欠落項目の追加と、
  過去棚卸取込のsessionIdモデル接続（取込前preview・server保存確認・`importBatchId`単位の取消／
  migration 0013）。**migration 0012〜0015はいずれも本番未適用**。実D1と実browserは未確認。
  Codex承認前に`完了`・`WEB-07`通過・release可としない。
  旧 `UI-002` は実体fileを持たず`UI-001.md`へ誤リンクしていたため`UI-001`へ統合し、統合先を記録した。
  詳細は [`IMPORT-001.md`](tasks/IMPORT-001.md) / [`DATA-001.md`](tasks/DATA-001.md) /
  [`DATA-002.md`](tasks/DATA-002.md)、経緯は [`session-log.md`](session-log.md)。
- 2026-08-09: CC実装のCodex独立reviewで、品目取込のparser・alias衝突・preview・表示文言に
  公開前修正が必要と判定した。WEB-07配下の実装作業を追跡する`IMPORT-001`をP1で追加し、
  3セッションの修正計画を`cc-session-plan.md`へ更新した。既存タスクの状態・担当は変更していない。
- 2026-08-08: User判断で製品実装をClaude Code、release品質基盤と独立reviewをCodexへ分離。
  WEB-001を品質基盤更新として再開し、棚卸中心の公開契約とWeb向け共同採点を追加した。
  production変更、URL/contact、deploy承認待ちは継続する。
- 2026-08-05: `UI-001`（デスクトップ表示）を次のマイルストーンへ追加。User指示で実装済み・PMトリアージ待ち。
  release gate（`WEB-01`〜`WEB-10`）とWeb Free版のscopeは変更していない。
- 2026-08-04: D-021により現在目標をWeb Free版へ変更。WEB-001を新設し、DOC-001だけをCodex進行中へ変更。
  PLAY-004をA1へ保留し、Stripe/trialをA1将来フローへ分離した。
- 2026-08-01: 一覧と詳細を分離。詳細を `tasks/` 配下へ移し、完了分を `tasks/completed-2026-07.md`、
  P2/P3を `tasks/backlog.md` へ。`DATA-002` を P2 → **P1** へ変更し、実使用バグ `R-001` /
  `F-001`〜`F-004` を統合。既存の記録・完了条件・検証証拠は削除していない。
