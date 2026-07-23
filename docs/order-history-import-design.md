# 過去発注（納品）履歴 取込 設計 v2

飲食店の**過去の納品履歴を一括で取り込み、既存の発注・分析エンジンへ流し込む**ための設計図。
本書は羅針盤（`docs/strategy-10yr.md`）・発注アシスト設計（`docs/ordering-analytics-design.md`）配下の実装計画。実装前に本書で合意を取る。

> **v2改訂の理由**：v1は古いコードベース基準だった。現状は発注・入出庫・消費逆算・PDFレシピ・名寄せ・
> 発注スケジュール等が**既に実装済み**（§1）。本書はそれらを新規に作り直すのではなく、その上に
> 「過去履歴の一括バックフィル」という**まだ無い部分だけ**（§2）を載せる設計に絞る。

---

## 0. 設計思想（最重要）

- **入力はその瞬間に価値を返すものだけが現場で続く。** 過去履歴取込は「データ収集」ではなく、**既存の予測・分析エンジンを過去に遡って燃料供給する**一手。
- **既存の器に流し込む。** 新テーブル・新概念を極力足さず、既存 `useMovements`（入庫＝納品）/ `useOrders`（発注）/ `useHistory`（棚卸）へ乗せる。
- **全自動・任意フォーマットは狙わない。** 業界の勝ち筋は「レシピ学習＋人手レビュー」。既存の `pdfProfiles`（レシピ）・`itemMatcher`（名寄せ）を再利用する。
- **仕入情報を外に出さない。** 現行のPDF/Excel解析は端末内完結。この原則を既定として維持（LLM抽出は §7 の opt-in に隔離）。
- **甘い数字を出さない。** 逆算した理論値には常に信頼度を添える（`app/src/utils/analysisQuality.js`）。

---

## 1. 既に実装済みの土台（本設計が乗る基盤）

この間に多くが実装され、v1で「将来案」としたものの大半は**もう存在する**。新設計はこれらを再利用する。

| 概念 | 実体（ファイル） | 状態 |
|---|---|---|
| PDFレシピ（複数保存・指紋で自動判定） | `composables/pdfProfiles.js`（`matchProfile`/`saveProfile`）＋ `components/PdfColumnMapper.vue` | ✅ |
| PDF表パーサ（汎用・座標） | `utils/pdfTableParser.js`（旧 `usePdfImporter` の単一レイアウトを一般化） | ✅ |
| CSV列マッピング取込 | `composables/useConfig.js`（`loadFromCSVMapped`）＋ `components/CsvMapperModal.vue` | ✅ |
| 名寄せ（入力→品目候補） | `utils/itemMatcher.js`（`findCandidates`）＋辞書3層（`dictionary`/`learnedAliases`/`masterDict`） | ✅ |
| 入庫＝納品（フロー記録） | `composables/useMovements.js`（`type:'in'`）＋ migration `0010_movements` | ✅ |
| 発注→入庫ワンタップ取込 | `useMovements.deliveryLinesFromOrder` / `unreflectedOrders` | ✅ |
| 発注レコード | `composables/useOrders.js`（`saveOrder`・`getLastOrderQty`） | ✅ |
| 消費の逆算（論理出庫） | `services/impliedConsumption.js`（観測点方式・`avgDailyConsumption`） | ✅ |
| 理論在庫（帳簿在庫） | `services/theoreticalStock.js` | ✅ |
| 発注学習・推奨 | `services/orderLearning.js` / `orderSuggestion.js` / `orderItemHistory.js` | ✅ |
| 発注スケジュール（曜日＋締切） | `services/orderScheduleUtil.js` ＋ `components/OrderScheduleModal.vue` | ✅（要拡張 §8） |
| 需要カレンダー（暦要因） | `services/demandFactors.js` / `jpHolidays.js` | ✅ |
| 過去**棚卸**結果の復元 | `utils/resultCsvParser.js`（日付・品目・数量・単価） | ✅（フローではなく残高） |

**結論**：予測・分析・レシピ・名寄せの前向きエンジンは揃っている。**欠けているのは「過去のフロー（納品）を過去日付で一括投入する経路」だけ**。

---

## 2. 本設計の焦点＝まだ無いもの（ギャップ）

