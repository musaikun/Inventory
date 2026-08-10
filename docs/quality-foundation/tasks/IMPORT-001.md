# IMPORT-001 — 品目マスタ取込を非破壊かつ確認可能にする

- 状態の正本は [`../task-list.md`](../task-list.md)
- Web公開との関係: [`../web-release-readiness.md`](../web-release-readiness.md)の
  Release candidate product contract / `WEB-07`
- 過去棚卸取込と履歴identityは[`DATA-002.md`](DATA-002.md)で扱い、本タスクへ重複させない。

## 背景

CC branch `claude/branch-operational-status-2lwwwu@8ff46af`で、非破壊mergeと共通previewの
初回実装が追加された。Codexの2026-08-09独立reviewでは方向性を承認した一方、次のdata riskを確認した。

- quoted comma、escaped quote、未閉じquote、headerなしfileを正しく処理できない。
- invalid numberをerrorにせず、既存値維持として扱う。
- alias衝突で別品目のaliasを無言で奪える。
- `categoryCodes`、`axisNames`、名称切り詰め、行errorがpreviewに完全表示されない。
- merge / replace、発注点、backup / undoの説明と実挙動が一致しない。
- modal / 全取込入口のcomponent・integration testが不足している。

## 完了条件

- 通常取込は非破壊mergeで、fileに無い既存品目を削除しない。
- replaceは別操作とし、削除・保持対象と影響をcommit前に表示する。
- CSV、mapped CSV、Excel、PDFが同じpreview / commit contractを使用する。
- quoted comma、escaped quote、BOM、日本語、CRLF/LF、空行、重複を仕様どおり処理する。
- 未閉じquote、列数不一致、headerなし、不正数値を行番号・列・理由付きで処理前に表示する。
- alias衝突で既存品目を傷つけず、明示解決なしにcommitしない。
- 追加・更新・変更なし・除外・error、Free上限、名称切り詰め、全変更fieldをpreviewする。
- previewとcommitで同じ計画dataを使い、cancel / Escapeでconfigを変更しない。
- backup / undoと画面文言を実挙動へ一致させる。
- 対象の異常系test、全取込入口のintegration test、App全test、production buildが成功する。
- 実browser未確認などの残件を明記し、Codexの独立reviewを受ける。

## 作業順

[`../cc-session-plan.md`](../cc-session-plan.md)の第3セッションで扱う。
着手時に`task-list.md`を`進行中 / Claude Code`へ更新し、証拠提出後は`レビュー待ち`までとする。
Codex承認前に`完了`またはWEB-07通過としない。

**2026-08-10 現在: `レビュー待ち / Claude Code`。** 実装と検証は下記のとおり。Codex再レビュー待ち。

## 実装（2026-08-10 / Claude Code 第3セッション）

対象HEAD: `claude/branch-operational-status-2lwwwu@ae9c03b`（第2セッションの成果を含む）

### 1. CSVの字句解析と数値解釈を一本化

`app/src/utils/csvParse.js`（新規）。品目取込・棚卸結果取込・納品取込がそれぞれ持っていた
1行パーサ3本を置き換えた。同じ欠陥を3か所で再現していたため。

| 修正前の挙動（実測） | 修正後 |
|---|---|
| `"1,200"` → **`1`** | `1200`（桁区切りとして読む） |
| `"5"" 皿"` → **`5 皿`**（エスケープされた引用符が消える） | `5" 皿` |
| 未閉じ引用符 → **黙って受理** | 開始行つきでエラー |
| 引用符内の改行 → レコードが割れる | 1セルの一部として保つ |
| `1,20` / `1,2345` → **`1`** | 不正として行番号・列・理由つきでエラー |

BOM・CRLF/LF/CR・末尾改行なし・空行（行番号は保つ）・日本語・全角数字・`¥`も同じ経路で扱う。

### 2. 品目取込を「黙って通さない」形へ

`app/src/utils/itemImport.js`。

