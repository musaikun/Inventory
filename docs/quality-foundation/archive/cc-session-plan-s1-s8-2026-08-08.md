> **履歴スナップショット（編集しない）**
>
> これは 2026-08-08 まで使われていた旧「CC作業セッション計画（S1〜S8）」を、
> 削除直前の `36fc8ad`（削除commit `2e14e23` の親）からそのまま保存したものです。
> 現行の実行計画は [`../cc-session-plan.md`](../cc-session-plan.md)（第1〜第3セッション）で、
> 別物です。旧計画の「S2」「S3」「S4」「S6」などの節番号は、現行計画には存在しません。
>
> `session-log.md` と `proposals.md` に残る `S1`〜`S8` の記述は、この文書を指します。
> 手動確認台本の現行版は [`../../test-checklist-new-features.md`](../../test-checklist-new-features.md) にあります。
>
> 保存日: 2026-08-10 / IMPORT-001 第3セッション
>
> 本文は `36fc8ad` の内容そのままですが、1階層深い場所へ置いたため
> **相対linkの深さだけ**（`x.md` → `../x.md`、`../x` → `../../x`）を直しています。
> 文言・節構成・記述内容は変更していません。

---

# CC作業セッション計画（指示出し用）

- **Status:** 一時文書（作業用）。初回Web公開までの CC 側の実行計画
- **Role:** User が CC セッションへ指示を出すための台本。8タスクを3セッションに束ねた割り振りと、各タスクの完了条件を持つ
- **Source of truth:** 状態は [`task-list.md`](../task-list.md)、完了条件の正本は各 `tasks/<ID>.md`、
  公開可否は [`web-release-readiness.md`](../web-release-readiness.md)。**本書はそれらの実行順を示すだけで、状態の正本ではない**
- **Last verified:** 2026-08-08 / `develop@f8da4c1`（S5・S6 完了時点）
- **破棄条件:** 第3セッション完了時、または公開スコープが変わった時点で削除する。恒久docsへ残さない

---

## このセッションの始め方（コールドスタート用）

**本書だけで着手できるように書いてある。** 迷ったら以下の順で確認する。

1. `git branch --show-current` でブランチを確認（固定名を前提にしない）
2. 本書の「役割」「確定事項」「セッション割り振り」を読む
3. 着手するタスクの「完了条件」節を読む
4. 背景が要るときだけ [`../README.md`](../../README.md) → [`README.md`](../README.md) → 各 `tasks/<ID>.md`

`CLAUDE.md`（リポジトリ直下）にプロジェクト全体のルールがある。本書はそれを置き換えない。

### 環境とコマンド

- Node v22 / npm。TypeScript は不使用。Vue 3 は `<script setup>` 記法で統一
- テストは Vitest。`app` と `worker` で**別パッケージ**

```bash
cd app    && npm test          # App ユニットテスト
cd app    && npm run build     # 本番ビルド（コミット前に必須）
cd app    && npm run dev       # 開発サーバー http://localhost:5173
cd worker && npm test          # Worker ユニットテスト
```

`worker/` を触ったタスクでは **App と Worker の両方**を実行して報告する。

### 現在のリポジトリ状態（2026-08-08 時点）

| commit | 内容 | 状態 |
|---|---|---|
| `37128a4` | デスクトップUI（サイドナビ・レイアウト層）＋ DOC-001 の文書整理 | push済み |
| `eb99895` | セッションタブの2列グリッド＋タッチ環境のタップ領域 | push済み（develop CI success） |
| `f8da4c1` | 本書の追加 | push済み |

`eb99895` は取り消さない。S8 で該当CSSを書き換える（詳細は S8 の完了条件）。

### 作業ブランチ（3セッション共有）

```
claude/branch-operational-status-2lwwwu
```

3つの会話セッションが**同じブランチ**を共有する。**着手前に必ず `git pull`、完了後に push** する。
第2セッション（S5/S6）は `worker/` に触らないため、第1セッション（S3/S4）と並行しても衝突しない。

