# セッションログ

新しい記録を上に追加します。会話の全文ではなく、再開に必要な事実だけを残します。

## 2026-08-08 — S4: DATA-001 複数writeの原子性（CC 第1セッション）

- 担当: Claude Code。[`cc-session-plan.md`](cc-session-plan.md) の S4。Worker中心＋App一部。**migration なし**。
- 棚卸完了・発注・入出庫の3つとも、ヘッダ（完了状態）と明細を**1つの `db.batch`
  （=1トランザクション）**へまとめた。従来は棚卸完了が2回、発注が別writeの連続、入出庫が3回。
- `inventoryLines.js` を「実行する」から「**文を組み立てて返す**」（`inventoryLineStatements`）へ変更。
  呼び出し側が `UPDATE sessions` と同じ batch へ載せられるようにするため。
- batch は途中で中断できないので、**明細の INSERT 自身に持ち主の確認を持たせた**
  （`WHERE EXISTS (SELECT 1 FROM sessions/orders/movements WHERE id = ? AND shop_code = ?)`）。
  `UPDATE sessions` を batch の先頭に置き、0行なら後続の INSERT も弾かれる。
- 冪等性は「毎回全削除してから入れ直す」で担保。upsert だけだと品目が減った再送で前回ぶんが残る。
- **クライアント側の部分適用も塞いだ。** `useSession.complete()` は complete API が失敗すると
  `updateSession(id, 'completed')` へフォールバックしており、「明細の保存に失敗したのに
  セッションだけ完了として残す」＝ DATA-001 が防ぎたい状態そのものをクライアントから作っていた。
  削除して `{ ok:false, reason:'save_failed' }` を返し、`_finalized` も戻して再試行を塞がない。
  **旧テスト1件（フォールバックを固定していた）を反転させた。**
- `handleMovementCreate` のヘッダ upsert に店舗境界の WHERE が無く、事前SELECT後の競合で
  他店のヘッダを上書きできる隙間が残っていた。`handleOrderCreate` と同じ形へ揃えた。
- 上限: `MAX_LINES_PER_REQUEST` = 5,000行を新設（`MAX_PAYLOAD_CHARS` はJSON全体のバイト数しか
  見ないため、短い行を大量に並べると上限内のまま数万行を1トランザクションへ詰め込める）。
  品目名・単位は既存の `MAX_INGREDIENT_LEN` / `MAX_UNIT_LEN` で slice。
  棚卸完了に `_tooLarge` と `inventory` の型チェックを追加（従来なし）。
- 検証: worker `npm test` 251 passed / 17 files（+29。`atomicity.test.js` 新設）、
  app `npm test` 619 passed / 71 files、`npm run build` 成功。
- 未実施: 実機・本番D1での確認。**本番D1で batch がトランザクションとして巻き戻ることは未検証**。
  ローカルは注入モックで再現しているだけ。手動確認台本6項目を `cc-session-plan.md` の S4 節に残した。
- 範囲外: `saveSnapshotToD1`（`store_history`）は完了処理とは別 write のまま。1つにまとめるには
  `store_history` の session単位キー化（F-001）が要るため Phase 3（公開後）。
- **第1セッション（S1〜S4）はこれで完了。** 8タスク全体では S1〜S8 がすべて実装済み。

## 2026-08-08 — S3: DATA-002 Phase 1（CC 第1セッション）

- 担当: Claude Code。[`cc-session-plan.md`](cc-session-plan.md) の S3。**Worker と App の両方**に触れた。
- `GET /store/:code/sessions/:id/lines` を追加。`storeHandler.js` の `handleSessionLinesGet` を
  `index.js` の `_requireAuth`（strict同store Bearer）の内側、`/sessions/:id/complete` の直前に登録。
  単価・在庫金額を返すためゲスト経路には置かない。
- **店舗境界テストを先に書いた**（完了条件どおり）。`worker/src/sessionLines.test.js` を作成し
  10件すべて失敗を確認してから実装。`session_id` だけで引くSQLではテストが落ちるモックにしてある。
  ルーター層の401/他店舗トークン401/他店舗セッション404/自店舗200を `index.test.js` に追加。
- 他店舗のIDと存在しないIDは**同じ404**。区別するとIDの実在を他店舗から確かめられる。
- App 側は `services/snapshotFromLines.js`（純関数）で lines から表示用スナップショットを組み立て、
  `App.vue` の `onViewSession` が端末にスナップショットが無いときだけ呼ぶ。
  **localStorage にも D1 にも書き戻さない**（User判断 2026-07-28 の方式A）。
- 復元したスナップショットは `locked: true`。`patchSnapshotItems` は localStorage の該当日付を
  書き換える実装で、端末に実体が無い記録を編集させると「保存したつもりで消える」ため。
- 1回の返却上限 `MAX_SESSION_LINES` = 2,000件。超過時は `truncated` を返しトーストで明示する
  （`F-002` の転送量問題を新経路へ持ち込まないための有界化）。
- `totalValue` はサーバーの `sessions.total_value` を優先。打ち切り時に合計が過小にならないため。
- **`SEC-005` を着手可へ変更**（順序ブロック解除）。`SEC-005.md` / `DATA-002.md` / `task-list.md` に明記。
- `docs/api-design.md` に認証区分つきで登録（feature-checklist §5）。DATA-002 の未解消行も更新。
- 検証: worker `npm test` 210 passed / 16 files（+14）、app `npm test` 617 passed / 71 files（+13）、
  `npm run build` 成功。
- 未実施: 実機・本番D1での確認。別端末で詳細が開けること、2026-07-07の351品目が出ることは
  **未確認**で、手動確認台本6項目を `cc-session-plan.md` の S3 節に残した。
- 残る穴: 復元経路では `entryLog` / `participants` / `auditLog` が空（`inventory_lines` に無い）。
  F-001（同日2回目の上書き）と F-003（データ源二重）は Phase 3 の範囲で未解消。
- 次の再開地点: 第1セッションの **S4（DATA-001・完了処理の原子性）**。

## 2026-08-08 — CC第2セッション: 品目マスタ取込の本修理（S5・S6）

- 担当: Claude Code。範囲は `cc-session-plan.md` の第2セッション（S5・S6）。`worker/` は無変更。
- 基点: `develop@f8da4c1` で実装し、push 時に `claude/branch-operational-status-2lwwwu`
  （S1・S2・S7・S8 が先行）へ rebase して統合した。
- **S2（止血）の後始末**: S2 の申し送り「S5 で通常取込からこの確認を外し、全置換操作にだけ残す」を実施した。
  - 外した: `SettingsModal.handleFile` / `SettingsModal.onMapperImported` / `PdfImporterModal.onImport`
    の `confirmMasterImport` 呼び出し3箇所、`SettingsModal.vue` の `.replace-warn` とそのCSS、
    `useConfig.js` の暫定コメント2箇所（全置換代入そのものが無くなったため）。
  - 残した: `utils/masterImportWarning.js` は削除せず、`ItemImportPreviewModal` の
    **「全入れ替え」確定時だけ**呼ぶようにした。冒頭コメントを現状に合わせて書き換え、
    `masterImportWarning.test.js` の8件はそのまま緑。
  - `HELP.import` は S2 の全置換文言からマージ後の挙動へ書き換えた。
  - S2 の手動確認台本のうち 2〜5・7 は前提が変わったため、差し替えを
    `test-checklist-new-features.md` の S 節へ置き、`cc-session-plan.md` の S2 節から参照させた。
- 統合時のコード衝突は S2 由来のみ（4ファイル）。S7・S8 とはファイルが重ならず衝突なし。

### S5 — 取込のマージ化

- 取込を「解析 → 計画 → 適用」の3段へ分離し、純粋関数を `app/src/utils/itemImport.js` へ新設。
  計画（`buildImportPlan`）は `config` を書き換えないため、プレビューと実取込が同じ結果になる。
- **既定を「追加・更新」に変更**。`loadFromCSV` / `loadFromCSVMapped` はファイルに無い既存品目を
  消さず、同名品目はファイルにある列だけ上書きする。空欄列は既存値を保持。
- **全入れ替えは `{ mode: 'replace' }` を明示したときだけ**。UI では確認画面のラジオ＋
  削除件数の警告＋確認チェックを通さないと実行できない。
- Free上限はマージ時に既存品目を削らない。空きぶんだけ新規を入れ、残りを `truncated` で返す。
- 推奨フォーマット（`exportConfigCSV` の出力）の往復を成立させた。従来 `loadFromCSV` が
  無視していた並び替え軸列（10・11列目）を読み、軸名未設定なら列名を採用する。
- 発注点の既存仕様（列があって空セルなら解除／列が無ければ非破壊）は維持。

### S6 — 取込前プレビュー

- `ItemImportPreviewModal.vue` を新設し、CSV / 列指定 / PDF・Excel の**全経路を確定前に通す**。
  PdfImporterModal は品目マスタへ直接書かず、変換したCSVを確認画面へ渡す方式へ変更した。
- 表示: 追加・更新・変更なし・除外（＋全入れ替え時は削除）の件数、取込後の総件数、
  更新される品目のフィールド単位の差分（変更前 → 変更後）、除外行の**行番号と理由**。
- Free上限による切り捨てを**取込前に**警告する（従来 `_capForPlan` が無言で切っていた）。
- PDF取込をβ表記にした（PdfImporterModal のタイトル・注記、取込導線のサブテキスト、
  SettingsModal のドロップゾーン）。
- 取込直後に限り1回だけ「取込前に戻す」ができる（`undoLastImport`）。メモリ上の退避のみで、
  再読込・アカウント切替（`resetLocalData`）・ホスト設定受信（`applyRemoteConfig`）・
  取込以外の品目変更（`_save`）で失効する。`cc-session-plan.md` S6 の注記どおり、
  恒久的なスナップショット機構は作っていない。

### 変更ファイル

- 新規: `app/src/utils/itemImport.js`、`app/src/components/ItemImportPreviewModal.vue`、
  `app/src/composables/useConfig.importMerge.test.js`、`app/src/composables/useConfig.importPreview.test.js`
- 変更: `app/src/composables/useConfig.js`、`app/src/components/SettingsModal.vue`、
  `app/src/components/PdfImporterModal.vue`、`app/src/components/MasterManagePage.vue`、
  `app/src/composables/useConfig.axes.test.js`

### 検証（S1・S2・S7・S8 と統合したあとの実行結果）

- `cd app && npx vitest run`: **70 files / 604 tests passed**。
  S5・S6 単体では 65 files / 569 tests passed（S1〜S4・S7・S8 を含まない基点での実行）。
- `cd app && npm run build`: 成功（PWA precache 17 entries / 2518.25 KiB）。既知のchunk警告のみ。
- `cd worker && npm test`: **15 files / 196 tests passed**（無変更の確認）。
- `git diff --check`: 指摘なし。
- 既存テストの変更は1件のみ: `useConfig.axes.test.js` の
  「再インポートで既存割り当てを名前一致で維持し、新規はその他」を `mode: 'replace'` へ明示化し、
  既定（マージ）側の対応ケースを追加した。全置換前提を書いていたのはこの1件だけ。
  S2 の `masterImportWarning.test.js`（8件）は変更せずに緑のまま。

### 仕様上の判断

- 実装とヘルプ文言が食い違っていた件は**文言側（追加マージ）を正**とした。
- 「上書き」は列単位。同名品目でも空欄列は既存値を消さない（発注点だけ明示解除あり）。
- 取込の取り消しは永続化していない。永続化の要否は提案箱でPM判断待ち。

### 残っているリスク

- 🖐 実機UI未確認（375px・デスクトップ）。この環境にブラウザ自動化がない。
- 全入れ替えを選んだ場合の破壊性は変わらない。確認UIと事前の削除件数表示で防いでいる。
- 取込の取り消しはメモリ上のみ。取込直後にタブを閉じる・再読込すると戻せない。
  マージ既定で破壊性自体が下がっているため許容範囲と判断したが、永続化の要否はPM判断。
- 差分計算は「取込後の値 vs 現在の値」で、品目数×フィールド数に比例する。
  Free上限150品目では問題ないが、Pro相当の数千品目でプレビューの体感を実測していない。

### migration

- **なし**。D1スキーマ・`worker/migrations/` は無変更。config スキーマも変えていないため
  `RoomDO.normalizeConfig` と同期payloadへの影響もない。

### Codex にレビューしてほしい点

1. **既定をマージへ変えた判断そのもの**。`loadFromCSV(csv)` の意味が変わる後方非互換で、
   呼び出し元は全て付け替えたが、これを製品仕様として確定してよいか。
