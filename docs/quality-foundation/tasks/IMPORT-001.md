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

**2026-08-11 現在: `レビュー待ち / Claude Code`。** 実装と検証は下記のとおり。Codex再レビュー待ち。
2026-08-10 の実装に、2026-08-11 の追補（ヘッダなしCSV・数値契約の統一・PDF/Excel変換・
エイリアス衝突・応答喪失からの再試行／取消）を重ねている。**`完了` および WEB-07 通過は判定していない。**

## 追補実装（2026-08-11 / Claude Code 第3セッション・続き）

対象HEAD: `claude/bold-ramanujan-vap4ls@07cc29f`（develop 統合後）。
2026-08-10 の実装に残っていた「入口ごとに契約が違う」問題を、5点ぶんそろえた。
**Worker と migration は変更していない。**

### A. ヘッダなしCSVを画面から選べるようにした

`parseMappedCSV` は `hasHeader` を持っていたが、**画面がそれを渡していなかった**。
`CsvMapperModal` は常に1行目をヘッダとして扱い、独自の1行パーサ（`_parseLine`）で解析していた。
その結果、見出しの無いファイルでは1行目の品目が黙って消えていた。

- Mapper に「1行目は見出し（列名）／1行目からデータ」の明示選択を追加した。
  自動判定は**既定値の初期化にだけ**使い、最終判断はユーザーの選択を優先する。
- `hasHeader` を Mapper → `SettingsModal` → `ItemImportPreviewModal` →
  `planMappedImport` → 確定処理まで同じ値で運ぶ。確認画面にも現在の選択を出す。
- 選択を切り替えると、プレビュー行・データ行数・列見出し（`列1`…）・列名からの自動検出が
  すべて追従する。**画面の説明と実際に取り込む行が一致する。**
- 独自の1行パーサを廃止し、`utils/csvParse.js` の共通トークナイザへ寄せた。
  未閉じ引用符はここで構造エラーになり、マッピングへ進めない。

### B. 数値解釈を全入口で1つにした

`resultCsvParser` と `deliveryImportParser` は `parseFloat` を使い、
カンマを全部落としてから読んでいた。実測の挙動:

| 入力 | 修正前 | 修正後 |
|---|---|---|
| `12abc` | **12** | 行エラー（行番号・列名・元の値・理由） |
| `abc100` | NaN → 行を黙って捨てる | 行エラー |
| `"1,20"` | **120** | 行エラー（桁区切りとして不成立） |
| `-100`（単価） | **-100 のまま通す／null にすり替え** | 行エラー |
| `1 200` | **1** | 行エラー（空白混入） |
| `NaN` / `Infinity` / `1e5` | NaN 扱いで黙って除外 | 行エラー |
| `"1,200"` | **1** | 1200 |
| `0.5` | 0.5 | 0.5 |

- 許可する形式は `csvParse.parseNumericCell` の1か所だけで定義する
  （整数・小数・先頭符号・3桁区切り・`¥`・全角数字・前後の空白）。
- エラーの形も `csvParse.readNumericCell` に一本化し、4入口が
  `{ line, column, columnLabel, value, reason }` の**同じ形**を返す。
  `itemImport._numCell` もこれへ委譲した。
- 「空欄（未入力）」と「書いてあるのに読めない」を分けた。
  納品取込の `skipped` は空欄だけを数え、読めない値は `errors` に入る。
- **不正データに気づかないまま確定できない**ようにした。
  - 品目取込: 従来どおり行エラーとして確認画面に出す（既定で開く）。
  - 納品取込 / 過去棚卸取込: 行番号・列名・元の値・理由を明細で出し、
    「この N 行を取り込まずに進む」にチェックするまで確定ボタンを無効にする。
  - 棚卸結果からの復元（確認画面を持たない一発操作）: 1件でも読めない値があれば
    行番号つきの理由を添えて**取り込まない**（フェイルクローズ）。

### C. PDF/Excel 変換が値を書き換えないようにした

`itemsToConfigCSV` は単価から数字以外を削っていた（`price.replace(/[^0-9.]/g,'')`）。
`-100` → `100`、`abc100` → `100` になり、**確認画面にも正しい値として並んでいた**。