### 主要ファイル地図（本計画で触る範囲）

| 対象 | ファイル |
|---|---|
| 品目マスタ・辞書・CSV取込 | `app/src/composables/useConfig.js` |
| 取込UI | `app/src/components/SettingsModal.vue` / `MasterManagePage.vue` / `CsvMapperModal.vue` / `PdfImporterModal.vue` |
| 過去データ取込 | `app/src/composables/useDataImport.js` |
| 在庫CRUD | `app/src/composables/useInventory.js` |
| セッション状態遷移 | `app/src/composables/useSession.js` |
| D1連携・店舗 | `app/src/composables/useStore.js` |
| 同期・全クライアント状態 | `app/src/composables/useSync.js` |
| ルート・画面切替 | `app/src/App.vue`（`currentView` で切替） |
| セッション一覧 | `app/src/components/SessionListPage.vue` |
| デスクトップ層CSS | `app/src/style.css` 末尾（`body.dt-shell` 配下に集約） |
| Worker ルーター | `worker/src/index.js` |
| 店舗データ・D1クエリ | `worker/src/storeHandler.js` |
| Durable Object | `worker/src/RoomDO.js` |
| migration | `worker/migrations/`（現在 0001〜0011。**本番は 0010/0011 未適用**） |

### 既知の落とし穴

- **`localStorage` のキーは `app/src/utils/storageKeys.js` に登録する。直書き禁止**
- **新しい業務データはアカウント切替時の消去対象に追加する**
  （`app/src/composables/accountData.js` の `clearLocalAccountData`）。→ 事故 S-10
- config にフィールドを足すときは **`useConfig.js` のシリアライズと `RoomDO.js` の
  `normalizeConfig` の両方**に追加する。→ 事故 B-01（軸データ消失）
- D1 クエリは必ず `WHERE shop_code = ?`。新エンドポイントは `index.js` の認証ゲートの内側に置く。→ 事故 S-F
- jsdom は `matchMedia` が `matches: false` を返すため、テストは常にモバイル経路を通る。
  デスクトップ表示はユニットテストで守られていない
- デスクトップCSSは `body.dt-shell` を前置きして各コンポーネントの scoped スタイルを
  上書きしている（詳細度 (0,2,1) > `.x[data-v-*]` の (0,2,0)）。この手口の恒久採用可否は
  [`../proposals.md`](../../proposals.md) でPMトリアージ待ち
- 閾値 1024px は `app/src/composables/useMediaQuery.js` の `DESKTOP_QUERY` と
  `style.css` のメディアクエリに二重定義。**対で保つこと**

### 完了時のセルフチェック

[`../feature-checklist.md`](../../feature-checklist.md)（共通DoD）で照合し、
N/A 項目は理由を一言添えて報告に含める。

---

## 役割（固定）

| | 範囲 |
|---|---|
| **CC** | 製品機能、データ処理、画面構成、関連テストの実装 |
| **Codex** | リリース品質基盤、独立レビュー、セキュリティ、E2E、公開判定 |

Codex が並行して持つもの: CC差分の独立レビュー / [WEB-001](../tasks/WEB-001.md) と公開ゲート /
SEC-005 / TEST-002 の Critical E2E / CORS・Pages・D1公開手順 / observability・privacy /
production smoke・rollback / 品質スコアカード / 最終リリース可否。

## 確定事項（2026-08-08）

1. **DATA-002 Phase 1 → その後 Codex の SEC-005**。両タスクのdocが `worker/src/index.js` の
   store ルート群での競合を警告しているため、順序を固定する。Phase 1 を先にする理由は、
   本番で実害が出ており、User承認済みの復旧対象データ（2026-07-07 の351行）が
   `inventory_lines` に残ったままのため
2. **DATA-002 Phase 3 と過去棚卸取込の再設計は初回公開スコープ外**（公開後）。
   Phase 3 は migration を伴い、本番D1に 0010/0011 が未適用（WEB-04）の現状では判断材料が揃わない
