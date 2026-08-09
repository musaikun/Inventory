# CCレビュー修正 3セッション計画（指示出し用）

- **Status:** 一時文書。Codexレビューで `Changes requested` となったCC実装の修正計画
- **Role:** Userが3つのCCセッションへ順番に渡す作業台本
- **Source of truth:** 状態は [`task-list.md`](task-list.md)、製品受入条件と公開可否は
  [`web-release-readiness.md`](web-release-readiness.md)、詳細は
  [`tasks/DATA-001.md`](tasks/DATA-001.md) / [`tasks/DATA-002.md`](tasks/DATA-002.md) /
  [`tasks/IMPORT-001.md`](tasks/IMPORT-001.md)
- **Last verified:** 2026-08-09 / `develop@dcf6874` / CC
  `claude/branch-operational-status-2lwwwu@8ff46af`
- **削除条件:** 3セッション、Codex再レビュー、参照移設、Markdown link検査がすべて完了した後。
  **第3セッションだけで削除しない**

本書は実行順を示す一時台本であり、タスク状態や公開契約の正本ではありません。

## 推奨運用

3セッションは**並行させず、第1 → 第2 → 第3の順**に実行します。
`App.vue`、`useStore.js`、`useHistory.js`が複数セッションで重なるためです。

1. 第1は`8ff46af`を含む最新CC HEADから開始する。開始時にremoteが進んでいれば最新descendantを確認する。
2. 各回は実装・検証・報告で止め、Userの指示なしにcommit / pushしない。
3. Userがcheckpoint commitを承認した後、次回はそのcommitを含むHEADから開始する。
4. 別branchにする場合も、第2は第1、第3は第2の承認済みHEADから作る。
   3本すべてを`8ff46af`から分岐しない。
5. 第3終了後にCodexが全差分を独立reviewする。CC判断で`完了`やrelease可にしない。

`develop@dcf6874`とCC branchの共通祖先は`f8da4c1`です。文書に重複があるため、
developを機械的にmergeせず、第3で3-wayの意味を確認して統合します。

## 全セッション共通

開始時:

1. `AGENTS.md`を全文読み、そこに列挙された必読文書を指定順に全文読む。その後、本書と対象task詳細を読む。
2. `git status --short --branch`、`git branch --show-current`、`git log -1 --oneline`を確認する。
3. Userや別agentの既存差分を保持し、不明な差分をreset、checkout、stashしない。
4. 対象P1だけを`進行中 / Claude Code`へ戻す。`WEB-001 = 進行中 / Codex`、
   `SEC-005 = 未着手 / Codex`は維持する。
5. 失敗を再現するtestを先に追加するか、同じ差分に含める。
6. Workers / D1変更ではCloudflare skillsと実装時点の公式資料を確認する。

### 第1開始前に行うtask boardの意味統合

CC側`8ff46af`のtask-listはdevelopより古い状態を含むため、コード着手前に次だけを手で統合します。
文書全体の3-way統合は第3で行います。

- `dcf6874`のcontractを含む最新developの状態を基準に、他タスクを古い状態へ戻さない。
- `WEB-001`は`進行中 / Codex`を維持する。
- DATA-001 / DATA-002は今回の修正開始として`進行中 / Claude Code`へ戻す。
- `IMPORT-001`は`未着手 / Claude Code`のまま追加し、第3開始時に`進行中`へ変える。
- `SEC-005`は`未着手 / Codex`を維持し、`着手可`や完了を付けない。
- DATA-002の旧「Codex完了まで着手しない」は削除せず、2026-08-09のUser継続指示で
  前提が置き換わった履歴を追記する。

維持する公開契約:

- 品目取込は非破壊defaultで、全置換・上限超過・不正行を処理前に確認できる。
- 棚卸完了はsession・明細・snapshotの部分成功を残さず、再試行しても重複しない。
- 別端末から正しい履歴明細を取得でき、同日複数回を上書きしない。
- 過去棚卸取込はpreview、server保存確認、batch取消、calendar/detail整合を持つ。
- 入出庫・発注確認はβで、棚卸とaccount削除はβ機能なしで完結する。

