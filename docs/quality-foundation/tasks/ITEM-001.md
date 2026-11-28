# ITEM-001 — 品目に変わらない ID を持たせる

User（2026-11-28・D-044・`enterprise-design.md` §0.7）: 品目の ID と商品コードを分ける。まず名前で指している箇所を洗い出す。

- 目的: 品目を**名前ではなく ID** でつなぐ。名前の変更・表記ゆれの統合（店の中）・本部の配布物と取り込み（テナント T-4）の前提。
- ID はアプリが付ける変わらない番号（見せない）。商品コード（`config.codes`）は任意の項目のまま。登録順の番号は使わない。
- 今は**名前の変更の機能が無い**（`useConfig` に renameItem なし）。名前は店の中で一意で、実質変わらない前提で全体が組まれている。

## 洗い出し（2026-11-28・`develop@e78592e` 以降）

### 1. 設定（D1 `store_configs.config_json` に丸ごと・App `useConfig`）

品目名をキーや値に持つもの（**28項目**）:

| 種類 | 項目 |
|---|---|
| 品目の並び・一覧 | `order`、`manualItems`、`deletedItems`、`hiddenItems`、`hiddenAuto` |
| 品目 → 値の表 | `units`、`prices`、`categories`、`codes`、`prevMonths`、`lotSizes`、`reorderPoints`、`replenishTargets`、`images`、`itemAdded`、`hiddenAt` |
| 並び替え・導線 | `tagsA`・`tagsB`・`tagsR`、`axisItemOrderA`・`B`・`R`、`tagsArchiveA`・`B`・`R`、`routeMore` |
| 音声の辞書 | `dictionary`（読み → 品目名） |
| その他 | `importExcluded`（取込で外した品目）。`orderAssumptions` は分類ごとの値で品目名を持たない（対象外） |

- App で設定を品目名で引いている部品・関数: **23 ファイル**。

### 2. 記録（D1 の行と JSON）

| 置き場所 | 品目の持ち方 |
|---|---|
| `inventory_lines`（棚卸の明細） | `item_name`（主キーの一部） |
| `session_audit`（変更履歴） | `item_name` |
| `item_par_levels`（適正在庫の学習） | `item_name`（主キーの一部） |
| `order_lines`（発注の明細） | `item` |
| `movement_lines`（入出庫） | `item`（期限の index `idx_movement_lines_lot` にも） |
| `store_history.snapshot_json`・`store_history_v` | `items[].item` |
| `store_inventory.inventory_json` | 品目名がキーの JSON |
| `import_batch_requests`・`session_completions` | 品目名は持たないが、二重送信の照合値（`fingerprint`）を明細（品目名を含む）から作る。ID へ切り替えると照合値が変わるので、照合値の作り方は名前のまま固定するか版を付ける |
| `task_templates.data_json`・`checklists` | 品目ではなくチェック項目（**対象外**） |

### 3. 同期（Durable Object `RoomDO.js`）

- 棚卸中の在庫 `inventory[ingredient]` が品目名キー（`ingredient` の出現 **43 か所**）。変更履歴（auditLog）の `item`、品目追加・非表示の申請も名前。
- 古いアプリ（更新前の端末）が名前だけで送ってくる期間がある → サーバーは**名前と ID の両方を受ける**必要がある。

### 4. App のデータの読み方

- 明細の `.item` を読んでいる部品・関数: **39 ファイル**。主な services/utils/composables:
  `sessionReport`・`snapshotView`・`pastImportPlan`・`orderRefs`・`sessionCompletion`・`dayTimeline`・`deliveryImportCommit`・`participantStats`・
  `stockDates`・`orderExport`・`orderLearning`・`snapshotFromLines`・`journalRecords`・`countOrder`・`stockGap`・`exportBuild`・`theoreticalStock`・
  `importBatch`・`analysisQuality`・`itemCheck`・`lineIndex`（`findLine`/`linesOf`＝名前で行を探す共通の入口）・`useHistory`・`useStockView`・`useMovements`・`useOrders`・`useStore`
