# DATA-002 — 履歴の端末依存を解消し、DO/D1 の成長時設計を検証

- 状態の正本は [`../task-list.md`](../task-list.md)
- **統合**: 実使用バグ `R-001` と、その調査中に発見した `F-001`〜`F-004` を、新規IDを作らず本タスクで扱う。
  報告の全文・コード根拠・本番D1の調査結果は [`../bug-reports.md`](../bug-reports.md) に保存する（削除しない）。

## 現在の状態（2026-08-19）

**完了 / Claude Code。** sessionIdを履歴identityの正本とし、stock/order別の完了契約、
完了claim/fingerprint、過去棚卸取込台帳、replace/cancelの原子guard、別端末向け履歴詳細、
保存失敗時の再送契約まで実装した。DATA-002からAppへ渡した7点は、後続の
`DATA-001` / `IMPORT-001`ですべて対応済み。Codexの最終独立レビューでblocking findingはない。

- 最終確認対象: `develop@e8f5e16`
- 検証: App 95 files / 1140 passed、Worker 26 files / 545 passed、production build成功
- 下記の「未実施」「Appへの引継ぎ」は各実装時点の履歴。現時点の本番D1 migration、
  実D1・実browser、critical E2Eは `WEB-04` / `WEB-07` / `WEB-09` / `WEB-10` で扱う。

## P1 へ引き上げた理由

当初は「実データ量が増えたときの設計検証」という将来課題だったが、2026-07-28 に
**本番で実害が確認された**ため優先度を上げた。

- 端末を変更すると、過去の棚卸の**詳細が読めなくなる**（`R-001`。Userの実機で発生）。
- 本番D1で、`sessions` と `store_history` に**両方向の孤児**が存在することを確認した（読み取り専用調査）。
- 過去取込したデータが**カレンダーに一切現れない**（`F-003`。実データで確認）。

## 統合した報告（詳細は [`../bug-reports.md`](../bug-reports.md)）

| ID | 深刻度 | 概要 | 状態 |
|---|---|---|---|
| R-001 | P1 | 端末変更後に棚卸履歴の詳細が開けない（「この端末での棚卸データが見つかりません」） | 原因確定・方針決定済み・**未修正** |
| F-001 | P1 | `store_history` が日付キーのため、同日2回目の棚卸が1回目を上書き／削除も日付単位 | 確認済み・未修正 |
| F-002 | P2 | 履歴取得 `LIMIT 50` の単位が `sessions` と違い、長期運用でズレる（1件185KB×50件≒9MB転送） | 確認済み・未修正 |
| F-003 | P1 | カレンダーは `sessions`、分析は snapshot と別データ源で表示が食い違う | 確認済み・未修正 |
| F-004 | P2 | セッション削除時、ローカルに snapshot が無いとD1側が孤児として残る | 確認済み・未修正 |

## 確定した構造上の原因

一覧と詳細で**データの持ち主が違う**。

| 種類 | 保存先 | 端末をまたぐか |
|---|---|---|
| セッション一覧（日付・件数・金額） | D1 `sessions` | またぐ |
| 棚卸の明細スナップショット | localStorage `inventory_history_v1` ＋ D1 `store_history` | D1にある分だけ |
| 完了時の明細（品目・数量・単価） | D1 `inventory_lines` | またぐが、**読み出すAPIが無い** |

本番D1の調査（2026-07-28・User承認済み・読み取り専用）で、症状の出ている棚卸の明細が
**`inventory_lines` に351行そのまま残っている**ことを確認済み。表示に使う `store_history` 側だけが欠けている。

## User判断（2026-07-28・確定）

| 論点 | 判断 |
|---|---|
| 2026-07-07 の棚卸351品目 | **実データ**。復旧対象とする |
| 復旧方式 | **A を採用**（`inventory_lines` を読む修正を入れ、恒久対処と復旧を兼ねる）。D1への直接書き込みは行わない |
| 到達目標 | **機種が変わっても、同じ店舗コードで入れば履歴が見られること** |
| 着手時期 | ~~**Codexの作業が完了した後**。それまで着手しない~~ → **2026-08-08 に失効**（下記） |

### 着手時期の判断の上書き（2026-08-08）

上表の「Codexの作業が完了した後。それまで着手しない」は **2026-07-28 時点で本タスクが
Codex側の作業列に置かれていたことを前提にした判断**でした。担当が **Claude Code** へ移り、
CC/Codex の役割が「CC = 製品機能・データ処理・画面構成 ／ Codex = リリース品質基盤・独立レビュー・
セキュリティ・E2E・公開判定」に整理されたことで、この前提が成立しなくなったため失効します。
判断そのものは削除せず、経緯として残します。

**新しい着手時期: 即時着手可。ただし `SEC-005` より先に Phase 1 を完了させること**（次節）。

Phase 1 を先にする理由は、本番で実害が出ており、User承認済みの復旧対象データ
（2026-07-07 の351行）が `inventory_lines` に残ったままのためです。

### 前提の再置換（2026-08-09）

2026-08-09 の User 継続指示（CCレビュー修正3セッション計画）により、本タスクは
**Codex の独立レビュー結果を受けた修正フェーズ**へ入りました。上の 2026-07-28 判断と
2026-08-08 の上書きはどちらも削除せず、経緯として残します。現在の前提は次のとおりです。

- 担当は `Claude Code`、状態は `進行中`。完了判定は Codex の再レビュー後で、CC 側では付けません。
- 修正は第1（保留保存の整合・表示）→ 第2（sessionId中心の履歴整合）の順に行います。
- Phase 3 と過去棚卸取込の公開後送りは、**User の新しい明示判断を `decisions.md` へ
  記録した場合だけ**有効です（計画の「全セッション共通」より）。


## 実装計画（Phase 1・2 実装済み / Phase 3 は公開後・全文は [`../bug-reports.md`](../bug-reports.md)）

- **Phase 1** — 詳細が読めない状態を解消（2026-07-07データの復旧を兼ねる）。
  `GET /store/:code/sessions/:id/lines` を追加し、`session_id` と `shop_code` の両方で絞る
  （`SEC-002` の店舗境界に合わせる）。App 側は snapshot が無ければ lines から表示用snapshotを組み立てる。
- **Phase 2** — 再発防止。`_snapQueue` / `_pending` の localStorage 永続化、保存失敗の可視化、
  ログイン・起動時のバックフィル。
- **Phase 3** — 構造の是正（要PM判断・migration含む）。`store_history` のsession単位キー化（F-001）、
  データ源の一本化（F-003）、`LIMIT 50` 見直し（F-002）、削除のサーバー側完結（F-004）。

## Phase 1 の実装（2026-08-08・Claude Code 第1セッション / S3）

**状態: 実装済み。Worker 210 tests passed / App 617 tests passed / production build 成功。**
D1 への復旧書き込みは行っていない（User判断 2026-07-28 の方式A）。

| 完了条件 | 実装 |
|---|---|
| `GET /store/:code/sessions/:id/lines` を追加し `session_id` と `shop_code` の両方で絞る | `storeHandler.js` の `handleSessionLinesGet`。`index.js` の `_requireAuth`（strict同store Bearer）の内側に登録。単価・在庫金額を含むためゲスト経路には置かない |
| 他店舗の `session_id` を渡した場合の店舗境界テストを先に書く | `worker/src/sessionLines.test.js` を先に作成し、10件すべて失敗を確認してから実装。加えて `index.test.js` にルーター層の401/404/200を追加 |
| App 側は snapshot が無ければ lines から表示用snapshotを組み立てる | `app/src/services/snapshotFromLines.js`（純関数）＋ `App.vue` の `onViewSession` |

### 設計上の判断

- **他店舗のIDと存在しないIDは同じ404**にした。区別すると「そのIDが実在するか」を
  他店舗から確かめられる。
- **復元したスナップショットは `locked: true`** にした。`patchSnapshotItems` は
  localStorage の該当日付を書き換える実装で、端末に実体が無い記録を編集させると
  「保存したつもりで消える」状態になる。訂正は端末に実体がある場合のみ。
- **localStorage にも D1 にも書き戻さない。** その場で見るための復元であり、
  端末のスナップショットとして正にはしない。バックフィル（Phase 2）とは逆向きの経路。
- **`totalValue` はサーバーの `sessions.total_value` を優先**する。明細が上限で
  打ち切られた場合に、積み上げ計算だと実際より小さい合計を出してしまう。
- **1回の返却上限は 2,000件**（`MAX_SESSION_LINES`）。`F-002` の転送量問題を新経路へ
  持ち込まないための有界化。超過時は `truncated` を返し、App はトーストで明示する。

### 残っている穴（Phase 1 では埋めていない）

- 復元経路は**完了済みセッションの明細のみ**。`entryLog` / `participants` / `auditLog` は
  `inventory_lines` に無いため空になる。詳細画面の「入力者別」「変更履歴」は端末に
  スナップショットがある場合にだけ出る。