1. **過去納品/発注の一括バックフィル経路** — 現状 `useMovements`/`useOrders` は「1件ずつ前向き記録」or「発注→入庫ワンタップ」のみ。**数ヶ月分の過去納品を過去日付で一括投入する経路が無い**。`resultCsvParser` は棚卸（残高）の復元用で、フロー（納品）ではない。
2. **決定的な穴**：現状のPDF/Excel取込（`usePdfImporter` → `itemsToConfigCSV`）は**品目マスタ止まり**。納品書を「入庫(movement)レコード（日付・数量付き）」に変える出口が無い。
3. **中間フォーマットCSV**（日付・複数日・複数仕入先）→ `movements(in)` / `orders` への一括展開。
4. **複数ファイル一括アップロード**（ジャンル別に分かれたPDFをまとめて）。
5. **ステージング/差分確認＋冪等な再取込**（`importBatchId`・重複排除・一括取消）。
6. **納品カレンダー（カバー期間）** — 既存 `orderScheduleUtil` は発注曜日＋締切のみ。休配日・リードタイム・「次の納品までのカバー日数で発注量が可変（日曜前は2日分）」は未実装。

---

## 3. データの落とし先（既存モデルに合わせる）

過去データは種類ごとに既存の器へ流す。**新しいストアは作らない。**

| 過去データ | 落とし先 | 追加フィールド |
|---|---|---|
| 納品（届いた量） | `useMovements` `type:'in'` | `source:'import'`, `importBatchId` |
| 発注（頼んだ量・任意） | `useOrders` | 同上 |
| 棚卸（残高） | 既存の `resultCsvParser` 経由復元（`useHistory` snapshots） | （既存経路を流用） |

- **相乗りの根拠**：`impliedConsumption` は `movements(in)` を inflow として既に消費計算に使う。**過去納品を `type:'in'` で入れれば、遡って消費逆算の材料になる**（下記の注意点あり）。
- **重要な注意（消費逆算の前提）**：`impliedConsumption` は**在庫の観測点が2つ以上**（棚卸 snapshots か 発注時 `order.stock`）を要求する。過去納品には在庫が付かないため、**納品だけでは消費区間が作れない**。→ **過去棚卸（`resultCsvParser`）と過去納品を揃えて入れる**と、`消費 = 前回棚卸 + 納品 − 出庫 − 今回棚卸` が遡って解ける（§7）。

### 3.1 レコード形（`useMovements` に最小追加）

```js
// 入庫（＝納品）レコード。既存形に source / importBatchId を足すだけ
{ id, date, type:'in', note, savedAt, orderId:null,
  source:'import',            // 追加: 手入力と区別（一括取消・再取込用）
  importBatchId:'imp_xxx',    // 追加: 取込単位（冪等・一括取消）
  lines:[{ item, qty, unit }] }
```

---

## 4. 中間フォーマットCSV（一括インポートの背骨）

バラバラな業者フォーマットを1本の中間形式に集約し、取込ロジック（投入・重複排除・日付展開）はこれだけを相手にする。**各行に日付があるので1ファイルで複数日を一括投入**（行の日付ごとに `movements(in)` へ展開）。

```
日付, 種別, 仕入先, カテゴリ, 品目名, 数量, 単位, 単価, 商品コード, 入数
2026-06-01, 入庫, 八百屋青果, 野菜, 玉ねぎ, 20, kg,   190, , 10
2026-06-01, 入庫, 肉のヤマ,   肉,   鶏もも, 5,  kg,   980, , 1
2026-06-03, 入庫, 八百屋青果, 野菜, レタス, 24, 玉,   100, , 8
```

- **種別**：`入庫`（既定）/`出庫`/`発注`。省略時は入庫。
- 必須列：日付・品目名・数量。任意列：種別・仕入先・カテゴリ・単位・単価・商品コード・入数。
- テンプレDL可能に（`usePdfImporter.downloadItemTemplate` と同じ要領で納品履歴版を追加）。
- 中堅企業のシステム担当は、自社エクスポートを**この1形式に1回マッピングするだけ**で流し込める（レシピ不要の最短ルート）。

---

## 5. 取込アーキテクチャ（既存レシピ資産に接続）

```
[業者PDF] ─pdfProfiles(レシピ)＋pdfTableParser─┐
[業者Excel/CSV]─CsvMapperModal─────────────────┤→ 中間フォーマット → [名寄せ:itemMatcher] → [ステージング] → movements(in)/orders
[自己CSV(中間形式)]─そのまま───────────────────┤                                          （§6 冪等）
[写真]  ─OCR(後段・保留)────────────────────────┤
[LLM抽出]─opt-in(§7)───────────────────────────┘
```