3. **実行順は下表のとおり**（項目番号順ではない）
4. デスクトップUIの2コミットは取り消さない。`eb99895` の2列グリッドは S8 で書き換える

### DATA-002.md の記録上書き

同docに「着手時期: Codexの作業が完了した後。それまで着手しない」（2026-07-28 User判断）が残る。
担当が CC へ移ったことでこの判断は失効する。**S1 で書き換える**（削除せず、上書きの経緯を残す）。

---

## セッション割り振り

**会話セッションは3本だが、Codexへの報告は8回に分ける。** セッションをまとめるのは実装効率の
都合であり、レビュー粒度は落とさない。

### 第1セッション — 止血・記録・サーバー側データ整合

| 順 | ID | 内容 | 範囲 | 規模 |
|---|---|---|---|---|
| 1 | **S1** | 担当・公開範囲の記録更新 | docs のみ | 極小 |
| 2 | **S2** | 品目マスタ取込の**止血** | `MasterManagePage` / `SettingsModal` | 小 |
| 3 | **S3** | DATA-002 **Phase 1**（別端末から明細取得・R-001復旧） | `worker/src/index.js` + `app/src` | 中 |
| 4 | **S4** | DATA-001（完了処理の原子性） | `worker/` + `app/src` | 大 |

`worker/` に触るものを1セッションへ寄せている。S2 は実害が出ているため大きい作業の前に置く。
**S4 が入り切らない場合は第2セッションの先頭へ送る**。この順序なら、そうなっても
ブロック解除（S3）と止血（S2）は必ず終わっている。

### 第2セッション — 品目マスタ取込の本修理

| 順 | ID | 内容 | 範囲 | 規模 |
|---|---|---|---|---|
| 5 | **S5** | 追加・更新マージ化、全置換の分離、CSV堅牢性テスト | `useConfig.js` 中心 | 大 |
| 6 | **S6** | 取込前プレビュー、スキップ理由、Free上限の可視化、PDFβ化 | 取込UI群 | 中〜大 |

`worker/` に一切触らない。第1セッションの残件と並行しても衝突しない。

### 第3セッション — 保存失敗の可視化と画面再編

| 順 | ID | 内容 | 範囲 | 規模 |
|---|---|---|---|---|
| 7 | **S7** | DATA-002 **Phase 2**（保存失敗の可視化・バックフィル） | `app/src` 中心 | 中 |
| 8 | **S8** | 画面を棚卸中心へ戻す（入出庫・発注の整理を含む） | `app/src` UI | 中 |

S8 を最後にするのは、データ層の結果を反映する側だから。先にやると第1・第2の後で再度触ることになる。

### 公開後（着手しない）

| ID | 内容 | 前提 |
|---|---|---|
| **P1** | DATA-002 Phase 3（sessionId中心化・同日複数回保持・データ源統一・削除のサーバー側完結） | PM判断 + WEB-04（本番D1 migration） |
| **P2** | 過去棚卸取込の再設計（`importBatchId`・日付衝突の選択・一括取消） | **P1 完了後**。履歴が日付キーのままでは成立しない |

---

## 各タスクの完了条件

### S1 — 担当と公開範囲の更新（docs のみ） ✅ 完了（2026-08-08・第1セッション）

- [x] [`task-list.md`](../task-list.md) の DATA-001 担当を Codex → **CC**（`Claude Code` 表記）
- [x] 同 DATA-002 担当を 未割当 → **CC**
- [x] 初回Web版の中心を「**棚卸効率化**」と明記 … `task-list.md`「初回Web版の中心」節 ＋
      [`web-release-readiness.md`](../web-release-readiness.md)「公開scope」
- [x] 入出庫・発注確認を中核機能ではなく **β機能** と位置づける（同上2箇所）
- [x] 新機能は増やさず既存機能の整理と安定化に限定する旨を明記（同上2箇所）
- [x] [`DATA-002.md`](../tasks/DATA-002.md) の着手時期の判断を上書き（打ち消し線で原文を残し、
      失効理由と新しい着手時期を追記）