Phase 3や過去棚卸取込を公開後へ送るのは、Userの新しい明示判断を`decisions.md`へ
記録した場合だけです。新機能、Stripe、trial、TWA、Google Play作業は追加しません。

## セッション一覧

| Session | 目的 | 主な範囲 |
|---|---|---|
| 第1 | 完了失敗と保留保存によるdata損失を止める | App完了処理、pending queue、警告表示 |
| 第2 | sessionId中心の履歴とserver原子性を完成させる | App、Worker、必要ならmigration |
| 第3 | 品目・過去棚卸取込を安全化し、全体統合する | 取込処理/UI、通しtest、現行docs |

---

## 第1セッション — 完了失敗と保留保存の安全化

### CCへ渡す指示

`8ff46af`を含む最新CC HEADで、「完了失敗時の状態破棄」とpending saveの
整合性を修正してください。今回はApp側の止血に限定し、Worker、履歴schema、品目取込、
`SEC-005`には触れないでください。

主な対象:

- `app/src/App.vue`
- `app/src/composables/useSession.js`
- `app/src/composables/useStore.js`
- `app/src/components/ConnectionBanner.vue`
- `app/src/utils/storageKeys.js`
- `app/src/composables/accountData.js`
- 関連App test

### 1. 完了失敗時に作業状態を保持

- `completeSessionD1()`が`ok:false`、5xx、通信断なら、`_clearDraft`、`clearSession`、
  `broadcastSessionEnd`、`dissolveRoom`、完了一覧への遷移、完了analyticsを行わない。
- host / solo双方でdraft、pending session、入力値、room、参加者状態を保持する。
- 同じ画面から同じ完了要求を再試行可能にする。
- 成功後だけ終了通知・room解散・draft削除・session clear・遷移を各1回行う。
- 表示文言を実状態と一致させる。

### 2. pending queueをlatest-winsかつ直列化

- `kind + shopCode + resourceId`とrevision/順序で保存対象を識別する。
- 古いpending Aより新しいBが成功した後、Aの再送でBを巻き戻さない。
- 同じ対象は最新版へ集約し、成功済みrevision以前を破棄する。
- 起動、接続復帰、手動、timerが同時でもdrainを1本にする。
- network / 5xx / retry可能な429と、恒久4xx・認証失効を区別する。
- logout、account切替、再loginで別店舗dataを送らない。

### 3. 永続化失敗を隠さない

- snapshot 20件、order/movement 200件の`slice`による無言欠落を廃止する。
- quota、serialization失敗、上限、再起動復元を明示的に扱う。
- 永続化できない変更を「端末に保存済み」と表示しない。
- bannerはofflineより未保存警告を優先し、件数と次の操作を示す。
- 状態変化を`aria-live`で通知する。

### 必須test

- host / soloの完了失敗でdraft・session・room・画面を維持する。
- 再試行成功時だけcleanup、broadcast、navigationを各1回行う。
- A失敗 → 同じIDのB成功 → A retryでもBを巻き戻さない。
- 同一対象の複数更新、同時drain、再起動、quota、上限、別account、logout/relogin。
- 400/409/413/429/5xx/通信断とbanner / `aria-live`。
- 純関数だけでなく、完了画面をmountするApp level testを含める。

### 検証・引き渡し

- targeted test、`app`の`npm test`、`npm run build`を実行する。
- rootで`git diff --check`と`git status --short`を確認する。
- 変更file、対象HEAD、全commandと結果、未実施、判断、残riskを報告する。
- DATA-001 / DATA-002は原則`進行中`のままにする。
- commit / push / deployは行わず、Userのcheckpoint指示を待つ。

---

## 第2セッション — sessionId中心の履歴整合と完了原子性

### CCへ渡す指示

第1セッションの承認済みcheckpointを含むHEADから開始し、履歴identity、棚卸完了の
server原子性、D1規模適合性を修正してください。品目取込と`SEC-005`には触れないでください。

主な対象:

- `worker/src/index.js`
- `worker/src/storeHandler.js`
- `worker/src/inventoryLines.js`
- `worker/src/constants.js`
- `worker/migrations/`（必要な場合のみ。適用は禁止）
- `scripts/migrate.sh`とmigration列挙test（migration追加時）
- `app/src/App.vue`
- `app/src/composables/useHistory.js`
- `app/src/composables/useStore.js`
- `app/src/components/SessionListPage.vue`
- `app/src/services/historyBackfill.js`
- `app/src/services/snapshotFromLines.js`
- 関連App / Worker test

### 1. sessionIdを履歴の正本identityにする

- sessionIdがある場合、日付一致だけのlocal snapshotを先に採用しない。
- 同日に2回以上棚卸しても、一覧・詳細・削除・backfillで別sessionとして保持する。
- client時刻の`updatedAt`だけで新旧判定せず、server revisionまたはserver時刻を使う。
- 別端末では、選択したsessionIdのserver明細を取得し、別sessionのsnapshotを表示しない。
- legacy日付キーdataの移行・fallbackは誤表示よりfail-closedを優先し、testと文書へ残す。

### 2. session・lines・snapshotを同一完了処理にする

- `saveSnapshotToD1()`を完了APIより先に独立成功させない。
- session完了、`inventory_lines`、表示・分析用snapshotを1つのserver-side処理で原子的に保存する。
- 一部だけ成功した状態を作らず、同一要求の再送を冪等にする。
- client cleanupは第1の契約どおり、server成功後だけ行う。
- schema変更が必要ならmigration fileとrollback不能点を追加し、test DBのfresh適用を確認する。
  development / production D1には適用しない。

### 3. 注文・入出庫とserver validationを補強

- order / movementの作成だけでなく、明細DELETE + header DELETEも原子的にする。
- ID、日付、文字列、配列件数、payload全体をserverで検証する。
- qtyは有限値、許容範囲、0・負数の扱いを業務契約どおり固定する。
- 棚卸qtyの非有限値を黙って0へ変換しない。
- 他店舗ID、存在しないID、競合時にtenant境界を崩さない。

### 4. D1実行上限を証拠化

- `MAX_LINES_PER_REQUEST = 5000`を前提にせず、最新のD1公式制限へ照合する。
- N+2 statementsの設計がFree plan、payload、bound parameter、30秒制限に適合するか確認し、
  証拠に基づく上限と実装へ合わせる。
- 0、1、150、351、採用上限、上限+1でtestする。
- runtimeに近いlocal testを追加する。
- 隔離non-production D1での351品目試験はUserの明示承認後だけ行う。
  production D1 write、migration、deployは禁止する。
- batch内statementがFreeのquery数へどう数えられるかは公式記述だけで断定しない。
  実D1未実施なら成功と書かずrelease gateへ残す。

参考:

- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

### 必須test

- 同日2 sessionが別々に一覧表示され、それぞれ正しい明細を開く。
- localに同日別sessionのsnapshotがあっても取り違えない。
- 端末時計が前後しても古いsnapshotを別sessionへbackfillしない。
- 別端末の一覧 → 詳細 → CSVが同じsessionIdを使う。
- 他店舗sessionIdは存在有無を漏らさない。
- 各writeへの失敗注入で全rollbackまたは一貫した再試行可能状態になる。
- 同じ完了要求の再送で重複しない。
- order / movementの作成・削除途中失敗で部分状態を残さない。
- 不正日付、長すぎるID/文字列、NaN/Infinity/負数、上限超過を拒否する。

### 検証・引き渡し

- Worker / App targeted testを実行する。
- `worker`で`npm test`を実行し、全件成功を確認する。
  5秒timeoutを再現した場合、単独成功を全体成功と読み替えず、原因と安定化結果を報告する。