- 端末の保存: 入出庫の下書き（`inventory_movement_draft_v1`：`{ in: { 品目名: 数 } }`）、在庫の cache（`useInventory`）。
- CSV・Excel・PDF の取込と書き出し: 品目名で照合・出力（取込レシピの言い換えも名前）。

### 5. Worker

- 品目名を扱う: `RoomDO.js`・`storeHandler.js`・`inventoryLines.js`・`pastImport.js`・`activityHandler.js`・`moneyGuard.js`。

## 方針（案・User 確認待ち）

- **ID の作り方**: `店舗コード＋最初の名前` から決まるハッシュ（例 `it_` ＋ 16 桁）。どの端末で付けても同じ値になるので、
  複数の端末が同時に付けても食い違わない。名前を変えても ID は変えない。同じ名前で作り直した品目は同じ ID に戻る（今の「割り当ての記憶」と同じ振る舞い）。
- **本部が決めた品目コードがある場合**（2026-11-28 相談）: 本部の品目には組織の単位で ID（`og_…`・本部が作ったときにサーバーで付ける）を持たせ、
  本部コードは組織の中で重複不可の「変えてよい項目」として持つ（コードを ID にすると付け直し・打ち間違いの訂正・体系の変更で記録が切れる）。
  本部は「品目マスタはコード必須」にできる。店の品目は、受け取りのときに本部コードの一致（無ければ名前＋単位の候補を店が確認）で本部の品目へ結び、
  店の ID（`it_…`）は本部の ID への付け替えとして残す（統合と同じ仕組み。店の過去の記録はそのまま続く）。
- **移行は「名前と ID を併記」してから「ID を正」にする**。古い端末と古い記録を読み続けられるように、名前は消さない。

## 段（案）

| 段 | 中身 | 本番の変更 | 規模 |
|---|---|---|---|
| I-1 | 設定に `itemIds`（名前 → ID）を足す。読み込み時に無ければ付ける（決まったハッシュなので端末で付けてよい）。画面は変えない | なし（config_json の中） | 小 |
| I-2 | 新しく書く記録に ID を併記: 棚卸の明細・入出庫・発注・変更履歴・DO の在庫。D1 は `item_id` 列を足す（NULL 可） | migration・Worker | 中 |
| I-3 | 古い記録へ ID を埋める（`itemIds` で名前 → ID。D1 は migration で一括、端末の cache は読むときに） | migration | 中 |
| I-4 | 読む側を ID で引く（`lineIndex` を ID 優先・名前は予備に）。設定の表を ID キーへ（`items: { id: { name, unit, price, ... } }` の形へ寄せる） | Worker（config の形） | **大** |
| I-5 | 名前の変更と統合（消した ID → 残した ID の付け替え表 `itemAliases`）。表記ゆれの統合の提案（2026-09-25）をここで | Worker | 中 |
| I-6 | `item_par_levels` などの主キーを ID へ。名前だけの古い送信の受け付けを終える | migration・Worker | 中 |

- I-1〜I-3 はふるまいが変わらず、戻せる。I-4 から先は読み方が変わるので、E2E（TEST-002）を先に厚くしておきたい。
- 本番のデータベースの更新が要る段（I-2・I-3・I-6）は、公開の準備（WEB-04 の未適用 migration）と順番を合わせる。

## 未決

0. 完了・過去取込の照合値（`fingerprint`）を名前のまま作り続けるか（おすすめ: 名前のまま固定。ID にすると切り替えの前後で同じ送信を別物と判定しうる）。

1. ID の作り方（決まったハッシュでよいか）。
2. I-4 で設定の形を `items: { id: {...} }` に作り替えるか、今の「項目ごとの表」のままキーだけ ID にするか（前者は配布物と相性が良いが変更が大きい）。