2. **`buildImportPlan` の全置換モード**（`app/src/utils/itemImport.js`）。
   `reorderPoints` だけ「発注点列が無ければ既存を保持」という既存の非対称仕様を引き継いでいる。
   ファイルに無い品目の発注点が残る点は従来どおりだが、意図した挙動か再確認してほしい。
3. **Free上限の扱い**。マージ時は `itemLimit - 既存件数` を空きとし、既存が上限を超えていても
   （Pro→Free の降格や過去データ）既存は削らず新規だけ弾く。プラン境界としてこれでよいか。
4. **取り消し（`undoLastImport`）の失効条件**。`_save()` 経由で失効させ、
   `resetLocalData` / `applyRemoteConfig` でも明示的に破棄している。
   アカウント境界で前アカウントの品目マスタが復元されうる経路が残っていないか。
5. **`masterImportWarning.js` の残し方**。S2 の申し送りに従い全入れ替え確定時だけ呼んでいるが、
   確認画面のチェックボックスと二段になる。片方に寄せるべきかは判断を仰ぎたい。

### 未実施

- deploy、production migration（migration は不要）。
- DoD セルフチェックは下記。N/A 理由つき。
  - 1 UI・表示: 🖐 スマホ / タブレット / PC の実機確認が**未実施**（要User確認）。
    空状態（0件取込・全行除外）はエラーメッセージで処理。
  - 2 入力・データ: 🤖 バリデーション済み。localStorage キー追加なし（退避はメモリのみ）。
    config フィールド追加なし＝`RoomDO.normalizeConfig` 影響なし。D1・migration なし。
    再インポート時の軸割り当て維持はテストで固定。
  - 3 エラー処理: 解析エラーは日本語で確認画面に表示。通信を伴わないため通信エラー項目は N/A。
  - 4 同期・多人数: 取込は既存どおり `_save()` → `_onConfigChanged` で伝播。WSメッセージ型の追加なし。
    ゲストは取込導線が非表示のため多人数項目は N/A。
  - 5 権限・認可: 新エンドポイントなし・D1クエリなしのため N/A。プラン境界は `isPro()` 経由で維持。
  - 6 ログ・監査: 品目マスタ取込は従来から auditLog 対象外（同期の config 更新として伝播）。変更なし。
  - 7 ナビゲーション: 確認画面は既存モーダル規約（`useEscapeKey` + `.modal-overlay`）に合わせた。
    🖐 Android の戻る操作は未確認。既存モーダルと同じ扱いが必要かは実機確認で判断する。
  - 8 通知: N/A（通知を出さない）。
  - 9 テスト・ドキュメント: 🤖 ユニットテスト追加済み。
    `test-checklist-new-features.md` と `project-status.md` の更新は本セッションで実施。

## 2026-08-08 — CC第3セッション: S7（保存失敗の可視化）/ S8（画面を棚卸中心へ）

- 担当: Claude Code。台本は [`cc-session-plan.md`](cc-session-plan.md) の第3セッション（S7・S8）。
- ブランチ: `claude/branch-operational-status-2lwwwu`（`develop@f8da4c1` から）。
  作業開始時点で S1〜S6 は本ブランチに未取り込みだったため、**S7/S8 はそれらに依存しない範囲で完結させた**。
  push 時に第1セッションの S1・S2（`6b336ac` / `d12878b`）が先に入っていたため rebase し、
  docs 3件（`session-log` / `task-list` / `DATA-002`）の衝突を解消した。コードの衝突は無し。

### S7 — DATA-002 Phase 2（保存失敗の可視化・バックフィル）

- 未送信キュー（`_pending` / `_snapQueue` / `_orderQueue` / `_moveQueue`）を localStorage
  `_pending_saves_v1` へ永続化。payload に `shopCode` を持たせ、**別店舗のキューは読み込み時に破棄**する。
  `resetAccountData` / `clearLocalAccountData` の消去対象に追加した。
- 棚卸完了が `saveSnapshotToD1` の結果を待つようにし、未送信ならトーストで明示。
  `ConnectionBanner` に `failed`（連続失敗2回以上）表示を追加し、未送信件数を出す。
- `services/historyBackfill.js`（純関数 `missingSnapshots`）を追加。履歴を読む3経路
  （起動 / ログイン / セッション開始）で、端末にあって D1 に無い・D1 側が古いスナップショットを送り直す。
- 起動時に `resumePendingSaves()` を呼び、接続復帰イベントを待たずに前回の未送信分を送る。
- 付随修正2点: `applyRemoteHistory` が端末側の新しいスナップショットを潰していたのを修正（同時刻はリモート優先＝従来どおり）。
  再送間隔を指数バックオフ化（8秒 → 最大2分）。
- **Phase 1（`GET /store/:code/sessions/:id/lines`）は未着手**。別セッション担当のため `worker/` は1行も触っていない。
  2026-07-07 の351品目の復旧は Phase 1 側。

### S8 — 画面を棚卸中心へ

- セッションタブを「① 品目を準備 → ② 棚卸をする → ③ 記録を見る」の順路へ組み直し、
  履歴カレンダーへの導線を第一導線の終点として追加した。
- 入出庫・発注確認・発注スケジュールを区切り線から下の **β機能**（`.beta-group`）へ移動。
  「発注確認」→「**発注内容の確認・記録（β）**」へ改称し、**仕入先へ自動送信されない**旨を常時表示。
- 出庫は主導線から外し、`MovementPage` 内のタブとしては残した（記録は削除していない）。
- 理論在庫の誤差要因（未記録の使用・ロス・納品）をホームカードと `MovementPage` の両方に明示。
- データ管理カードの点滅を**品目0件のときだけ**にした（棚卸開始と注意を奪い合わないため）。
- `DesktopNav` の並びを 棚卸 → 品目マスタ → 在庫・入庫（β）へ。
- `eb99895` の2列グリッドを書き換え、対象を panel 全体から `.beta-group` へ縮小。
  同コミットの `(pointer: coarse)` タップ領域確保は**残している**。

### 検証

- App: `npm test` 67 files / **558 passed**（変更前 63 files / 531）。`npm run build` 成功。
  CSS 226.06kB → 228.08kB（gzip 35.98 → 36.33kB）。
- Worker: `npm test` 15 files / **196 passed**（`worker/` は未変更・回帰確認のみ）。
- 追加テスト4件: `useStore.pending.test.js`（永続化・店舗境界・容量不足・失敗回数）、
  `historyBackfill.test.js`（差分判定）、`useHistory.remote.test.js`（上書き規則）、
  `SessionListPage.flow.test.js`（順路の並びと文言）。
- **未実施**: 実ブラウザでの目視確認（この環境にブラウザ自動化が無い）。手動確認の台本は
  [`tasks/UI-001.md`](tasks/UI-001.md) に追加した。deploy・D1 migration は行っていない（migration の追加なし）。

### 共通DoD（[`../feature-checklist.md`](../feature-checklist.md)）セルフチェック

| 節 | 結果 |
|---|---|
| 1. UI・表示 | 🖐 375px / タブレット / PC の目視は**未実施**（台本を `tasks/UI-001.md` へ追加）。空状態は「完了した棚卸はまだありません」を履歴導線に用意。ホームカードのテーマ色（棚卸=青 / 入出庫=緑 / 発注=オレンジ）は維持。最小フォントは 11px の注記が既存カードと同水準 |
| 2. 入力・データ | `_pending_saves_v1` を `storageKeys.js` へ登録。`clearLocalAccountData` と `resetAccountData` の消去対象に追加。D1永続化の要否＝**未送信キューは端末専用で正しい**（D1 へ送れなかったものの控えなので、D1 に置く対象ではない）。schema変更なし＝**migration なし**。config へのフィールド追加なし＝`normalizeConfig` 変更不要 |
| 3. エラー処理・通信 | 保存失敗は日本語の明示表示（トースト＋バナー）。再送はバックオフ上限2分で無限即時リトライにしない。バックフィルは1回10件上限。**フェイルの方針**: 履歴取得が失敗（null）したときは「D1 は空」と解釈せず**何も送らない**（誤って全件上書きしないため）。機内モード実機確認は未実施 |
| 4. 同期・多人数 | **N/A**。WS メッセージ型・DO storage は未変更。ホスト完了経路の待ち追加のみで、ゲストへ送る内容は変わらない |
| 5. 権限・認可 | **N/A（サーバー側は未変更）**。client 側の店舗境界として、復元した未送信キューは `shopCode` 照合で他店舗分を破棄する |
| 6. ログ・監査 | 秘匿情報の出力なし。未送信件数のみ表示（単価・PIN・トークンは出さない） |
| 7. ナビゲーション | 履歴導線はタブ切替のみで `currentView` を変えないため、`_closeTopLayer` の規約に影響しない。β機能の移動は既存 emit の位置変更のみ |
| 8. 通知 | プッシュは**N/A**。トーストは保存失敗時の1回のみ（成功時は従来どおり） |
| 9. テスト・ドキュメント | ユニットテスト4ファイル追加（App 558 passed）。手動台本は `tasks/UI-001.md` へ（`test-checklist-new-features.md` は自ら「履歴snapshot・現行checklistではない」と宣言し、現在のtask固有検証は `tasks/<ID>.md` を正としているため、そちらへ追加した）。`project-status.md` の実装済み節を更新。設計判断は `proposals.md` へ投稿 |

### 未決・引き渡し

- 設計判断は [`../proposals.md`](../proposals.md) の 2026-08-08 エントリ2件へ投稿済み（PMトリアージ待ち）。
  特に **`applyRemoteHistory` の上書き規則変更**と**完了処理が明細保存を待つようになった点**は既存挙動の変更。
- Codex へのレビュー希望: アカウント境界（`_pending_saves_v1` の店舗照合）、
  バックフィルが D1 を過剰に上書きしないか、完了処理の待ち追加と `DATA-001`（S4）の設計が衝突しないか。
- 次の再開地点: Phase 1（S3）と DATA-001（S4）。どちらも `worker/` 側で、本セッションの差分とは重ならない。

## 2026-08-08 — S2: 品目マスタ取込の止血（CC 第1セッション）

- 担当: Claude Code。[`cc-session-plan.md`](cc-session-plan.md) の S2。**挙動は変えず、警告と文言だけを追加**。
- 実害: `loadFromCSV` / `loadFromCSVMapped` は品目リストを**全置換**する。ファイルに無い品目と、
  その単価・別名・カテゴリが消える。一方UIの説明は「品目名が一致するものは上書き、無いものは追加」＝
  追加マージを約束しており、300品目の店舗が50品目のファイルを入れると250品目が消えていた。
- `app/src/utils/masterImportWarning.js` を新設。全置換であることを説明する確認を、
  **3つの取込入口すべて**へ入れた（CSV直接 / 列指定マッパー / PDF・Excel）。
  品目0件のときは失うものが無いため確認しない。confirm が使えない環境では中止（同意なしに破壊しない）。
- ファイル選択**前**に見える警告を `SettingsModal` のドロップゾーン上へ追加（`.replace-warn`）。
  確認ダイアログはファイルを選んだ後にしか出ないため。
- `MasterManagePage.vue` の `HELP.import` を実装の挙動へ一致させた。
- 暫定である旨を `masterImportWarning.js` 冒頭、`useConfig.js` の全置換代入の直前2箇所、
  `HELP.import` の上に残した。S5 で外す対象も `cc-session-plan.md` に列挙した。
- 検証: `npm test` 539 passed / 64 files（新規8件）、`npm run build` 成功。
  CSS 226.06 → 226.26kB（gzip 35.98 → 36.03kB）。
- 未実施: 実ブラウザでの目視確認。手動確認台本8項目を `cc-session-plan.md` の S2 節に残した。
- feature-checklist セルフチェック結果は同節と本コミットに記載。
- 次の再開地点: **S3（DATA-002 Phase 1）**。完了時に Codex へ `SEC-005` の着手可を通知する。

## 2026-08-08 — S1: 担当と公開範囲の記録更新（CC 第1セッション）

- 担当: Claude Code。[`cc-session-plan.md`](cc-session-plan.md) の第1セッション S1。**docsのみでcode変更なし**。
- 作業ブランチ `claude/branch-operational-status-2lwwwu` を3セッション共有として確定。
  `develop@f8da4c1` を fast-forward 取り込み済み。
- 担当変更: `DATA-001` を Codex → **Claude Code**、`DATA-002` を 未割当 → **Claude Code**。
  優先度・状態・release gate（`WEB-01`〜`WEB-10`）の判定基準は変更していない。
