# DATA-001 — 複数 D1 書き込みの原子性と入力制限を改善

- 状態の正本は [`../task-list.md`](../task-list.md)

- 対象: 注文、移動、棚卸完了。
- 完了条件:
  - ヘッダー・明細・完了状態が部分更新にならない。
  - payload 全体と主要文字列・配列件数の上限を server 側で強制する。
  - 中途失敗を注入し、更新前状態または一貫した再試行可能状態を確認する。

## 実装（2026-08-08・Claude Code 第1セッション / S4）

**状態: 実装済み。Worker 251 tests passed / App 619 tests passed / production build 成功。**
migration なし（スキーマ変更なし）。

### 原子性 — 1つの `db.batch` = 1トランザクションで書く

D1 の `batch` は1トランザクションとして扱われる。ヘッダ（または完了状態）と明細を
同じ batch に載せることで、片方だけ成功した状態を作らせない。

| 対象 | 変更前 | 変更後 |
|---|---|---|
| 棚卸完了 | `insertInventoryLines`（batch）→ `UPDATE sessions`（別write）の**2回** | `[UPDATE sessions, DELETE lines, ...INSERT lines]` を**1 batch** |
| 発注 | ヘッダupsert → `DELETE` → N回の`INSERT`（**全部別write**） | `[header, DELETE, ...INSERT]` を**1 batch** |
| 入出庫 | `DELETE` → ヘッダupsert → 明細batch の**3回** | `[header, DELETE, ...INSERT]` を**1 batch** |

`inventoryLines.js` は実行をやめ、**文を組み立てて返す**`inventoryLineStatements` に変えた。
呼び出し側が `UPDATE sessions` と同じ batch へ載せられるようにするため。

### batch は途中で中断できない — 依存する write に番人を置く

トランザクション内では「ヘッダが拒否されたので明細をやめる」という分岐が書けない。
そこで**明細の INSERT 自身に持ち主の確認を持たせた**。

```sql
INSERT INTO inventory_lines (...) SELECT ?, ?, ...
WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ? AND shop_code = ?)
```

`UPDATE sessions` を batch の先頭へ置き、0行だった場合（セッションが消えた・他店舗のものになった）に
後続の INSERT も EXISTS で弾かれる。結果として、持ち主のいない明細が残らない。
発注・入出庫も同じ形（`EXISTS (SELECT 1 FROM orders/movements WHERE id = ? AND shop_code = ?)`）。

### 冪等性

明細は毎回**全削除してから入れ直す**。`ON CONFLICT DO UPDATE` の upsert だけだと、
2回目に品目が減った場合に前回ぶんが残る。再送すれば最終状態は必ず payload と一致する。

### 入力上限（server側で強制）

| 上限 | 値 | 理由 |
|---|---|---|
| `MAX_LINES_PER_REQUEST` | 5,000行 | `MAX_PAYLOAD_CHARS` はJSON全体のバイト数しか見ない。短い行を大量に並べると上限内のまま数万行のwriteを1トランザクションへ詰め込める |
| `MAX_INGREDIENT_LEN` | 既存200 | 品目名を slice |
| `MAX_UNIT_LEN` | 既存50 | 単位を slice |

棚卸完了にも `_tooLarge`（payload全体）と `inventory` の型チェックを追加した。従来は無かった。

### クライアント側の部分適用も塞いだ

`useSession.complete()` は、`complete` API が失敗すると
`updateSession(id, 'completed')` へ**フォールバックしていた**。
これは「明細の保存に失敗したのに、セッションだけ完了として残す」動きで、
DATA-001 が防ごうとしている部分適用そのものをクライアント側から作っていた。
一覧には出るのに詳細が開けない棚卸（R-001）は、この経路でも生まれる。

フォールバックを削除し、失敗時は完了扱いにせず `{ ok: false, reason: 'save_failed' }` を返す。
`_finalized` も戻して再試行を塞がない。`App.vue` は結果を見てトーストを出し分ける
（サーバーには何も入っていないため「接続が戻ってからもう一度完了してください」）。