- **PDF**：`pdfProfiles.matchProfile` でレシピ自動判定→列抽出。現状は品目マスタ止まりなので、**抽出行を「フロー(入庫)行」に流す出口を追加**するのが実装の中心。
- **名寄せ**：`itemMatcher.findCandidates`（辞書3層）で業者商品名→品目を半自動。対応づけたら `masterDict` に焼き、**仕入先ごとに永続化**して2回目以降は自動。未マッチは「新規品目追加／スキップ」。
- **複数ファイル一括**：各ファイルを `matchProfile` で個別判定→**結果を連結して1データセットに統合**。ジャンル別PDF（各PDFがカテゴリを内包）をまとめて投入できる。取込済みファイルを記録し、後日追加分だけ足す運用にも対応。
- **レシピ共有＝将来の堀**：主要業務用卸（トーホー・久世・西原商会等）は多店舗で共通。1度書いたレシピを配布・蓄積する仕組みはネットワーク効果になる（§9 保留）。

---

## 6. ステージング・冪等性（信頼性の核）

乱雑データの信頼性はここで決まる。**取込は即確定せず、下書きに溜めて差分を見せる。**

1. **ステージング＆差分確認** — 確定前に「新規品目◯件／既存マッチ◯件／未マッチ◯件／重複◯件」を提示。ユーザーが直してから確定。
2. **冪等な再取込（重複排除キー）** — `日付+種別+仕入先+品目+数量` のハッシュ、またはファイル指紋で、**同じ納品書を2回落としても二重にならない**。
3. **一括取消／再取込** — `importBatchId` 単位でまとめて取消・やり直し。

---

## 7. 発注理論値の逆算（既存エンジンへ接続）

新しい逆算ロジックはほぼ不要。**過去データを既存エンジンに供給する**のが本質。

### 段①：納品実績ベース（今すぐ・確実）
- **前回納品量** → `useOrders.getLastOrderQty` 相当を `movements(in)` にも適用。
- **曜日別／週別の納品量** → `services/orderItemHistory.js` の同曜実績を流用。
- 納品データ**だけ**で出る（在庫不要）。

### 段②：消費逆算ベース（既存 `impliedConsumption` に供給）
- v1で書いた「総納品 ÷ 日数」近似は**不要**。既存 `impliedConsumption.avgDailyConsumption`（観測点方式）が上位互換。
- **過去棚卸（`resultCsvParser`）＋過去納品（`movements in`）を揃えて入れる**と、区間ごとに `消費 = 前回棚卸 + 納品 − 出庫 − 今回棚卸` が遡って解ける。**分析グラフが過去に伸びる**のが最大価値。
- `theoreticalStock`（直近棚卸＋その後の入出庫）も過去データで基準点が増え、ズレ検出の精度が上がる。
- マイナス消費（入庫漏れ・計数ミス）は既存の `flagged` で統計から除外。

### 逆算で外せない肝（既存資産で対応）
- **入数(lot)変換**：`services/lot.js`（`effectiveLot`）。発注qtyはLOT数、納品は物理量（`deliveryLinesFromOrder` が換算済み）。
- **外れ値除外**：`estimators/median.js`（中央値）＋発注の `excluded` フラグ。
- **信頼度**：`analysisQuality.js`。データが薄い間は「参考」表示。

---

## 8. 納品カレンダー（`orderScheduleUtil` の拡張・カバー期間）

現状 `orderSchedule = { days:[発注曜日], deadline }` は**発注曜日と締切のみ**。ここに**納品側**（休配日・リードタイム）を足すと、理論発注量の「カバー期間」が発注日ごとに変わる。

```js
// orderSchedule を拡張（後方互換：既存の days/deadline はそのまま）
{
  days:             [火, 金],        // 既存: 発注する曜日
  deadline:         '11:00',        // 既存: 締切
  leadBeforeCutoff: 1,              // 追加: 締切前発注 → 翌日納品
  leadAfterCutoff:  2,              // 追加: 締切後発注 → 翌々日
  deliveryWeekdays: [月,火,木,金,土],// 追加: 納品可能な曜日（日・水は休配）
  holidays:         ['2026-08-15'], // 追加: 臨時休配
}
```

**カバー期間ロジック**（各納品は「その納品日〜次の納品日」を賄う）：

```
カバー日数(納品日) = 次の納品日 − その納品日
理論発注量 = 平均日次消費 × カバー日数 − 理論在庫 + 安全在庫  → ÷入数 切り上げ
```

例（締切前=翌日納品／日・水休配）：金の発注→土納品→次は月（日は休配）＝**カバー2日＝多め**。月の発注→火納品→次は木（水休配）＝**カバー2日＝多め**。→「日曜前・水曜前の発注が多くなる」が**カレンダーから自動導出**（品目ごとの特別処理は不要）。

**二重に効く**：同じカレンダーで過去納品の**消費按分**（塊で届く納品を日次に均す）にも使える。