- **不正数値を「既存値を維持」にすり替えない。** 修正前は `parseFloat` が `NaN` を返すと
  `undefined`＝未指定として扱い、既存値が残ったまま「更新」と表示されていた。
  現在はその行をエラーにし、**同じ行の他の列も適用しない**（画面の差分と実データがずれるため）。
- **列数がヘッダと一致しない行**を行番号つきで除外する。
- **ヘッダ無しファイル**（1行目が「品目名」相当でない）を `IMPORT_ERROR_NO_HEADER` で拒否し、
  列指定へ誘導する。修正前は先頭行を黙ってヘッダ扱いし、**1品目目が消えていた**。
  列指定側は `hasHeader: false` で1行目もデータとして取り込める。
- **1行も取り込めない場合も、除外理由を例外へ載せる**（`err.errors` / `err.skipped`）。
  「有効な品目が見つかりませんでした」だけを出して原因を消さない。
- 品目名は `ITEM_NAME_MAX`（200・worker の `MAX_INGREDIENT_LEN` と同値）で切り詰め、
  切り詰めた事実を `summary.truncatedNames` に残す。

### 3. エイリアス衝突を非破壊にし、明示解決を要求

修正前は `next.dictionary[alias] = row.name` で**既存品目のエイリアスを無言で奪えた**
（実測: `あかいやつ → トマト` が `あかいやつ → レタス` に変わる）。

- 既定 `ALIAS_KEEP_EXISTING` では奪わず、衝突として `summary.aliasConflicts` に出す。
- 3種を検出する: 既存の別名が別品目を指す（`existing`）／別名が既存**品目名**と同じで
  その品目を隠す（`item`）／ファイル内で2品目が同じ別名を取り合う（`file`）。
- 画面は衝突があるあいだ取込ボタンを無効にし、「今のままにする」「ファイルの指定を優先する」
  のどちらかを選ばせる。**明示解決なしにcommitしない。**
- 全入れ替えで消える品目のエイリアスは衝突にせず、辞書からも落とす。

### 4. プレビューと取込を同じ計画データにする

修正前は `previewCSVImport` と `loadFromCSV` が**それぞれ解析と計画を組み直して**いた。
`planCSVImport()` / `planMappedImport()` が計画を返し、画面がその**同じオブジェクト**を
`applyImportPlan()` へ渡す。2回組み立てないので、ずれる余地がない。

プレビューへ追加した表示: 分類コードの変更（カテゴリ単位のため品目差分に出ない）、
ファイル列名から採用する軸名、品目名の切り詰め、取り込めなかった行（行番号・列・理由）、
エラー件数、発注点の扱い。

### 5. merge / replace / undo の文言を実装へ一致させる

- 発注点: **列があるファイルだけ**が発注点を書き換え、空欄の行は解除する。列が無ければ保持する。
  この分岐をそのまま文言にし、解除対象の件数も出す。
- 全入れ替えの「この操作は取り消せません」は誤り（`undoLastImport` がある）。
  「取込の直後にかぎり1回だけ戻せる。端末のメモリ上だけの退避で、再読込や他の変更で失効する」
  という実際の挙動へ書き換えた。
- キャンセル・Escape・オーバーレイクリックが重なっても `close` は1回だけ。閉じる経路で config を変更しない。

### 6. 過去棚卸取込を sessionId モデルへ接続

修正前は `window.confirm` 1枚のあと `_data[date] = ...` と**日付キー**で localStorage を直接書き、
D1 へは `saveSnapshotToD1()` を投げっぱなしにしていた。同日に通常の棚卸があると黙って上書きし、
サーバー保存の成否を見ずに「取り込みました」と表示し、取込ぶんだけを取り消す手段が無かった。