- [x] DATA-002 Phase 1 → SEC-005 の順序を両docへ明記（[`DATA-002.md`](../tasks/DATA-002.md)
      「着手順」節 ／ [`SEC-005.md`](../tasks/SEC-005.md)「着手順」節。`task-list.md` と
      `web-release-readiness.md` の `WEB-05` にも記載）
- [x] Phase 3 / 過去棚卸取込を公開後スコープと明記（`task-list.md`「初回公開scope外」節、
      `DATA-002.md`「今回の公開scope」表、`web-release-readiness.md`「今回の対象外」）

### S2 — 品目マスタ取込の止血

**根拠（コード確認済み・2026-08-08）**

[`useConfig.js:397-410`](../../../app/src/composables/useConfig.js#L397-L410) の `loadFromCSV` は
`config.order` / `units` / `prices` / `categories` / `codes` / `categoryCodes` / `prevMonths` /
`lotSizes` / `dictionary` を**丸ごと差し替え**、`manualItems` を新CSVに含まれる名前だけに絞る。
`reorderPoints` のみ列が無い場合に保持（非破壊）される。

一方 [`MasterManagePage.vue:107`](../../../app/src/components/MasterManagePage.vue#L107) の説明は
「品目名が一致するものは上書き、無いものは追加されます」＝**追加マージを約束している**。

呼び出し経路は実在する: [`SettingsModal.vue:155`](../../../app/src/components/SettingsModal.vue#L155)、
[`PdfImporterModal.vue:137`](../../../app/src/components/PdfImporterModal.vue#L137)。

300品目を運用中の店舗が50品目のファイルを入れると、250品目と単価・別名・分類が消える。

- [x] ヘルプ文言を実装の挙動に一致させる … `MasterManagePage.vue` の `HELP.import`
- [x] 取込実行前に「既存マスタは置き換わる」ことを確認ダイアログで明示する …
      `utils/masterImportWarning.js` を新設し、**3つの取込入口すべて**に適用
      （`SettingsModal.handleFile` = CSV直接 ／ `SettingsModal.onMapperImported` = 列指定 ／
      `PdfImporterModal.onImport` = PDF・Excel）。加えてファイル選択**前**に見える警告を
      ドロップゾーン上へ表示
- [x] 本修理（S5）までの暫定である旨をコメントに残す … `masterImportWarning.js` 冒頭、
      `useConfig.js` の `loadFromCSV` / `loadFromCSVMapped` の代入直前、`HELP.import` の上
- [x] 既存テストが通ること … 539 passed / 64 files（S2で+8）

**S5 で外すもの**（マージ化したら通常取込からこの確認を外し、全置換操作にだけ残す）:
`masterImportWarning.js` の呼び出し3箇所、`SettingsModal.vue` の `.replace-warn`、
`HELP.import` の文言、`useConfig.js` の暫定コメント2箇所。
→ **S5・S6 で実施済み（2026-08-08）**。通常取込（CSV直接／列指定／PDF・Excel）からは確認を外し、
`confirmMasterImport` は `ItemImportPreviewModal` の**「全入れ替え」確定時だけ**呼ぶようにした。
`.replace-warn` とそのCSS、`useConfig.js` の暫定コメントは削除（全置換代入自体が無くなったため）。
`HELP.import` はマージ後の挙動へ書き換えた。`masterImportWarning.test.js` の8件はそのまま緑。

> 上表の手動確認台本のうち **2〜5・7 は前提が変わった**。通常取込は確認ダイアログを出さず
> 取込確認画面（`ItemImportPreviewModal`）を通る。差し替えた台本は
> [`../test-checklist-new-features.md`](../../test-checklist-new-features.md) の S 節（S-1〜S-9）にある。
> 6（品目0件で確認を出さない）と 8（375px の折り返し）は全置換を選んだ場合に有効。

#### 手動確認台本（未実施）

実ブラウザでの確認は行っていない。S5 着手時か実機確認時に消化する。

| # | 手順 | 期待 |
|---|---|---|
| 1 | 品目登録済みの状態で データ管理 → 取込 を開く | ドロップゾーンの上に赤枠の「入れ替えです」警告と現在の件数が出る |
| 2 | CSVを選ぶ → 確認ダイアログでキャンセル | **品目リストが変わらない**。エラー表示も出ない |
| 3 | 同じCSVで OK | 従来どおり取り込まれ、成功メッセージが出る |
| 4 | 「フォーマット不明のCSV/Excelを列指定でインポート」→ 列指定 → 取込 → キャンセル | マッパーが閉じ、品目リストは変わらない |
| 5 | PDF / Excel を投入 → プレビュー → 取込 → キャンセル | プレビューに留まり、品目リストは変わらない |
| 6 | 品目0件（初回）の状態で取込 | 確認ダイアログは**出ない**（失うものが無いため） |
| 7 | ゲスト参加中に データ管理 → 取込 | 従来どおりドロップゾーン自体が出ない（警告も出ない） |
| 8 | 375px幅で警告文の折り返し | レイアウトが崩れず、最小フォント13px を下回らない |

### S3 — DATA-002 Phase 1

正本: [`DATA-002.md`](../tasks/DATA-002.md) / 全文は [`bug-reports.md`](../bug-reports.md)

**✅ 完了（2026-08-08・第1セッション）**

- [x] `GET /store/:code/sessions/:id/lines` を追加し、`session_id` と `shop_code` の**両方**で絞る
      … `storeHandler.js` の `handleSessionLinesGet`。`index.js` の `_requireAuth` の内側
- [x] **他店舗の `session_id` を渡した場合の店舗境界テストを先に書く**
      … `worker/src/sessionLines.test.js` を先に作成し、10件すべて失敗を確認してから実装。
      加えて `index.test.js` にルーター層の401/404/200を追加
- [x] App 側は snapshot が無ければ lines から表示用snapshotを組み立てる
      … `services/snapshotFromLines.js`（純関数・13テスト）＋ `App.vue` の `onViewSession`
- [ ] 端末を変えても、同じ店舗コードで過去の棚卸の詳細が開ける … **実機未確認**（下記台本）
- [ ] 2026-07-07 の351品目が表示される … **本番未確認**。D1への直接書き込みは行っていない
- [x] 完了後、Codex へ SEC-005 の着手可を通知する
      … `SEC-005.md` / `DATA-002.md` / `task-list.md` に着手可を明記

#### 手動確認台本（未実施・実機とD1が要る）

| # | 手順 | 期待 |
|---|---|---|
| 1 | 端末Aで棚卸を完了 → 端末Bで同じ店舗コードでログイン → 履歴からその棚卸を開く | 明細が表示される（従来は「この端末での棚卸データが見つかりません」） |
| 2 | 本番の2026-07-07のセッションを開く | 351品目が表示される |
| 3 | 復元表示された詳細で訂正を試みる | 訂正できない（`locked`）。編集ボタンが出ない |
| 4 | 別店舗コードでログインし、他店舗のセッションIDを直接指定 | 404。明細は返らない |
| 5 | 機内モードで履歴詳細を開く | 「通信状況を確認してください」。404の文言と混ざらない |
| 6 | 端末にスナップショットがある棚卸を開く | 従来どおり。入力者別・変更履歴も出る（復元経路を通らない） |

`entryLog` / `participants` / `auditLog` は `inventory_lines` に無いため、
復元経路では空になる。#6 との差が出るのは仕様。

### S4 — DATA-001（完了処理の原子性）

正本: [`DATA-001.md`](../tasks/DATA-001.md)

現状: 棚卸完了時に `saveSnapshotToD1`（await しない）と `completeSessionD1`（await する）の
**2つの独立した書き込み**が走り、前者だけ失敗すると「セッションは残るが明細が消える」。

**✅ 完了（2026-08-08・第1セッション）** — migration なし

- [x] snapshot・session・明細保存を一つの完了処理として扱う … **session と明細のみ**。
      `store_history`（snapshot）は Phase 3 が要るため範囲外（下記）
- [x] 一部だけ成功した状態を作らない … `[UPDATE sessions, DELETE lines, ...INSERT lines]` を
      1つの `db.batch`（=1トランザクション）へ。明細の INSERT は
      `WHERE EXISTS (SELECT 1 FROM sessions ...)` で持ち主を確認する
- [x] 同じ完了要求を再送しても重複しない（冪等）… 明細は毎回全削除して入れ直す。
      品目が減った再送でも前回ぶんが残らない
- [x] 保存失敗時は完了扱いにせず、再試行できる … `useSession.complete()` の
      `updateSession('completed')` フォールバックを**削除**。`{ ok:false }` を返し `_finalized` も戻す
- [x] 注文・入出庫の header/lines にも同じ方針を適用 … 同じ batch 形へ。
      `handleMovementCreate` に欠けていた upsert の店舗境界 WHERE も追加
- [x] payload 全体と主要文字列・配列件数の上限を server 側で強制 …
      `MAX_LINES_PER_REQUEST`（5,000行）を新設。品目名・単位は既存の上限で slice。
      棚卸完了に `_tooLarge` と型チェックを追加（従来なし）
- [x] 部分失敗・再送・通信切断テストを追加 … `worker/src/atomicity.test.js`（29件）。
      batch の途中で例外を投げて巻き戻りを注入する

**旧テスト1件を反転**: 「complete API が失敗したら従来の updateSession にフォールバックする」は、
DATA-001 が防ごうとしている部分適用そのものを固定していたため、
「フォールバックしない」へ書き換えた。

#### 範囲外にしたもの

`saveSnapshotToD1`（`store_history`）は完了処理とは別の write のまま。1つにまとめるには
`store_history` の session単位キー化（F-001）が要るため **Phase 3（公開後）**。
失敗の可視化と再送は S7（Phase 2）が担保している。

#### 手動確認台本（未実施）

| # | 手順 | 期待 |
|---|---|---|
| 1 | 機内モードで棚卸を完了 | 「サーバーへ完了を記録できませんでした」。セッションは完了扱いにならない |
| 2 | #1 の後に接続を戻して再度完了 | 完了する。明細が重複しない |
| 3 | 完了直後に同じ完了をもう一度実行 | 明細が重複しない。合計金額も変わらない |
| 4 | 品目を減らして再完了 | 減らした品目が履歴から消える（前回ぶんが残らない） |
| 5 | 発注・入出庫で通信を切りながら保存 | ヘッダだけ・明細だけの状態が残らない |
| 6 | 本番D1で write を中断させる | **未検証**。batch がトランザクションである前提の確認が要る |
- [ ] 部分失敗・再送・通信切断テストを追加

### S5 — 取込の本修理①（マージ化） — 完了 2026-08-08 / Claude Code

- [x] 通常取込を「追加・更新」にし、**既存品目を消さない**
- [x] 全置換は別操作として分離し、明示的な警告と確認を入れる（`mode: 'replace'` ＋確認チェック）
- [x] 推奨CSV・Excel形式を正式対応とする（軸列10・11を読めるようにし、出力CSVの往復が成立）
- [x] CSVの引用符・カンマ・BOM・日本語・重複をテスト
- [x] `loadFromCSVMapped` にも同じ方針を適用
- [x] S2 の暫定文言を実装に合わせて更新 —
      **注**: S2（第1セッション）は本作業の基点 `develop@f8da4c1` に含まれていないため、
      暫定文言の書き換えではなくマージ後の挙動に合う文言を直接書いた。
      第1セッション側が同じ箇所を触っている場合、取り込み時に競合し得る。

### S6 — 取込の本修理②（プレビュー） — 完了 2026-08-08 / Claude Code

- [x] 取込前に **追加・更新・変更なし・除外・エラー**の件数を表示
- [x] 既存データとの差分を確認できる（更新品目のフィールド単位で 変更前 → 変更後）
- [x] スキップした行について**行番号と理由**を表示
- [x] Free上限による切り捨てを黙って行わない（取込前に警告。取込後の案内も維持）
- [x] PDF取込をβ扱いにする（変換画面・取込導線・ドロップゾーン）
- [x] 取込前バックアップまたは取り消し — **取り消しを実装**（`undoLastImport`）。
      メモリ上の退避のみで、再読込・アカウント切替・ホスト設定受信・取込以外の品目変更で失効する。
      注記どおり恒久的なスナップショット機構は作っていない。永続化の要否はPM判断（提案箱）。

**成果物**: `app/src/utils/itemImport.js`（解析→計画→適用の純粋関数）、
`app/src/components/ItemImportPreviewModal.vue`、テスト2ファイル。`worker/` 無変更。
**検証**: S1・S2・S7・S8 と統合後で App 70 files / 604 tests passed、production build 成功、
Worker 15 files / 196 tests passed。
**残**: 🖐 実機UI確認（375px・デスクトップ）。詳細は
[`session-log.md`](../session-log.md) の 2026-08-08 と [`../proposals.md`](../../proposals.md)。

**注意**: config全体のスナップショット機構は**存在しない**。`tagsArchiveA/B` は軸の割り当てのみ、
`restoreInventory` は進行中セッションの在庫を結果CSVから戻すもので別物。取消は新規実装になるため、
プレビューと差分確認を先に入れ、**取消の要否をその効果を見てから判断する**。

### S7 — DATA-002 Phase 2

- [ ] `_snapQueue` / `_pending` を localStorage へ永続化
- [ ] 保存失敗をユーザーに見える形で通知する
- [ ] ログイン・起動時のバックフィル
- [ ] 一覧と詳細で片方にしか出ないデータが発生しない

### S8 — 画面を棚卸中心へ

- [ ] 「品目を準備 → 棚卸開始 → 入力 → 完了 → 履歴」を第一導線にする
- [ ] 棚卸開始を最も目立つ主操作にする
- [ ] データ管理は棚卸準備として配置する
- [ ] 入出庫・発注確認を二段目または「β機能」内へ移動
- [ ] 入庫は任意β機能として残す。出庫は初回公開の主導線から外す
- [ ] 理論在庫は記録状況によって誤差が出ることを明示
- [ ] 発注確認を「**発注内容の確認・記録（β）**」へ改称し、
      **仕入先へ自動送信されないこと**を明示（[`order-history-import-design.md`](../../order-history-import-design.md)）
- [ ] 推奨発注・分析・スケジュールの新規拡張を止める
- [ ] 既存記録・進行中セッションを削除しない
- [ ] `eb99895` の2列グリッド（`style.css` のセッションタブ用 grid）を新構成に合わせて書き換える。
      同コミットの `pointer: coarse` タップ領域確保は**残す**
- [ ] モバイルとデスクトップの両方を確認

デスクトップではサイドナビ（`DesktopNav.vue`）が既に二段目として機能しているため、
棚卸を主役へ戻す上での土台として活かす。

---

## 引き渡し条件（全タスク共通）

各タスク完了ごとに次を報告する。

- 変更ファイル
- 実行したテストコマンドと結果
- 未実施のテスト
- 仕様上の判断
- 残っているリスク
- migration の有無
- Codex にレビューしてほしい点

## 禁止事項

- **本番deploy、D1 migration適用、commit、push は User の明示依頼まで行わない**
- Worker / D1 を変更する際は Cloudflare 公式資料と利用可能な skills を確認する
- 恒久docs（strategy / roadmap / 設計書）は直接編集しない。設計判断・仕様提案は
  [`../proposals.md`](../../proposals.md) へ投稿し、PM トリアージを待つ
- 新機能を増やさない。既存機能の整理と安定化に限定する