- 初回Web版の中心を **棚卸業務の効率化** と明記。第一導線は
  「品目を準備 → 棚卸開始 → 入力 → 完了 → 履歴」。入出庫・発注確認は **β機能**、出庫は主導線から外す。
  新機能は追加せず既存機能の整理と安定化に限定する方針を `task-list.md` と
  `web-release-readiness.md` の両方へ記載した。
- `DATA-002.md` の「着手時期: Codexの作業が完了した後。それまで着手しない」（2026-07-28 User判断）を
  **打ち消し線で原文を残したまま失効**とし、失効理由（担当がCCへ移り前提が成立しない）と
  新しい着手時期（即時着手可・ただしPhase 1をSEC-005より先に完了）を追記した。
- **`DATA-002` Phase 1 → `SEC-005` の順序を固定**。`worker/src/index.js` の store ルート群で競合するため。
  `DATA-002.md` / `SEC-005.md` / `task-list.md` / `web-release-readiness.md`（`WEB-05`）へ記載。
  CCはPhase 1完了時にCodexへ着手可を通知する。
- `DATA-002` **Phase 3** と **過去棚卸取込の再設計** を初回公開scope外（公開後）と確定。
  Phase 3 は migration を伴い、本番D1に 0010/0011 未適用（`WEB-04`）のため判断材料が揃わない。
  過去棚卸取込は Phase 3 完了が前提。新規IDは作らず `DATA-002` の公開後フェーズとして扱う。
- `WEB-07` の Owner を Codex → **Claude Code / Codex** へ更新（実装がCCへ移ったため。公開判定はCodexのまま）。
- 未実施: code修正、test/build（docsのみのため）、production deploy、migration、外部service変更。
- 次の再開地点: 第1セッションの **S2（品目マスタ取込の止血）**。その後 S3（DATA-002 Phase 1）→ S4（DATA-001）。

## 2026-08-04〜2026-08-06 — DOC-001: Web公開を目標にdocs全体を再編

- 担当: Codex。文書整理とread-only監査のみ。App/Worker実装は変更していない。
- User判断をD-021へ記録し、現在と将来フローを分離:
  - W1（現在）: Web/PWA Free版。trial、Stripe、Pro販売、PostHog有効化、Play配布なし。
  - A1（将来）: Android app内登録を起点に14日Pro無料体験→Free。Web Stripeの明示契約を
    同一accountのserver entitlementへ反映するconsumption-only Play版。
  - Web登録へのtrial適用とStripe/backendの単独公開順は未決として残した。
- docs配下90 Markdown＋export ZIPを棚卸し。正本、現行候補、runbook/draft、将来設計、履歴へ分類した。
- `docs/README.md`を総合索引、`web-release-readiness.md`を現在のrelease gateとして新設。
  WEB-001/DOC-001を作成し、task boardとagent入口をWeb先行へ同期。Play資料は削除せず後続へ保留した。
- Dated audit、export、完了記録、過去session entryは改変していない。大量のfile移動/renameも行っていない。
- 初回Web preflightで新たに確認したblocker:
  - 文書の`inventory-app.pages.dev`は正常な公開先でなく、実project productionは旧build。
  - develop previewのprivacy/terms/supportはPages上で308 redirect loop。
  - remote Workerは旧CORSで任意Originを反射し、repositoryの許可Originは実Pages hostと不一致。
  - production branch/Wrangler/rollback未固定、本番D1 0010/0011未適用。
  - 登録濫用、Free 2台制限、履歴data integrity、observability、critical E2Eが未完。
- `bug-reports.md`の壊れたrepository相対link 41件を`../../app` / `../../worker`へ修正。
- Phase 2で`spec/api/sync/security/test/ci-cd`を`develop@bc9fb85`へ照合。現行W1 baseline、
  known gap、旧reference snapshot、履歴実績の境界を追加し、DOC-001を完了した。
- 8/5に並行追加されたUI-001とApp差分は保持し、DOC-001のcode変更・検証実績には含めていない。
- 基準: `develop@bc9fb85`。develop Actions run `30882005257`はpreviewまで成功。
- 未実施: code修正、test/build再実行、production deploy、migration、外部service変更、commit、push。
- 最終検証: 92 files（Markdown 91 + ZIP 1）、local Markdown link全件解決、Markdown table列崩れなし、
  `git diff --check`成功。DOC-001としてcode test/buildは未実行。
- 次の再開地点: WEB-01のcanonical/contactをUserが決定後、Pages routing/CORS/deploy経路から着手。

## 2026-08-04 — PLAY-002: data削除境界の独立reviewとrace修正

- 担当: Codex（data削除・Cache/SW・Worker/D1/DO）。Claude CodeのUI/a11y差分を保持し、
  Back blocker解消に限って共有境界の`App.vue` / `DeleteAccountModal.vue` / `appMenuState.js`を最小変更。
- client側で3つの削除raceを修正:
  - 旧店舗のD1未送信queue/retry timerと、境界前に開始した保存の遅延失敗によるqueue復活。
  - 削除後も残る同期WebSocket再接続と、参加者/message/audit/競合のmemory data。
  - 天気fetch・逆geocode・geolocation callbackの遅延完了による位置/cache/state復活。
- `clearLocalAccountData()`をbest-effort化し、1 resetの例外で後続消去が止まらないよう補強。
- Cache/SW監査: Workboxはapp shell/font/PDF cMap、push SWは通知だけ。account/API dataは保存しないため、
  account削除時のSW解除・静的cache削除は不要。専用testで回帰固定。
- Cloudflare公式仕様と現行実装を再照合:
  - DOは互換日付が古くても`deleteAlarm()`後に`deleteAll()`し、stock/order両方を消去。
  - D1の削除中/削除後INSERT競合はmigration 0011の`account_inactive` triggerで既に遮断。
  - 公開Worker routeからDO内部削除pathへは到達しない。Worker変更は不要と判断。
- CCのUI/a11y差分はfocus trap・focus復帰・375px対応を承認。独立reviewで検出したAndroid/browser Back
  blockerは、modal登録handlerをApp共通制御が消費する方式で解消。入力・確認・errorは閉じ、
  削除処理中・完了はmodalを維持する。設定内と公開削除pageの両方を同じ配線で扱う。
- 検証: data境界対象5 files / 27 tests、Back/UI関連5 files / 28 tests、App全体63 files / 531 tests、
  Worker全体15 files / 196 tests、App production build成功（448 modules、PWA precache 17 entries /
  2476.36 KiB）、`git diff --check`成功。
- 判定: code review範囲は承認。PLAY-002はcanonical/contact確定とUser実機確認が残るため進行中。
- 未実施: commit、push、deploy、production migration、Play Console変更。

## 2026-08-04 — PLAY-003: D-019端末data削除とData Safety再照合

- 担当: Codex。既存のPLAY-002/004・DEP-001差分を保持し、PLAY-003の監査台帳・回答draft・進捗記録だけを更新した。
- D-019のApp実装を独立再照合:
  - account削除成功時に端末ID・端末名・天気位置情報/cacheとmemory stateを消去する。
  - 削除失敗、logout、account切替では端末設定を保持し、再試行・通常利用を壊さない。
  - privacy/support/legalの公開文面と削除確認UIが同じ範囲を説明する。
- `data-safety-audit.md`、`data-safety-form-draft.md`、`google-play-readiness.md`を実装へ同期し、
  `DS-02`を整合済みとした。PLAY-003自体は他gateが残るため進行中を維持。
- 公式仕様を2026-08-04に再確認: D1 Time TravelはWorkers Free 7日、Workers LogsはFree 3日。
  Google Playは端末外への送信を原則collectionに含め、account削除時は関連dataも削除対象とする。
- 検証:
  - 対象: 5 files / 81 tests passed。
  - App全体: 58 files / 502 tests passed。
  - App production build成功（447 modules、PWA precache 17 entries / 2473.26 KiB）。
  - `git diff --check`成功。既知のVite CJS・500 kB超chunk警告と改行warningのみ。
- 残件: canonical URL/contact、Workers Logs閲覧担当・payload masking・alert、provider共有例外、
  TWA microphone、`/pdf`存廃、公開build network、0010/0011適用承認。
- 未実施: commit、push、deploy、production migration、Play Console変更。

## 2026-08-02 — CI-001完了・DEP-001 production high解消