| 種別 | ファイル |
|---|---|
| 新規 | `worker/migrations/0013_import_batches.sql`（`sessions.import_batch_id` + index） |
| 新規 | `worker/src/pastImport.js`（create / cancel） |
| 新規 | `app/src/services/pastImportPlan.js`（計画・確定・取消） |
| 新規 | `app/src/components/PastStocktakeImportModal.vue` |
| 変更 | `worker/src/index.js`（strict Bearer の側へ2ルート追加） |
| 変更 | `app/src/composables/useHistory.js`（sessionIdキー化・バッチ削除） |
| 変更 | `app/src/composables/useDataImport.js` / `useStore.js` |
| 変更 | `app/src/components/MasterManagePage.vue` / `MovementPage.vue`（導線2箇所は実装1つ） |

- 取込で作るのは**通常と同じ session**。カレンダー・詳細・取消がすべて同じ `sessionId` を参照する。
- **1リクエスト = 1日ぶん**。日数×品目数を1つのbatchへ入れるとD1の1 invocation上限を超えるため。
- session / `inventory_lines` / `store_history` を1つの `db.batch` で書く。途中失敗は全巻き戻し＋`503 retryable`。
- 同じ `(shop_code, batchId, date)` の再送は同じ session を貼り直す（冪等）。
- 同日衝突は既定で非破壊（別 session として追加）。上書きは client が `replaceSessionIds` で
  **明示指定した session だけ**を `shop_code` の内側で削除する。
- 取消は `import_batch_id` の一致だけを条件にするため、別バッチと通常の棚卸を消さない。冪等。
- **サーバーが `sessionId` を返した日だけ**を端末へ反映し、「取り込みました」もその件数だけ出す。

## 検証（2026-08-10）

| command | 結果 |
|---|---|
| `cd app && npx vitest run src/utils/csvParse.test.js` | 18 passed |
| `cd app && npx vitest run src/utils/itemImport.strict.test.js` | 32 passed |
| `cd app && npx vitest run src/components/ItemImportPreviewModal.test.js` | 15 passed |
| `cd app && npx vitest run src/services/pastImportPlan.test.js` | 19 passed |
| `cd app && npm test` | 79 files / 747 passed |
| `cd app && npm run build` | 成功 |
| `cd worker && npx vitest run test/pastImport.sqlite.test.js` | 24 passed |
| `cd worker && npm test` | 20 files / 367 passed |

### 修正前に失敗を確認したテスト

`HEAD` の `app/src/utils/itemImport.js` を一時コピーして今回の回帰テストを当て、
**8件すべてが失敗すること**を確認してから実装した（確認後にコピーは削除）。

| 期待 | 修正前の実測値 |
|---|---|
| `"1,200"` → `1200` | `1` |
| `5"" 皿` → `5" 皿` | `5 皿` |
| 未閉じ引用符で例外 | 例外にならない |
| ヘッダ無しで例外 | 例外にならない（先頭品目が消える） |
| 列数不一致がエラー行 | `undefined`（記録されない） |
| 不正数値の行を取り込まない | `['トマト','レタス']`（取り込まれる） |
| エイリアスを奪わない | `レタス`（奪う） |
| preview に分類コード・軸名・切り詰め | `undefined` |

## 未実施

- **実D1**: migration 0013 は `node:sqlite` のfresh適用testでのみ確認。development / production D1 へ
  適用していない。実D1でのstatement数・実行時間の計測も未実施（`WEB-04` / `WEB-07` に残る）。
- **実ブラウザ / 実機**: 375px・1024px以上・keyboard操作の目視確認をしていない。
  jsdom は `matchMedia` が `matches: false` を返すため、テストはモバイル経路だけを通る。
- 大量データ（500行上限付近・複数日×多品目）の実測。

## migration

- **あり**: `0013_import_batches.sql`（`sessions.import_batch_id` 追加 + 部分index）。
- **ロールバック可能**。列追加と index 作成だけで、既存行・既存制約を書き換えない。
  0012 と違い `DROP TABLE` を含まないため不可逆点ではない。戻す場合は index を DROP すればよい
  （列は NULL のまま無害に残る）。
- `scripts/migrate.sh` にセンチネル `idx_sessions_import_batch` で登録済み。**適用は未実施。**

## DoD セルフチェック（[`../../feature-checklist.md`](../../feature-checklist.md) 照合 / 2026-08-10）