- 日付キーのままなので **F-001（同日2回目の上書き）は解消していない**。
- 一覧と詳細のデータ源が2つある状態（F-003）そのものは Phase 3 の範囲。

## Phase 2 の実装（2026-08-08・Claude Code 第3セッション / S7）

**状態: 実装済み・未コミット時点で App 558 tests passed / production build 成功。**
Phase 1（`GET /store/:code/sessions/:id/lines`）は別セッション担当のため未着手。
Phase 2 は Phase 1 と独立して成立する（再発防止であり、既存の欠損復旧ではない）。

| 完了条件 | 実装 |
|---|---|
| `_snapQueue` / `_pending` の localStorage 永続化 | `useStore.js`。キー `_pending_saves_v1`（`storageKeys.js` に登録）。`shopCode` を payload に持ち、**別店舗のキューは読み込み時に破棄**する（事故 S-10 と同じ境界）。`resetAccountData` と `clearLocalAccountData` の消去対象に追加 |
| 保存失敗の可視化 | 完了処理が `saveSnapshotToD1` の結果を待ち、未送信ならトーストで明示（従来は投げっぱなしで「完了しました ✓」だけが出ていた）。`ConnectionBanner` に `failed` 表示を追加し、連続失敗2回以上で「サーバーへ保存できていません（未送信 N件）」へ強める |
| 起動時のバックフィル | `services/historyBackfill.js`（純関数 `missingSnapshots`）。履歴を読む3経路（起動・ログイン・セッション開始）で、端末にあって D1 に無い／D1 側が古いスナップショットを送り直す。1回あたり最大10件 |
| 起動時の未送信再送 | `resumePendingSaves()` を `App.vue` の `onMounted` から呼ぶ（接続復帰イベントを待たない） |

### 付随して直した2点

1. **`applyRemoteHistory` が端末側の新しいスナップショットを潰していた**。未送信分が D1 の古い版で
   上書きされると、バックフィルで送るべき差分ごと消える。保存時刻を比較し、端末側が新しければ残す
   （同時刻・不明はリモート優先＝従来どおり）。
2. **再送間隔を指数バックオフ化**（8秒 → 最大2分）。復旧しない障害で8秒ごとに叩き続けない。

### 残っている穴（Phase 2 では埋めていない）

- localStorage の容量不足でスナップショット（1件で百KB規模）を端末に残せない場合、
  メモリ上には保持するが**アプリを閉じると消える**。`pendingPersisted=false` として
  バナーに「この端末では未送信分を保持できません」と出すところまで。恒久対処は IndexedDB 化で、Phase 3 相当。
- 完了処理そのものの原子性は **DATA-001（S4）の範囲**。ここでは「失敗したことが見える」までしか担保していない。
- 日付キーのままなので **F-001（同日2回目の上書き）は解消していない**。バックフィルも日付キーで判定する。

## Phase 2 のレビュー修正（2026-08-09・Claude Code / CCレビュー修正 第1セッション §2-3）

Codex レビューで、Phase 2 の未送信キューに3つの欠陥が指摘された。

### 1. 古い版が新しい版を巻き戻す（latest-wins が無い）

旧実装は種類ごとの配列に payload を積むだけで、対象の識別子を持っていなかった。

1. Aの保存が失敗してキューに入る
2. 同じ対象の新しいBが直接保存に成功する
3. 再送がAを送り、**サーバー上のBがAへ巻き戻る**

`kind + shopCode + resourceId` をキーにした Map へ置き換え、保存要求ごとに単調増加の
`rev` を振った。成功時はその rev 以下の待ち項目を破棄し、失敗時は既存より新しい rev の
ときだけ入れ替える。識別子は config/inventory=固定、snapshot=日付（D1側も日付upsert）、
order/movement=id。

### 2. drain が並行して走る

起動・接続復帰・タイマー・手動が同時に来ると `retryPendingSaves` が多重に走り、
同じ項目を二重送信して片方の結果を取りこぼしていた。実行中の drain を1本に束ねた。

### 3. 失敗の種類を区別していない

すべての失敗を同じ「再送待ち」にしていたため、内容がサーバーに拒否される保存
（400/409/413）が永久に再送され続け、認証失効（401/403）でも無駄に叩き続けていた。

| 分類 | 対象 | 挙動 |
|---|---|---|
| `auth` | 401 / 403 | drain を止める。再ログイン時 `clearAuthBlock()` で再開 |
| `permanent` | 400番台（429を除く） | 捨てる。ただし `rejectedSaves` に載せてバナーで提示する |
| `retry` | 429 / 5xx / 通信断 | キューに残して指数バックオフで再送 |

### 4. 永続化の無言欠落（§3）

旧実装は snapshot 20件・order/movement 200件で `slice` してから localStorage へ書き、
**溢れた分をメモリにだけ残したまま `pendingPersisted = true`**（＝「端末に保存済み」）と
表示していた。件数上限を撤廃し、容量に入らない場合は入る分だけ書いたうえで
`unpersistedCount` に残りを出す。バナーは「アプリを閉じると失われます」と明示する。

### 表示（§3）

- **未保存の警告をオフライン表示より優先**する。オフラインは「そのうち直る」と読めるが、
  未保存は失われうる変更のため。
- `role="status"` + `aria-live` を常設し、端末にも保持できていない場合だけ `assertive`。

### 検証

- `src/composables/useStore.queue.test.js` 12件（latest-wins / 直列化 / 失敗分類 / 永続化の正直さ）
- `src/components/ConnectionBanner.test.js` 11件（優先順位・文言・aria-live）
- 既存の `useStore.save.test.js` / `useStore.pending.test.js` 13件は**変更せずに通過**
- App 全体 74 files / 648 passed、`npm run build` 成功

### 残っている穴

- `rejectedSaves` は件数と種別を出すだけで、**拒否された内容そのものは復元できない**。
  どの品目・どの明細が落ちたかまでは提示していない。
- localStorage が全く使えない環境では依然としてアプリを閉じると失われる。IndexedDB 化は Phase 3 相当。

## 着手順（2026-08-08 確定）

### Phase 1 → SEC-005（順序を固定する）

Phase 1 は `worker/src/index.js` の store ルート群に入り、**`SEC-005`（Codex担当）が同じ範囲を触る**。
両者を並行させると同一ファイルで競合するため、**`DATA-002` Phase 1 を先に完了させ、
その後に Codex が `SEC-005` へ着手する**。同じ順序を [`SEC-005.md`](SEC-005.md) にも記載している。

CC は Phase 1 完了時に **Codex へ `SEC-005` の着手可を通知する**。

> **2026-08-08: Phase 1 完了。`SEC-005` は着手可。**
> `worker/src/index.js` の store ルート群に `GET /store/:code/sessions/:id/lines` を追加済み
> （`_requireAuth` の内側、`/sessions/:id/complete` の直前）。`storeHandler.js` に
> `handleSessionLinesGet`、`constants.js` に `MAX_SESSION_LINES` を追加している。
> `SEC-005` で legacy `/store/create` を触る際は、この追加後の状態を基点にすること。

### 今回の公開scope

| Phase | 今回scope | 備考 |
|---|---|---|
| Phase 1（別端末からの明細取得・R-001復旧） | **対象** | 実害あり。最優先 |
| Phase 2（保存失敗の可視化・バックフィル） | **対象** | 再発防止 |
| Phase 3（構造の是正・migration含む） | **scope外（公開後）** | 下記 |

**Phase 3 は初回公開scope外**とする（2026-08-08 確定）。migration を伴い、
**本番D1に 0010 / 0011 が未適用**（`WEB-04` / `PLAY-003` / `OPS-001`）という現状では判断材料が揃わない。
着手には PM判断 と `WEB-04` の完了が前提。

**過去棚卸取込の再設計**（`importBatchId`・日付衝突の選択・一括取消）も **scope外（公開後）**。
`store_history` が日付キーのままでは成立しないため、**Phase 3 完了後**に着手する。

なお Phase 1・2 はスプリント凍結（〜2026-08-08）との関係でも「データ損失バグの修正」として
凍結対象外と解釈できる。Phase 3 は新機能に近く PM 判断が必要という整理は上記のとおり維持する。

## 元の完了条件（成長時設計の検証）

- 対象: room result の全 snapshot 走査、同日履歴の一意性、DO の大きな単一値、
  serial な push 送信と保存期間。
- 実データ量の前提を定め、index・paging・保存上限・削除方針を設計する。

## 追加の完了条件（統合分）

- 端末を変えても、同じ店舗コードで過去の棚卸の詳細が開ける。
- 一覧（`sessions`）と詳細（明細）の参照整合性が保たれ、片方にしか出ないデータが発生しない。
- 保存失敗がユーザーに見える形で通知される。
- 新エンドポイントに他店舗の `session_id` を渡した場合の店舗境界テストを先に追加する。

## 2026-08-09 — CC第2セッション: sessionIdを履歴の正本identityにする