**旧テスト「complete API が失敗したら従来の updateSession にフォールバックする」は、
この危険な挙動を固定していたため反転させた。**

### 付随して直した1点

`handleMovementCreate` のヘッダ upsert に `WHERE movements.shop_code = excluded.shop_code` が
無かった。事前SELECTの後に別店舗が同じ id を作る競合で、他店のヘッダを上書きできる隙間が
残っていた（`handleOrderCreate` には既にあった）。同じ形へ揃えた。

### 残っている穴

- `saveSnapshotToD1`（`store_history`）は**この原子性の外**にある。完了処理とは別の write で、
  失敗は Phase 2 の可視化・再送キューで扱う。両者を1つにするのは `store_history` の
  session単位キー化（F-001）が要るため **Phase 3（公開後）**。
- D1 の batch がトランザクションであることに依存している。ローカルのモックでは
  巻き戻りを注入して再現しているが、**本番D1での部分失敗は未検証**。

## レビュー修正（2026-08-09・Claude Code / CCレビュー修正 第1セッション §1）

Codex レビューで、**サーバー側を原子的にしただけでは足りない**ことが指摘された。
`worker` 側は `36fc8ad` で1トランザクション化されたが、App 側は
`completeSessionD1()` が `ok:false` を返しても後片付けを続けていた。

### 修正前に確認した壊れ方

`app/src/App.vue` の完了処理は、完了記録の成否に関わらず
`broadcastSessionEnd` / `dissolveRoom` / `_clearDraft` / `clearSession` / 一覧への遷移 /
`track('session_completed')` を実行していた。結果として

- サーバーには完了が記録されていないのに、端末の draft と pendingSession は消える
- ホストではルームまで解散するため、ゲストの続行手段も消える
- 画面は一覧へ移るので、**同じ棚卸をやり直す導線が無い**

`app/src/App.complete.test.js` を追加し、**修正前の挙動では6件中4件が失敗する**ことを
確認してから修正した（確認方法: 修正箇所を一時的に旧挙動へ戻して実行）。

### 併せて見つけた未定義参照

ソロ完了経路の `sessionsYear.value = completedYear` は、`sessionsYear` も `completedYear` も
**リポジトリ内のどこにも定義が無い**。`cf25ae5` で代入だけが入り、以来ずっと
solo 完了時に `ReferenceError` を投げていた（`clearSession()` の後・画面遷移の前で throw するため、
一覧へ遷移できない）。行ごと削除した。ホスト経路には無い行のため、症状はソロ完了のみ。

### 実装

| 完了条件 | 実装 |
|---|---|
| `ok:false` / 5xx / 通信断で後片付けをしない | `_finishSession()` を新設し、`completeSessionD1` の結果が `ok` のときだけ 終了通知・解散・draft削除・clear・遷移・analytics を実行する |
| 入力値・draft・room・参加者を保持する | 失敗時は `reopenSession()`（`useInventory` に追加）で読み取り専用を解除するだけ。他は一切触らない |
| 同じ画面から再試行できる | 完了ボタンが残り、同じ `pendingSession` に対してもう一度押せる |
| 成功後だけ各1回 | 二重押しガード `completing` を追加し、ボタンも `:disabled` にする |
| 表示文言を実状態に合わせる | 失敗時は「サーバーへ完了を記録できませんでした。接続が戻ってからもう一度完了してください」 |

### 検証

- `src/App.complete.test.js` 6件（App をマウントして完了ボタンを実際に押す）
- App 全体 74 files / 648 passed、`npm run build` 成功
- Worker は未変更（17 files / 251 passed で回帰のみ確認）

### 残っている穴

- 完了が失敗した時点で**ローカルのスナップショットは既に作られている**（入力値を失わないため意図的）。
  サーバー側にはセッションが active のまま残るので、一覧と履歴で見え方が一時的にずれる。
  Phase 2 のバックフィルが next drain で埋めるが、**sessionId 単位の整合は第2セッションの範囲**。
- 実機・実ブラウザでの確認は未実施。

## 関連

