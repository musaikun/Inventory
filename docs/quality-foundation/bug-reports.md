# 実使用バグ報告台帳

最終更新: 2026-07-28

Userが実際にアプリを使用して発見したバグを、**修正前に受け取り・確認・記録**するための台帳です。
2026-07-28 時点で他2セッションが品質基盤タスクを並行実行中のため、
このファイルは**報告の集約のみ**を行い、`task-list.md` への採番（`BUG-00x`）と修正着手は
他セッションとの担当・差分の関係を確認した後に行います。

## 運用ルール

- ここに載っている項目は、明示の指示があるまで**修正しない**。
- 「原因（推定）」はコードの読み取りだけで書く。実装・テストの変更は伴わない。
- 再現できていないものを「再現済み」と書かない。確認状況を正直に残す。
- `task-list.md`、`session-log.md` など他セッションが編集中の共有文書は、統合判断が出るまで触らない。

## 状態の定義

| 状態 | 意味 |
|---|---|
| 受付 | Userから報告を受けた。内容の確認が未着手 |
| 確認中 | 再現条件・原因箇所を調査中 |
| 確認済み | 原因箇所を特定し、修正方針まで記述した（未修正） |
| 再現不可 | 現状の情報では再現できず、追加情報待ち |
| 仕様 | バグではなく現行仕様と判明。仕様変更の要否は別途判断 |
| 移管済み | `task-list.md` へ採番し、修正担当が決まった |

## 報告一覧

| ID | 報告日 | 概要 | 影響範囲 | 深刻度 | 状態 |
|---|---|---|---|---|---|
| R-001 | 2026-07-28 | 端末変更後に棚卸履歴の詳細が開けない（「この端末での棚卸データが見つかりません」） | 履歴詳細・カレンダー金額・分析 | P1 | **修正待ち**（原因確定・方針決定済み。**Codex作業完了後に着手**） |
| F-001 | 2026-07-28 | `store_history` が日付キーのため、同日2回目の棚卸が1回目を上書き／削除も日付単位 | 履歴・分析 | P1 | 確認済み（未修正） |
| F-002 | 2026-07-28 | 履歴取得 `LIMIT 50` の単位が `sessions` と違い、長期運用でズレる | 履歴 | P2 | 確認済み（未修正） |
| F-003 | 2026-07-28 | カレンダーは `sessions`、分析は snapshot と**別データ源**を見ており表示が食い違う | カレンダー・分析 | P1 | 確認済み（未修正・本番で実害を確認） |
| F-004 | 2026-07-28 | セッション削除時、ローカルに snapshot が無いとD1側が消えず孤児として残る | D1・分析 | P2 | 確認済み（未修正・本番に孤児1件） |

F-001〜F-004 はUser報告ではなく、R-001の調査中に発見したもの。**いずれも未修正**。

---

## 詳細

### R-001: 端末変更後に棚卸履歴の詳細が読めない（端末依存をなくしたい）

- **報告日**: 2026-07-28
- **状態**: **修正待ち**（原因確定・方針決定済み。**Codexの作業完了後に着手**する。2026-07-28時点で未着手）
- **深刻度**: P1（過去の棚卸結果という主要資産が、端末を替えると読めなくなる）
- **報告内容**: スマホを変更したところ、棚卸の記録の**詳細**が読めなくなった。
  `この端末での棚卸データが見つかりません` と表示される。**端末依存でなくしたい**。

#### Userからの追加情報（2026-07-28）

| 確認事項 | 回答 | 切り分けへの効果 |
|---|---|---|
| 旧スマホ | **無し** | 旧端末のlocalStorageからの復旧は**不可**。D1に残っているものが全て |
| 見えない範囲 | 全期間（そもそも棚卸は**1件のみ**） | 候補④（同日上書き）・⑤（LIMIT 50）は**除外** |
| ログイン | 同じ店舗コード | アカウント取り違えは**除外** |
| 症状 | カレンダーに実施日は出る。**詳細だけ**開けない | 一覧＝D1、明細＝ローカルという構造と一致 |