**計算 vs ユーザー入力**：納品履歴の日付から**納品曜日・休配日は自動推定**（日・水が一度も出てこない＝休配）。**締切・リードタイム・臨時休配はユーザー入力**（推定値を初期表示して上書き）。理論値は純関数の派生値なので、カレンダー変更で**その場で再計算**。

---

## 9. 段階計画（現状差分ベース）

| 段階 | 内容 | 立ち上がる価値 |
|---|---|---|
| **P0** | 中間フォーマットCSV（日付付き・複数日）→ `movements(in)` 一括投入＋ステージング/冪等 | 過去納品を器に入れる |
| **P1** | PDF納品書 → 入庫フローの出口追加（`pdfProfiles` レシピ再利用）＋複数ファイル一括 | ジャンル別PDFの現実に対応 |
| **P2** | 過去棚卸（`resultCsvParser`）＋過去納品の突合 → `impliedConsumption` で遡及消費 | 分析グラフが過去に伸びる |
| **P3** | 納品カレンダー拡張（`orderScheduleUtil` にカバー期間・休配日・リードタイム） | 休配日込みの理論発注（日曜前2日分） |
| **P4** | D1 `movements` バルクIngest＋端末間同期／サーバ側冪等 | 多端末・大量取込 |
| **保留** | LLM抽出（opt-in §7's方針）、写真OCR、レシピ共有（堀） | 長尾・将来構想 |

依存：P0→(P1,P2)、(P0+過去棚卸)→P2、P2→P3。P4はP0の中間形式に合流するので独立に足せる。

### 9.1 実装状況（2026-07-23）

**P0 実装済み**（クライアント層・app全テストgreen）:
- 中間フォーマットCSVパーサ `utils/deliveryImportParser`（複数日・表記ゆれ・テンプレDL）
- 名寄せ突合 `services/deliveryImportMatch`（`itemMatcher` 利用・matched/candidate/unmatched）
- 冪等 `utils/importBatch`（`日付+種別+品目+数量`・`importBatchId`）
- ステージングUI `components/DeliveryImportModal.vue`（差分サマリ・行対応づけ・除外）
- 確定 `services/deliveryImportCommit` → `useMovements.saveMovement`（`source:'import'`/`importBatchId`）
- 導線: `MovementPage` 入庫モードに取込＋テンプレDL、`useMovements.deleteImportBatch`（一括取消）

**過去棚卸インポート 実装済み**:
- `resultCsvParser.parseResultSnapshots`（日付グルーピング）＋ `useHistory.importPastSnapshot`（過去日付挿入）
- `MovementPage` に導線。過去棚卸＋過去納品で `impliedConsumption` が遡及算出。

**ゲート表示 実装済み**:
- `services/analysisCapability`（`itemConsumptionAvailability`/`storeConsumptionReadiness`）
- `MovementPage` 在庫ビューにアンロックバナー、品目詳細に動的ヒント。

**未着手（別セッション＝DB）**: `movements` への `source`/`import_batch_id` 列、バルクIngest、`sinceDays` 窓拡張
（`db-design-v2.md` §10）。**現状は過去1年超の取込が GET 窓外**になるため、DB側対応が必要。

---

## 10. 未確定の決定事項（実装前に確定する）

1. 過去発注（頼んだ量）も取り込むか、当面は納品（`movements in`）だけにするか。
2. 中間フォーマットCSVの列確定（`種別` 列の要否、単位・入数の表現、複数仕入先の1ファイル同居）。
3. 消費逆算の遡及には過去棚卸が要る（§3）。過去棚卸の入力を取込フローに組み込むか、別導線のままにするか。
4. `orderSchedule` 拡張の後方互換（既存 `days/deadline` を保ちつつ納品側フィールドを追加する移行）。
5. ステージングUIの置き場所（既存 `PdfImporterModal` / `CsvMapperModal` の拡張か、新規取込ページか）。
6. D1 バルクIngestのAPI形と冪等キー（`importBatchId` をサーバ側でも一意制約にするか）。
7. LLM抽出を将来入れる場合のプライバシー設計（自前Worker・マスキング・同意UX）。

---

## 11. 非目標（当面やらない）

- 全自動・任意フォーマットの無人取込（人手レビューは必ず挟む）。
- 発注送信の自動化（本アプリは作成・記録層。送信は既存手段）。
- 売上・廃棄データの取込（原価率・ロス分析は本書の範囲外）。
- 既存エンジン（発注学習・消費逆算・理論在庫）の作り直し（本書は**供給**に徹する）。
</content>