- `app`で`npm test`と`npm run build`を実行する。
- migration追加時は全migrationのfresh適用testと列挙testを実行する。
- `git diff --check`と`git status --short`を確認する。
- DATA-001 / DATA-002へ対象HEAD、command、結果、未実施、migration有無を追記する。
- `SEC-005`は変更しない。第2差分の固定・統合後にCodexが着手する。
- commit / push / deploy / migration適用は行わず、Userのcheckpoint指示を待つ。

---

## 第3セッション — 取込全体のdata品質と最終引き渡し

### CCへ渡す指示

第2セッションの承認済みcheckpointを含むHEADから開始し、品目取込と過去棚卸取込を
公開契約へ適合させ、全体testと現行文書を統合してください。棚卸中心UIとβ境界を維持し、
新機能へ拡張しないでください。

主な対象:

- `app/src/utils/itemImport.js`
- `app/src/composables/useConfig.js`
- `app/src/components/ItemImportPreviewModal.vue`
- `app/src/components/MasterManagePage.vue`
- `app/src/components/SettingsModal.vue`
- `app/src/components/PdfImporterModal.vue`
- CSV mapper / Excel importの既存経路
- `app/src/utils/resultCsvParser.js`
- `app/src/composables/useDataImport.js`
- `app/src/composables/useHistory.js`
- 過去棚卸取込とcalendar/detailのcomponent / service / test
- `worker/src/index.js` / `worker/src/storeHandler.js` / `worker/src/constants.js`
- `worker/migrations/`とmigration test（必要な場合のみ。実環境への適用は禁止）
- `docs/api-design.md`（過去棚卸APIを追加・変更する場合）
- 現行docsと品質基盤

### 1. CSVと品目取込をstrictにする

- quoted commaの`1,200`を`1`として扱わない。
- escaped quote、CRLF/LF、BOM、日本語、重複、空欄を仕様どおり処理する。
- 閉じていないquote、列数不一致、invalid numberを黙って受理しない。
- headerなしfileで先頭品目をheaderとして捨てず、明示mappingまたはerrorにする。
- 不正数値を「現在値を維持」にすり替えず、行番号・列・理由をpreviewへ出す。
- CSV、mapped CSV、Excel、PDFを共通preview contractへ通す。

### 2. aliasとpreviewを実変更へ一致

- 既存品目Bのaliasを、新規/更新品目Aが無言で奪わない。
- alias衝突をpreviewに表示し、取消または明示解決なしにcommitしない。
- `categoryCodes`、`axisNames`、alias、名称切り詰め、削除対象、Free上限超過を表示する。
- 追加・更新・変更なし・除外・errorの件数と各行理由を表示する。
- previewとcommitで判定を二重化せず、同じ計画dataを使う。

### 3. merge / replace / undoの説明を一致

- 通常操作は非破壊mergeとし、fileに無い既存品目を消さない。
- replaceは別操作として、削除対象と保持対象を実行前に示す。
- 発注点を保持・消去する条件を表示と実装で一致させる。
- backup/undoがあるなら「元に戻せない」と表示しない。ないなら取消を約束しない。
- cancel、Escape、modal closeは1回だけ処理し、configを変更しない。

### 4. 過去棚卸を第2のsessionId modelへ接続

- commit前previewを表示する。
- server保存成功を確認してから完了表示し、localだけの成功を作らない。
- `importBatchId`単位で取消し、server結果を確認する。
- 同日sessionがある場合、上書き・別session追加・cancelの影響と選択肢を事前表示する。
- 取込後のcalendarとdetailが同じsessionIdを参照する。
- 取消後の再取込を冪等にし、別batchや通常棚卸を削除しない。
- create / cancel APIはstrict Bearer認証と`shop_code`境界の内側へ置く。
- create / cancelをserver側で原子的・冪等にし、payload、行数、日付、文字列を検証する。
- migrationが必要ならtest DBのfresh適用と後方互換を確認し、development / production D1へ適用しない。

### 5. UI・docs最終統合

