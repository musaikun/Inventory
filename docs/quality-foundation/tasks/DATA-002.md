# DATA-002 — 履歴の端末依存を解消し、DO/D1 の成長時設計を検証

- 状態の正本は [`../task-list.md`](../task-list.md)
- **統合**: 実使用バグ `R-001` と、その調査中に発見した `F-001`〜`F-004` を、新規IDを作らず本タスクで扱う。
  報告の全文・コード根拠・本番D1の調査結果は [`../bug-reports.md`](../bug-reports.md) に保存する（削除しない）。

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