- 担当: Codex。Claude CodeのPLAY-002/004差分は保持し、依存・Excel取込境界とCI証拠だけを変更した。
- **CI-001完了**: `develop@7d47cb4`のActions run
  [`30725392991`](https://github.com/musaikun/Inventory/actions/runs/30725392991)が成功。
  Node 24でWorker test、App test/build、Pages deploy、develop alias更新の全stepが成功した。
  develop aliasは`https://develop.inventory-app-c40.pages.dev`。実ブラウザ接続は環境に利用可能なbrowserがなく未確認。
- **DEP-001完了**:
  - `postcss` 8.5.15 → 8.5.25。
  - `xlsx`をnpm registry 0.18.5からSheetJS公式CDN 0.20.3へ変更。
  - Excel解析をWeb Workerへ隔離し、5 MiB、20シート、各5,000行・100列、合計10万セル、8秒timeoutを追加。
  - 日本語を含む`.xlsx` / `.xls`、入力上限、Worker timeoutの回帰testを追加。
- 検証: `npm audit --omit=dev` 0 vulnerabilities、App 58 files / 498 tests、production build成功。
  `spreadsheetImport.worker-*.js`の独立bundleとPWA precacheを確認。`git diff --check`成功。
- 残件: 通常の`npm audit`にはbuild/test用依存の6 high / 3 moderate / 1 lowが残る。
  commit、push、deploy、実機Excel取込は未実施。

## 2026-08-04 — PLAY-002: focus trap・誤操作防止・375px対応（UI/a11y）

- 担当: Claude Code（UI・a11y主担当）。Codexは独立reviewとdata削除検証。Worker無変更。
- **focus trap**: `composables/useFocusTrap.js` を新規追加し `DeleteAccountModal` へ適用。
  `role="dialog" aria-modal="true"` だけではブラウザはTabの移動範囲を制限しないため、
  トラップ無しでは**削除処理中に背後の画面を操作できる**状態だった。capture で Tab を先取りする。
  可視性では絞らず「DOMにある＝操作できる」で判定（局面ごとに`v-if`で差し替える構造、
  かつjsdomでは`offsetParent`が常にnullのため）。
- **フォーカス復帰**: 開く直前の`document.activeElement`を保持し`onUnmounted`で戻す。
  元の要素が消えている場合は何もしない。
- **局面切り替え**: `watch(phase)`で新局面の先頭へフォーカスを移す。処理中は操作対象が無いため
  `tabindex="-1"`のダイアログ自身へ移し、トラップの外へ出さない。
- **375px**: 店舗名・サーバー由来エラー文へ`overflow-wrap: anywhere`。`.da-actions .btn`へ`min-width: 0`
  （flex itemはこれが無いと内容幅より縮まず狭い端末で溢れる）。`.btn`の`line-height: 1`は折り返し時に
  文字が重なるため1.35へ。`DeleteAccountPage`にも同様の対策。
- **文面の不整合を修正**: `SettingsModal`の端末データ説明がD-019の実装と矛盾していたため改めた。
- 確認: 公開ページの店舗コード正規化（`[^A-Z]`除去）はWorkerの発行規則（英大文字6桁・数字なし）と一致。
- 検証:
  - 新規`DeleteAccountModal.a11y.test.js` 12件。実装を`git stash`した状態で**7件が失敗**することを確認。
  - App 59 files / 514 tests passed。production build成功（precache 17 entries / 2474.95 KiB）。
  - `vite preview`で未ログインの`/?delete-account` `/privacy(.html)` `/terms(.html)` `/support(.html)`が
    すべて200。配信物のsupport.htmlから「残るもの」表の端末ID行が消え、自動削除の記載が入ることも確認。
- **実機確認手順（375px・User実施）をPLAY-002.mdへ記録**（A:削除導線 / B:誤操作防止 / C:失敗と再試行 /
  D:公開Web未ログイン / E:キーボード の27項目）。
- 未対応: canonical URL/contact確定後の絶対URL反映（`DS-08`待ち）、実機での目視・タップ確認。
- 未実施: commit、push、deploy。

## 2026-08-02 — PLAY-004: terms正本の同期とD-019の公開文面反映

- 担当: Claude Code。legal文面と回帰testのみ。App/Worker実装は無変更。
- **terms正本の同期（Codex review指摘1・長期未解消だった項目）**: 公開/landing termsは既に正しく、
  `docs/legal/terms.md`だけがずれていたため正本を公開版へ寄せた。
  - 第6条3・第11条3を「利用者へ通知」→「本サービス上へ掲示／お知らせ」。
    **連絡先を保持しない実装では個別通知を履行できない**ため。将来メール登録を入れる場合は「通知」へ再改定する。
  - 第7条2/5の「一切の責任を負いません」→「責任を負いません」（全部免責は消費者契約法8条で無効となり得る）。
  - 第1・2・8条の表現差も解消し、改定日と理由を追記。
- **D-019の公開文面反映**: 端末ID・端末名・天気の位置情報とキャッシュを「削除しても残る」→
  「アカウント削除の完了時に自動削除される」へ。privacy/support/landing/正本の計6ファイルを同時更新。
  「残るもの」は表示設定のみになった。
- **回帰test追加**（`legalPages.test.js`）: 条文単位の同期チェックと、端末固有データの自動削除の記述。
  旧文言（`利用者へ通知します`/`一切の責任を負いません`/`操作ログ等`/`端末の設定として残ります`/
  「残るもの」表の端末ID行）を再発防止として禁止。
- 検証: 文面を`git stash`した状態で**6件が失敗**することを確認。`legalPages.test.js` 56 tests passed。
  App 58 files / 497 tests passed。App production build成功。
- 注意: 作業ツリーにCodexのDEP-001（`xlsx`をSheetJS CDN 0.20.3へ）が進行中のため`app/package.json`は触っていない。
  buildのprecacheが16 entries / 2346.54 KiBへ増えているのはその差分の影響。
- **PLAY-003へ引き継ぎ**: `data-safety-form-draft.md` / `data-safety-audit.md` の端末データ保持の記述は未更新。
- 未実施: commit、push、deploy。実機UI確認。

## 2026-08-02 — D-019: account削除時に端末固有データも自動削除（PLAY-002）

- 担当: Claude Code。App実装＋test＋削除UX。Worker・legal文面は無変更。
- 実装:
  - `useDeviceId.resetLocalData()` — `_device_id`/`_device_name`を削除し、`deviceId`はメモリ上だけ
    新しい値へ差し替える（`export const`→`export let`のlive binding）。永続化しないため次回起動で
    通常の初期化経路が新IDを採番・保存する。削除済みaccountのIDを送り続けず、IDが空にもならない。
  - `useWeather.resetLocalData()` — `weather_loc`/`weather_cache`とmodule scopeの`state`を初期化。
    stateを戻さないとリロードするまで前の位置・天気が残るため。
  - `accountData.clearDeviceLocalData()` を追加し `clearDeletedAccountLocalData()` の`finally`から呼ぶ。
    logout/account切替の`clearLocalAccountData()`には含めない。
  - 削除UX: 削除対象一覧へ「この端末の設定（端末名・端末ID・天気の位置情報）」を追加し、最終確認にも明記。
- 失敗時の保持: `finalize()`は200後にしか呼ばれないため、503/409/通信失敗では認証・業務data・端末設定が
  すべて残り再試行できる。実装変更は不要で、回帰testで固定した。
- 検証:
  - 実装を`git stash`した状態で新規・追加testのうち**9件が失敗**することを確認（回帰として機能する）。
  - 対象4 files / 25 tests passed。App 56 files / 481 tests passed。Worker 15 files / 196 tests passed。
  - App production build成功（precache 2076.40 KiB）。
- **同一release内の未完（PLAY-003/004へ引き継ぎ）**: `app/public/privacy.html:249,291` と `support.html` は
  「端末設定はサイトデータを消去するまで残る」と記載しており、実装と矛盾する状態になった。
  privacy/support/landing/`docs/legal/*`とData Safety申告を自動削除の説明へ更新してから公開する。
  `legalPages.test.js`は`端末ID`の存在しか見ておらずこの矛盾を検出できないため、アサーション追加が要る。
- 未実施: commit、push、deploy。実機UI確認。

## 2026-08-02 — task分割の独立review修正・CI/Test分離を反映

- 担当: Codex。Claude Codeの`task-list.md`進捗ボード化と`tasks/`分割を独立reviewし、構造は採用した。
- 文書修正:
  - 優先度・状態・担当は`task-list.md`だけを正本とし、詳細fileの重複metadataを削除。
  - `develop@96233d4`のcommit/pushとPro Review deploy済み事実を反映。本番Pages / Worker / D1は未変更。
  - Free 2台制限は現行App/Workerでは成立しないP1として`PLAY-004`へ記録し、server-side拒否testを完了条件へ追加。
  - D-019（account削除時の端末ID・端末名・天気位置情報/cache自動削除）とD-020（Cloudflare Free、
    Time Travel 7日、Workers Logs有効）を追加し、PLAY/Data Safety/retention/runbook/checklistへ反映。
  - 現行buildと公開privacy/supportは端末設定を保持する挙動で一致しているため、D-019のApp実装・test後に
    同じreleaseで公開文面を切り替える。
- CI/Testのローカル対応:
  - 2026-08-01のdevelop Actions `30690499992`はNode 20の`node:sqlite` importで失敗し、preview未更新。
  - `develop-preview.yml` / `pro-review.yml`をNode 24へ更新し、App VitestからWorker testを分離。
  - Worker 15 files / 196 tests、App 54 files / 467 tests、App production build（444 modules）成功。
  - `TEST-002`はpackage分離のみ完了。critical integration/E2Eが残るため状態は進行中。
- 文書検証: 新規`tasks/`と更新した品質基盤文書のlocal Markdown linkは全件解決。
  trailing whitespaceなし、`git diff --check`成功（改行形式warningのみ）。
- 残り: commit/push後のActions・develop preview確認、Free 2台制限、端末設定自動削除、各公開P0/P1。
- 未実施: commit、push、追加deploy、本番migration。

## 2026-08-01 — task-listを進捗ボード化し、詳細を tasks/ へ分割

- 担当: Claude Code。**文書整理のみ。コード変更なし。**
- **状態の正本は `task-list.md`**（進捗ボード）。根拠・実装・検証証拠・完了条件は `tasks/<ID>.md` へ移した。
  完了分は `tasks/completed-2026-07.md`、P2/P3は `tasks/backlog.md`。
- 副次効果: CodexとCCが**別ファイルを編集できる**ため、単一の巨大ファイルでの競合が減る。
- 新規タスクIDは作らず、以下を既存タスクへ統合した。
  - CI/検証環境のNode不整合（`@zxing/library`がNode >=24宣言、CIはNode 20） → `CI-001`
  - App VitestがWorkerテストを含み重複実行 → `TEST-002`
  - `postcss` / `xlsx` のproduction high → `DEP-001`
  - TWA価格表示・無料版2台制限（D-016の公開面反映） → `PLAY-004`
  - 履歴の端末依存（`R-001`・`F-001`〜`F-004`） → `DATA-002`（**P2→P1へ変更**）
- `bug-reports.md` は報告台帳として維持し、統合先を明記（内容は削除していない）。
- `DEP-001` は記載の鮮度確認のため `npm audit --omit=dev` を再実行（read-only）。
  production high 2件: `postcss <=8.5.17`（Path Traversal・**修正版あり**）、`xlsx`（prototype pollution / ReDoS・修正版なし）。
  対応の性質が違うため分けて記述した。
- 参照先を更新: `README.md`（読む順番・使い方）、`working-agreement.md`（開始/完了手順）、`AGENTS.md`（読む順番）。
- 検証: 旧`task-list.md`の詳細374行を新構成と全行照合し、**内容の欠落なし**を確認
  （差分は見出し構造・相対リンク化・節見出しへの昇格のみ）。内部リンクは全件解決。
  旧26タスクID＝新12ファイル＋completed 9＋backlog 5 で一致。
- 未実施: commit、push、deploy。

## 2026-08-01 — Access保護付きPro Review Pagesを初回deploy

- 担当: Codex。UserがCloudflare PagesのPreview access policy有効化を完了したため、
  `inventory-app-pro-review`の`pro-review` Previewだけを初回deploy。本番Pages、通常Worker、本番D1、
  migration、commit、pushは変更していない。
- 対象: `develop@e35c2ba`＋未commit差分。Wrangler `4.118.0`を使用。
- 検証:
  - Worker: 15 files / 196 tests passed。
  - App: 67 files / 658 tests passed。
  - `VITE_SYNC_WORKER_URL=wss://inventory-sync-pro-review.yuya-takaki.workers.dev`、
    `VITE_DEPLOYMENT_CHANNEL=pro-review`、`VITE_REVIEW_PLAN=pro`でproduction build成功（444 modules）。
  - build内に専用Worker URLと`PRO REVIEW · テストデータ`表示を確認。通常Worker URLはJS assetに不在。
  - deployment ID `4e8cedd7-2dbf-4ab6-b4b4-bee250fea610`。
    固定URL `https://pro-review.inventory-app-pro-review.pages.dev`、固有URL
    `https://4e8cedd7.inventory-app-pro-review.pages.dev`。
  - 両URLとも未認証アクセスはCloudflare Access loginへ`302`。専用Worker healthは`200 OK`。
    固定Review originにはCORS許可、develop originには`Access-Control-Allow-Origin`なし。
  - 専用D1をread-only確認し、`PRO REVIEW TEST`（`EXCFGA`）1店舗、`plan=pro`、`deleted_at=null`、
    queryの`rows_written=0`を確認。
- 残件: このセッションでは操作可能なbrowserが無く、Access login後の画面目視とDevTools上の
  `X-Robots-Tag: noindex`確認は未実施。Userが固定URLを開き、レビュー識別表示・ログイン・主要機能を実機確認する。
- 既知warning: Vite CJS API deprecated、500 kB超chunk。commit、pushは未実施。

## 2026-07-28 — 無料枠上限メッセージからPlay課金誘導表現を除去

- 担当: Claude Code。D-016（恒久無料＋将来Web PRO）に伴い、**契約手段が存在しないPROの利用を促す文言**を除去。
- 判断根拠: Play Billingの義務は「アプリ内でデジタル商品を販売する場合」に発生する。現状は決済導線・
  外部リンクがゼロ（`app/src` に `href="http(s)://` の一致なし）で課金ポリシー違反には当たらない。
  残るリスクは**購入できないプランの利用を促す誤認表示**であり、事実の告知へ置換して解消した。
- 変更（Codex編集中ファイルとは行が重複しない範囲のみ）:
  - `App.vue` 3か所: 「さらに登録するにはPROプランをご利用ください」→
    「無料プランの上限（150品目）に達しました。上限の緩和は将来提供予定です。」
  - `SessionListPage.vue`: 「過去N件の履歴はPROプランで閲覧できます」→「〜は無料プランでは表示されません」。
    **「アップグレード」ボタンを「詳しく」へ改称**（購入動作を示唆するCTAだった）。reason文にも将来提供予定を明記。
- 非対象: `UpgradeModal.vue`（Codexが価格・CTA撤去済み）、接続端末数の警告（`App.vue:225`。元から事実告知のみ）。
- 検証: App 67 files / 657 tests passed。production build成功（precache 2075.73 KiB）。
  文言に依存するtestは存在しないことをgrepで確認済み。
- 残る要判断（User）:
  - `terms` 第4条の「月額2,980円」表記。アプリ内から到達する法務ページに価格が載る状態。購入導線がないため
    通常は問題ないが、完全に安全側へ倒すなら金額を落として「提供開始時に別途掲示」に留める。
  - Play Consoleの「アプリ内購入」申告を**なし**にする。
  - 購入手段がない以上、上限到達時にPROモーダルを開く体験自体の是非（トースト等へ変更するか）。
- 注意: 作業中に`App.vue`がCodex側でも編集された（`isProReviewEnvironment`とPRO REVIEWバッジの追加）。
  今回の変更とは行が重複せず競合しなかったが、**`App.vue`は現在共有ファイル**のため以降の編集は要調整。
- 未実施: commit、push、deploy。task-listの状態更新はCodexの編集中のため未実施。

## 2026-07-28 — D-016無料版方針を実装・PostHog設定手順を整理

- 担当: Codex。User採用の「恒久無料版＋将来Web PRO」を実装と現行文書へ反映。
- 無料登録でも1店舗の店舗コードと4桁PINを発行し、無料枠を接続端末2台・品目150件・
  棚卸履歴直近3回とした。
- `LIMITS_DISABLED`とlocalStorageのPRO自己申告、Workerの14日トライアル算出を撤去。
  初回公開では全店舗をfreeとして扱い、自動課金・自動有料化を行わない。
- アプリ内の価格・Stripe・外部決済CTAと3か月無料表記を撤去。landing、公開/正本terms、
  support、reviewer guide、料金戦略を同期し、将来Web PROは月額2,980円の提供予定とした。
- `posthog-setup-checklist.md`を追加。EU Cloud、IP破棄、autocapture/replay等off、明示同意、
  custom event allowlistを採用する。現行Freeの保持は1年のため、User承認まではno-opを維持する。
- 検証:
  - 対象App 3 files / 67 tests passed。
  - 対象Worker 2 files / 30 tests passed。
  - App全体 67 files / 652 tests passed。
  - Worker全体 15 files / 193 tests passed。
  - App production build成功（444 modules）。
  - `git diff --check`成功。Vite CJSと500 kB超chunkの既知warningあり。
- 未実施: commit、push、deploy、Cloudflare resource変更。
- 残り: server-side無料枠強制、PRO entitlement配線、PostHog 1年保持のUser承認とproject情報、
  developと分離したAccess保護付きPRO review環境の採否。

## 2026-07-28 — アカウント登録拡張（復旧用メール・PIN復旧・アンケート）の設計を提案箱へ起票

- 担当: Claude Code。**コード変更なし**。User構想の共有を受けた設計整理のみで、Codexへは未共有。
- User判断: 実装時期は決めず「まず設計だけ固める」。PIN復旧の方式（リンク/コード）は未決。
- `docs/proposals.md` へ起票。主な論点:
  - **メールを identity にしない**。`enterprise-design.md` §9.1/§9.2 は「店舗＝共有アカウント」を採用済みで、
    email認証は org_admins（本部層）に置く設計のため、店舗層のidentityをメールへ移すと衝突する。
    → 復旧用の連絡先として `stores` に任意列を足すに留め、ログインは `shop_code + PIN` を維持。
  - **PIN復旧はログイン相当**。`authHandler.js:142` の単一ホストセッション（成功時に全token失効）により、
    復旧すると稼働中の他端末が落ちる。挙動は維持しUIで明示する。
  - **強度差**: メール到達だけでPIN再設定できると実強度＝メールアカウントの強度。単回・短命・ハッシュ保存の
    復旧トークン、復旧後の全token失効、メール/IP単位のレート制限、**列挙対策（応答を常に同一に）**、
    未確認メールでの復旧禁止を条件とする。
  - **削除範囲**: `accountDeletion.js` の13グループへメール・復旧トークン・アンケート回答を追加し、
    `0011` と同型のトリガを新表にも付ける。7日tombstone中の再登録判定は**メールハッシュのみ保持**を推奨。
  - **アンケートは任意・目的限定**。Data Safety申告対象になるため必須化しない。
  - **配信基盤が未存在**。Cloudflare Email Serviceが構成上自然。送信ドメインとSPF/DKIM/DMARCが先行作業で、
    canonical host（`DS-08`）の決定と同時に決めるのが効率的。
- 既存成果への影響（実装する場合）: `data-safety-form-draft.md` の前提「アカウントに紐づく個人情報なし」が崩れ、
  privacy §2/§4/§5/§6 とterms第6条3・第11条3の再改定が必要になる。スプリント凍結の対象外作業のため、
  着手は8/8以降または凍結解除のUser判断が要る。
- **確認**: 本件があっても、`PLAY-004` 残blocker①のterms同期を「掲示」方向で進める判断は変わらない。
  規約は現況の実装を述べるものであり、メール登録の実装時に改めて「通知」へ改定するのが正規手順。
- 未実施: commit、push、deploy。task-listへの新規タスク登録はPMトリアージ後。

## 2026-07-26 — TEST-001完了・develop CI local gate全件成功

- UserがD-005を「日付昇順＋同一日内はCSVでの仕入先初出順」で決定。
  同一日・仕入先の複数行は最初の登場位置へ1件に集約する。
- `deliveryImportCommit.js`へgroupの`firstSeen`を追加し、locale依存の仕入先名sortを除去。
  日付が前後する入力、同一仕入先の再登場、日本語名を含む回帰testを追加した。
- 検証: 対象4/4、clean install後にApp 67 files / 658 tests、Worker 15 files / 195 testsが全件成功。
  App production build成功（444 modules）、`git diff --check`成功。
- `TEST-001`を完了へ更新。CI-001の残りはcommit/push後のActions実行とpreview更新確認。
- 既知warning: App `npm ci`はNode 22に対するZXing Node >=24 engine警告、buildは500 kB超chunk警告。
  dependency auditはApp 12件、Worker 7件を報告するが、このタスクでは変更していない。
- commit、push、deploy、remote migrationは実施していない。

## 2026-07-26 — Codex: PLAY-004後半独立review・全体回帰

- CCの公開privacy/terms/support、削除/landing/settings導線、retention・外部送信文面を独立review。
  公開3 HTMLと主要実装事実は承認。targeted 5 files / 66 tests passed。
- 全体回帰: Worker 15 files / 195 passed。App 67 files中66 passed、656 passed / 1 failed。
  失敗は仕様判断待ちの既知`TEST-001`だけ。App production build成功（444 modules）、`git diff --check`成功。
- 未解消review指摘: `docs/legal/terms.md`（正本）と公開/landing termsに終了通知・免責・規約変更等の文面差が残る。
  また`landing/index.html`の月額1,980円・解約表現は「現在無料・決済なし」のtermsと矛盾する。
- canonical URL/contact、料金表示、D-005仕入先順はUser判断待ち。実機UI/公開networkは未確認。
- commit、push、deploy、remote migrationは実施していない。

## 2026-07-26 — PLAY-004後半: 公開legalページ・URL導線・legal文面の実装整合

- 担当: Claude Code。Codexの`PLAY-003`成果（`privacy-retention-draft.md`、`data-safety-audit.md`）を公開面へ反映。
- **配信方式の判断**: 公開legalは `app/public/` の静的HTML（`/privacy.html` `/terms.html` `/support.html`）。
  SPA・認証・installを介さず到達でき、アプリからは**相対リンク**で繋ぐため canonical host 未確定（`DS-08`）でも
  導線を完成できる。Play Console へ登録する絶対URLだけがUser待ちになる。
  `landing/` はどのdeploy scriptにも含まれない手動サイトのため、公開面は app deploy（`app/dist`）に一本化した。
- **配信の落とし穴に対処**: ①`_redirects`のSPA catch-all（`/* → /index.html`）より前に
  `/privacy` `/terms` `/support` の200 rewriteを追加。②`vite.config.js`の`navigateFallbackDenylist`へ
  3 pathを追加し、インストール済みPWAが拡張子なしURLでアプリ本体へ倒れないようにした。
- **文面の実装整合**: 保持期間（token 30日 / DO chat・監査 200件かつ24時間 / login・IP失敗記録 最長約24時間15分 /
  削除receipt・匿名tombstone 7日 / D1 Time Travel 契約planに応じ最大30日）、外部送信先（Cloudflare、Push service、
  Open-Meteo、BigDataCloud）、任意権限の発生条件を反映。旧記載の「操作ログ1年」「アクセスログ90日」を削除。
  Stripe・PostHogを委託先から外し「現在利用していません」と明記（`DS-09`）。termsの第4条を
  「無料提供・決済機能なし」へ改定し、料金前払い・返金・支払未確認による登録取消の条項を落とした。
  Workers Logsは有効/無効が未確認のため「記録される場合はCloudflareの仕様に従う」という条件付き表現にした。
- **端末内データ（`DS-02`）**: 削除後も残る端末ID・端末名・天気の位置情報を明示し、Android/Chrome・
  PWA・iOS Safari・PCブラウザ別の消去手順をsupportページに用意。privacy §8 と設定画面から接続した。
  削除時に端末設定まで消す方針へ変える場合は、文面より先に実装とtestを変える必要がある旨を台帳へ残した。
- **導線**: LandingPage下部、SettingsModal「法的情報・サポート」、公開削除ページ（`PRIVACY_URL`等を実URLへ）。
- 正本 `docs/legal/{privacy-policy,terms}.md` と `landing/{privacy,terms,support}.html`（support は新規）も同期。
- 検証:
  - 新規 `src/utils/legalPages.test.js` 47件: ページの存在、viewport/lang、外部リソース非依存（CSP self）、
    contact統一（`support@tanaoro.com`混在の検出）、旧記載（90日・1年間・Stripe, Inc.）の再発防止、
    実装事実の記載、アプリ3導線、`_redirects`の順序、PWA denylist。
  - `DeleteAccountPage.login.test.js` に未ログインでの3リンク到達を1件追加。
  - build後 `dist/` に3ページと`_redirects`が出力（precache 15 entries）。`vite preview`で
    `/privacy.html` `/terms.html` `/support.html` `/?delete-account` が**未ログインでHTTP 200**、
    titleも期待どおりであることを確認。
  - App全体: 67 files / 656 passed、既知`TEST-001`のみ1 failed。build成功。
- 未実施: commit、push、deploy。実機（375px）での目視確認。
- 次の再開地点: Codexによる公開legalページ・導線・文面の独立review。
  Userは canonical host と統一contact（`DS-08`）を決定。決定後にCCが絶対URLを反映する。
- 要User判断: `landing/index.html` の「¥1,980/月」表示が改定後のterms（決済機能なし）と矛盾する。
  landingはdeploy対象外だが、公開するなら料金表示の扱いを決める必要がある。

## 2026-07-26 — Cloudflare read-only preflight・D1 migration列挙修正・CC legal再review

- 担当: Codex。Cloudflare/Wranglerをread-onlyで確認。D1 Time Travel info取得は成功したが、bookmark値は
  repositoryへ記録していない。account plan名と保存済みWorkers Logs設定はCLIで取得できず、
  Dashboard用browserも未接続のためUser確認を残した。
- 本番D1 schemaには0010の`movements`/`movement_lines`、0011の削除列・receipt・triggerが存在せず、
  両migrationが未適用と確認。remote write、migration、deployは実施していない。
- 手動backend deploy用`scripts/migrate.sh`が0009までしか列挙していなかったため、0010/0011を追加。
  migration directory全件を順序どおり列挙する`worker/test/migrationScript.test.js`を追加し、1 test passed。
- develop workflowはfrontend preview専用でD1/Workerを変更しないことを再確認。標準Wrangler migration履歴ではなく、
  repositoryのschema sentinel方式で適用状態を判定する運用を`docs/ci-cd.md`へ明記した。
- CCの公開privacy/terms/support・app導線を独立reviewし、対象5 files / 66 tests passed。
  canonical URLと統一contactはUser確定待ちで、公開済みとは判定していない。
- ZXing: `@zxing/browser@0.2.0`が要求する`@zxing/library@^0.22.0`はNode >=24を宣言。
  現行Node 22ではwarningのみでtest/build可能だが、CI Node 20との組合せをrelease前にNode 24へ揃えるか、
  browser 0.1.5/library 0.21系へ下げるかを別依存判断とする。
- commit、push、deploy、remote migrationは実施していない。

## 2026-07-26 — PLAY-003 / PRIV-001 data最小化実装・回答draft・CC再review

- 担当: Codex。CCの`DS-01`、名称統一、reviewer手順書を独立reviewし、`_data_owner`は
  account削除成功時だけ消し、logout/account切替では保持する設計を承認した。途中cleanupが例外でも
  owner削除を必ず試すよう`clearDeletedAccountLocalData()`を`finally`で補強した。
- Data Safety / privacy: `data-safety-form-draft.md`と`privacy-retention-draft.md`を作成。
  位置情報、音声、Push、端末名/ID、chat、security record、D1 Time Travelをdata type/保持期間へ対応付けた。
  現行policyの「操作log 1年」「access log 90日」「Stripe利用中」は実装不一致として公開前修正対象にした。
- PRIV-001: `posthog-js`依存、key例、CSPのPostHog接続先を除去。analytics moduleを常時no-op化し、
  旧PostHog localStorageだけを削除するunit testを追加。source/package/CSP/buildにimport/key/host残存なし。
- Security retention: `login_attempts` / `ip_attempts`は15分の判定窓を維持し、期限切れrowを既存日次cronで
  全体cleanupする実装とtestを追加。実保持は最長約24時間15分。platform logはdashboard確認を別gateとした。
- D1: `d1-recovery-runbook.md`を作成。Time TravelはFree 7日/Paid 30日、restoreは破壊的であり、
  復元前の削除抑止list退避と復元後の再削除を必須化。現状はmaintenance modeと外部削除ledgerがないため、
  本番restoreを安全に完遂できないことを明記した。
- 検証:
  - App clean install `npm ci`成功。`npm ls vitest vite esbuild posthog-js`成功。
  - Worker: 14 files / 194 tests passed。
  - App: 608 passed / 1 known failure（`TEST-001`の日本語仕入先名順序）。
  - App production build成功（444 modules）。500 kB超chunk警告は既知の`PERF-001`。
  - `git diff --check`成功。
- 注意: `npm ci`は現行Node 22.14.0に対し`@zxing/library@0.22.0`がNode >=24を要求する
  engine warningを出すが、test/buildは上記結果。別の依存更新判断が必要。
- 未完了gate: public privacy/terms/support URL・統一contact、端末設定保持、TWA microphone、`/pdf`存廃、
  本番Cloudflare plan/Workers Logs、provider共有例外、公開build network、Play Console双方照合。
- deploy、remote migration、commit、pushは実施していない。

## 2026-07-26 — PLAY-004前半の実施（名称統一・reviewer手順書）とDS-01修正

- 担当: Claude Code。前回の前半監査で「User判断待ち」だった指摘を実施し、Codexの`DS-01`へ対応した。
- **名称統一（前半の最重要指摘）**: `index.html`（`title`=`棚卸入力`→`タナオロ`、`apple-mobile-web-app-title`=
  `棚卸`→`タナオロ`）、`AuthPage.vue`・`HomeScreen.vue`（`棚卸管理`→）、`LandingPage.vue`・
  `StoreSetupModal.vue`（`棚卸アプリ`→）を`タナオロ`へ統一。`app/`配下の旧表記は残存0で、
  manifest・公開削除ページ・onboarding と5表記すべてが一致した。旧表記に依存するtestは無し。
- **reviewer手順書を新規作成**: `play-reviewer-guide.md`。Play Consoleの「アプリのアクセス権」へ貼る本文、
  社内実機チェック9手順、削除2経路（アプリ内はログイン済みのみ表示／公開Webは未ログイン可）、
  権限4種の発生条件、TWAで課金導線が出ない根拠、未確定項目の owner 一覧。
  test店舗のcode/PINと公開URLはUser記入待ち。reviewerが削除を実行するとその店舗は再ログイン不可
  （7日tombstone）になるため、予備のtest店舗を用意する注意を明記した。
- **DS-01（Codex指摘）**: 削除完了後も`_data_owner`（店舗code）がlocalStorageへ残る不整合を修正。
  `clearDeletedAccountLocalData()`を追加し`DeleteAccountModal.finalize()`から使用。ログアウト・
  アカウント切替では`_data_owner`を残す（消すと再ログイン時に切替を検出できず前アカウントのデータが残る）。
  修正前に公開削除ページの通しテストが`_data_owner="STOREA"`残留で失敗することを確認済み。
- 前半監査の補正: cameraは`BarcodeScanner.vue`が直接`getUserMedia`を呼ばず`@zxing/browser`の
  `decodeFromConstraints`経由。位置情報は自動取得ではなく「📍 現在地で天気を表示」押下時のみ
  （`SessionListPage.vue:636`）で、拒否しても主機能は完結する。→ `DS-02`の申告文はこの前提で作れる。
- 検証:
  - 新規`DeleteAccountPage.delete.test.js` 2件＋`accountData.test.js` 4件追加。削除経路 6 files / 35 passed。
  - `cd app && npm test`: 64 files / 603 passed、既知`TEST-001`（仕入先順）のみ1 failed。回帰なし。
  - `cd app && npm run build`: 成功（PWA precache 2244.75 KiB）。
- 未実施: commit、push、deploy。実機UI確認。
- 次の再開地点: Codexが①DS-01修正 ②reviewer手順書 ③名称統一 を独立review。
  Userは手順書§1のtest店舗と`DS-08`のURL/contactを確定。後半（公開legalページ）は`PLAY-003`完了後。

## 2026-07-26 — PLAY-003 / PRIV-001 初回実装整合監査

- 担当: Codex。`data-safety-audit.md`を新設し、App/Worker/D1/DO/localStorage/第三者SDKを
  data type単位で収集・送信・保存・削除・保持・Data Safety候補へ整理した。
- PLAY-002追加gate: 削除成功後も`_data_owner`（店舗code）がlocalStorageへ残る。画面回帰の承認は維持するが、
  account data削除はClaude Code修正→Codex再reviewまで未完了。
- PRIV-001: tracked build設定ではPostHog key未注入でno-op。ただしkey設定時はautocapture default=true、
  default opt-in、自由記述feedback送信となる。品質凍結期間は無効固定を推奨。
- privacy差分: 現行の操作log 1年/access log 90日は実装証拠と不一致。Push/Web Speech/DO chat/device IDs、
  7日tombstone/receipt、D1 Time Travel、即時削除導線も記載不足。Stripeは未実装なのに現行サービスとして記載。
- 公開前gate: device名/ID・位置情報保持、security row保持、D1 plan、`/pdf`存廃、canonical URL/contactをUser決定。
  Claude Codeは`_data_owner`修正と公開legal route/URL導線、Codexは保持・PostHog・Worker/運用整合と再reviewを担当。
- 検証根拠: PLAY-002 6 files / 40 tests passed。監査はdocs/code reviewで、追加testは未実施。
- 未実施: deploy、migration、commit、push。

## 2026-07-26 — PLAY-004 前半監査（TWA・reviewer導線・名称・store metadata）

- 担当: Claude Code。**監査のみでコード変更なし**（指摘は起票し、実施はUser判断後）。
- TWA課金導線: **問題なし**。価格・決済CTAは `UpgradeModal.vue` に集約され `twaMode` で非表示。
  呼び出しは `App.vue:2604` の1箇所のみで `isTwaApp()` を必ず渡す。`STRIPE_CHECKOUT_URL` は空文字で
  他参照なし。TWAでは `LandingPage` が無料版案内＋PRO契約済みログイン入口のみ表示。
- **最重要指摘: アプリ名が5表記に分裂**（`タナオロ` / `棚卸入力`(title) / `棚卸`(apple title) /
  `棚卸管理`(AuthPage・HomeScreen) / `棚卸アプリ`(LandingPage・StoreSetupModal)）。
  store listing・アプリ内・公開削除リソースの名称一致はPlay要件のため `タナオロ` への統一が必要。
  Deliverable B で公開ページのみ先に `タナオロ` へ揃えた件の残りにあたる。
- reviewer導線: 削除は `SettingsModal.vue:360` の `isAuthenticated && !isGuest` ガード下にあり、
  **未ログインでは不可視**。reviewer用test店舗の認証情報が必須。公開Web `?delete-account` は
  未ログインでも到達できるため審査手順に使える。
- 権限申告の要確認: camera(BarcodeScanner)・microphone(useVoice)・通知(usePush)に加え、
  **位置情報(useWeather の geolocation)** を検出。棚卸の主機能と無関係に見えるため
  Data Safety申告・機能説明との整合を `PLAY-003` と突き合わせる必要がある。
- store metadata: manifest description は実機能と整合。icon 192/512/maskable あり。
- 次の再開地点: 名称統一の実施可否をUser判断 → 反映。reviewer手順書の作成。
  公開legalページ・URL導線は `PLAY-003` 完了後、screenshots は 8/6 UI freeze 後。

## 2026-07-26 — PLAY-002 Deliverable B承認 / PLAY-003・PRIV-001着手

- 担当: Codex。
- PLAY-002再レビュー: 公開routeと削除pageを実mountする画面レベル回帰を承認。追加blockerなし。
- 検証: 削除関連6 files / 40 tests passed。未login/login済みroute、入力、login成功/失敗、
  削除対象表示、削除modal起動、通常route非干渉を確認。
- PLAY-002残件: User実機UI、PLAY-003後のprivacy/terms/support確定URL、据え置き合意済みfocus trap。
- 着手: PLAY-003とPRIV-001。App/Worker/D1/DO/端末/第三者SDKをdata type単位で監査し、
  Data Safety案、privacy保持文面、公開URLのCC handoffを作る。
- 未実施: deploy、migration、commit、push。

## 2026-07-26 — CI-001 develop Pages preview 自動化（ローカル適用）

- 担当: Codex。User承認によりD-006を更新し、`develop` push後の固定preview自動更新を採用。
- 追加: `.github/workflows/develop-preview.yml`。Worker/App testとApp buildに成功した場合だけ、
  Cloudflare Pagesの`develop` branchへfrontendをdeployする。
- 固定URL: `https://develop.inventory-app-c40.pages.dev`。
- 安全境界: D1 migration、Worker、本番Pagesは自動変更しない。preview frontendは本番Workerを参照するため、
  実機確認にはtest店舗を使う。
- 文書: `CLAUDE.md`、`docs/ci-cd.md`、D-006、CI-001を現行workflowへ同期。
- CI安定化: フルsuite時だけ5秒を超えた`App.deleteRoute.test.js`の公開削除画面testに15秒timeoutを設定。
- 検証:
  - `cd worker && npm test`: 13 files / 191 passed。
  - `cd app && npx vitest run src/App.deleteRoute.test.js`: 1 file / 3 passed。
  - `cd app && npm test`: 62 files / 597 passed、既知`TEST-001`のみ1 failed。
  - `cd app && npm run build`: 成功（445 modules、PWA precache 2244.68 KiB）。
- 状態: CI-001は進行中。commit/pushとActions実行は未実施。`TEST-001`解消まではtest gateでdeployされない。
- 未実施: D1 migration、Worker deploy、本番Pages deploy、commit、push。

## 2026-07-26 — PLAY-002 Deliverable B 画面レベル回帰テストへの作り直し

- 担当: Claude Code。Codex 指摘（前回のtestは画面を描画せず回帰にならない）は妥当と判断し全面的に作り直し。
- テスト基盤（新規依存なし・既存devDependencyのみ）:
  - `vitest.config.js` に `@vitejs/plugin-vue`（ビルドで既に使用）を追加し、`.vue` を mount 可能にした。
  - `virtual:pwa-register/vue` は PWA プラグイン非搭載のテストで解決できないため、
    `src/test-stubs/pwaRegister.js` へ alias（Windows 対応のため `fileURLToPath` 使用）。
  - `@vue/test-utils` は導入せず、Vue 本体の `createApp` + jsdom の実 DOM 操作で検証。
- `DeleteAccountPage.login.test.js`（5件・実mount）: 未ログイン時の入力欄表示／店舗コード小文字→大文字化を
  含む input イベント→ログインボタンclick→**削除対象アカウント画面への遷移**／PIN 4桁未満はAPIを呼ばず
  エラー表示・非遷移／ログイン失敗は非遷移／「アカウント削除に進む」で削除モーダル（role=dialog・
  再認証PIN欄・店舗コード確認欄）が開く。
- `App.deleteRoute.test.js`（3件・App を実mount）: 未ログイン+`?delete-account` で公開削除ページが描画される／
  ログイン済みでも同ルートを優先し削除対象を表示／パラメータ無しでは削除ページを出さない（通常起動を阻害しない）。
- 検証:
  - App 全体: 63 files / 597 passed、既知 `TEST-001`（仕入先順）のみ 1 failed。config 変更由来の回帰なし。
  - Worker 全体: 13 files / 191 passed。App production build 成功。
- 未対応（合意済み/依存）: focus trap、実機UI確認、privacy/terms/support 確定URLと保持方針文面（`PLAY-003`）。
- 未実施: commit、push。
- 次の再開地点: Codex 再レビュー（画面レベル回帰の充足確認）。

## 2026-07-26 — PLAY-002 Deliverable B レビュー指摘の修正

- 担当: Claude Code。Codex の changes requested 2点へ対応。Worker 無変更。
- 指摘1（アプリ名）: 事実確認のうえ修正。PWA manifest（`vite.config.js`）は `name/short_name = タナオロ`、
  アプリ内も「タナオロの使い方」「タナオロ プロプラン」が正式名。`DeleteAccountPage.vue` の
  `APP_NAME` を「棚卸管理」→「タナオロ」へ。manifest と併せて更新する旨をコメントで明記。
  ※`AuthPage.vue` / `HomeScreen.vue` の見出しは「棚卸管理」のままで表記が混在。公開ページのみ
  listing 名に一致させる方針（User 判断 2026-07-26）。アプリ全体の表記統一は `PLAY-004` で扱う。
- 指摘2（公開routeのtest）: URL 判定を `utils/startupRoute.js` の `isDeleteAccountRoute()` へ切り出し、
  App.vue から使用。`@vue/test-utils` は未導入のため依存追加はせず、描画に依存しない形でテスト化。
  - `startupRoute.test.js` 7件: 値なし/値付き/他param併用/部分一致は反応しない/room・store では false/
    null・undefined 安全。＝未認証でも公開ページが優先表示され、通常起動を妨げない回帰。
  - `DeleteAccountPage.login.test.js` 3件: 店舗code+PIN login 成功で認証済み・削除対象確定、
    失敗では認証状態を作らない、別アカウント login で前アカウントのローカル業務データが掃除される。
- 検証: 削除経路 5 files / 35 tests passed、`npm run build` 成功（precache 2244.68 KiB）。
- 未対応（合意済み/依存）: focus trap、実機UI確認、privacy/terms/support 確定URLと保持方針文面（`PLAY-003`）。
- 未実施: commit、push。
- 次の再開地点: Codex 再レビュー（指摘2点の解消確認）。

## 2026-07-26 — PLAY-002 Deliverable B Codex独立レビュー（changes requested）

- 判定: 公開Web削除経路の設計・実装方針は妥当。ただし、Google Playへ登録できる完成状態としては
  修正2点と`PLAY-003`の公開前gateが残る。
- 確認できた点:
  - `?delete-account`を認証・room・session復元より先に判定し、未install/未loginでも専用viewへ到達する。
  - 店舗code+PINでlogin後、承認済み`DeleteAccountModal`と同じbackend contractを再利用する。
  - account切替時はlocal auth/shop codeを消去し、別account login時はowner差分でlocal業務dataを掃除する。
- 修正依頼:
  1. `DeleteAccountPage.vue`の`APP_NAME`が「棚卸管理」だが、PWA manifest・privacy policy・termsの
     正式サービス名は「タナオロ」。Google Playの公開Web resourceはstore listing上のapp名または
     developer名を参照する必要があるため、listingと一致させる。
  2. 新規の公開route/viewに専用の自動testがない。少なくとも`?delete-account`が未認証でも優先表示される
     回帰testと、公開pageのlogin入力/遷移のtestを追加する。
- 公開前gate（`PLAY-003`依存）:
  - privacy/terms/support URLは現在空で非表示。確定HTTPS URLを反映する。
  - privacy policyへ、匿名tombstone/receiptの7日保持、D1 Time Travel/provider backupの回復期間、
    account非連結security recordの保持方針を実装と矛盾なく反映する。保持するdataがある場合は明示が必要。
- 根拠: Google Play公式のaccount deletion要件は、Web linkが機能し、削除申請手段を目立つ形で示し、
  store listing上のapp/developer名を参照することを要求。正当な理由でdataを保持する場合は保持方針を明示する。
- 検証:
  - App全体: 60 files中59 passed / 1 failed、582 tests passed / 既知`TEST-001`のみ1 failed。
  - production build成功（444 modules、PWA precache 2244.58 KiB）。
  - local `/?delete-account`のHTTP応答を確認。操作可能なbrowser接続が無かったため目視・click・mobile実機は未実施。
- 未実施: App実装変更、deploy、commit、push。
- 次の再開地点: Claude Codeが上記2点を修正後、Codex再レビュー。公開URL/保持文面は`PLAY-003`で確定する。

## 2026-07-26 — SEC-004 ホスト認可境界のfail-closed化 完了

- 担当: Codex。Claude CodeのPLAY-002 Deliverable B（App）とは非競合のWorker lane。
- 問題: D1のstores照会失敗時にWorkerがDOへ素通しし、RoomDOも保護状態不明をlegacy扱いしたため、
  空室では第三者へ新規host tokenを発行できた。
- 修正:
  - Worker room gateはDB未設定/D1例外を503で閉じ、DOへ到達させない。
  - RoomDOは明示的に存在するPIN未設定店舗だけlegacy互換。不明/DB未設定/D1例外は保護扱いとし、
    有効auth tokenなしの新規host tokenを拒否。
  - レート制限table障害は認可境界ではないため、従来のfail-openを維持。
- テスト: 修正前に4経路の失敗を確認。対象3 files / 86 tests、Worker全体13 files / 191 tests passed。
- 根拠: Cloudflare Workers/DOの最新best practices（例外境界、明示的エラー、DO呼出し失敗の伝播）を確認。
- 未実施: deploy、実環境変更、commit、push。
- 次の再開地点: CCのDeliverable B独立レビュー。またはCodexの次タスク`SEC-005`。

## 2026-07-26 — PLAY-002 Deliverable B 公開Web削除ビュー 実装（レビュー待ち）

- 担当: Claude Code。承認済みの Deliverable A（削除フロー）を再利用。Worker 無変更。
- 対象: アプリ未インストールでもブラウザから削除申請できる公開Webリソース（Play の Data deletion URL 用）。
- 実装:
  - `App.vue` の onMounted 冒頭で `?delete-account` を検出し、認証・ルーム・セッション復元より優先して
    `currentView='delete-account'` を表示（未ログインでも到達可）。テンプレートに専用ビュー分岐を追加。
  - 新規 `DeleteAccountPage.vue`: アプリ名・削除対象・復元不能を明示。未ログインは店舗コード+PIN で
    `login()`→承認済み `DeleteAccountModal` を再利用して削除。完了時は静的な完了表示。
  - privacy/terms/support は設定値化（`PRIVACY_URL` 等）。未設定なら導線非表示。**確定URLは PLAY-003 依存**。
- 検証: `npm run build` 成功（precache 2244 KiB＝新ページ反映）。削除ロジックの unit test 16 緑（回帰なし）。
- 残り: 🖐実機UI（in-app＋公開ページ）、privacy/terms/support の確定URL反映（PLAY-003）、focus trap、
  Codex による公開ビューの独立レビュー。
- 未実施: commit、push。
- 次の再開地点: Codex の公開ビュー独立レビュー＋実機確認 → 確定URL反映。

## 2026-07-26 — PLAY-002 Deliverable A 低優先残件のCodex確認

- 判定: **対応2点を承認、追加指摘なし**。Deliverable Aのコードレビューは完了。
- Push非対応時も先に購読表示state/keyを消し、既存購読の有無にかかわらずremote `apiFetch`を
  呼ばないことをテストで固定したことを確認。
- 検証:
  - `usePush.local.test.js` + `accountDeletionFlow.test.js` + `api.test.js`: 3 files / 25 tests passed。
  - App全体: 59 files / 578 tests passed、既知`TEST-001`のみ1 file / 1 test failed。
  - App production build成功（442 modules）。
- Deliverable Aにコード上の追加残件なし。PLAY-002全体は実機UI、focus trap、公開Web削除ビュー、
  privacy/terms/support導線を継続する。
- 未実施: App実装変更、commit、push、deploy。

## 2026-07-26 — PLAY-002 Deliverable A 低優先残件の対応

- 担当: Claude Code。Codex 追再レビュー（承認）の低優先2点へ対応。Worker 無変更。
- A（非対応環境でも購読key掃除）: `unsubscribePushLocal()` の `pushSubscribed=false`＋`_KEY`削除を
  `pushSupported` 早期returnより前へ移動。Push 非対応環境で削除しても「通知ON」表示が残らない。
- B（remote未呼出しの固定）: `usePush.local.test.js` で `api.js` をモックし、`apiFetch` が呼ばれない
  ことを全ケースで assert。加えて非対応環境で key を消して false を返す test を追加（計3件）。
- 検証: `usePush.local.test.js`＋`accountDeletionFlow.test.js` `16 passed`、`npm run build` 成功。
- 据え置き（合意済み）: focus trap。PLAY-002 残タスク: 実機UI・公開Web削除ビュー・privacy/terms/support導線。
- 未実施: commit、push。

## 2026-07-26 — PLAY-002 Deliverable A 再レビュー残件のCodex確認

- 判定: **対応2点を承認**。Deliverable Aの承認状態を維持する。
- UUID: 保存済みrequestIdをWorkerと同一のUUID patternで検証し、非UUIDを再生成することを確認。
- Push: `getRegistration()`によりSW未登録時も即時完了し、既存購読はremote APIを使わず
  browser側だけ解除することを確認。
- 検証:
  - `accountDeletionFlow.test.js` + `usePush.local.test.js` + `api.test.js`: 3 files / 24 tests passed。
  - App全体: 59 files / 577 tests passed、既知`TEST-001`のみ1 file / 1 test failed。
  - App production build成功（442 modules）。`git diff --check`成功（改行warningのみ）。
- 低優先残件: `pushSupported === false`でも購読表示keyを消すこと、remote API未呼出しをspyで固定するtest。
- PLAY-002全体の残件は実機UI、focus trap、公開Web削除ビュー、privacy/terms/support導線。
- 未実施: App実装変更、commit、push、deploy。

## 2026-07-26 — PLAY-002 Deliverable A 再レビュー残件の対応

- 担当: Claude Code。Codex 再レビュー（承認）の非Blocker残件へ対応。Worker 無変更。
- ①保存 requestId の UUID 検証: `resolveRequestId` が保存値の `id` を UUID 形式で検証し、
  非UUID（改変/破損）は破棄して再生成。→ 直せない 400 デッドロックを防止。
- ②SW 未登録での finalize hang: `unsubscribePushLocal()` を `serviceWorker.ready`（未登録だと
  永久未解決）から `getRegistration()`（未登録なら即 undefined）へ変更。削除済みなのにスピナーが
  回り続ける事象を回避。
- テスト: `accountDeletionFlow.test.js` に非UUID破棄を追加（計13）。`usePush.local.test.js` 新規2件
  （SW未登録でも hang せず解決／既存購読は browser 側 unsubscribe のみ・remote 呼ばない）。
  対象 `15 passed`、`npm run build` 成功。
- 据え置き（合意済み）: focus trap（全モーダル共通課題）。実機UI確認・公開Web削除ビュー・
  privacy/terms/support 導線は PLAY-002 残タスクとして継続。
- 未実施: commit、push。

## 2026-07-26 — PLAY-002 Deliverable A Codex再レビュー

- 判定: **承認**。前回Blocker 2件は解消され、アプリ内削除UXは次工程へ進められる。
- requestId: `{shop,id}`で保存し、別店舗または壊れた保存値を破棄することを確認。
- Push: backend成功後は`unsubscribePushLocal()`を使い、失効済みtokenでremote DELETEせず
  browser購読解除へ到達することを確認。
- Accessibility: dialog semantics、label/input関連付け、PIN初期focus、status/alert live regionを確認。
- 検証:
  - `accountDeletionFlow.test.js` + `api.test.js`: 2 files / 21 tests passed。
  - App全体: 58 files / 574 tests passed、既知`TEST-001`のみ1 file / 1 test failed。
  - App production build成功（442 modules）。`git diff --check`成功（改行warningのみ）。
  - Worker対象4 tests、全体13 files / 187 tests passed。
- テスト配置修正: Node SQLiteを使う`pushHandler.test.js`を`worker/src`から`worker/test`へ移し、
  AppのVitest include対象から分離。実装変更なし、Worker全体成功を確認。
- 非Blocker残件: 保存requestIdのUUID形式検証、Service Worker未登録時もfinalizeを停止させない保証と
  `unsubscribePushLocal()`/finalizeの結合テスト、focus trap。
- PLAY-002全体の残件: 実機UI確認、公開Web削除ビュー、privacy/terms/support導線。
- 未実施: commit、push、deploy。

## 2026-07-26 — PLAY-002 Deliverable A レビュー指摘の修正

- 担当: Claude Code。Codex の changes requested（下記エントリ）へ対応。Worker 無変更。
- 吟味結果: Blocker 2件・a11y・unit test 要求はいずれも妥当と判断し修正。
- Blocker1（requestId 店舗scope化）: `deleteRequestId` を `{shop,id}` で保持し、`resolveRequestId()` が
  別店舗/壊れ値を破棄して再生成。backend が認証前に receipt を冪等判定するため、別店舗の残存 requestId
  再送で「別店舗を削除せず 200 alreadyDeleted」→ローカルだけ消去、の誤認経路を遮断。
  `accountData.clearLocalAccountData` の切替掃除にも `deleteRequestId` を追加。
- Blocker2（成功後 Push local-only 解除）: `unsubscribePushLocal()` を追加し finalize から使用。
  remote DELETE(401)を呼ばないため browser `PushSubscription.unsubscribe()` に必ず到達し、
  失効ハンドラ誤発火も回避。
- Accessibility: `role=dialog`/`aria-modal`/`aria-labelledby`、label と input の for/id 関連付け、
  初期 focus(PIN)、処理中=`role=status aria-live=polite`、エラー=`role=alert aria-live=assertive`。
- テスト: 純粋ロジックを `utils/accountDeletionFlow.js` へ切り出し、`accountDeletionFlow.test.js` 12件追加
  （requestId scope 5・error 写像 7）。`npx vitest run` 12 passed、`npm run build` 成功（441 modules）。
- 未対応（合意済み残件）: focus trap（アプリ全モーダル共通課題として別途）、実機UI確認、公開Web削除ビュー、
  privacy/terms/support 導線、docs更新。
- 未実施: commit、push。
- 次の再開地点: Codex 再レビュー（blocker解消確認）→ 実機確認 → 残DoD。

## 2026-07-26 — PLAY-002 Deliverable A Codex独立レビュー

- 判定: **changes requested**。AppファイルはCC担当のためCodexは未編集。
- Blocker 1: `deleteRequestId`が店舗にscopeされていない。backend成功後に応答を失いreceiptが残った状態で
  別店舗へloginすると、前店舗requestIdのreplay 200を新店舗削除成功と誤認し、localだけ消去し得る。
- Blocker 2: 削除成功時点で全tokenは失効済み。現行`unsubscribePush()`はremote DELETEの401でcatchへ入り、
  browser `PushSubscription.unsubscribe()`を実行せず、通常の「別端末login」失効handlerも誤発火する。
- Accessibility残件: `role=dialog` / `aria-modal`、label関連付け、focus管理、処理中/エラーのlive region。
- 検証: `npx vitest run src/utils/api.test.js` 1 file / 9 tests passed、`npm run build`成功（441 modules）。
- CCへの修正条件: requestIdを店舗scope化、削除成功後のPushをlocal-only解除、上記flowのunit test追加。

## 2026-07-25 — SEC-003 Push購読API保護 完了

- 担当: Codex。CCの`PLAY-002` App変更とは非競合。既存`apiFetch`のBearer自動付与も確認済み。
- 実装: Push購読作成・削除へstrict店舗認証、8KiB stream上限、公開HTTPS endpointと
  RFC 8291 / Push API準拠のP-256・auth鍵形式検証を追加。
- tenant境界: endpoint owner事前確認と原子的UPSERT条件で別店舗の奪取を409拒否。DELETEは
  `shop_code + endpoint`一致だけを削除し、他店舗操作はidempotent no-op。
- テスト:
  - 実装前に未認証、不正payload、payload超過、越境upsert/deleteの5失敗を確認。
  - 対象43 tests、Worker全体`13 files / 187 tests` passed。
- 未実施: deploy、実環境変更、commit、push。
- 次の再開地点: `SEC-004`（ホスト認可のfail-closed化）。CCは`PLAY-002`のtest・公開Web・実機確認。

## 2026-07-25 — PLAY-002 アプリ内削除UX 実装（レビュー待ち）

- 担当: Claude Code。User 承認済み方針（アプリ内UXから着手・公開Webは SPA 内 URL 起動ビュー）。
- 対象: `DELETE /auth/account`（PLAY-001 backend / D-013 確定）に対する in-app 削除フロー。
- 変更ファイル（App lane のみ・Worker 無変更）:
  - 新規 `app/src/components/DeleteAccountModal.vue`（再認証→最終確認→処理中→エラー/再試行→完了）。
  - `useAuth.js` に `deleteAccount()`、`api.js` に `err.code/err.body` 公開、`analytics.js` に `resetAnalytics()`。
  - `storageKeys.js` に `deleteRequestId`、`appMenuState.js` に `showDeleteAccount`。
  - `SettingsModal.vue` の「設定」に danger 区画（認証済みのみ）、`App.vue` にモーダル配線・戻る操作・成功時 landing 遷移。
- 契約準拠: requestId は開いた時に1回生成→保持→再試行不変・成功で破棄。409=`retryable:false` で元ID保持、
  503/通信失敗=token 温存で同一ID再試行。200 後にのみ Push解除→業務data消去→分析reset→auth破棄。
  confirmation は認証店舗コード完全一致（越境ガード）。
- 検証: `cd app && npm run build` 成功（441 modules、モーダルがバンドルに反映）。
- DoD 未了（レビュー・実機後に着手）: 🤖ユニットテスト、🖐実機UI(375px)、公開Web削除ビュー(Deliverable B)、
  privacy/terms/support 導線、test-checklist/project-status 更新、Codex 独立レビュー。
- 未実施: commit、push、deploy。
- 次の再開地点: Codex の現行実装完了後に **レビュー＋実機確認** を実施。その結果を受けて残りDoD（テスト・公開Web）へ。

## 2026-07-25 — BUG-001 cron schema修正 完了

- 担当: Codex。Claude Codeの`PLAY-002` App変更と重ならないWorker laneで実施。
- 仕様: D1に最終操作時刻がないため、途中session通知は`started_at`基準。開始24時間超・7日以内、
  activeかつ論理削除されていないsessionだけを対象にする。
- 実装: `pushHandler.js`の存在しない`sessions.updated_at`参照を`started_at`へ修正。
- テスト:
  - 全migrationを適用したNode SQLiteで、修正前の`no such column: s.updated_at`を再現。
  - cron全体実行と、開始25時間/23時間/8日超の通知境界を自動test化。
  - `cd worker && npm test`: 13 files / 182 tests passed。
- 運用: User採用の自律作業/停止確認境界をD-014へ記録。
- 未実施: deploy、実環境変更、commit、push。
- 次の再開地点: Codexは`SEC-003`（Push購読APIの認証・payload検証）。Claude Codeは`PLAY-002`継続。

## 2026-07-25 — PLAY-001 account deletion backend 完了

- 担当: Codex。Claude Codeのcontractレビュー指摘（D-013）を反映済み。
- 実装:
  - `DELETE /auth/account` と、PIN再認証・店舗code確認・UUID requestId・15分5回制限を追加。
  - 0011 migrationでpending/request列、匿名receipt、inactive accountへの再INSERT防止triggerを追加。
  - D1関連dataと全token/Push購読をbatch削除し、storeを7日匿名tombstone化。
  - 棚卸/発注2 DOの全接続・alarm・storageを内部経路から削除。
  - pending/削除済み店舗のlogin、token、store API、store参照、room gateを遮断。
  - 日次cronへ7日経過receipt/tombstone cleanupを接続。
- テスト:
  - account deletion 11件を含め、`cd worker && npm test`: 12 files / 180 passed。
  - 全11 migrationをインメモリSQLiteへ適用。削除列/receipt列と`account_inactive` triggerを確認。
- 文書: contract、D-012/D-013、Google Play data map、API/DB現況を実装へ同期。
- 未実施: production migration、deploy、commit、push。
- 次の再開地点: Claude Codeは `PLAY-002` UI/公開Web接続。Codexは接続後の認可/data削除review、
  並行可能なら `PLAY-003` または次の公開対象P1へ進む。

## 2026-07-25 — PLAY-001 backend 契約レビュー

- 担当: Claude Code（依頼: `account-deletion-contract.md` のレビュー）。アプリ本体・契約 doc は無変更（B 方針）。
- 対象: 契約 doc と実装 `accountDeletion.js` / migration 0011 / `accountDeletion.test.js` の突き合わせ。
  ※レビュー中に `accountDeletion.js` が新規出現。Codex が PLAY-001 backend を並行実装中。
- 整合を確認できた点:
  - migration 0011 の全 child 表 active-insert トリガと tombstone UPDATE が実スキーマと整合。
    line 系 4 表（inventory/order/movement/par）すべてに `shop_code` 列あり。
  - `accountDeletion.js` の data map（13 表を物理削除＋stores 匿名化＋receipt）が契約と完全一致。
  - PIN 照合は `verifyPinHash` 再利用で PBKDF2 / legacy 両対応。rate limit は login 共有窓（15分/5回）。
  - test 10 件（400 / 401 / 正常 / replay / DO失敗 / D1失敗 / cleanup）。
- 契約 doc の鮮度ズレ（未編集・申し送りのみ）:
  - `confirmation` は「認証店舗の `shop_code` と case-sensitive 完全一致」（大文字化しない）。
  - 429 閾値未記載（login 共有 15分/5回）。
  - 409 UI「同一 requestId 再試行」は誤り。409 は別 requestId 進行中のみ。
  - 処理順に requestId 形式チェック優先と PIN 失敗時 `login_attempts` 記録が未記載。
  - 7日経過後の replay は 401（冪等でなくなる）が未記載。
- 未完の配線（Codex lane、PLAY-001 完了 blocker）:
  - `DELETE /auth/account` 未配線、`purgeRooms`＋RoomDO 内部 purge（`account-delete-v1`）未実装、
    `scheduled()` の cleanup 未呼び出し。
  - `deletion_pending_at` 時の通常 API / room read・update 遮断は未確認。
- 未決は `decisions.md` D-013 に登録（決定者 Codex）。
- 次の再開地点: Codex が wiring＋429/409 テストを完了後、Claude Code が PLAY-002（削除 UX・公開 Web）へ着手。

## 2026-07-25 — SEC-002 完了

- 担当: Codex
- 変更:
  - order ownerの事前確認と、`ON CONFLICT` 内のshop条件を追加。
  - owner確認後の競合でも別店舗upsertを409で拒否し、明細変更前に停止。
  - 他店舗・不存在のorder DELETEを404に統一し、HTTP statusを伝播。
- テスト:
  - 修正前に越境POST、競合、越境DELETE、HTTP statusの4失敗を確認。
  - 対象: 62 passed。Worker全体: 11 files / 159 passed。
  - インメモリSQLiteで別店舗 `changes=0`、同店舗 `changes=1` を確認。
- 未実施: deploy、commit、push。
- 次の再開地点: account deletion contractを固定し、`PLAY-001` backendへ着手。

## 2026-07-25 — SEC-001 完了

- 担当: Codex
- 変更:
  - `join` 成功前は `ping` 以外を拒否し、認可状態をWebSocket attachmentへ永続化。
  - 空deviceId、二重join、招待session不一致、偽hostを拒否。
  - 未参加ソケットへの配信を遮断し、退出時の認可を即時失効。
  - `conflict_lock` をhost-onlyに修正。
- テスト:
  - 失敗testを先に追加し、修正前は29件中28件の失敗を確認。
  - `RoomDO.joinAuth.test.js`: 33 passed。
  - Worker全体: 11 files / 154 passed。
- 未実施: deploy、commit、push。Workers runtime統合テストは `TEST-002` で継続。
- 次の再開地点: `SEC-002` の2店舗衝突testとowner check。

## 2026-07-25 — SEC-001 着手

- 担当: Codex
- 対象: WebSocket参加完了前の更新遮断、空deviceId、host-only操作。
- 方針: 失敗testを先に追加し、connection attachmentを認可状態の正として最小修正する。
- 使用指針: Cloudflare Durable Objects / Workers best practices（2026-07-25再取得）。
- 状態: 進行中。

## 2026-07-25 — 共同品質基盤スプリントを採用

- 担当: User / Codex。Claude Codeへの共有待ち。
- 決定:
  - 2026-07-27〜2026-08-08はGoogle Play要件と品質基盤以外の機能開発を停止。
  - 共有場所を `docs/quality-foundation/` とし、特定agent名に依存しない名称へ変更。
  - Codexはsecurity/data/backend/CI、Claude CodeはPlay必須UI/UX/legal surfaceを主担当とする。
  - 全10評価項目9.0以上、8項目以上A+をrelease targetとする。
  - 双方の独立採点の低い方を正式点にする。
- 作成:
  - `sprint-plan-2026-07-27.md`
  - `quality-scorecard.md`
  - `google-play-readiness.md`
- アプリ本体の変更: なし。
- 次の再開地点: `SEC-001`、`SEC-002`、account deletion contractの確定。

## 2026-07-25 — 初回横断監査と共有基盤

- 担当: Codex
- 対象: `develop@131a36f`
- 実施:
  - コード、Worker/DO、D1、CI、テスト、依存関係、既存 Markdown を横断確認。
  - App / Worker で `npm ci`、test、App build、production audit を実行。
  - P0 2件、P1/P2 の改善候補を完了条件付きタスクへ変換。
  - `docs/quality-foundation/` の前身となる共有文書と `AGENTS.md` を作成し、`CLAUDE.md` に共有入口を追加。
  - ローカル生成物を `.gitignore` に追加。既存生成物は削除していない。
- 検証結果:
  - Worker: 121 tests passed。
  - App: 500 passed / 1 failed。
  - App build: 成功、chunk size と Vite CJS の警告あり。
  - App production audit: low 1 / high 2。
  - Worker production audit: 0。
- アプリ本体の変更: なし。
- 未決:
  - 仕入先の正しい並び順 (`D-005`)。
  - `develop` で CI のみか preview も行うか (`D-006`)。
- 次の推奨:
  1. `SEC-001` を担当中へ変更し、未参加 WebSocket の失敗テストから開始。
  2. 続いて `SEC-002` の2店舗衝突テストと owner check。
- 注意:
  - 作業開始時点で `.wrangler/`、`worker/dist/`、ルート `package-lock.json` が未追跡。
    ignore しただけで削除していない。