N/A には理由を付ける。🖐 の未実施は「未実施」節と `test-checklist-new-features.md` の T 節に台本化した。

### 1. UI・表示

| 項目 | 判定 | 根拠 / 理由 |
|---|---|---|
| 🖐 スマホ 375px・タップ領域44px | **未実施** | 実ブラウザ無し。台本 T-1-1。既存のモーダル共通クラス（`modal-sheet` / `.btn` 12px padding）に乗せており、独自の寸法を作っていない |
| 🖐 タブレット表示 | **未実施** | 同上。レイアウトCSSは無変更（`style.css` / `App.vue` に差分なし） |
| 🖐 PC表示（>=1024px・ホバー） | **未実施** | 台本 T-1-2。デスクトップ層（`body.dt-shell`）は無変更 |
| 🖐 ローディング表示 | ✅ | 過去棚卸の確定中は「保存中…」でボタンを無効化。品目取込は同期処理で待ちが無い |
| 空状態 | ✅ | 0件ファイル・全行エラーの両方をテスト（`itemImport.strict.test.js` / モーダルtest） |
| ホームカードの統一 | **N/A** | ホーム画面に手を入れていない（`SessionListPage.vue` 無変更） |
| ダーク/文字サイズ | **N/A** | 既存モーダルの配色・字送りをそのまま使い、新しい配色規則を作っていない |

### 2. 入力・データ

| 項目 | 判定 | 根拠 / 理由 |
|---|---|---|
| 🤖 バリデーション（型・範囲・空・重複） | ✅ | client: `csvParse.test.js` 18 / `itemImport.strict.test.js` 32。server: `pastImport.sqlite.test.js` の「server側の検証」10件 |
| localStorage キーを `storageKeys.js` へ登録 | **N/A** | 新しい localStorage キーを作っていない（履歴は既存 `STORAGE_KEYS.history` のまま） |
| アカウント切替時の消去対象 | ✅ | 取込ぶんも既存の履歴（`useHistory.resetLocalData`）と品目マスタ（`useConfig.resetLocalData`）に含まれる。新しい保存先を作っていない |
| D1永続化の要否 | ✅ | 過去棚卸取込を **D1 正本**にした（従来は localStorage 専用 + 投げっぱなし）。品目マスタは従来どおり config 経由 |
| schema変更は `migrations/` + `migrate.sh` | ✅ | `0013_import_batches.sql` を追加し `migrate.sh` にセンチネル登録。fresh適用testと列挙testあり。**適用は未実施** |
| config フィールド追加時の `normalizeConfig` 同期 | **N/A** | config のフィールドを増やしていない（`dictionary` 等の既存フィールドの**入れ方**を変えただけ） |
| 再インポートで新フィールドの割り当てが維持されるか | ✅ | 軸割り当ての復元は既存仕様のまま（`useConfig.archive.test.js` が継続green）。発注点の保持/解除条件をテストで固定 |

### 3. エラー処理・通信

| 項目 | 判定 | 根拠 / 理由 |
|---|---|---|
| 🤖 想定エラーは日本語・想定外は握り潰さない | ✅ | 行単位の理由を日本語で保持。server の batch 失敗は `console.error` + `503 retryable` |
| 🖐 通信エラー（機内モード→復帰） | **未実施**（ロジックは🤖） | 台本 T-2-5。例外・非ok・sessionId欠落の3経路を `pastImportPlan.test.js` で固定 |
| 🖐 オフライン中の入力継続 | **N/A** | 取込はオフラインで完了させない設計。**未送信キューへ載せない**（サーバー確認前に成功と見せないため）。この判断は `pastImportPlan.js` 冒頭に理由つきで記載 |
| フェイルオープン/クローズの明示 | ✅ | 取込はすべて**フェイルクローズ**。サーバーが `sessionId` を返さない限り端末へ書かない |
| タイムアウト・リトライ上限 | ✅ | 自動リトライを持たない。失敗日を出して手動再実行（同じ `batchId` で冪等） |