- 棚卸完了時は `saveSnapshotToD1`（await しない）と `completeSessionD1`（await する）の
  **2つの独立した書き込み**が走り、前者だけが失敗すると「セッションは残るが明細が消える」状態になる。
  この非対称は `DATA-002` の R-001 で本番実害として確認されている。原子性の設計はそちらと突き合わせる。

## 2026-08-09 — CC第2セッション: server原子性・D1上限・数量契約

- 対象HEAD: `claude/branch-operational-status-2lwwwu@9a7141f`（第1セッションのcheckpointを含む）
- **migration あり**: `worker/migrations/0012_history_session_key.sql`（**未適用**）。
  development / production D1 には適用していない。`store_history` を作り直すため
  **ロールバック不能**。適用前のバックアップ確認が要る。

### 1. snapshot を完了処理へ取り込んだ

`saveSnapshotToD1()` が完了APIより**先に独立成功**していた経路を廃止した。
client は snapshot を `POST /sessions/:id/complete` の body へ載せ、サーバーが
`UPDATE sessions` → `inventory_lines` → `store_history` を**1つの `db.batch`**で書く。
途中で落ちれば全部巻き戻り、`ok:false` を返して client は cleanup しない（第1の契約どおり）。
snapshot の `sessionId` はサーバーが完了対象のセッションIDへ揃える（client 指定を信用しない）。

### 2. 明細INSERTを複数行まとめへ変更（D1上限）

1行1 INSERT だと N+2 statements になり、**Free の「Queries per Worker invocation = 50」**を
150品目でも超えていた。まとめ行数は **bound parameter 上限 100/query** から逆算し、
持ち主確認は `FROM parent p, (...) v WHERE p.id = ? AND p.shop_code = ?` の JOIN で担保する
（batch は途中中断できないため文ごとに閉じる必要がある）。

### 3. 数量の業務契約を固定

`Number.isFinite(x) ? x : 0` の丸めを廃止。NaN / Infinity / 範囲外は **400 で拒否**する。
棚卸は 0 を許し負数を拒否、発注は 0 を許し（「確認したが発注しない」行）負数を拒否、
入出庫は 0 と負数を拒否。ID・日付・文字列長・配列件数もサーバーで検証する。

### 4. order / movement の削除を原子化

明細DELETE + ヘッダDELETE を1 batch にした。`handleMovementDelete` に持ち主確認が無く
他店舗IDでも 200 を返していたため、`handleOrderDelete` と同じ 404 へ揃えた。

### 実行したcommandと結果

```
cd worker && npx vitest run   → 19 files / 335 tests passed
cd app    && npx vitest run   → 72 files / 634 tests passed
cd app    && npm run build    → 成功（PWA precache 17 entries / 2522.19 KiB）
git diff --check              → 指摘なし
```

Worker全体テストで5秒timeoutは**再現していない**（全体2.2秒）。

### 未実施

- **実D1での計測・検証は一切していない。** batch内statementがFreeのquery数へどう数えられるかは
  公式資料に記載がなく、**厳しい側（1 statement = 1 query）を仮定**して上限を決めた。
  実測は release gate（WEB-07）へ残す。
- 隔離non-production D1 での351品目試験（User承認が要るため未実行）。
- migration 0012 の適用、deploy、production D1 への write。
- 実機UI確認。

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

## 2026-08-12 — CC第1セッション: 完了確定・401・保存queue・履歴revision

- 基準HEAD: `develop@07cc29f`（3セッション統合済み）。作業branchは
  `claude/inventory-auth-queue-session-1-h8e4ku`。
- **App側のみ**。Worker、migration、取込関連component/parserは変更していない。
- **migration なし**（0012 / 0013 は依然として本番未適用）。

### 1. 完了はserver成功後にだけローカルへ確定する

前回までは `completeSession()`（読み取り専用マーク）と `saveSnapshot()`（履歴への書き込み）を
**完了APIより先に**実行していた。失敗時に `reopenSession()` で巻き戻す設計だったが、
巻き戻せるのは「応答が返ってきた失敗」だけで、次の消失経路が残っていた。