これにより、原因は「**スナップショットがD1の `store_history` に無い（または取得できていない）**」1点に絞られました。
候補④⑤は本件の原因ではありませんが、**別バグとして残存**します（後述）。

#### 症状が出る箇所（コード）

| 箇所 | 表示 | 判定条件 |
|---|---|---|
| [App.vue:387](app/src/App.vue#L387) | `この端末での棚卸データが見つかりません` | セッション詳細を開く際、ローカルにスナップショットが無い |
| [HistoryCalendar.vue:554](app/src/components/HistoryCalendar.vue#L554) | `この端末に明細データが無いため、金額を計算できません` | 同上（`getSnapshotBySessionId` が null） |

#### 確認できたデータ構造（これが端末依存の正体）

**一覧と詳細で、データの持ち主が違う。**

| 種類 | 保存先 | 端末をまたぐか |
|---|---|---|
| セッション一覧（日付・件数・金額） | D1 `sessions`（[storeHandler.js:179](worker/src/storeHandler.js#L179)、`LIMIT 50`） | **またぐ** |
| 棚卸の**明細スナップショット** | localStorage `inventory_history_v1`（[useHistory.js:17](app/src/composables/useHistory.js#L17)）＋ D1 `store_history` | **D1にある分だけまたぐ** |
| 完了時の明細（品目・数量・単価） | D1 `inventory_lines`（[storeHandler.js:440](worker/src/storeHandler.js#L440)） | **またぐが、読み出すAPIが無い** |

つまり「一覧はD1から来るので新端末でも並ぶが、詳細はローカル or `store_history` にしか無いので開けない」
という組み合わせで、報告の症状（一覧は見えるが詳細が開けない）と一致します。

#### 原因候補（コード読み取りで確認、実際にどれが起きたかは未確定）

**① ローカルのみのスナップショットをD1へ**押し上げる経路が存在しない（構造上の欠落・最有力）

同期は `applyRemoteHistory`（[useHistory.js:249](app/src/composables/useHistory.js#L249)）による
**D1 → ローカルの一方向だけ**。ローカルにしか無いスナップショットをD1へ送る処理は、
`saveSnapshotToD1` の呼び出し2箇所（[App.vue:1116](app/src/App.vue#L1116) の棚卸完了時、
[useDataImport.js:93](app/src/composables/useDataImport.js#L93) の過去取込時）だけで、
**ログイン時・起動時のバックフィルが無い**。一度ローカルだけに残ったスナップショットは、
その端末を離れると永久に届かない。

**② D1保存の失敗キューがメモリ上にしか無い**（[useStore.js:15](app/src/composables/useStore.js#L15)）

`saveSnapshotToD1` は失敗すると `_snapQueue`（**モジュール変数**）へ積み、8秒ごとに再送する。
アプリを閉じるとキューは消え、**localStorageには保存済み・D1には未保存**の状態が確定する。
棚卸は冷蔵庫・倉庫など電波の弱い場所で完了することが多く、現実的に踏みやすい。
`config`/`inventory` の `_pending` も同じ構造。

**③ 店舗コードが無い時点の棚卸はD1へ保存されない**（[useStore.js:124](app/src/composables/useStore.js#L124)）

`if (!shopCode.value || !BASE) return` で**黙って捨てる**。アカウント登録前・ログアウト状態で
完了した棚卸は、ローカルのみに残る。またD1履歴同期は `531d84b`（店舗コード + D1 導入）以降の機能のため、
**それ以前に取った棚卸は全てローカルのみ**。

**④ 【本件の原因ではないが別バグとして残存】`store_history` が日付キーで、1日1件しか持てない**
（[storeHandler.js:79-81](worker/src/storeHandler.js#L79-L81)）

`ON CONFLICT(shop_code, snapshot_date) DO UPDATE` かつローカルも `_data[today]`
（[useHistory.js:114](app/src/composables/useHistory.js#L114)）。
**同じ日に2回棚卸すると、後の1件が前の1件を上書きする**。
一方 `sessions` はセッション単位なので、一覧には2件並ぶが詳細は1件分しか無く、
古い方は `getSnapshotBySessionId` が null になる。→ 端末変更と無関係にも起きる**別バグ**。

**⑤ 【本件の原因ではないが別バグとして残存】履歴取得が `LIMIT 50`**（[storeHandler.js:68](worker/src/storeHandler.js#L68)）

`store_history` は日付単位50件、`sessions` は50件で**単位が違う**ため、件数が増えると
「一覧に出るが履歴取得の窓から外れて詳細が無い」ズレが発生する。長期運用で必ず顕在化する。

#### 最重要の発見: 明細データはD1の `inventory_lines` に残っている可能性が高い

棚卸完了時、D1へは**2つの独立した書き込み**が走る。

| 書き込み | 呼び出し | 待機 | 保存先 | 詳細表示に使われるか |
|---|---|---|---|---|
| スナップショット | `saveSnapshotToD1`（[App.vue:1116](app/src/App.vue#L1116)） | **await しない**（fire-and-forget） | `store_history` | **使う**（唯一の表示源） |
| セッション完了 | `completeSessionD1`（[App.vue:1138](app/src/App.vue#L1138)） | **await する** | `sessions` ＋ **`inventory_lines`** | **使っていない** |

`handleSessionComplete`（[storeHandler.js:421-449](worker/src/storeHandler.js#L421-L449)）は
`insertInventoryLines` で**品目名・数量・単位・単価・金額を1行ずつ**保存してから
`sessions.status = 'completed'` を書く。**カレンダーに完了済みとして日付が出ている＝この処理は成功している**ため、
`inventory_lines` にはその棚卸の明細が残っているはず。

一方、表示に使う `store_history` 側だけが欠けている。両者は**同じ棚卸の二重記録**で、
信頼できる方（await付き・正規化済み）を表示に使っていないという構造になっている。

→ **旧スマホが無くても、`inventory_lines` から明細を復元できる見込みがある。**
ただしD1の実データ確認は未実施（本番D1への読み取りはUser承認待ち）。

#### 本件で残る原因候補（②が最有力）

旧端末が無く、1件のみ、同一店舗コードという条件から、絞り込みは以下。

- **②が最有力**: 棚卸完了時の `store_history` へのPOSTだけが失敗し、
  メモリ上の `_snapQueue` に積まれたままアプリ終了 → 消失。
  `completeSessionD1` は await されるので成功しやすく、`saveSnapshotToD1` は投げっぱなしで
  失敗しても**画面上に何の警告も出ない**。この非対称が「セッションだけ残り、明細だけ消える」を生む。
- **①も同時に成立**: 仮にローカルには残っていても、D1へ押し上げる経路が無いため
  端末を替えた時点で復旧不能になった。
- **代替候補（要確認）**: 新端末での `loadHistoryFromD1()` が401等で失敗し、
  `.catch(() => null)`（[useStore.js:120](app/src/composables/useStore.js#L120)）が**黙って握り潰した**。
  この場合D1にはデータがあり、再ログインやリロードで直る可能性がある。
  → **D1を1回SELECTすれば②と代替候補を確実に区別できる**（下記）。

#### 本番D1の調査結果（2026-07-28・User承認済み・読み取り専用）

対象店舗 `KEJPFC`。`npx wrangler d1 execute inventory-store --remote --command "SELECT ..."` のみ実行（**書き込みなし**）。

**`sessions`（カレンダーの表示源）— 1件**

| id | started_at | ended_at | status | item_count | total_value |
|---|---|---|---|---|---|
| `d53cb352-…` | 2026-07-07T01:50:50Z | 2026-07-07T01:51:06Z | completed | 351 | null |

**`store_history`（詳細の表示源）— 2件。どちらも上記セッションのものではない**

| snapshot_date | sessionId | source | items | 入力済み | 単価あり | 備考 |
|---|---|---|---|---|---|---|
| 2026-06-30 | **null** | import | 357 | 357 | 0 | 2026-07-27に過去取込したデータ |
| 2026-07-18 | `bb33adb3-…` | — | 1047 | **1** | 0 | 対応する session が**存在しない孤児**。実入力1件のみ |

**`inventory_lines`（未使用の明細）— 351行、すべて `d53cb352-…` に紐づく**

| 行数 | 数量>0 | 単位あり | 単価あり |
|---|---|---|---|
| 351 | 329 | 351 | 0 |

**確定した事実**

1. カレンダーに出ている2026-07-07の棚卸は、**`store_history` にスナップショットが1件も無い**。
   → `getSnapshotBySessionId` も日付フォールバックも外れ、[App.vue:387](app/src/App.vue#L387) のトーストに落ちる。**症状と完全に一致**。
2. **その棚卸の明細は `inventory_lines` に351行そのまま残っている**（数量329件・単位あり）。
   単価は未登録のため金額は復元できないが、**品目・数量・単位は完全に復旧可能**。
3. `sessions` と `store_history` は**互いに参照整合性が無く、両方向に孤児が出ている**。
   - session はあるが snapshot が無い（2026-07-07）→ 詳細が開けない
   - snapshot はあるが session が無い（2026-07-18）→ カレンダーに一切出ない
   - snapshot に sessionId が無い（2026-06-30の取込分）→ カレンダーに一切出ない（→ F-003）
4. 2026-07-07 のセッションは **16秒で完了**（01:50:50→01:51:06）し、351品目・単価なし。
   短時間で大量入力されており、テストまたは一括入力の可能性がある（Userの記憶と要照合）。

**保存側が失敗したのか、後から日付単位で消えたのか**は、D1に痕跡が残らないため断定できない。
ただし①（バックフィル無し）②（キューが揮発）F-001（日付キー削除）のいずれであっても、
**同じ結果（sessionだけ残り明細が消える）を生む**ため、修正方針は変わらない。

#### 参考: 当初の確定作業クエリ（実行済み）

本番D1に対する**読み取り専用**クエリ1回で、原因が確定する。

```sql
SELECT snapshot_date, length(snapshot_json) FROM store_history WHERE shop_code = ?;
SELECT id, started_at, ended_at, status, item_count, total_value FROM sessions WHERE shop_code = ?;
SELECT session_id, COUNT(*) FROM inventory_lines WHERE shop_code = ? GROUP BY session_id;
```

結果は上記のとおり。**`inventory_lines` に351行あり、復旧可能**であることが確認できた。

#### 想定影響範囲（修正時に触る箇所）

- App: [useHistory.js](app/src/composables/useHistory.js)、[useStore.js](app/src/composables/useStore.js)、
  [App.vue](app/src/App.vue)（`_pullAccountConfig` / `_startSessionView` / mount）、
  [HistoryCalendar.vue](app/src/components/HistoryCalendar.vue)
- Worker: [storeHandler.js](worker/src/storeHandler.js)（history GET/POST、`inventory_lines` 読み出しを足す場合）
- migration: `store_history` をセッション単位にする案を採る場合は新規migrationが必要（**後方互換の検討必須**）
- Data Safety台帳: 保存先・保持期間の記述に影響しうる（既存の申告内容と要照合）

#### 修正方針の候補（**未実施・未着手**。D1調査を踏まえて優先度を更新）

| # | 内容 | 効果 | 規模 |
|---|---|---|---|
| **1** | **`inventory_lines` の読み出しAPIを追加し、詳細表示のフォールバックにする** | 今回の症状が直る。**既存データも即座に読めるようになる** | Worker GET 1本 + App側フォールバック |
| **2** | **未送信キューの永続化**（`_snapQueue` を localStorage へ） | 保存漏れの再発防止 | 小 |
| **3** | **ログイン・起動時のバックフィル**（ローカルのみのsnapshotをD1へ押し上げ） | 端末依存の解消（構造） | 中 |
| **4** | **`store_history` をセッション単位のキーへ**（migration必要） | F-001（同日上書き・日付削除）の解消 | 大・要後方互換設計 |
| **5** | 保存失敗をユーザーに見せる（現状は完全に無言） | 失われる前に気づける | 小 |
| **6** | `LIMIT 50` の見直し（ページング or 期間指定） | F-002 | 小 |
| **7** | 文言見直し（「この端末での」は端末依存の設計を露出している） | UX | 小 |

**1が最優先**。既にD1にある正規化済みデータを使うだけで、保存側の設計を変えずに症状が消える。

#### 復旧方針（2026-07-07の351品目・**未実施**）

| 方式 | 内容 | 得られるもの | 失うもの |
|---|---|---|---|
| A | 修正1（`inventory_lines` 読み出し）を実装し、詳細画面から直接読む | 恒久対処と復旧を兼ねる | 実装が入るまで見られない |
| B | `inventory_lines` からCSVを生成し、過去取込（`importPastSnapshot`）で戻す | すぐ見られる | 単価なし。手作業 |
| C | `inventory_lines` から snapshot JSON を組み立て `store_history` へ1行INSERT | すぐ見られる・アプリ変更不要 | **本番D1への書き込み**（要User承認・要バックアップ） |

いずれも単価は復元できない（`inventory_lines.unit_price` が全件null＝完了時に単価未登録だったため）。

#### 当面の回避策

旧端末が無いため、**CSV書き出しによる移行は使えない**（旧端末のlocalStorageが唯一の書き出し元だった）。
残る復旧手段は `inventory_lines` からの復元のみ。
なお過去分の手入力での再登録は [useDataImport.js](app/src/composables/useDataImport.js) の
`importPastSnapshot` 経由で可能（D1にも保存される）。

#### 他セッションとの関係

- **着手条件: Codexの現在の作業が完了すること**（User判断）。それまでコードに触れない。
- 現在の作業ツリー差分（`planLimits` / `entitlements` / `UpgradeModal` / `landing`）とは**ファイル重複なし**。
- Phase 1 は `storeHandler.js` `index.js` `App.vue` `useStore.js` に入る。
  `SEC-005`（無制限な店舗作成経路の整理・Codex担当・未着手）が `index.js` の同じ store ルート群を触るため、
  **`index.js` で競合する可能性が高い**。着手順の調整が必要。
- Phase 3 の 1 はmigration追加。**本番D1に0010/0011が未適用**という現状（README記載）と順序の調整が要る。
- スプリント凍結（〜2026-08-08、Play要件と品質基盤以外の新機能停止）との関係上、
  Phase 1・2 は「データ損失バグの修正」として凍結対象外と解釈できるが、Phase 3 は新機能に近い。**PM判断が必要**。

#### User判断（2026-07-28・確定）

| 論点 | 判断 |
|---|---|
| 2026-07-07 の棚卸351品目 | **実データ**。復旧対象とする |
| 復旧方式 | **A を採用**（`inventory_lines` を読む修正を入れ、恒久対処と復旧を兼ねる）。D1への直接書き込み（C）は行わない |
| 到達目標 | **機種が変わっても、同じ店舗コードで入れば履歴が見られること**（端末依存の解消） |
| 着手時期 | **Codexの現在の作業が完了した後**。それまで着手しない |

#### 実装計画（**未着手**。Codex完了後に開始）

到達目標に対し、「D1を履歴の正・ローカルはキャッシュ」へ寄せる。3段階に分ける。

**Phase 1 — 詳細が読めない状態を解消する（＝2026-07-07データの復旧を兼ねる）**

| 対象 | 変更内容 |
|---|---|
| [storeHandler.js](worker/src/storeHandler.js) | `GET /store/:code/sessions/:id/lines` を追加。`inventory_lines` を `session_id` **と `shop_code` の両方**で絞る（`SEC-002` の店舗境界に合わせ、session_id 単独で引かない） |
| [index.js](worker/src/index.js) | 上記ルートを追加。`/sessions` 系は前段の `verifyStoreAccess`（後方互換ソフト認証）ではなく、各ルートで `_requireAuth`（strict）を呼ぶ方式になっているため、**新ルートも `_requireAuth` に揃える**（レガシー店舗でも素通りさせない） |
| [useStore.js](app/src/composables/useStore.js) | `loadSessionLinesFromD1(sessionId)` を追加 |
| [App.vue:380-392](app/src/App.vue#L380-L392) | `onViewSession` を async 化。snapshot が無ければ lines を取得し、表示用 snapshot を組み立てて `detailSnapshot` に渡す。取得も失敗した時だけ現在のトーストを出す |

組み立てる snapshot の形（[SessionDetailPage.vue](app/src/components/SessionDetailPage.vue) が要求する形）:

```
{ date, savedAt, sessionId, locked: true,
  items: [{ item, qty, unit, unitPrice, subtotal, code:'', flagged:false, category:null, … }],
  totalValue, participants: null, auditLog: [], entryLog: [], activeMs: null }
```

- 復元できるもの: **品目名・数量・単位**（＋単価が登録されていれば単価と金額）
- 復元できないもの: 参加者別集計・変更履歴・入力順ログ・所要時間 → 各タブは空表示になる
- `locked: true` を立てる。3日の訂正期間はとうに過ぎており、
  `isLocked`（[SessionDetailPage.vue:64](app/src/components/SessionDetailPage.vue#L64)）も真になるため、
  **書き戻しの経路を作らずに済む**（`patchSnapshotItems` は snapshot がローカルに無いと動かないため）
- 併せて [HistoryCalendar.vue:328](app/src/components/HistoryCalendar.vue#L328) の `noData` 判定も
  フォールバック後の状態を見るようにする（今回は単価が無いので金額は出ないが、警告文は消える）

**Phase 2 — 同じ消失を再発させない**

1. `_snapQueue` / `_pending` を localStorage へ永続化（[useStore.js:14-16](app/src/composables/useStore.js#L14-L16)）。再起動後も再送する
2. `saveState === 'pending'` をユーザーに見せる（現在は保存失敗が**完全に無言**）
3. ログイン・起動時のバックフィル: ローカルにあってD1に無い snapshot を押し上げる

**Phase 3 — 構造の是正（要PM判断・migration含む）**

1. `store_history` を session 単位のキーへ（F-001）
2. カレンダーと分析のデータ源を一本化（F-003）
3. 過去取込データにも session 行を作る（F-003）
4. 履歴取得の `LIMIT 50` とペイロード量の見直し（F-002）
5. セッション削除をサーバー側でsession単位に完結させる（F-004）

**検証（着手時に実施）**

- Worker: 新エンドポイントの店舗境界テスト（他店舗の session_id を渡して404/403になること）を先に書く
- App: `onViewSession` のフォールバック（snapshotあり／なし／取得失敗の3系統）
- `cd worker && npm test` → `cd app && npm test && npm run build`
- 実機: 別端末で同じ店舗コードにログイン → カレンダー → 2026-07-07 の詳細が開けること

---

### F-001: 同日2回目の棚卸が1回目を上書きする（履歴が日付キー）

- **発見日**: 2026-07-28（R-001の調査中）／**状態**: 確認済み・未修正／**深刻度**: P1（データ消失）
- **内容**: 棚卸明細の保存キーが**日付**になっている。
  - ローカル: `_data[today] = {...}`（[useHistory.js:114](app/src/composables/useHistory.js#L114)）
  - D1: `ON CONFLICT(shop_code, snapshot_date) DO UPDATE`（[storeHandler.js:80](worker/src/storeHandler.js#L80)）
  - 削除も日付単位: `DELETE ... AND snapshot_date = ?`（[storeHandler.js:87](worker/src/storeHandler.js#L87)）
- **起きること**:
  1. 同じ日に2回棚卸すると、**2回目が1回目を無言で上書き**する。`sessions` には2件残るため、
     古い方は詳細が開けない（R-001と同じ症状）。
  2. セッション削除は `deleteSnapshotFromD1(snap.date)`（[App.vue:1012](app/src/App.vue#L1012)）で
     **日付ごと消す**ため、同日の別セッションの明細まで巻き添えで消える。
- **補足**: `today` は `new Date().toISOString().slice(0,10)` = **UTC日付**。
  JST 0:00〜8:59 に完了した棚卸は**前日のキー**になる。深夜の閉店後棚卸で日付がずれる。
- **修正方針（未実施）**: `store_history` を session 単位のキーへ（migration必要・後方互換の設計が要る）。
  最低限、日付キーは業務日（JST基準）で決める。

### F-002: 履歴取得の `LIMIT 50` が `sessions` と単位違い

- **発見日**: 2026-07-28／**状態**: 確認済み・未修正／**深刻度**: P2（長期運用で顕在化）
- **内容**: `sessions` は**セッション50件**（[storeHandler.js:179](worker/src/storeHandler.js#L179)）、
  `store_history` は**日付50件**（[storeHandler.js:68](worker/src/storeHandler.js#L68)）。
  母集団が違うため、件数が増えると「一覧に出るのに詳細が無い」ズレが必ず出る。
  加えて `store_history` は1件185KBに達しており（実測）、50件で**約9MBを毎回転送**する。
- **修正方針（未実施）**: 一覧はメタ情報のみ、明細は開いた時に取得する形へ。または期間指定・ページング。

### F-003: カレンダーと分析が別のデータ源を見ていて、表示が食い違う

- **発見日**: 2026-07-28／**状態**: 確認済み・未修正／**深刻度**: P1（実害を本番で確認）
- **内容**:

  | 画面 | データ源 | 実装 |
  |---|---|---|
  | 履歴カレンダー | **D1 `sessions`** | [HistoryCalendar.vue:61](app/src/components/HistoryCalendar.vue#L61) `props.sessions` |
  | 経営ダッシュボード・分析 | **snapshot（ローカル）** | [SessionListPage.vue:70](app/src/components/SessionListPage.vue#L70) `getSnapshots()` |

  両者に参照整合性が無いため、**同じ棚卸が片方にしか出ない**。本番の実データで両方向とも発生していた。

  | データ | カレンダー | 分析 |
  |---|---|---|
  | 2026-07-07 の棚卸（session あり・snapshot なし・351品目） | **出る** | **出ない** |
  | 2026-06-30 の過去取込（snapshot のみ・sessionId null・357品目） | **出ない** | 出る |
  | 2026-07-18 の孤児 snapshot（session なし） | **出ない** | 出る |

- **影響**: 過去取込（`importPastSnapshot`）したデータは**カレンダーに一切現れない**。
  Userが2026-07-27に取り込んだ357品目がこれに該当する。
- **修正方針（未実施）**: 表示源を一本化する。`sessions` を正とし、取込データにも session 行を作るのが自然。

### F-004: セッション削除時、ローカルに明細が無いとD1側が孤児として残る

- **発見日**: 2026-07-28／**状態**: 確認済み・未修正／**深刻度**: P2
- **内容**: [App.vue:1006-1014](app/src/App.vue#L1006-L1014) の `onDeleteSession` は
  `getSnapshotBySessionId`（**ローカル**）で日付を引いてからD1を消す。
  ローカルに明細が無い端末（＝まさに機種変更後の端末）で削除すると、**D1の明細だけが残る**。
  さらに `deleteSnapshotFromD1(...).catch(() => {})` で失敗も握り潰す。
- **実害**: 本番D1に 2026-07-18 の孤児 snapshot（185KB）が残存。どの画面からも削除できない。
- **関連**: アカウント削除（`PLAY-001`）は `shop_code` 単位の一括削除なので**取り残しは無い**。
  ただし「ユーザーが消したつもりのデータがサーバーに残る」点は
  Data Safety の説明（削除操作の実効性）と整合を要確認。
- **修正方針（未実施）**: 削除はセッションIDでサーバー側に委ね、ローカル参照に依存させない。

<!--
各報告は以下のテンプレートで追記する。

### R-00x: <一行要約>

- **報告日**: YYYY-MM-DD
- **状態**: 受付
- **深刻度**: P0（データ消失・機能停止） / P1（主要導線が壊れる） / P2（回避可能）
- **発生環境**: 端末・ブラウザ・ホスト/ゲスト・オンライン/オフライン
- **再現手順**:
  1.
- **期待する動作**:
- **実際の動作**:
- **再現性**: 毎回 / たまに / 未確認
- **確認結果**: （こちらで再現・コード確認した内容）
- **原因（推定）**: `file:line` を添えて記述
- **想定影響範囲**: 修正時に触るファイル・他タスクとの競合可能性
- **修正方針（未実施）**:
- **他セッションとの関係**: 並行タスクとの差分競合の有無
-->