- 対象HEAD: `claude/branch-operational-status-2lwwwu@9a7141f`
- **migration あり**: `0012_history_session_key.sql`（**未適用**・ロールバック不能）。
  `store_history` の一意制約を `(shop_code, snapshot_date)` から `(shop_code, session_id)` へ移す。
  `session_id` を持たない行（過去取込・旧データ）は従来どおり日付で一意。
  既存行の `session_id` は `json_extract(snapshot_json, '$.sessionId')` で引き上げる。

### 直したこと

- **同日2回の棚卸が上書きされる問題（F-001）を解消**。localStorage の履歴も `sessionId` を
  キーにした（旧形式は読み込み時に移行）。サーバー側も一意制約を移した。
- **日付一致だけの local snapshot を先に採用しない**。`App.vue onViewSession` の
  「sessionIdで見つからなければ同じ日付のsnapshotを使う」fallbackを削除した。
  端末に無ければサーバーの明細から組み立てる（誤表示よりfail-closed）。
- **新旧判定を server 時刻へ移した**。`applyRemoteHistory` は `serverSavedAt`（D1 の `created_at`）で
  比較する。端末にサーバー時刻が無い＝未送信の版はリモートで潰さない。
  双方サーバー時刻を持たない旧データ同士だけ、従来どおり client 時刻で比較する。
- **削除が同日の別セッションを巻き込まない**。`DELETE /store/:code/history/:key` は
  key が sessionId ならそのセッション、日付なら `session_id IS NULL` の legacy 行だけを消す。
- **バックフィルの突き合わせを sessionId キーへ**。日付キーだと同日2件の片方を
  「送信済み」と誤判定して落としていた。

### 実行したcommandと結果

```
cd worker && npx vitest run   → 19 files / 335 tests passed
cd app    && npx vitest run   → 72 files / 634 tests passed
cd app    && npm run build    → 成功
git diff --check              → 指摘なし
```

新規テスト: `app/src/composables/useHistory.sessionKey.test.js`（15件）、
`worker/test/writeAtomicity.sqlite.test.js`、`worker/test/migrationFresh.test.js`。
Worker側は全migrationを当てた**実SQLite**で検証している（`worker/test/d1Harness.js`）。

### 未実施

- migration 0012 の適用（development / production とも）。
- 実D1での動作・計測。別端末での実機確認。
- Phase 3（データ源一本化・`LIMIT 50` 見直し・削除のサーバー側完結）は引き続き scope外。

## 状態（2026-08-10 / 第3セッション終了時）

**レビュー待ち / Claude Code。** 第1〜第3セッションの差分がこのbranchに揃った時点で
`task-list.md` の状態を `進行中` → `レビュー待ち` へ変更した。
Codex による全差分の独立レビュー前なので、`完了` にも `WEB-07` 通過にもしていない。

- 対象branch / HEAD: `claude/branch-operational-status-2lwwwu`（第3セッション作業ぶんを含む）
- 第3セッションでこのタスクのコードは変更していない。IMPORT-001 の実装（過去棚卸取込）が
  本タスクの sessionId identity と server原子性の契約に**乗る側**として追加されている。
  取込が作る session も `inventory_lines` と `store_history` を同じ `db.batch` で書く。
- 統合後の再実行結果: App 79 files / 747 tests passed、Worker 20 files / 367 tests passed、
  `npm run build` 成功。
- 未実施は上記「未実施」節のとおり（実D1・実機・migration適用）。0013 も未適用として加わる。

## Worker / D1 契約の修正（2026-08-12 / Claude Code・CCレビュー修正 第2セッション）

Codexレビューを受けた第2セッション（Worker・D1・履歴契約・削除API）の差分。App側（`app/src`）は変更していない。
状態は `進行中 / Claude Code` のまま。Codex再レビュー前なので `完了` にも `WEB-07` 通過にもしていない。

- 対象branch: `claude/worker-d1-atomicity-history-delete-eyek0c`（`07cc29f` を含む develop descendant）

### 1. 棚卸完了APIをsnapshot必須・孤児ゼロにした

| 直したこと | 実装 |
|---|---|
| snapshotを必須化 | `handleSessionComplete`。無指定は `400 snapshot_required`。明細だけ書いて表示用snapshotが無い状態＝R-001そのものを、APIとして作れなくした |
| 孤児snapshotを作らない | `sessionSnapshotStatement()` を新設。`INSERT INTO store_history … SELECT … FROM sessions WHERE id=? AND shop_code=? AND deleted_at IS NULL`。旧 `VALUES` 形式では、事前の存在確認と `db.batch` の間にセッションが消えても snapshot だけ書き込まれた |
| takenAt / snapshot.date の検証 | `parseDate` を通し、不正値は `400 invalid_date`。従来は無検証で `taken_at` 列へそのまま入っていた |
| 再送の冪等性 | 明細は貼り直し、snapshotは同じ行をupsert。`sessions` の UPDATE は同値でも1行 |
| 応答 | `{ ok, sessionId, itemCount, totalValue, snapshotSaved: true, serverRevision, serverSavedAt }` |

**Appへの影響（未対応・第3セッション以降の課題）**: `App.vue` の完了経路のうち
`setSessionEndedCallback`（`app/src/App.vue:818`）と「完了済みセッションを離れる」経路
（同 `:1314`）は snapshot を付けずに `completeSessionD1()` を呼んでいる。
本変更でこの2経路は `400 snapshot_required` になる。`_finishSession`（同 `:1234`）は snapshot を送るため影響しない。
App側を触らない指示のため未修正。**このまま統合するとApp側の2経路が壊れる**ので、
第3セッションかApp担当セッションで snapshot を載せる修正が必要。

### 2. 履歴に server revision を持たせた（migration 0014）

- `store_history` へ `revision`（`NOT NULL DEFAULT 0`）と `updated_at` を追加。
- 採番は upsert のたびに `COALESCE(MAX(revision) WHERE shop_code=?, 0) + 1`。同じ行を上書きしても必ず増える。
- `GET /history` は各行に `serverRevision` / `serverSavedAt` を含める。
  `POST /history` は保存後の `serverRevision` / `serverSavedAt` を返す。
- client の `updatedAt` / `savedAt`（端末時計）はサーバー側の新旧判定に一切使わない。
- 既存行は `revision = id` / `updated_at = created_at` でバックフィルする。

`POST /history` は**セッション行の存在を確認しない**ままにした。PIN未設定のレガシー店舗は
`/sessions`（strict Bearer）を使えず `sessions` 行を持たないため、存在を要求すると履歴保存そのものが
できなくなる。棚卸完了と過去取込だけが存在確認つきの経路を使う。**この経路からは孤児snapshotを作れる**
（F-004の残り）ため、Phase 3 の課題として残す。

### 3. 削除APIのHTTPステータス契約

- `DELETE /store/:code/movements/:id` を `resultResponse` 経由にした。従来は常に200で、
  404（不在・他店舗）も503（batch巻き戻し）も本文の差にしかならず、clientが削除失敗を検知できなかった。
- `DELETE /store/:code/history/:key` も `resultResponse` 経由にし、失敗を `503 history_delete_failed`
  （`retryable: true`）で返すようにした。削除件数 `removed` も返す。
- 404 に機械可読な `code`（`movement_not_found` / `order_not_found` / `session_not_found`）を付けた。
- `DELETE /store/:code/sessions/:id` も `resultResponse` へ揃えた（現状の戻り値は変わらない）。

### 4. 過去棚卸API

| 直したこと | 実装 |
|---|---|
| canonical snapshot をserverが生成 | `_canonicalSnapshot()`。検証済み行から `items` を含む snapshot を組み立てる。clientの `snapshot` は形だけ検証して保存しない |
| replace の許可条件 | 同じ店舗・同じ日付・`completed`・`stock` の4条件。1件でも外れたら `409 replace_not_allowed`（`reason` / `sessionId` 付き）で全体を拒否し、何も削除しない |
| replace 削除のstatement集約 | 件数によらず3文へ `IN` で集約。50件でも `IN` 50 + shop 1 = 51 bound params（上限100） |
| 同一 batchId + date の一意性 | `sessionId` を `(shop_code, batchId, date)` のSHA-256から決定的に採番（UUID v5相当）。加えて migration 0014 で `UNIQUE(shop_code, import_batch_id, started_at) WHERE import_batch_id IS NOT NULL` |
| response loss後の再送 | 決定的IDにより同じ行のupsertへ収束する |
| cancel | 変更なし（`import_batch_id` 一致のみを削除。通常棚卸・別バッチに触れない） |

### 5. validation と migration

- payload上限を **UTF-8バイト数**で判定（`jsonByteLength()` / `MAX_PAYLOAD_BYTES`）。
  旧 `JSON.stringify().length` は UTF-16 code unit 数で、日本語payloadが実バイト数の約3倍まで通っていた。