- 元のセル値をそのまま CSV へ渡し、良し悪しは共通の数値契約に判定させる。
  読めない値は確認画面に行番号つきで出る。
- CSV生成を `csvParse.toCSVRow` / `csvEscapeCell` に一本化した。
  `"${v}"` で囲むだけの実装は、値の中の `"` でセルが割れる（`5" 皿` → 列ずれ）。
  RFC4180 どおり `"` を `""` にしてから囲む。
- 同じ理由で `useConfig.exportConfigCSV` も共通実装へ寄せた（フォーミュラ対策は維持）。
  引用符・カンマ・改行を含む品目名／単位／エイリアスが**出力→取込で往復**する。

### D. エイリアス衝突を画面の文言どおりに解決する

`file` 種別（ファイル内で2品目が同じ別名を取り合う）だけ、`ALIAS_TAKEOVER` を選んでも
先頭行が残っていた。「ファイルの指定を優先する」と書いてあるのに結果が変わらない状態だった。

- takeover は3種（`existing` / `item` / `file`）を同じ規則で解決する。
  ファイル内衝突は**あとの行**へ付け替える。
- 既定（`ALIAS_KEEP_EXISTING`）は従来どおり、既存の割り当てとファイル先頭行を保持する。
- 確認画面は衝突の種類を明示し、`file` だけのときは選択肢の文言を
  「先に出てきた行を優先する」へ変える。plan と確定が同じ結果になることをtestで固定した。

### E. 過去棚卸の応答喪失（response loss）から復帰できるようにした

修正前は、確定に失敗すると失敗リストを出すだけで、**取込IDも計画も画面から消えていた**。
サーバー側に入っている可能性がある状態で、再試行も取消もできなかった。

- 失敗を2種に分ける。`OUTCOME_FAILED`（サーバーが理由つきで拒否）と
  `OUTCOME_UNKNOWN`（応答が届かず、保存されているかもしれない）。例外は必ず後者。
- 確定に失敗しても計画と `importBatchId` を保持し、
  **「同じ取込IDで再試行」と「この取込を取り消す」**の2つを出す。取込IDも画面に出す。
- 再試行は `commitPastImport(plan, { onlyDates })` で**失敗・結果不明の日だけ**を送る。
  `importBatchId` は計画のものを使い回し、**再試行で新しいIDを作らない**。
  サーバーは `(shop_code, batchId, date)` で冪等なので、成功済みの日を送り直しても増えない。
- `mergeCommitResults` で前回の成功を残したまま結果を畳み込む。成功日を二重に数えない。
- `savedCount = 0` でも結果不明が1つでもあれば取消を出す（`canCancelBatch`）。
  「取り込めていない」と思ったまま、実際に残ったデータを消せない状態を作らない。
- 保存中・取消中はボタンを無効にし、閉じる操作も塞ぐ（二重押しと結果の見失いを防ぐ）。
  取消に失敗したら理由と取込IDを残し、もう一度押せるようにする。
- 第二セッションの canonical snapshot / 冪等APIに接続する前提。
  Worker 側（`worker/src/pastImport.js`・migration 0013）は**今回変更していない**。

### F. 文言を実装に合わせた

- `masterImportWarning` の「・取り消しはできません」を削除し、
  「取込の直後にかぎり1回だけ戻せる／端末のメモリ上だけの退避」へ書き換えた
  （`undoLastImport` が実在するので旧文言は誤り）。確認画面の説明とも同じ文にした。
- 過去棚卸の確認画面に、取込前から「この取込ぶんだけ取り消せる」を出す。
- `test-checklist-new-features.md` の S-5 から「取り消せない旨の警告」を外し、
  T節に応答喪失・実D1での再試行・納品取込の数値契約の手動項目を追加した。

## 検証（2026-08-11）

| command | 結果 |
|---|---|
| `cd app && npm test` | **84 files / 833 passed** |
| `cd app && npm run build` | 成功（`dist/` 生成・PWA precache 17 entries） |
| `cd worker && npm test` | 20 files / 367 passed（worker は無変更・回帰確認のみ） |
| `git diff --check` | 出力なし |

### 今回追加・変更したtest