- mobile 375px、desktop 1024px以上、keyboardで棚卸が第一導線のままか確認する。
- 入出庫は任意β、発注確認は非送信の確認・記録βであることを維持する。
- bannerとimport errorの読み上げ通知を確認する。
- `dcf6874`のcontractを含む最新developを確認し、公開契約を3-wayで意味を確認して統合する。
- `WEB-001 = 進行中 / Codex`を維持する。
- DATA-001 / DATA-002 / IMPORT-001は証拠提出後だけ`レビュー待ち / Claude Code`へ戻し、`完了`にしない。
- `UI-002`の実体なし・`UI-001.md`誤linkを解消する。新IDを正式作成しないならUI-001へ統合する。
- `docs/project-status.md`、必要なAPI文書、DATA詳細、`session-log.md`を実装へ同期する。
  履歴snapshotの`docs/quality-foundation/project-status.md`は編集しない。
- 削除済み`cc-session-plan.md`への参照切れを解消し、本書はCodex再レビューまで削除しない。
- CC側のsession-log / proposalsに残る旧計画のS2/S3/S4/S6や手動台本への意味参照を、
  対応するtask詳細・恒久test文書へ移設する。必要なら手動台本を含む削除直前版
  `36fc8ad`（`2e14e23`の親）から旧計画を履歴snapshotとして保存し、
  新計画の同名pathへ旧sectionがあるように見せない。
- README、task-list、session-log、proposalsを含むlocal Markdown linkを全件検査する。
- Web向けscorecard適用の既存文書差はCodex / User判断へ残し、CC判断で変更しない。
- 未実施test、実D1、実browser確認を成功扱いしない。

### 必須test

- `1,200`、escaped quote、unclosed quote、headerなし、BOM、日本語、invalid number、duplicate。
- alias衝突で既存品目を傷つけず、解決内容がpreviewとcommitで一致する。
- `categoryCodes`、`axisNames`、名称切り詰め、削除、上限、行errorがpreviewに出る。
- merge / replace / cancel / undoの実装と文言が一致する。
- 全取込経路が共通previewを通るcomponent / integration test。
- 過去棚卸のpreview → server保存確認 → calendar/detail → batch取消 → 再取込の通しtest。
- 同日2回、別batch、通常棚卸との衝突で意図しない上書き・削除がない。
- 過去棚卸APIの未認証、他店舗、payload上限、create/cancel途中失敗、同一batch再送。

### 検証・最終引き渡し

- App targeted test、`npm test`、`npm run build`を実行する。
- 過去棚卸のWorker targeted testと、第2を含む統合状態でWorkerの`npm test`を実行する。
- migration追加時は全migrationのfresh適用testと列挙testを実行する。
- `git diff --check`、`git status --short`、local Markdown link、Markdown table列を確認する。
- [`../feature-checklist.md`](../feature-checklist.md)を照合し、N/Aには理由を付ける。
- 変更file、最終HEAD、全commandと結果、未実施、判断、残risk、migration有無、rollback観点を報告する。
- Codexへ、完了失敗、pending latest-wins、同日session、atomic complete、D1 351件、
  CSV/alias、過去棚卸、docs conflictの再レビューを依頼する。
- 状態は`レビュー待ち`まで。Codex承認前に`完了`、WEB-07通過、release可としない。
- commit / push / deploy / migration適用はUserの明示指示まで行わない。

## 禁止事項

- production deploy、D1 migration適用、production data write、commit、pushを無断で行わない。
- `git reset --hard`、既存差分のcheckout、無断stashを行わない。
- `web-release-readiness.md`の条件をCC判断だけで削除・延期しない。
- test件数だけで完了判定せず、異常系と未実施確認を明記する。
- security / data model / API変更と大型refactoringを目的なく混ぜない。
- 新機能、課金、trial、Play/TWA対応を追加しない。

## 報告テンプレート

```markdown
### 対象
- branch / HEAD:
- session:
- 対応したレビュー指摘:

### 変更
- file:
- 変更理由:

### 検証
- command:
- result:
- 修正前に失敗を確認したtest:

### 未実施・残risk
- 実D1:
- 実browser / device:
- migration / deploy:
- その他:

### 次の引き渡し
- Codexに確認してほしい点:
- 次セッションが前提にするHEAD:
```