- 既定値へ黙って倒していた箇所を拒否へ変更:
  movement `type`（`'out'` 以外を全て `'in'` にしていた）、movement `orderId` と order `sessionId`
  （形式不正を `null` へ）、session `type`（不正を `'stock'` へ）、session `itemCount`（数値以外を `0` へ）。
- migration 0012 の `PRAGMA foreign_keys = OFF/ON` を `PRAGMA defer_foreign_keys = on` へ修正。
  D1 は全クエリを暗黙トランザクション内で実行するため `foreign_keys` を切り替えられない
  （2026-08-12 に[公式資料](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)で確認）。

### 検証

- `cd worker && npm test` … 21 files / 437 tests passed
- 追加した必須test:
  - snapshotなし完了の400拒否、snapshot形式不正の拒否
  - 存在確認後にセッションが消える／他店舗へ移る競合で孤児snapshotが残らない
  - batch の各statement（0〜3）への障害注入で全ロールバック
  - movement DELETE の 404 / 503 を **HTTPステータス**で確認（`src/index.test.js`）
  - 履歴upsertごとの revision 単調増加、`GET/POST /history` の `serverRevision` / `serverSavedAt`
  - 過去棚卸 snapshot に `items` が入ること
  - replace の別日・active・order・他店舗・不在の全体拒否（何も削除しない）
  - 50 replace + 500 lines の総クエリ本数（認証2本込みで50以下）と bound parameter 100以下
  - 同一 batchId + date の並行要求で session 1件、response loss相当の再送で重複なし
  - データ入り 0011 相当DBからの 0012〜0014 更新（`test/migrationUpgrade.test.js`）

### 未実施・残risk

- **remote D1 への migration 適用は行っていない**（0012 / 0013 / 0014 とも未適用）。
- 実D1での計測は未実施。`batch` 内 statement が invocation あたりの query 数へどう数えられるかは
  公式資料に明記がないため、引き続き厳しい側（1 statement = 1 query）を仮定している。
- App側2経路の `snapshot_required` 破れ（上記1）。
- `POST /history` 経由の孤児snapshot（上記2）。

## Worker / D1 / API整合性の修正（2026-08-16 / Claude Code・第1修正セッション）

Codexレビューで指摘された、Workerの完了処理・過去棚卸置換・HTTP status・revision応答・
migration文書の問題を修正した。`app/src/**` は変更していない（差分ゼロ）。
状態は `進行中` → `レビュー待ち / Claude Code`。Codex再レビュー前なので `完了` にも `WEB-07` 通過にもしていない。

- 基準commit: `develop@e095282`（ancestor確認済み）／ branch `claude/data-002-worker-d1-api-bogzyq`
- Cloudflare公式資料の確認日: **2026-08-16**
  - [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) —
    bound parameters 100 / statement 100,000 bytes / query 30秒 /
    queries per invocation Free 50・Paid 1,000 / row 2 MB。
    「Limits for individual queries apply to each individual statement contained within a batch statement」
    という記述は今も *individual query* の制限についてのみで、**invocationあたりの本数の数え方には触れていない**。
    実装は従来どおり厳しい側（1 statement = 1 query）を仮定している。
  - [D1 batch()](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) —
    「Batched statements are SQL transactions」「each statement in the list will execute and commit,
    sequentially, non-concurrently」「An array of D1Result objects … in the array position corresponding to
    the array position of the initial prepare statement」。**読み戻しSELECTを同じbatchへ入れる根拠**。
  - [D1 return object](https://developers.cloudflare.com/d1/worker-api/return-object/) —
    `success` / `meta` / `results`。`meta.changes` は変更行数。
  - [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) —
    公式は `d1_migrations` table方式。本repositoryはsentinel方式なので `scripts/migrate.sh` と実schemaを照合する。
  - [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) —
    bodyを読む前にサイズ上限を課す、`try...catch` と適切なHTTP statusで返す。
- `@cloudflare/workers-types`: **インストールされていない**。`worker/package-lock.json` に現れるのは
  `wrangler@3.114.17` の *optional peerDependency*（`^4.20250408.0`）としてのみで、
  `worker/node_modules/@cloudflare` は存在しない。本projectは型なしJSのため、採用APIは
  types定義ではなく上記公式資料と実SQLite testで裏づけている。

### 修正前に失敗を確認したtest

新規3ファイル 42件のうち **25件**が修正前の実装で失敗した（内訳: `sessionContract` 16 / `pastImportIdempotency` 8 /
`routerStatus` 1）。主な失敗理由:

| test | 修正前の挙動 |
|---|---|
| snapshotのcanonical化・不一致拒否 | clientの `itemCount` / `totalValue` / `sessionId` / `items` をそのまま保存していた |
| `empty_inventory` | inventory 0件でも `snapshotSaved: true` で完了できた |
| order完了 | `400 snapshot_required` で**完了できなかった**（在庫入力を伴わないため） |
| completed→active | 409にならず、`status='active'` / `ended_at=NULL` / `item_count` が巻き戻った |
| replace再送 | 置換対象が削除済みのため `409 replace_not_allowed / not_found` |
| replace TOCTOU | preflight後にactiveへ戻ったsessionを削除できた |
| `POST /sessions` 不正type | HTTP **200** で `{_status:400}` が本文に露出 |
| revision読み戻し | batch外の独立SELECTのため、別要求のrevisionを返しうる／失敗時も成功していた |

### 1. session type別の完了契約（確定）

調査した経路: `sessions.type`（migration 0007）、`handleSessionComplete` → `inventoryLineStatements` →
`inventory_lines`、`orders` / `order_lines`（`handleOrderCreate`）、`handleSessionsGet` /
`handleSessionLinesGet`、App の `_finishSession` / `SessionListPage.completedSessions`。

**決め手**: App の完了一覧は `s.status === 'completed' && (s.type ?? 'stock') !== 'order'` で
**order sessionを除外している**。発注の詳細は `orders` / `order_lines` から読む。
つまり order に `store_history` を持たせる読み手が現状どこにも無い。

#### stock

| 項目 | 契約 |
|---|---|
| 要求 | `{ inventory, prices, takenAt?, snapshot }`。`snapshot` 必須（無ければ `400 snapshot_required`） |
| canonical化 | `sessionId` / `date` / `type` / `items` / `itemCount` / `totalValue` / `savedAt` は**server が検証済みinventory rowsから決める**。client値は採らない |
| 不一致 | `qty` を持つ品目の集合が明細行と一致しなければ `400 snapshot_mismatch`（**何も書かない**）。数量・単位・単価・小計は行の値で上書き（正規化）。`qty: null` の未入力品目は表示のため残す |
| 0件 | `400 empty_inventory`。明細もitemsも無い「完了」は R-001 そのもの |
| 任意metadata | allowlistのみ。`entryLog` / `auditLog` 各500件、`participants` 50件、`flaggedItems`、`activeMs`、`axisNames`、`locked`。leaf は型と長さで切る。`dirty` / `synced` / `serverRevision` などは捨てる |
| 応答 | `{ ok, sessionId, type:'stock', itemCount, totalValue, snapshotSaved:true, serverRevision, serverSavedAt }` |
| `snapshotSaved` | 有効なsnapshotが実際に保存された場合だけ `true` |

#### order

| 論点 | 決定 |
|---|---|
| `store_history` | **保存しない**。架空のmarker snapshotも作らない |
| canonical detail | `orders` / `order_lines`（`POST /store/:code/orders`） |
| listの `itemCount` | **client値（検証済み・0〜500）**。発注明細は別経路で冪等に書かれるため、完了を `order_lines` の到着に依存させると未送信キューが残っている間だけ完了できなくなる |
| detail表示 | 従来どおり `orders` から。完了一覧には出さない（App既存の除外を維持） |
| retry | 単一UPDATEで冪等 |
| 既存order sessionとの互換性 | 影響なし。`store_history` を持たないのは従来どおりで、schema変更も不要 |
| 誤送信 | `snapshot` または空でない `inventory` は `400 snapshot_not_allowed` |
| 応答 | `{ ok, sessionId, type:'order', itemCount, snapshotSaved:false }` |

#### 状態遷移

`PUT /store/:code/sessions/:id` は `completed` から戻さない。単一UPDATE文の
`WHERE ... AND status <> 'completed'` が判定を持つ（後続SELECTは404と409の区別だけに使い、権限判定には使わない）。

- `completed` → `active` / `incomplete` … `409 session_completed`。明細・snapshot・`ended_at` は保たれる
- `completed` → `completed` … 冪等に200
- 不在・他店舗 … 404（存在を漏らさない）

### Appへの引継ぎ（このセッションではApp を編集していない）

`app/src` は担当外のため未修正。**次のAppセッションで必ず対応が必要**な3点。

1. **`App.vue:859` `setSessionEndedCallback`** — `completeSessionD1(count, { inventory, prices })` を
   snapshot なしで呼んでいる。stock では `400 snapshot_required` になる。
   ホスト自身の完了は `_finishSession` が snapshot 付きで送るため、この経路は
   **snapshot を載せる**か、ホスト自身の場合は呼ばない形にする。
2. **`App.vue:1381` `onGoHome` の完了済み経路** — 同上。snapshot なしで `completeSessionD1` を呼んでいる。
3. **order モードの完了** — `_finishSession` は order でも
   `{ inventory, prices, snapshot }` を送る。`buildSnapshot` は `inventory` が空だと `null` を返すため、
   発注のみのセッションは `snapshot: null` → `400 snapshot_required` になる。
   `sessionMode === 'order'` では `{ itemCount }` だけを送る形へ分岐する。

送るべきpayload例:

```js
// stock（従来どおり。snapshot.items は inventory の全行を含むこと）
await completeSessionD1(count, {
  inventory: { ...inventory },
  prices: config.prices ?? {},
  takenAt: '2026-08-16',
  snapshot,                       // buildSnapshot(...) の戻り値
})
// → { ok, sessionId, type:'stock', itemCount, totalValue, snapshotSaved:true, serverRevision, serverSavedAt }

// order
await completeSessionD1(count, { itemCount: Object.keys(orderDraft.value).length })
// → { ok, sessionId, type:'order', itemCount, snapshotSaved:false }
```

`useSession.complete()` の「`payload.snapshot` があるのに `snapshotSaved !== true` なら失敗扱い」は
そのままで正しい（order では `payload.snapshot` が無いので判定に入らない）。
`useAuth.completeSession()` は `{ inventory, prices, takenAt, snapshot }` を固定で送るため、
**order 用に `{ itemCount }` を送れる引数追加が必要**。

`touch()` / `markActive()` の遅延送信は完了後に `409 session_completed` を受けるが、
どちらも `.catch(() => {})` しているため表示への影響はない（＝意図どおり無視される）。

### 2. 過去棚卸replaceのidempotency（migration 0015・未適用）

**新規migration `0015_import_replay.sql`**。既存migrationは書き換えていない。適用も行っていない。

- 台帳 `import_batch_requests`。PRIMARY KEY は `(shop_code, batch_id, import_date)`。
  `fingerprint` は「日付・検証済み明細・上書き対象集合（順序非依存）」の SHA-256。
- 台帳があり指紋一致 → 前回と同じ成功をそのまま返す（`replay: true`）。
  **置換対象が既に削除済みでも 409 にしない。**
- 台帳があり指紋相違 → `409 import_intent_conflict`。既存の取込を黙って書き換えない。
- 台帳の INSERT は取込本体と**同じ batch**。並行した同一要求は PRIMARY KEY 違反で片方が
  batch ごと巻き戻り、台帳を読み直して同じ成功へ収束する。
- 「既存batchを見つけたら検証を省略する」ではない。payload検証は従来どおり全て通り、
  **指紋が要求全体の同一性を保証**している。
- 同じ `batchId` の**別日付**は設計上の別要求単位（1リクエスト=1日）なので通る。
- 取消（`DELETE /imports/:batchId`）は台帳行も同じ batch で消す。
  消さないと、取り消したバッチの再取込が「replay」と判定されて何も書かなくなる。
- 台帳を持たない旧データ（0015適用前の取込）は従来どおり upsert で貼り直す（後方互換）。

### 3. replace authorizationのTOCTOU

- preflight SELECT は**理由つき409を返すためだけ**に残し、削除権限の根拠から外した。
- 唯一の許可条件を SQL の真偽式にした:
  「指定IDのうち 同店舗・同日・`completed`・`stock` を満たすものが**ちょうどN件**」。
- これを session作成・台帳INSERT・削除3文の**すべての WHERE へ埋めた**。
  明細DELETE / 明細INSERT / snapshot は「1)が実際に走ったか」を `sessions.ended_at`（この要求の時刻）で
  参照して従属させている。