### 4. 同期・多人数

| 項目 | 判定 | 根拠 / 理由 |
|---|---|---|
| 全項目 | **N/A** | WebSocket / DO / ルームに触れていない。取込はHTTP経路のみで、新しいWSメッセージ型を追加していない |

ただしゲスト秘匿は関係する → **✅**: 取込APIは strict Bearer 側に置いた（単価・在庫金額を扱うため）。

### 5. 権限・認可・マルチテナント

| 項目 | 判定 | 根拠 / 理由 |
|---|---|---|
| 権限の明記と実装一致 | ✅ | 取込・取消とも店舗トークン必須。ゲスト不可 |
| 多店舗分離（`WHERE shop_code = ?`） | ✅ | `pastImport.js` の全SQLに `shop_code` を入れた。他店舗の session を `replaceSessionIds` に指定しても消えないことをテスト |
| 新エンドポイントを認証ゲートの内側へ + `api-design.md` 登録 | ✅ | ソフト認証の正規表現ではなく **strict Bearer（`_requireAuth`）** 側へ置いた。データを書き換えるため sessions 系と同じ扱いにするのが正しい。`api-design.md` に §1.3.1 として認証区分つきで登録 |
| ペイロード上限・レート制限 | ✅ | `MAX_PAYLOAD_CHARS`（約100万文字）と `MAX_LINES_PER_REQUEST`（500）。無認証経路ではないため独自のレート制限は追加していない |
| プラン境界 | ✅ | 品目取込は既存の `FREE_ITEM_LIMIT` 切り捨てを維持し、確認画面に出す。過去棚卸取込にプラン差を**新設していない**（新機能を増やさない方針） |
| 配布artifactごとの購入面 | **N/A** | 課金・購入面に触れていない |

### 6. ログ・監査

| 項目 | 判定 | 根拠 / 理由 |
|---|---|---|
| auditLog に載せる | **N/A** | auditLog は棚卸セッション中の品目入力を追うもの。取込はセッション外の一括操作で、追跡単位は `importBatchId`（取消可能）として持たせた |
| 秘匿情報をログに出さない | ✅ | `console.error` は `shopCode` / `batchId` / `date` / エラーメッセージのみ。明細・単価を出さない |
| 失敗時に文脈を残す | ✅ | `[pastImport] create batch failed: <code> <batch> <date>` / `cancel batch failed:` |

### 7. ナビゲーション・端末挙動

| 項目 | 判定 | 根拠 / 理由 |
|---|---|---|
| 🖐 戻る操作 | **未実施**（実機） | 新しいモーダルは既存の `useEscapeKey` + オーバーレイクリックに乗せ、独自実装をしていない。**閉じる処理が1回だけ**であることは自動testで固定 |
| 🖐 スワイプ競合 | **N/A** | スワイプ要素を追加していない |
| 🖐 画面ロック・復帰 | **N/A** | WS再接続に関わらない |

### 8. 通知

| 項目 | 判定 | 根拠 / 理由 |
|---|---|---|
| プッシュ通知 | **N/A** | 通知を送らない |
| アプリ内通知・トースト | ✅ | 既存の status メッセージ規約に合わせ、`aria-live` で読み上げる |

### 9. テスト・ドキュメント

| 項目 | 判定 | 根拠 / 理由 |
|---|---|---|
| 🤖 ユニットテスト追加 | ✅ | 新規4ファイル・89件（app 66 / worker 24 + migration 3） |
| 手動テスト項目を `test-checklist-new-features.md` へ | ✅ | T 節（T-1 / T-2 / T-3）を追加 |
| `docs/project-status.md` の実装済み節を更新 | ✅ | 「CCレビュー修正 第3セッション」を追加 |
| 設計書へ追記 | ✅ | `api-design.md` に §1.3.1 と baseline 2行、Known gaps を更新 |
| マニュアル更新 | **N/A** | ユーザー向けマニュアルは未整備（プロジェクト共通の状態）。画面内文言で説明した |