| file | 内容 |
|---|---|
| `app/src/components/CsvMapperModal.test.js`（新規・12件） | 見出し／データの選択、ヘッダなしで1行目が残る、`hasHeader` の受け渡し、quoted comma・escaped quote・multiline・BOM・CRLF、未閉じ引用符でインポート不可 |
| `app/src/components/SettingsModal.import.test.js`（新規・3件） | **実UI経由**の配線: マッピング画面 → 確認画面 → 確定で1行目が残る／見出し扱いなら消える／引用符・カンマを含むセルが壊れない |
| `app/src/components/DeliveryImportModal.test.js`（新規・5件） | 行番号・列名・元の値・理由の表示、確認するまで取り込めない、`1,200`・小数の受理 |
| `app/src/components/PastStocktakeImportModal.test.js`（新規・13件） | 応答喪失後の取込ID保持、再試行が失敗日だけを送る、成功日を二重に数えない、savedCount=0 での取消、二重押し防止、取消失敗の表示、読めない行の確認必須 |
| `app/src/composables/usePdfImporter.csv.test.js`（新規・7件） | `-100`・`abc100` を変換しない、共通契約で行エラーになる、引用符・カンマ・改行の往復 |
| `app/src/utils/csvParse.test.js`（+9件） | 前方一致の拒否、空白混入の拒否、`readNumericCell` の共通エラー形、`csvEscapeCell` / `toCSVRow` の往復 |
| `app/src/utils/itemImport.strict.test.js`（+2件） | ファイル内衝突の takeover、3種の衝突を同じ規則で解決 |
| `app/src/utils/resultCsvParser.test.js`（+7件） | 各不正値の拒否、`1,200`・小数の受理、読めない日付、errors の返却 |
| `app/src/utils/deliveryImportParser.test.js`（+6件、既存1件を更新） | 同上（空欄=skipped と 不正=errors の分離を含む） |
| `app/src/components/ItemImportPreviewModal.test.js`（+8件） | `hasHeader` の伝搬、PDF由来の不正単価、エイリアス解決が plan と確定で一致 |

### 既存testの更新（挙動を変えたもの）

| test | 変更理由 |
|---|---|
| `useConfig.reorderCsv.test.js` | エクスポートが RFC4180 準拠になり、エスケープ不要なセルを引用符で囲まなくなった |
| `masterImportWarning.test.js` | 「取り消しはできません」が誤りだったため、正しい文言を期待するよう変更 |
| `deliveryImportParser.test.js` | 空欄（skipped）と読めない値（errors）を分けた |
| `resultCsvParser.test.js` | `parseResultSnapshots` が `{ snapshots, errors }` を返すようになった |

## 未実施（2026-08-11 時点）

- **実ブラウザ / 実機**: T-1-1〜T-1-8、T-2-*、T-4-* は未実施。jsdom は `matchMedia` が
  `matches: false` を返すため、component testはモバイル経路だけを通る。
- **実D1**: 応答喪失からの再試行（T-2-9）と、端末に無い状態からの取消（T-2-10）は
  実D1で未検証。冪等性はserver testと client 側の契約testまで。
- migration 0013 の development / production への適用は依然として未実施（第3セッション当初と同じ）。
- 大量データ（500行上限付近・複数日×多品目）の実測。

## 実装（2026-08-10 / Claude Code 第3セッション）

対象HEAD: `claude/branch-operational-status-2lwwwu@ae9c03b`（第2セッションの成果を含む）

> **2026-08-11 追記（この節の記載範囲の訂正）**
> 下記「1. CSVの字句解析と数値解釈を一本化」は、実際には**字句解析（トークナイザ）だけ**が
> 一本化されていた。数値の解釈は品目取込にしか適用されておらず、棚卸結果取込・納品取込は
> `parseFloat` の前方一致受理を続けていた。PDF/Excel 変換も単価から数字以外を削っていた。
> 数値契約が4入口でそろったのは2026-08-11の追補（上記 B / C）。
> 同じく「失敗日を出して手動再実行」も、当時の画面には再試行・取消の導線が無く、
> 実際には確定失敗と同時に取込IDが失われていた（上記 E で解消）。

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