- **batch内の順序が契約の一部**: guard は対象件数を数えるため、対象を先に DELETE すると
  guard 自身が false になる。guard を評価する文をすべて DELETE より前に置いている。
- 結果は二択のみ。guard成立＝全部適用／guard不成立＝**全文0行**（`409 replace_not_allowed` /
  `reason: target_changed`）。「条件つきDELETEをcommitしてから `changes` を見る」方式は採っていない。
- 取込先自身を上書き対象に指定した場合は `409 replace_not_allowed / self_replace`
  （作ったsessionを同じbatchのDELETEが消して明細だけ宙に浮くため）。
- **`MAX_REPLACE_SESSIONS` を 50 → 40 へ変更**。guard がID一覧をもう一度参照するので
  1文あたり `2N + 4 ≦ 100`（bound parameter上限）→ N ≦ 48。余白を見て40。
  超過は書き込み前に `400 invalid_replace`。

### 4. HTTP status伝播

`POST /store/:code/sessions` を `jsonResponse(..., 200, ...)` から `resultResponse` へ変更した。
`resultResponse` が `_status` を本文から削除する。他の `jsonResponse(await handler(...), 200, ...)`
call site（config/inventory/history GET、room PUT、orders/movements GET、store create、sessions GET）は
`_status` を返しうる handler ではないことを確認済み。

### 5. revision acknowledgement

- `readHistoryStamp()`（batch後の独立SELECT）を廃止し、`historyStampStatement()` / `readStampResult()` へ置換。
  読み戻しSELECTを**書き込みと同じ `db.batch()`** の最後に入れる。
- 対象call site: `handleSessionComplete`、`handlePastImportCreate`、`handleHistoryPost`（3か所すべて修正）。
- `RETURNING` は使っていない。D1公式資料に明記が無いため、明記のある
  「batch = 1トランザクション・statement順に実行・位置対応のD1Result」だけに依存した。
- 読み戻せない場合は `serverRevision: null` で成功させず、`503`（`retryable: true`）を返す。
  batchが落ちれば読み戻しごと巻き戻る。
- 回帰テスト: `h.onNextBatch()` で**旧standalone SELECTの位置に競合writeを注入**し、
  応答の `serverRevision` が自分の行の値（42）と一致することを確認している。

### 6. migration 0014 / 0015 の文書反映

`scripts/migrate.sh` は 0014 を列挙済みだったが、リリース手順側から欠落していた。

| 文書 | 修正 |
|---|---|
| `web-release-readiness.md` | `WEB-04` の対象を 0010〜0015 へ。`migrate.sh` の列挙範囲を0001〜0015へ。公開手順3にsentinel一覧とTime Travel確認、手順4に適用順・rollback可否表・後方互換を追記 |
| `api-design.md` | 完了API §3.1 を stock / order 別の契約へ書き直し、状態遷移を追記。`sessions` / `imports` / `history` の contract表、未適用migration一覧、取込spec（原子guard・台帳・上限40）を更新 |
| `project-status.md` | 0014 / 0015 を未適用として追記 |
| `task-list.md` | 「migration 0012・0013とも本番未適用」→「0012〜0015はいずれも本番未適用」 |

`scripts/migrate.sh` へ `apply_if_missing 0015_import_replay.sql import_batch_requests` を追加した
（列挙testが全migration fileとの一致を検査する）。dated audit・履歴snapshot・`docs/export/` は編集していない。

### 付随修正

- `accountDeletion.js` の削除対象へ `import_batch_requests` を追加（店舗の業務データのため・PLAY-001の削除範囲）。
- `test/d1Harness.js`: batch内のSELECTが `results` を返すようにした（D1のbatch戻り値の再現）。
  `seedSession()` / `seedToken()` を追加。

### 実行したcommandと結果

| command | 結果 |
|---|---|
| `npm --prefix worker ci` / `npm --prefix app ci` | 成功（`node_modules` が未インストールだったため実施） |
| `npx vitest run test/sessionContract.sqlite.test.js test/routerStatus.sqlite.test.js test/pastImportIdempotency.sqlite.test.js`（**修正前**） | **25 failed / 17 passed（42）** |
| 同（修正後） | 42 passed（3 files） |
| `npm --prefix worker test` | **24 files / 481 tests passed** |
| `npm --prefix app test -- --run` | **87 files / 875 tests passed** |
| `npm --prefix app run build` | 成功 |
| `git diff --check` | 指摘なし |
| `git diff --name-only -- app/src` | **出力なし（App差分ゼロ）** |

### 未実施・残risk

- **migration は local / remote とも適用していない**（0012〜0015すべて未適用）。
- 実D1での動作・statement数・実行時間の計測は未実施。`batch` 内statementが
  invocationあたりのquery数へどう数えられるかは公式資料に明記が無いため、
  引き続き厳しい側（1 statement = 1 query）を仮定している。
- 実browser / 実機での確認は未実施。
- **App側3経路（上記「Appへの引継ぎ」）は未修正**。このWorker差分だけを統合すると、
  `session_ended` 経由の完了・完了済みセッションからのホーム遷移・発注セッションの完了が
  400 になる。App セッションとセットで統合すること。