| 壊れ方 | 直し方 |
|---|---|
| 通信中にタブが終了すると、端末は完了済みで復帰し `restorePendingSession()` が走らない＝同じ棚卸を完了し直す導線が消える | ローカル確定をサーバー成功後へ移した。応答が返らなければ端末側は何も変わらない |
| サーバーには active しか無いのに端末には完了履歴が残る | `saveSnapshot` を `buildSnapshot`（メモリ上で組み立て）と `commitSnapshot`（端末へ確定）へ分割 |
| その履歴をバックフィルが送り、一覧と詳細が食い違う | `missingSnapshots` に `activeSessionIds` を渡し、進行中セッションぶんを除外 |
| 明細が入らない完了を成功として扱う | `snapshotSaved !== true` を失敗（`reason:'snapshot_missing'`）にした。snapshot を送った完了だけが対象 |
| 中身の無い端末スナップショットを詳細として表示する | `isSnapshotComplete()` で弾き、`sessionId` の lines 取得へ fallback |

完了要求は `useSession.complete()` が **sessionId 単位で1本**に束ねる。完了ボタン・
ホームへ戻る・`session_ended` が重なっても実行中の1本へ合流する。後片付け（解散・
draft削除・遷移）は `App._finishSession` の `_finishing` でも締める。
再試行は同じ sessionId・同じ内容で送るため、サーバー側の冪等性がそのまま効く。

### 2. 401で作業を消さない

`api.js` の失効ハンドラは `.then` の中で**同期的に**呼ばれ、`shopCode` を空にしてから
`_save` の catch が走る。そのため

- `_save` の stale 判定（`code !== shopCode.value`）が真になり、**401を起こした最新版が
  enqueue されずに消えていた**
- `_persistPending` が `shopCode: ''` で書き、次回起動の `_restorePending` が読み捨てていた
- App の失効ハンドラが `clearSession()` / `reset()` で進行中セッションと入力値を捨てていた

直し方:

- キューの各項目が**自分の shopCode を持つ**。鍵は `kind + shopCode + resourceId`。
  stale 判定は `_saveGeneration`（アカウント切替）だけを見る。
- `noteAuthInvalidated(code)` を追加し、App の失効ハンドラが**消す前に**呼ぶ。
  再送を止め、未送信分と作業中 draft（`_saveDraft`）を失効時点の店舗へ紐付けて書き出す。
- 失効ハンドラは `clearAuthLocal()` だけにし、`pendingSession` / 入力値 / draft を残す。
- `_restorePending` は「別店舗でログイン中」のときだけ他店舗ぶんを落とす。
  ログアウト状態（shopCode 空）では捨てない。
- 送信対象は `_activeEntries()`＝現在の店舗ぶんだけ。別店舗へログインしても旧店舗へは送らない。
- `clearAuthBlock()` を `App.onAuthDone()` へ接続した（従来は test からしか呼ばれていない
  dead code だった）。別アカウントなら `useAuth` の accountReset が先に旧店舗ぶんを破棄する。

### 3. queue identityと順序

- snapshot の resourceId を **sessionId** にした（`_resourceId()`）。日付キーだと同じ日の
  2回目の棚卸が1回目のキュー項目を潰し、片方がサーバーへ届かないまま消えていた。
  sessionId を持たない legacy 行だけ日付へ落とす。D1 側の一意制約（0012）と同じ形。
- 同一対象への直接保存を `_inflight` で**直列化**。A→Bと投げても応答がB→Aで返ると
  サーバー到達順まで入れ替わり、古いAが最終値になりえた。先行が無ければ待たずに送る。
- 拒否された保存（400/409/413）を localStorage（`_rejected_saves_v1`）へ永続化。
  リロードで「保存できなかった」事実だけが消えると、入力し直す必要に気づけない。
- ConnectionBanner の優先順位を `unpersisted → failed/pending → rejected → offline` にした。
  オフラインは「そのうち直る」と読めるが、拒否は放っておいても入らない。
- 容量不足時の `unpersistedCount` / `pendingPersisted` を現在の店舗ぶんに揃え、
  `pendingCount` と母数を一致させた。