- `POST /history`（soft auth・legacy店舗用）は従来どおりセッション行の存在を確認しない。
  この経路からは孤児snapshotを作れる（F-004の残り）。Phase 3の課題として据え置き。
- `_snapshotMeta` は `auditLog` / `entryLog` を500件で切る。500件を超える変更履歴を持つ
  棚卸では、古い側が履歴snapshotから落ちる（明細そのものは `inventory_lines` に全件残る）。

## 再レビュー指摘の修正（2026-08-17 / Claude Code・第1修正セッション 追加分）

`38cf1cc` を基準にした追加差分。既存commitのamend / reset / rebaseはしていない。
`app/src/**` は変更していない（差分ゼロ）。状態は `進行中` → `レビュー待ち / Claude Code`。

- 基準commit: `38cf1cc`（ancestor確認済み・開始時 worktree clean）／ branch `claude/data-002-worker-d1-api-bogzyq`
- Cloudflare公式資料の再確認日: **2026-08-17**（前回2026-08-16から変更なし）
  - [D1 batch()](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) —
    「Batched statements are SQL transactions」「If a statement in the sequence fails …
    it aborts or rolls back the entire sequence」「execute and commit, sequentially, non-concurrently」。
    **claim を batch 先頭に置き、以降の全文を従属させる設計の根拠**。
  - [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) — bound params 100 /
    statement 100,000 bytes / query 30秒 / invocation Free 50・Paid 1,000 / row 2MB。
  - [D1 SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/) —
    **`RETURNING` の可否は今も記載なし**。トランザクション文（BEGIN/COMMIT）の可否も記載なし。
    したがって `RETURNING` は使わず、読み戻しは同一 batch 内の SELECT だけに依存する。
  - [D1 return object](https://developers.cloudflare.com/d1/worker-api/return-object/) — `success` / `meta.changes` / `results`。
- `@cloudflare/workers-types`: **インストールされていない**（前回と同じ）。`wrangler@3.114.17` の
  optional peerDependency `^4.20250408.0` として lockfile に現れるだけで、
  `worker/node_modules/@cloudflare` は存在しない。型なしJSのため、採用APIは公式資料と実SQLite testで裏づける。

### 修正前に失敗を確認したtest

新規2ファイル + 既存1ファイルの追加分、計41件のうち **23件**が `38cf1cc` で失敗した
（`completionClaim` 14 / `ledgerLifecycle` 8 / `accountDeletion` 1）。

| 指摘 | 修正前の挙動 |
|---|---|
| §1 汎用PUT | active stock へ `status:'completed'` を送るだけで completed にでき、lines も history も無い完了を作れた |
| §2 棚卸日 | `takenAt=08-09` / `snapshot.date=08-10` が両方通り、明細と履歴が別日になった |
| §3 上書き | 完了後に別内容の complete を送ると、明細・snapshot・件数・合計・revision を差し替えられた |
| §4 時刻marker | 同一ミリ秒の別要求が `ended_at === now` を満たし、409 側の lines/snapshot が残りえた |
| §5 stale ledger | session や history を消しても台帳が残り、replay が `200 / snapshotSaved:true` を返した |
| §6 account削除 | 台帳行を seed していなかったため、削除範囲が test で固定されていなかった |

### 1. 汎用PUTから完了契約を迂回させない

`handleSessionUpdate` は `active` / `incomplete` への更新だけを扱う。

| 遷移 | 結果 |
|---|---|
| active / incomplete → `completed` | **409 `use_complete_endpoint`**。session / lines / history を一切変更しない（この経路では書き込みを1文も発行しない） |
| completed → `completed` | 何も変更せず冪等に 200 |
| completed → active / incomplete | 409 `session_completed`（従来どおり） |
| 不在 / 他店舗 | 404（IDの実在を漏らさない） |

完了は必ず `POST /sessions/:id/complete` を通る。

### 2. 棚卸日を一意にする

canonical 日付は検証済み `takenAt` ひとつ。

- `snapshot.date` 省略 → canonical 日付を使う
- `snapshot.date` が canonical と不一致 → **400 `snapshot_date_mismatch`**（書込み0件）
- `snapshot.date` が不正な日付 → 従来どおり 400 `invalid_date`

保存後は `sessions` / `inventory_lines.taken_at` / `store_history.snapshot_date` /
snapshot JSON の `date` / 応答の `date` / 一覧 / 詳細がすべて一致する。

### 3. 完了は最初の1要求だけが確定できる（migration 0016・未適用）

**新規migration `0016_completion_claims.sql`**。既存migrationは書き換えていない。適用もしていない。

- claim table `session_completions`。PRIMARY KEY は `(shop_code, session_id)`。
- fingerprint は **server が検証した値だけ**から作る canonical intent の SHA-256:
  `type` / canonical日付 / `itemCount` / `totalValue` / 検証済み明細行。
  **client が送る fingerprint は受け取らない。**
- 任意 metadata（`entryLog` / `auditLog` / `activeMs` など）は **fingerprint に含めない**。
  `activeMs` は再試行のたびに増えるため、含めると正当な再送まで別 intent と判定されてしまう。
- 挙動:
  - 同一 intent の再送 → 保存済み結果（`replay: true`）
  - 数量・単価・日付・明細・件数・合計が違う再送 → **409 `completion_intent_conflict`**。
    既存の lines / snapshot / itemCount / totalValue / endedAt / revision は不変
  - order は同じ `itemCount` の再送だけ冪等成功、違えば 409
- **0016 適用前に完了した session** は claim を持たないため、同じ内容でも
  `409 completion_intent_conflict`（`reason: already_completed`）で fail-closed。
  推測で fingerprint を作らない（当時の要求と同一である保証がないため）。

### 4. 採用した atomic guard と fingerprint 設計（§3 / §4 共通）

**「claim を先に取り、以降の全文をその claim へ従属させる」** 一本の形にそろえた。

| 経路 | claim table | claim key | guard 条件 |
|---|---|---|---|
| 棚卸完了 | `session_completions`（0016） | `(shop_code, session_id)` | `status <> 'completed'` を満たす session が存在すること |
| 過去取込 | `import_batch_requests`（0015） | `(shop_code, batch_id, import_date)` | 上書き対象が「同店舗・同日・completed・stock」でちょうどN件 |

- claim の INSERT は **batch の先頭**。PRIMARY KEY により1トランザクションで1要求しか取れない。
- 以降の UPDATE / DELETE / INSERT / snapshot は、すべて
  `EXISTS (claim WHERE … AND fingerprint = ?)` へ従属する。claim を取れなかった側は1行も書けない。
- **`ended_at === now` の時刻 marker を廃止した**（§4）。ミリ秒精度の時刻は排他的 token にならず、
  同じミリ秒の別要求が同じ marker を満たす。server 生成 fingerprint を持つ claim 行なら
  同一ミリ秒でも勝者が一意に決まる。
- bound parameter は、`sessions s` と相関する EXISTS にすることで **fingerprint の1個**しか増えない。
  `INVENTORY_ROWS_PER_STATEMENT` は `rowsPerStatement(5, 4) = 19` で従来と同値。
- 件数 guard を評価するのは取込台帳の INSERT **1文だけ**になったため、ID一覧の二重参照が消えた。
  これに伴い `MAX_REPLACE_SESSIONS` を **40 → 50 へ戻した**（前回は旧guard形状のため下げていた）。

実測（`test/d1Harness.js` の counters・batch内statementも1本ずつ数える厳しい側）:

| 経路 | queries | maxBoundParams |
|---|---:|---:|
| 完了 1品目 | 9 | 9 |
| 完了 150品目 | 16 | 99 |
| 完了 351品目 | 27 | 99 |
| 完了 500品目 | 35 | 99 |
| 取込 500行 + replace 50件 | 38 | 99 |

認証2本を足しても Free の 50 / bound parameter 100 に収まる。

### 5. stale ledger / claim で偽の成功を返さない

- 取込の replay 成功には、台帳の指紋一致に加えて **session（同店舗・同batch・未削除）と
  `store_history` の両方が存在すること**を要求する。欠けていれば
  **409 `import_record_missing`**（fail-closed）。`snapshotSaved: true` を返さない。
- 完了の replay も同様。claim はあるのに `store_history` が無ければ
  **409 `completion_record_missing`**。
- 発生源そのものを塞いだ:

| 操作 | 変更 |
|---|---|
| `DELETE /sessions/:id` | session だけを消していたのを、`inventory_lines` / `store_history` / 取込台帳 / 完了claim / session の**5文を1 batch**へ。孤児（F-004）も同時に解消。失敗は 503 `session_delete_failed`（retryable）で全体rollback |
| `DELETE /history/:sessionId` | 対応する取込台帳の行も同じ batch で削除。日付キー（legacy行）指定時は従来どおり `session_id IS NULL` の行だけ |
| `DELETE /imports/:batchId` | 台帳に加えて、そのバッチの session に紐づく完了claimも削除 |
| `DELETE /auth/account` | `session_completions` を削除対象へ追加 |

すべて `shop_code` で絞るため、**別店舗の台帳・claim は残る**（testで固定）。
復旧経路: 取込は `DELETE /imports/:batchId` → 再取込。完了は session 削除 → やり直し。

### 6. account deletion のtestと契約

- `accountDeletion.test.js` の seed / 検証 table 一覧へ `import_batch_requests` と
  `session_completions` を追加。対象店舗と別店舗の両方に行を作り、
  **対象店舗だけが消え、別店舗は残る**ことを固定した。batch途中失敗のrollback testも同じ行を含む。
- `account-deletion-contract.md` の Data map へ2 tableを追加し、release evidence 節へ
  「両店舗をseedして固定する」を明記した。

### 7. migration 切替境界

`web-release-readiness.md` の公開手順へ次を追加した。

- preflight で `SELECT COUNT(*) AS n FROM sessions WHERE import_batch_id IS NOT NULL` を数える。
- 0015 適用前の取込バッチ（台帳なし）と 0016 適用前の完了 session（claimなし）の影響と許容判断を表で明記。
- **推測で fingerprint を作らない**（自動 backfill を行わない）ことを明記。
- **maintenance条件**: migration 適用〜Worker deploy の窓では、旧Workerが台帳・claim を書かないまま
  取込・完了を処理できるため、**この間は過去棚卸取込と棚卸完了を行わせない**。
  窓の書き込みはデータとしては正しく保存され、復旧作業は不要（次回要求から記録が始まる）。
- legacy batch の挙動は `test/ledgerLifecycle.sqlite.test.js` の
  「台帳を持たない legacy batch」で固定した（replay ではなく通常の upsert として処理する）。

### 8. 現行文書のmigration記載

| 文書 | 修正 |
|---|---|
| `docs/ci-cd.md` | 「本番0010/0011は未適用」→ 0010〜0016、適用順、0012の不可逆点、0015/0016のmaintenance条件 |
| `docs/spec.md` | schemaの正を0001〜0016へ。`import_batch_requests` / `session_completions` を table一覧へ追加。「migration 0010/0011」→ 0010〜0016 |
| `docs/quality-foundation/README.md` | blocker列挙の「0010/0011」→「0010〜0016のmigration」 |
| `docs/api-design.md` | §1/§2/§3の契約、PUT/DELETE/complete/history delete/取込のcontract表、未適用migration一覧、WEB-001 known gap、`MAX_REPLACE_SESSIONS` 50 |
| `docs/quality-foundation/account-deletion-contract.md` | Data map に2 table追加、release evidence、最新照合日 |
| `docs/quality-foundation/web-release-readiness.md` | WEB-04を0010〜0016へ、preflight sentinelに0016と取込件数、適用順・rollback表に0016、**切替境界の節を新設** |
| `docs/roadmap.md` | 公開手順の「本番D1 0010/0011」→ 0010〜0016 |

dated audit（`audit-2026-07-25.md` / `data-safety-audit.md`）、`docs/export/`、
履歴snapshot（`quality-foundation/project-status.md`）、Google Play系は編集していない。

### 実行したcommandと結果

| command | 結果 |
|---|---|
| 新規/追加test（**修正前**・`38cf1cc`） | **23 failed / 18 passed（41）** |
| `npx vitest run test/completionClaim.sqlite.test.js test/ledgerLifecycle.sqlite.test.js` | 30 passed |
| `npx vitest run test/pastImportIdempotency.sqlite.test.js` | 14 passed |
| `npx vitest run src/accountDeletion.test.js` | 11 passed |
| `npx vitest run test/migrationFresh.test.js test/migrationUpgrade.test.js test/migrationScript.test.js` | 3 files / 20 passed |
| `npx vitest run test/routerStatus.sqlite.test.js` | 5 passed |
| `npm --prefix worker test` | **26 files / 511 tests passed** |
| `npm --prefix app test -- --run src/App.complete.test.js` | 13 passed |
| `npm --prefix app test -- --run` | **87 files / 875 tests passed**（`App.authLoss.test.js` / `App.complete.test.js` を含め **timeoutは再現しなかった**） |
| `npm --prefix app run build` | 成功 |
| `git diff --check` | 指摘なし |
| `git diff --name-only -- app/src` | 出力なし |

### 未実施・残risk

- **migration は local / remote とも適用していない**（0012〜0016すべて未適用）。
- 実D1での計測は未実施。上の queries / boundParams は実SQLiteハーネスの値。
  `batch` 内 statement が invocation あたりの query 数へどう数えられるかは公式資料に明記が無く、
  引き続き厳しい側（1 statement = 1 query）を仮定している。
- 実browser / 実機確認は未実施。
- **App側の追随が未了**（第2セッションへ引継ぎ）。前回記録の3経路に加え、今回の変更で次が加わる。
  1. `App.vue:859` `setSessionEndedCallback` — snapshot なしの `completeSessionD1`
  2. `App.vue:1381` `onGoHome` の完了済み経路 — 同上
  3. order モードの完了 — `{ itemCount }` を送る形へ分岐（`useAuth.completeSession()` に引数追加）
  4. **`snapshot.date` と `takenAt` を必ず一致させる**。`buildSnapshot` は `date` を当日で埋めるので、
     `takenAt` を省略するか同じ値を送る（不一致は 400 `snapshot_date_mismatch`）
  5. **409 `completion_intent_conflict` / `use_complete_endpoint` の扱い**。前者は「別内容で完了済み」で
     再試行しても解消しない（retryable: false）。未送信キューへ戻さず、詳細を再取得して表示する。
     後者は `updateSession(id,'completed')` 経路が残っていれば取り除く
- `POST /history`（soft auth・legacy店舗用）は従来どおりセッション行の存在を確認しない。
  この経路からは孤児snapshotを作れる（F-004の残り）。Phase 3 の課題として据え置き。
- 完了 claim を消す経路は session 削除だけ。`DELETE /history/:sessionId` は claim を残すため、
  history を消した完了済み session は `409 completion_record_missing` になり、
  同じ session では復旧できない（session を削除してやり直す）。意図的な fail-closed。

## 再レビュー HIGH 2件の修正（2026-08-17 / Claude Code・追加分2）

`1d3cbfa` を基準にした追加差分。`app/src/**` は変更していない。

### 修正前に失敗を確認したtest

追加した回帰test 13件が `1d3cbfa` で失敗した
（`completionClaim` 10 / `ledgerLifecycle` 2 / `routerStatus` 1）。

### HIGH 1: 完了 fingerprint が snapshot の一部しか見ていなかった

`_completionFingerprint` は「種別・日付・件数・合計・明細行（品目名・数量・単位・単価・小計）」
だけを見ていた。保存対象なのに指紋へ入っていない項目があると、その項目だけを変えた再送が
**replay 成功**になり、**サーバーは旧内容・端末は新内容**という食い違いを作る。

指紋から漏れていた保存対象:

| 種別 | 項目 |
|---|---|
| items のラベル列 | `code` / `flagged` / `category` / `lotSize` / `prevMonth` / `tagA` / `tagB` |
| snapshot metadata | `entryLog` / `auditLog` / `participants` / `flaggedItems` / `axisNames` / `locked` |

**修正**: 指紋の対象を「保存する canonical snapshot **そのもの**」へ変えた。
保存対象が増えても指紋が自動的に追随する。

**意図的に除外する鍵は2つだけ**（`FINGERPRINT_EXCLUDED_SNAPSHOT_KEYS`）。

| 鍵 | 除外理由 |
|---|---|
| `savedAt` | server 時刻。要求のたびに必ず変わるため、含めると再送が常に別 intent になる |
| `activeMs` | 端末の計測時間。完了に失敗して同じ画面から再試行すると増えるため、含めると正当な再送が 409 になる。表示用の参考値で、棚卸の記録内容そのものではない |

これ以外は**すべて含める**。除外を追加する場合は上記と同じ水準の理由を明記すること。

### HIGH 2: 0015以前の台帳なし取込を別内容で黙って上書きできた

`existing && !ledger`（session はあるが台帳が無い）で、そのまま upsert していた。
0015 適用前に旧Workerが書いたバッチや、`DELETE /history/:sessionId` で台帳だけが消えた状態で、
**取り込み済みの内容を別内容へ黙って差し替えられた**。

**修正**: `409 legacy_import_unverified`（`retryable: false`）で fail-closed。

- 台帳が無いと「前回と同じ要求か」を判定する材料が無い。明細から fingerprint を再計算しても
  当時の要求と同一である保証がないため、**推測で replay 成功にしない**。
- 並行して届いた同一要求が直前に台帳を確定させた場合は legacy ではないので、
  `_resolveRacedLedger` を先に通してから legacy 判定へ落とす。
- 復旧経路は **`DELETE /imports/:batchId` で明示的に取り消してから再取込**の一本。
  同じバッチの**別日付**は影響を受けない。
- 副次: `DELETE /history/:sessionId` 後の再取込も、この経路で 409 になる。
  「history を消したら直接再取込できる」という前回の記述は取り下げ、
  **stale 状態からの復旧はすべて cancel 経由**に統一した（testも更新済み）。

### 合わせて直した項目

| 項目 | 内容 |
|---|---|
| 文書矛盾 | `web-release-readiness.md` の切替境界が「操作停止が必須」と「発生しても許容」を並記していた。**必須条件であり選択肢ではない**と明記し、窓の間に発生した場合の扱いを「事後対応であって事前の許可ではない」表に分離した |
| 0010〜0016の記載同期 | `api-design.md` / `spec.md` の `Last verified` を 2026-08-17 / 現branch（0016まで・本番未適用）へ。`web-release-readiness.md` に最新照合行を追加 |
| router test | 新しい 409/400 が HTTP でも正しく返り、本文へ `_status` が漏れないことを `test/routerStatus.sqlite.test.js` へ追加（`use_complete_endpoint` / `session_completed` / `snapshot_date_mismatch` / `completion_intent_conflict` / replay 200 / `legacy_import_unverified` / `import_intent_conflict`） |

### 実行したcommandと結果

| command | 結果 |
|---|---|
| 追加した回帰test（**修正前**・`1d3cbfa`） | **13 failed** |
| `npm --prefix worker test` | **26 files / 534 tests passed** |
| `npm --prefix app test -- --run` | 87 files / 875 tests passed |
| `npm --prefix app run build` | 成功 |
| `git diff --check` | 指摘なし |
| `git diff --name-only -- app/src` | 出力なし |

### Appへの引継ぎ（追加分）

前回の5点に加えて、次を扱う必要がある。

6. **`409 legacy_import_unverified`** — 過去棚卸取込で、内容を保証できない既存取込があるときに返る。
   再試行では解消しない。「先に取込を取り消してください」と案内し、
   `DELETE /imports/:batchId` → 再取込の導線を出す。
7. **完了の再送は snapshot を1文字も変えずに送る**。`category` / `code` / `auditLog` などを
   変えて再送すると `409 completion_intent_conflict` になる。
   完了失敗後に内容を編集した場合は「別の内容として完了し直す」ことになり、
   同じ sessionId では確定できない（session を作り直す導線が要る）。
   `activeMs` だけは変わってもよい。

## 独立レビュー指摘の修正（2026-08-17 / Claude Code・追加分3）

`e9b1dbe` を基準にした追加差分。`app/src/**` は変更していない。
第2セッション（App完了処理・同期キュー）と第3セッション（CSV・過去棚卸取込UI）の差分には触れていない。

- Cloudflare公式資料は 2026-08-17 に確認済み（本セッション内で再取得）。
  [D1 batch()](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) の
  「Batched statements are SQL transactions」「execute and commit, sequentially, non-concurrently」
  「D1Result 配列は prepare した順に対応」が、今回の cancel 修正（SELECT を batch 先頭へ）の根拠。
  `RETURNING` は今も公式に記載が無いため使用しない。

### 修正前に失敗を確認したtest

追加した回帰test のうち **6件**が `e9b1dbe` で失敗した（すべて `test/ledgerLifecycle.sqlite.test.js`）。

| test | 修正前の挙動 |
|---|---|
| 通常棚卸を置換すると、旧 `session_completions` も消える | 旧 claim が孤児として残った |
| 取込済みを別 batch で置換すると、旧 `import_batch_requests` も消える | 旧台帳が残り、旧バッチ再送が `import_record_missing` になった |
| batch のどの位置で失敗しても部分状態にならない | 削除文が増える前提の検査で落ちた |
| 上限件数の replace で query / bound parameter が上限内 | 同上 |
| 事前処理後・batch 開始前に確定した取込も削除し件数に含める | `removed: 0` / `sessionIds: []` を返した |
| cancel の batch のどこで失敗しても元のまま | 事前 SELECT が `cancel_failed` の catch 対象外だった |

### HIGH: replace で旧 claim・旧台帳が残る

上書き対象について、同一 transaction 内で **5種類**を削除するようにした（旧実装は前3つだけ）。

1. `inventory_lines`
2. `store_history`
3. `session_completions`（新規）
4. `import_batch_requests`（新規）
5. `sessions`

維持している条件:

- `shop_code` で対象店舗を限定し、`session_id` / `id IN replaceIds` で対象を限定
- 5文すべてを新しい取込要求の claim guard（台帳 EXISTS + fingerprint）に従属させる
- **session 本体より先に**関連 claim・台帳を削除する
- 作成中の新しい `import_batch_requests` は対象にならない
  （その `session_id` は新セッションで、`self_replace` 拒否により `replaceIds` に入らない）
- guard 失敗時は全 statement が0件。batch 途中失敗は全体 rollback
- 件数によらず5文へ集約（1件5文だと50件で250文になり Free の invocation 上限を超える）

`api-design.md` の「通常操作では stale 台帳は発生しない」という契約と実装が一致した。

### MEDIUM: 取消対象の取得が transaction 外

対象 session の SELECT を **削除と同じ `db.batch()` の先頭**へ移した。

- `sessionIds` / `removed` は batch 結果の先頭 SELECT から作る。
  応答の件数・IDが「実際に消した対象」と必ず一致する。
- SELECT を含む batch のどこで失敗しても `503 cancel_failed` / `retryable: true`（全体 rollback）。
  旧実装では事前 SELECT の失敗が catch 対象外だった。
- 冪等性は維持（2回目は `removed: 0`）。通常棚卸・別batch・他店舗には触れない。
- query 数は増えていない（旧: 外1 + batch5 = 6／新: batch6 = 6）。

### LOW: migration 0015 のコメント

SQL 構造は変えず、末尾のコメントを現行契約へ合わせた。
「既存の取込バッチは台帳行を持たないため、次回の要求から記録が始まる（後方互換）」は誤りで、
実際は台帳なし既存取込を `409 legacy_import_unverified` で fail-closed にしている。
推測で fingerprint を作らないこと、同内容でも拒否すること、明示的な取消後に再取込することを明記した。

### D1実行上限の実測（実SQLiteハーネス・batch 内 statement も1本ずつ計上）

| 経路 | queries | 最大 bound parameter |
|---|---:|---:|
| 棚卸完了 1品目 | 9 | 9 |
| 棚卸完了 150品目 | 16 | 99 |
| 棚卸完了 351品目（R-001の実データ規模） | 27 | 99 |
| 棚卸完了 500品目（上限） | 35 | 99 |
| 過去取込 500行 / replace 0件 | 34 | 99 |
| 過去取込 500行 / replace 50件（上限） | 40 | 99 |
| 取込の取消 | 6 | 3 |

replace 削除が3文→5文になって取込は 38 → 40 queries。認証2本を足しても Free の 50 に収まる。

### テストの設計上の注意

`status='completed'` を直接 INSERT する seed では `session_completions` が作られず、
今回の欠陥を検出できない。追加した test は **実API経路**（`handleSessionComplete()` /
`handlePastImportCreate()`）で claim・台帳を作っている。
rollback test は statement の並びに依存させないため、成功実行で batch サイズを測ってから
0..size-1 のすべてに障害を注入する形にした。

### 実行したcommandと結果

| command | 結果 |
|---|---|
| 追加した回帰test（**修正前**・`e9b1dbe`） | **6 failed / 21 passed（27）** |
| `npm test -- test/ledgerLifecycle.sqlite.test.js test/pastImportIdempotency.sqlite.test.js test/pastImport.sqlite.test.js` | 3 files / 83 passed |
| `npm test -- test/migrationFresh.test.js test/migrationUpgrade.test.js test/migrationScript.test.js` | 3 files / 20 passed |
| `npm test`（worker 全体） | **26 files / 545 tests passed** |
| `npm --prefix app test -- --run` | 87 files / 875 passed |
| `npm --prefix app run build` | 成功 |
| `git diff --check` | 指摘なし |
| `git diff --name-only -- app/src` | 出力なし |

### 未実施・残risk

- **migration は local / remote とも未適用**（0012〜0016）。
- 実D1での計測は未実施。上の queries / boundParams は実SQLiteハーネスの値で、
  `batch` 内 statement が invocation あたりの query 数へどう数えられるかは公式資料に明記が無い。
  引き続き厳しい側（1 statement = 1 query）を仮定している。
- 実browser / 実機確認は未実施。
- **App側の追随が未了**（7点。前回までの記録のとおり）。
- `POST /history`（legacy 店舗用 soft auth）は従来どおりセッション行の存在を確認しないため、
  この経路からは孤児 snapshot を作れる（F-004 の残り・Phase 3）。
- replace の対象が `completed` / `stock` / 同日に限られるのは従来どおり。
  order セッションや進行中の棚卸は上書きできない（意図した制約）。