### 4. 履歴revisionを利用する（第2セッションの契約に乗る側）

判定順を `serverRevision` → `serverSavedAt` → client時刻（旧データ同士のみ）にした。
判定は `app/src/utils/snapshotSync.js` に一本化し、`useHistory` と `historyBackfill` が共有する。

- 端末の訂正は `dirty` / `synced` という**状態**で持つ。`updatedAt`（端末時計）で新旧を
  決めると、時計を戻した端末の訂正が「古い」と判定されて消えていた。
- `patchSnapshotItems` / `lockOtherSnapshots` が `dirty` を立て、
  `markSnapshotSynced(key, meta)` がサーバー成功後に下ろして revision を書き戻す。
- dirty なローカル訂正は remote で潰さない（キュー経由で送り直されるまで端末側を正とする）。
- 履歴詳細の訂正が**サーバーへ送られていなかった**（`@patched` が `detailSnapshot` を
  差し替えるだけだった）。`onSnapshotPatched` で送るようにした。失敗しても dirty のまま残り、
  未送信キューと次回のバックフィルが再送する。
- `GET/POST /store/:code/history` が `serverRevision` / `serverSavedAt` を返す前提だが、
  **返さない現行Workerでも動く**（fallback 経路。第2セッションの実装待ち）。

### 変更file

```
app/src/App.vue
app/src/utils/api.js                       （変更なし。失効ハンドラの契約はApp側で満たす）
app/src/utils/snapshotSync.js              新規
app/src/utils/storageKeys.js
app/src/composables/useStore.js
app/src/composables/useSession.js
app/src/composables/useHistory.js
app/src/composables/accountData.js
app/src/services/historyBackfill.js
app/src/components/ConnectionBanner.vue
app/src/App.complete.test.js               （拡張）
app/src/App.authLoss.test.js               新規
app/src/composables/useStore.authQueue.test.js   新規
app/src/composables/useHistory.revision.test.js  新規
app/src/composables/useHistory.sessionKey.test.js（fixtureを新モデルへ）
app/src/services/historyBackfill.test.js   （拡張）
app/src/components/ConnectionBanner.test.js（拡張）
```

### 実行したcommandと結果

```
cd app    && npm test        → 82 files / 789 tests passed（連続2回とも成功。timeout延長なし）
cd app    && npm run build   → 成功（PWA precache 17 entries / 2550.81 KiB）
cd worker && npm test        → 20 files / 367 tests passed（Worker未変更・回帰確認のみ）
git diff --check             → 指摘なし
```

`App.complete.test.js` の mock は `{ ok: true, snapshotSaved: true }` を返すよう更新した。
`snapshotSaved` を成功条件へ入れたため、これを欠く応答は完了として扱わない。

修正が効いていることは、対象箇所を一時的に旧挙動へ戻して確認した。

- `useSession` の合流を外す → 「完了ボタン＋ホーム＋session_ended が競合しても完了要求は1本」が失敗
- ローカル確定を完了APIの前へ戻す → 「完了APIが503でも…履歴だけが作られない」が失敗

### 未実施・残リスク

- **実D1・実browser・実機は未確認。** migration 0012 / 0013 は本番未適用のまま。
- 第2セッションが `GET/POST /store/:code/history` へ `serverRevision` / `serverSavedAt` を
  返すまで、履歴の新旧判定は `serverSavedAt` fallback で動く。revision 経路は
  App側の unit test でのみ検証済み。
- 完了APIは `serverRevision` を返さないため、完了直後のローカル snapshot は
  `synced: true` だけを持つ。revision は次の `GET /history` で埋まる。
- 401直後の未送信データは、同じ端末で別店舗へログインするまで localStorage に残る
  （`resetAccountData` が破棄する）。ログアウトのまま放置した場合の保持期間は決めていない。
- `useStore` の `_save` は `{ ok, result }` を返すよう変わった。boolean を期待する既存
  呼び出しは各 export 側で `.ok` へ畳んである（`saveSnapshotToD1` だけが object を返す）。
