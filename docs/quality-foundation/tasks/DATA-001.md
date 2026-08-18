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

## 2026-08-17 — CC App第2セッション: 完了ライフサイクルと同期キュー

- 基準HEAD: `develop@77d6d48`。作業branchは `claude/app-completion-sync-queue-z8etdp`。
- **App側のみ**。`worker/**`、migration、CSV・過去棚卸取込の parser / UI は変更していない。
- **migration なし**（0012〜0016 は依然として local / remote とも未適用）。

### 参照した第1修正セッションのcommitと完了契約

| commit | 内容 |
|---|---|
| `39f7776` | 完了APIの snapshot 必須化、履歴 revision（0014） |
| `e952550` | App側の完了確定・401・保存queue・履歴revision（前回のApp差分） |
| `38cf1cc` | **stock/order別の完了契約を確定**、snapshot の server canonical 化、`completed→active` 禁止（0015） |
| `1d3cbfa` | 汎用PUTでの完了迂回を 409 で封鎖、棚卸日を `takenAt` 一本化、完了 claim / fingerprint（0016） |
| `e9b1dbe` | fingerprint を canonical snapshot 全体へ拡大 |
| `77d6d48` | replace の旧claim・旧台帳削除、取消の同一transaction化 |

いずれも作業HEADの祖先であることを `git merge-base --is-ancestor` で確認した。
App側の追随項目は [`DATA-002.md`](DATA-002.md) の「Appへの引継ぎ」（7点）に記録されている。

**App が従う完了契約**（`docs/api-design.md` §3.1 / `DATA-002.md` §1）:

| | stock | order |
|---|---|---|
| body | `{ inventory, prices, takenAt, snapshot }` | `{ itemCount }` **だけ** |
| snapshot | 必須（`400 snapshot_required`） | 送ると `400 snapshot_not_allowed` |
| inventory | 0件は `400 empty_inventory` | 非空は `400 snapshot_not_allowed` |
| 日付 | `takenAt` と `snapshot.date` の不一致は `400 snapshot_date_mismatch` | — |
| items | `qty` を持つ集合が明細行と不一致なら `400 snapshot_mismatch` | — |
| 状態遷移 | `PUT` で completed にすると `409 use_complete_endpoint` | 同左 |
| 再送 | canonical snapshot 全体の fingerprint が違えば `409 completion_intent_conflict` | 冪等 |

### Appへの引継ぎ7点の対応

| # | 引継ぎ | 対応 |
|---|---|---|
| 1 | `setSessionEndedCallback` が snapshot なしで完了API | 共通 helper 経由へ（§2） |
| 2 | `onGoHome` の完了済み経路が snapshot なし | 同上（§2） |
| 3 | order は `{ itemCount }` へ分岐、`useAuth.completeSession()` に引数追加 | `completeSession(sessionId, body)` へ変更し、body は helper が作る（§2） |
| 4 | `snapshot.date` と `takenAt` を一致させる | helper が `takenAt = snapshot.date` を1か所で決める（§2） |
| 5 | `409 completion_intent_conflict` / `use_complete_endpoint` の扱い | 409 を retryable:false で扱い、`updateSession(id,'completed')` の経路を削除（§2・§8） |
| 6 | `409 legacy_import_unverified` の導線 | **未対応**。過去棚卸取込UIは本セッションの変更禁止範囲（第3セッション所有）。残課題として下記に記録 |
| 7 | 完了の再送は snapshot を1文字も変えずに送る | 完了要求を sessionId 単位でキャッシュし、結果不明のあいだは同一 body を再送（§8） |

### 1. 完了処理中・結果不明中に active を書き戻さない

完了要求の送信中は `isCompleted` がまだ false なので、ホームを押すと
`markSessionActive()` が `PUT /sessions/:id {status:'active'}` を送っていた。
server は `409 session_completed` で拒否するようになったが、**端末側が「進行中」と
信じ続ける状態そのもの**（完了済みの詳細へ到達できない）を作らせない。

| 直したこと | 実装 |
|---|---|
| 専用のbusy / 結果不明state | `useSession` に `completionUnknown`（応答なし・5xx・通信断）と `completionBusy` を追加。4xx（429除く）は server の応答があるので不明にしない |
| 競合操作のguard | `onGoHome` / ブラウザバック / `onSessionStart` / `onSessionResume` / `onStartPractice` / `onStartNew` / `onDeleteSession` / `onViewSession` を `_blockedByCompletion()` で止める。ホームボタンも `:disabled` |
| active を書かない | `markActive()` 自身が `completing` / `completion_unknown` / `completed` を拒否する（呼び出し側のguardが漏れても書けない） |
| completed → active の経路を残さない | `onGoHome` 失敗時の `reopenSession()` を廃止し、`useInventory.reopenSession()` ごと削除した |
| 結果不明からの収束 | ホームで `verifyCompletion()`（`GET /sessions`）→ 同じ完了要求を再送。server 側は同一 intent の replay として冪等に成功する |
| 二重クリック | 従来の `completing` による `:disabled` を維持 |

### 2. snapshot なしの本番完了経路をなくし、stock/order を分けた

`setSessionEndedCallback` と `onGoHome` の完了済み経路が snapshot 無しで
`completeSessionD1()` を呼んでおり、現行 Worker では `400 snapshot_required` になる。
発注セッションは `buildSnapshot` が `null` を返すため同じく 400 になっていた。

- 完了payloadの組み立てを `app/src/services/sessionCompletion.js` へ集約。
  本番の3経路（完了ボタン・`session_ended`・`onGoHome`）がすべて `_buildCompletionRequest()` を通る。
- **order は種別だけで分岐**する。在庫を入力していても snapshot も inventory も送らない
  （正本は `orders` / `order_lines`。架空の marker snapshot を作らない）。
- `takenAt` は `snapshot.date` から決める。1か所で決めるので不一致が構造的に起きない。
- `useAuth.completeSession(sessionId, body)` へ変更し、body の形を固定しない。
- **server の検証を手前で行う**: `qty` を持つ items の集合と `inventory` の集合が一致しない、
  品目名が200文字で切り詰めた結果衝突する、日付が実在しない場合は **API を呼ばずに**
  理由つきのエラーを出す（`completionErrorMessage`）。

### 3. queue retry と direct save の競合

`_drain` が `_inflight` レーンを通さず直接送っていたため、「Aの再送が飛んでいる最中に
新しいBを直接保存」すると2本が同時にサーバーへ向かい、遅れて決着したAが新しいBを
最終状態として上書きできた。

- `_lane(key, task)` を新設し、直接保存もキューの再送も同じレーンを通す。
- レーンは `kind + shopCode + resourceId` 単位。別対象は待たされない（testで固定）。
- 再送はレーンに入ってから**キューを読み直す**。直接保存が成功して項目が消えていれば
  何も送らず、新しい版へ差し替わっていれば新しい方を送る。
- coalescing（latest-wins）・失敗分類・auth block は変更していない。

### 4. account 切替時の generation

`_sendOnce` が generation を**実際の送信開始時**に読んでいた。レーン待ちの間に
アカウントを切り替えると、旧アカウントで作った保存が新しいトークンで送られる。

- `generation` / `shopCode` / 認証主体（token）を `_save()`＝論理要求の作成時に確定する。
- generation が変わっていれば送らない（`resetAccountData` が旧店舗ぶんを破棄済みなので
  キューへも戻さない）。
- 店舗または認証主体だけが変わっている場合は、**作成時点の店舗の未送信キューへ確定**する。
  同じ店舗へ戻れば drain が改めて送る（旧店舗用の durable queue）。

### 5. history acknowledgement の version 競合

`markSnapshotSynced(key)` が「その時点で key に入っているオブジェクト」を無条件に
clean にしていた。A の送信中に作った B が A の応答だけで「サーバー確認済み」になり、
バックフィルの対象から外れてリモートの古い版に潰される。

- snapshot ごとに `localRev`（単調増加・端末時計に依存しない）を持たせた。
  `commitSnapshot` / `patchSnapshotItems` / `lockOtherSnapshots` / `applyRemoteHistory` /
  `importPastSnapshot` が版を進める。リロード時は保存済みの最大値から採番を続ける。
- `markSnapshotSynced(key, meta, sentLocalRev)` は版が一致するときだけ clean にする。
- `_pushSnapshot` は送信時の `localRev` を捕まえて渡し、`localRev` 自体はサーバーへ送らない。

### 6. 同一店舗への再ログイン

`clearAuthBlock()` が drain の完了を待たず、`onAuthDone()` が直後にリモートを読んで
ローカルへ反映していた。再ログイン直後の端末にはサーバーより新しい未送信の版がある。

- `clearAuthBlock()` は `{ wasBlocked, drained, pending }` を返す await 可能な関数にした。
- 順序は `services/authResume.js` の `resumeAfterLogin()` に出した（App を mount せずに検証できる）。
  drain → 送り切れたときだけ pull。送り切れなければ pull せず、件数を通知して
  キューと再送導線（指数バックオフ・バナー）を保つ。
- 失効ハンドラは、credentials を消す**前に**デバウンス中の config / inventory を
  `queuePendingSave()` で失効時点の店舗のキューへ確定する（**送信はしない**）。

### 7. 既定 test の安定化

App を mount する test の**初回 `import('./App.vue')` が2.6〜3.7秒**かかり、既定5秒の
`testTimeout` の大半を test 本体で食っていた（`App.deleteRoute.test.js` には
`, 15000` の個別延長が入っていた）。

- 初回 import を `beforeAll`（既定 hookTimeout 10秒）へ移し、直後に `vi.resetModules()` で
  registry を捨てる。transform 結果だけが再利用され、各 test は毎回まっさらな
  モジュール状態から始まる。
- 4つの App mount test file に適用し、`App.deleteRoute.test.js` の個別 timeout を削除した。
- 結果: 最遅だった3件（3706ms / 3389ms / 2630ms）がいずれも 300ms 未満になった。
- `testTimeout` の引き上げ、sleep の追加、test の削除・skip、`maxWorkers=1` 固定、
  assertion の削減は**していない**。

### 8. 完了の再送は同じ body を送る（fingerprint 契約）

server は canonical snapshot 全体（除外は `savedAt` / `activeMs`）から fingerprint を作り、
内容が違う再送を `409 completion_intent_conflict` で拒否する。応答を取りこぼした要求が
サーバー側で確定していた場合、**組み立て直した body では二度と確定できない**
（`auditLog` が1件増えているだけで別 intent になる）。

- 完了要求を `_completionIntent = { sessionId, request }` として保持する。
- 結果不明のあいだは保持した body をそのまま再送する。
- サーバーが受け付けていないと**断定できた**失敗（4xx・`snapshotSaved` 欠落）のときだけ
  捨てて、最新の入力で作り直す。
- `409 completion_intent_conflict` は `retryable:false` として扱い、未送信キューへ戻さない。
  端末の履歴も確定しない（サーバーの内容が正）。ホームから離脱でき、`active` は送らない。
- `409 completion_record_missing` も `retryable:false`（同じ session では復旧できない）。

### 追加・変更した test（修正前に失敗を確認済み）

| file | 内容 | 修正前 |
|---|---|---|
| `src/App.complete.test.js` / `src/composables/useSession.test.js` | 完了中のホーム／バック／ボタン無効、応答喪失後にactiveを送らない、結果不明からの収束、`session_ended` / ホーム経路のpayload、order の `{itemCount}` 契約、payload不正でAPIを呼ばない、同一body再送、409群 | 本番fileを `77d6d48` の内容へ戻して **27件失敗** |
| `src/composables/useStore.lane.test.js` / `src/composables/useHistory.ackVersion.test.js` | レーン競合、別keyは待たない、generation捕捉、旧店舗キューへの確定、`clearAuthBlock` の await、`queuePendingSave`、ack の版一致 | `useStore.js` / `useHistory.js` を戻して **12件失敗** |
| `src/App.authLoss.test.js` | 失効直前のデバウンス config / inventory がキューに残る | `App.vue` を戻して **2件失敗** |
| `src/services/sessionCompletion.test.js` | stock/order の完了契約（新規 helper） | 新規 |
| `src/services/authResume.test.js` | drain → pull 順序（新規 helper） | 新規 |

### 変更file

```
app/src/App.vue
app/src/composables/useSession.js
app/src/composables/useStore.js
app/src/composables/useHistory.js
app/src/composables/useInventory.js            （reopenSession を削除）
app/src/composables/useAuth.js                 （completeSession(sessionId, body) へ）
app/src/services/sessionCompletion.js          新規
app/src/services/authResume.js                 新規
app/src/services/sessionCompletion.test.js     新規
app/src/services/authResume.test.js            新規
app/src/composables/useStore.lane.test.js      新規
app/src/composables/useHistory.ackVersion.test.js 新規
app/src/App.complete.test.js                   （拡張・warm hook）
app/src/App.authLoss.test.js                   （拡張・warm hook）
app/src/App.deleteBack.test.js                 （warm hook）
app/src/App.deleteRoute.test.js                （warm hook・個別timeout削除）
app/src/composables/useSession.test.js         （契約更新）
app/src/composables/useStore.queue.test.js     （戻り値更新）
```

### 実行したcommandと結果

```
npm --prefix app test -- --run    → 91 files / 935 tests passed（1回目）
npm --prefix app test -- --run    → 91 files / 935 tests passed（連続2回目）
npm --prefix app run build        → 成功（PWA precache 17 entries / 2570.69 KiB）
npm --prefix worker test          → 26 files / 545 tests passed（未変更・回帰確認）
git diff --check                  → 指摘なし
git diff --name-only -- worker    → 出力なし
```

### 未実施・残リスク

- **実D1・実browser・実機は未確認。** migration 0012〜0016 は local / remote とも未適用。
- **適用順序**: App をこの契約へ合わせたため、**migration 未適用の Worker では完了が動かない**。
  migration → Worker → App の順で出す必要がある。判断は release gate（`WEB-04` / `WEB-07`）側。
- **引継ぎ6点目（`409 legacy_import_unverified`）は未対応**。過去棚卸取込UIは本セッションの
  変更禁止範囲のため、第3セッション（IMPORT-001）で扱う。
- `verifyCompletion()` は `GET /sessions`（最新50件）に依存する。50件を超えて古くなった
  セッションは一覧に出ないため「確認できない＝結果不明のまま」となり、再送で収束させる。
- 結果不明の状態と完了要求は端末へ永続化する（下の「レビュー指摘の修正」§1）。
  容量不足で body を書けなかった場合だけ、結果不明の事実だけが残り再送は組み立て直しになる。
  その場合の `409` は「サーバーで確定済み」と分かる形で扱う（active は書き戻さない）。
- `409 completion_intent_conflict` の復旧導線（session を作り直して入力を引き継ぐ）は
  実装していない。現状は「サーバーで別内容として確定済み」と表示し、一覧から確定内容を
  確認させるところまで。

## 2026-08-17 — レビュー指摘の修正（第2セッション 追補）

独立レビューで挙がった5点。基準は push 済みの `c3141e6`。`worker/**` は変更していない。

### 修正前に失敗を確認したtest

| file | 件数 | 内容 |
|---|---|---|
| `src/composables/useSession.test.js` | 10 | 結果不明の永続化・復帰、`markActive` の失敗握り潰し、アカウント切替と応答の競合 |
| `src/services/sessionCompletion.test.js` | 5 | body の deep clone、件数上限（500 / 2,000）の境界 |
| `src/App.complete.test.js` | 6 | 再読込後の同一body再送、完了中・結果不明中の入力ロック、`session_ended` の sessionId 検証 |

### 1. 完了結果不明が再読込で失われる（重大）

`completionUnknown` と完了要求のキャッシュがメモリだけにあり、応答喪失後に再読込すると
ただの進行中セッションとして復帰していた。そこから完了し直すと body が組み立て直され、
server の fingerprint と一致せず `409 completion_intent_conflict` で**二度と確定できない**。

- 完了要求を `STORAGE_KEYS.completionIntent`（`_completion_intent_v1`）へ永続化する。
  形は `{ sessionId, shopCode, type, body }`。保存・破棄は `useSession` が一元管理し、
  App 側の module 変数（`_completionIntent`）は廃止した。
- `restore()` が結果不明の状態ごと復帰させる。**別店舗のぶんは復帰させない**（アカウント境界）。
- 成功・4xx・`409`・`verifyCompletion` の完了確認で破棄する。
- 容量不足で body を書けない場合は、`body: null` の marker だけを残す。
  再送は組み立て直しになるが、`active` を書き戻すよりは安全側。
- **`markActive()` が API エラーを握り潰していた**。`.catch(() => {})` の後で無条件に
  `status = 'active'` を書いており、server が `409 session_completed` を返しても端末は
  「進行中」と信じ続けた。失敗時は端末側も更新せず、`409 session_completed` なら
  端末を completed へ合わせる。

### 2. 旧アカウントの完了応答が新アカウントを壊す（重大）

`resetLocalData()` は `_completing` の参照を消すだけで、実行中の Promise は止まらない。
旧アカウントの応答が後から返ると、その時点の `pendingSession` を completed にし、
App が**旧 snapshot を現在の履歴へ確定し、現在の draft と session を消して**いた。

- `_accountGeneration` を追加し、`resetLocalData()` で進める。
- 完了要求は送信開始時に `{ generation, shopCode, sessionId }` を捕まえ、
  **応答（成功・失敗とも）を適用する直前に突き合わせる**。ずれていれば
  `{ ok:false, stale:true }` を返し、状態も結果不明フラグも一切触らない。
- App の `_finishSession` / `onGoHome` は `stale` を受けたら後片付けをせずに戻る。

### 3. 再送用 payload が不変でない（重大）

`{ ...inventory }` は外側だけの浅いコピーで、entry オブジェクトは在庫と共有されていた。
`updateQty()` は entry を直接書き換えるため、**組み立て済みの完了要求まで後から変わる**。
snapshot 側は値のコピーなので変わらず、再送が `400 snapshot_mismatch` になりうる。

- `buildCompletionRequest()` が `inventory` / `prices` / `snapshot` を deep clone して固定する。
  端末の履歴確定にも**送ったのと同じ版**（`req.snapshot === req.body.snapshot`）を使う。
- あわせて `inputLocked` に `completionBusy` を含め、**完了中・結果不明中は入力できない**ようにした。
  ここで編集できると「画面の内容」と「送った内容」がずれ、編集分は保存されない
  （再送は同じ body でしか通らない）。

### 4. App と Worker で件数上限が違う（中）

App は 5,000 件を前提にしていたが、Worker の `MAX_LINES_PER_REQUEST` は **500**
（D1 の statement 予算から逆算した値）。501 件を「正常な payload」として作って
413/400 を受けていた。

- App 側の定数を 500 / `MAX_SNAPSHOT_ITEMS` 2,000 へそろえ、**API を呼ぶ前に**拒否する。
- 境界 test: 棚卸 500 件成功 / 501 件拒否、snapshot items 2,001 件拒否、
  発注 500 件成功 / 501 件拒否。

### 5. `session_ended` の sessionId を検証していない（中）

callback は `sessionId` を受け取りながら現在の `pendingSession` を完了していた。
古いルームから遅れて届いたイベントで、いま開いている別のセッションを完了させられる。

- `sessionId === pendingSession.id` のときだけ完了する。
- `sessionId` を持たない通知（sessionId を保存していないルーム）は対象を特定できないので
  完了させない（fail-closed）。ホスト自身の完了は `_finishSession` が主経路で、
  ここはそれへ合流するだけの保険。

### 付随して直したtestの欠陥

`409` の test が `apiFetch.mockImplementation()` で**共有モックの実装ごと差し替えて**いた。
`vi.clearAllMocks()` は呼び出し履歴しか消さないため、以降の全 test が 409 を受け続け、
単体では通るのに全体では落ちる状態になっていた。共有モックのフラグ（`completeConflict`）
へ置き換え、実装の差し替えをやめた。

### 実行したcommandと結果

```
npm --prefix app test -- --run    → 91 files / 962 tests passed（連続2回）
npm --prefix app run build        → 成功（PWA precache 17 entries / 2573.21 KiB）
npm test（worker）                 → 26 files / 545 tests passed（未変更・回帰確認）
git diff --check                  → 指摘なし
git diff --name-only -- worker    → 出力なし
```

### 残リスク

- `409 completion_intent_conflict` の復旧導線（session を作り直して入力を引き継ぐ）は
  引き続き未実装。現状は「サーバーで別内容として確定済み」と表示するところまで。
- 完了要求の永続化は snapshot 全体を localStorage へ書く。大規模店舗（数百品目）では
  数百KB になり、容量が逼迫している端末では marker だけの保存に落ちる。

## 2026-08-18 — 再レビュー修正（完了intentのdurable化・全promise chainの世代管理）

基準 `e81fad1`。`worker/**` は変更していない。重大2件・高1件。

### 修正前に失敗を確認したtest

| file | 件数 | 内訳 |
|---|---|---|
| `src/composables/useSession.test.js` | 23 | 送信前durable化19件＋旧契約を固定していた既存4件（後述） |
| `src/App.complete.test.js` | 6 | 未解決Promiseのまま終了・再読込収束・保存失敗・確定ack |

command: `npx vitest run src/composables/useSession.test.js` /
`npx vitest run src/App.complete.test.js`（`e81fad1` の `useSession.js` / `App.vue` へ差し戻して実行）。
5秒 timeout で落ちた件は、決着しない完了要求へ次の test が合流していたため
（`begin()` が `_completing` を捨てていなかった）。これ自体も修正対象に含めた。

### 1. 完了payloadをAPI送信前にdurable化する（重大）

旧実装は `completeSessionApi()` を呼び、**catch の中で**初めて intent を保存していた。
送信中に PC・ブラウザ・タブが落ちると catch は実行されない。サーバーでは完了済みでも
端末には送った body が残らず、再読込後に同じ完了要求を再送できなかった。

- immutable な request を作ったら、**ネットワークへ出す前に**同期的に書く。
  形は `{ v, sessionId, shopCode, type, body, phase, at }`（`v` = schema version）。
- 書けなければ `intent_not_persisted` を返し、**完了APIを呼ばない**。
  `body: null` の marker へ切り下げる旧経路は廃止した（送った内容を復元できない状態で
  「結果不明」だけを作らない）。入力・draft・pendingSession は保持する。
- `beforeunload` などの unload 処理には依存しない。
- 送信した時点で `completionUnknown` を立てる（結果が確定するまで active を書かない）。

### 保存・削除のタイミング（API成功 ≠ 端末の確定完了）

| 順 | 処理 | intent |
|---|---|---|
| 1 | immutable request 作成 | — |
| 2 | `_writeIntent()`（phase `sending`） | **作成** |
| 3 | `completeSessionApi()` | 保持 |
| 4 | server 成功 / replay 確認 | phase `confirmed` へ更新（**消さない**） |
| 5 | App が snapshot を履歴へ commit | 保持 |
| 6 | App が draft削除・room解散・遷移まで完了 | 保持 |
| 7 | `ackCompletionFinalized(sessionId)` | **削除**・`completionUnknown` 解除 |

`_finishSession` と `onGoHome` の完了済み経路が 7 を呼ぶ。4xx・`409` の各種は
サーバー状態が分かるので即削除する。

### 2. 全ての非同期lifecycle処理にgenerationを適用する（重大）

`_complete()` にしか照合が無く、`verifyCompletion()` / `markActive()` / `touch()` の
遅延送信と、それらを await する App の chain が抜けていた。A店舗の `getSessions()` が
completed で解決すると、B店舗の `pendingSession` が completed へ変わり、
`_resolveUnknownCompletion()` が B店舗の `_finishSession()` を走らせられた。

- `_captureOrigin()` / `_isStale()` / `_staleResult()` を共通化。捕まえるのは
  **account generation・shopCode・sessionId** の3つ。
- 照合を追加した promise chain:
  - `complete()`（成功・失敗の両方／既存を共通ヘルパへ統一）
  - `verifyCompletion()`（`getSessions()` の成功・失敗の両方）
  - `markActive()`（成功・`409 session_completed`・通信エラーの全経路）
  - `touch()` の2秒デバウンス送信
  - App `_resolveUnknownCompletion()`（verify 後・`_finishSession` へ進む前）
  - App `onGoHome()` の `markSessionActive()` await 後（stale なら clear も遷移もしない）
  - App `_finishSession()` / `onGoHome()` の `completeSessionD1()` await 後（既存を維持）
- stale の戻り値は `{ ok:false, stale:true, reason:'stale' }` に統一。
  `pendingSession` / `completionUnknown` / `_finalized` / durable intent /
  現在アカウントの draft・history・currentView を**一切変更しない**。
- `begin()` / `resume()` / `clear()` は実行中の `_completing` への合流も断つ
  （前のライフサイクルの決着しない要求を待ち続けない）。

### 3. verifyCompletionでdurable intentを早期削除しない（高）

旧実装は GET が completed なら intent を消していた。直後に App は「同じ要求を再送する」
として `_finishSession()` を呼ぶが、intent が無いので**現在の在庫・audit log から
body を作り直す**。再読込後にローカルが違えば `409 completion_intent_conflict` になり、
サーバーは完了済みなのに端末履歴を確定できない。

- `verifyCompletion()` は `pendingSession.status` と `_finalized` を更新するだけ。
  intent も `completionUnknown` も触らない（解除は `ackCompletionFinalized()` だけ）。
- 取得に失敗したときも保持する。stale なら何も触らない。
- App は `_buildCompletionRequest()` が保存済み intent を最優先で返すため、
  **現在の在庫が空でも**保存済み body と snapshot で収束できる。

### 変更file

```
app/src/composables/useSession.js
app/src/App.vue
app/src/composables/useSession.test.js   （23件追加・旧契約の4件を新契約へ更新）
app/src/App.complete.test.js             （6件追加・errorHandler で unhandled rejection を解消）
```

`sessionCompletion.js` / `storageKeys.js` は変更なし（既存の deep clone・上限・
`_completion_intent_v1` をそのまま使う）。

### 旧契約を固定していた既存testの更新

「API 成功で即 intent 削除・結果不明解除」を前提にしていた4件を、確定 ack の契約へ更新した。
どれも `active` を書かないことは維持している。

- `完了済みセッションを active へ戻さない`
- `結果不明は再試行の成功＋確定ackで解除される`（旧: 成功だけで解除）
- `サーバー状態の再確認だけでは結果不明を解除しない（確定ackで解除する）`
- `完了が成立し、端末側の確定ackまで済んだら保存分を消す`

App test の `完了済みセッションをホームで離れる経路` は、`dissolveRoom` を
「永久に解決しない」から「reject」へ変えた。前者は `_finishing` が立ったままになり、
本番では起こらない状態を固定していた。

### 実行したcommandと結果

```
npx vitest run src/composables/useSession.test.js（修正前）→ 23 failed / 24 passed
npx vitest run src/App.complete.test.js（修正前）        → 6 failed / 33 passed
npx vitest run src/composables/useSession.test.js       → 47 passed
npx vitest run src/App.complete.test.js                 → 39 passed
npm --prefix app test -- --run                          → 91 files / 986 tests passed（1回目）
npm --prefix app test -- --run                          → 91 files / 986 tests passed（連続2回目）
npm --prefix app run build                              → 成功（PWA precache 17 entries / 2573.80 KiB）
npm --prefix worker test                                → 26 files / 545 tests passed
git diff --check                                        → 指摘なし
git diff --name-only -- worker                          → 出力なし
```

Worker test の timeout は発生していない（全体 5.27 秒）。

### 未実施・残risk

- 実D1・実browser・実機は未確認。migration 0012〜0016 は未適用のままで、
  **migration → Worker → App の順**で出す必要がある。
- durable intent は `localStorage` へ書く。数百品目の snapshot は数百KB になり、
  容量が逼迫した端末では `intent_not_persisted` で完了できない。
  この場合は「保存できないので完了しない」＝入力は端末に残る（fail-closed）。
  IndexedDB 化は Phase 3 相当。
- `verifyCompletion()` は `GET /sessions`（最新50件）に依存する。50件より古い session は
  確認できず、結果不明のまま再送で収束させる。
- `409 completion_intent_conflict` の復旧導線（session を作り直して入力を引き継ぐ）は
  引き続き未実装。
- 端末が複数タブで開かれている場合、durable intent は共有される。別タブが同じ session を
  完了しても内容は同一なので replay に収束するが、タブ間の排他は入れていない。

## 2026-08-18 — 再レビュー修正2（await後のstale再確認・lifecycle世代）

基準 `a20db8b`。`worker/**` は変更していない。重大2件・中2件。

### 修正前に失敗を確認したtest

| file | 件数 | 内容 |
|---|---|---|
| `src/App.complete.test.js` | 4 | `session_ended` の await 後（退出・通知）、`dissolveRoom` の await 後、保存失敗の文言 |
| `src/composables/useSession.test.js` | 4 | 同一 sessionId の resume で旧 Promise が失効しない |

command: `npx vitest run src/App.complete.test.js -t "awaitをまたいだ旧処理"` /
`npx vitest run src/composables/useSession.test.js`

### 1. session_ended の await 後に stale を確認していなかった（重大）

callback は完了APIを await するが結果を受け取らず、**その時点の** `syncIsHost` で
退出処理へ進んでいた。待機中に別アカウント・別セッション・別ルームへ切り替わると、
`completeSessionD1()` は `stale` を返すのに無視され、**いま参加しているルーム**を
`leaveRoom()` していた。ゲスト経路の callback は現在の session / inventory / config を
消せるため、現在アカウントの作業が失われる。

- callback 開始時に `captureLifecycle()` と `syncIsHost` を捕まえる。
- await 後、`completed.stale` または `isLifecycleStale(origin)` なら**何もせず返る**
  （退出も通知もしない）。
- 退出・通知の分岐は**通知を受けた時点の** host / guest で判断する
  （await 中に変わった現在値に従わない）。

### 2. `_finishSession` がルーム解散の await 後に再確認していなかった（重大）

完了API直後の stale 確認はあったが、その後の `await dissolveRoom()` が抜けていた。
待機中にアカウント・セッションが変わっても旧処理が続行し、`_clearDraft()` /
`ackCompletionFinalized()` / `clearSession()` / 画面遷移を**現在のセッション**へ実行していた。

- `dissolveRoom()` の前に `captureLifecycle()` を取り、解散の成功・失敗どちらの後でも
  再確認する。stale なら後片付けを一切せずに返る。

### 3. 同一sessionIdの再開で旧Promiseが失効しない（中）

`_startFresh()` のコメントは「同じ id の旧ライフサイクルも失効する」としていたが、
世代を進めていなかった。`_isStale()` が見る世代は account reset でしか変わらないため、
**同一店舗・同一 sessionId で `resume()`** すると店舗も sessionId も一致し、
前のライフサイクルの応答が新しい方へ適用されていた。

- `_accountGeneration` を `_lifecycleGeneration` へ改め、`resetLocalData()` に加えて
  `_startFresh()`（= `begin()` / `resume()` / `clear()`）でも進める。
- App が await をまたいで同じ基準で確認できるよう `captureLifecycle()` /
  `isLifecycleStale(token)` を公開した。

### 4. durable保存失敗の説明が一般エラーだった（中）

`intent_not_persisted` は「端末に再送用データを保存できないので**送信していない**」
状態なのに、「サーバーへ完了を記録できませんでした」と表示していた。通信を疑って
同じ操作を繰り返させる文言だったため、専用の案内へ分けた
（端末の空き容量・送信していないこと・入力は残っていること）。

### 実行したcommandと結果

```
npx vitest run src/App.complete.test.js -t "awaitをまたいだ旧処理"（修正前）→ 4 failed
npx vitest run src/composables/useSession.test.js（修正前）                  → 4 failed
npx vitest run src/composables/useSession.test.js                          → 51 passed
npx vitest run src/App.complete.test.js                                    → 43 passed
npm --prefix app test -- --run                → 91 files / 994 tests passed（1回目）
npm --prefix app test -- --run                → 91 files / 994 tests passed（連続2回目）
npm --prefix app run build                    → 成功（PWA precache 17 entries / 2574.55 KiB）
npm --prefix worker test                      → 26 files / 545 tests passed
git diff --check                              → 指摘なし
git diff --name-only -- worker                → 出力なし
```

### test側で判明した制約

App test の `useSync` モックは `syncIsHost` / `syncIsActive` が**プレーンオブジェクト**で、
`computed()` が依存を追跡できない。mount 後に値を変えても App 側には反映されないため、
ホスト/ゲストの分岐は **mount 前**に決める必要がある。§1 の回帰testはゲスト経路を
mount 前に設定して再現している。

### 残risk（前回からの差分）

- `session_ended` の stale 判定は「通知を受けた時点」を基準にする。通知後に同じ
  セッションへ戻った場合（例: 退出→即再参加）は、その通知は処理されない。
  完了自体は `_finishSession` が主経路なので影響しない。

## 2026-08-18 — 再レビュー修正3（同期層の世代確認・intent保持・遅延処理）

基準 `c2cb281`。P1 3件・P2 1件。**`app/src/composables/useSync.js` を変更した**
（同期層の内側でしか直せない競合のため。Worker は未変更）。

### 修正前に失敗を確認したtest

| file | 件数 | 内容 |
|---|---|---|
| `src/composables/useSync.dissolve.test.js` | 2 | 解散待機中のつなぎ替えで新接続の token / socket / room を壊す（**新規file・実 useSync**） |
| `src/composables/useSession.test.js` | 1 | 同一 session の resume で未確定 intent が消える |
| `src/App.complete.test.js` | 3 | 解散通知の3.5秒後処理、不一致・欠落 `session_ended` での退出 |

### 1. `dissolveRoom()` の世代確認が遅く、新しい接続を切断できた（P1）

App 側の確認は `await dissolveRoom()` の**後**。しかし `useSync.dissolveRoom()` は
内部で 150ms 待ってから、**グローバルな `_ws` / `state` / `shopCode`** に対して
`clearHostToken()` と `leaveRoom()` を実行する。待機中につなぎ替わると、App が
確認するより先に新アカウントの host token 削除・新 socket の close・新ルーム状態の
idle 化・ゲスト leave callback が起きていた。

- 同期層の内側で **socket / shopCode / roomCode / roomType を待機前に捕まえ**、
  待機後に一致しなければ何もせず返る。
- `clearHostToken()` は捕まえた `type` を渡す（`_hostTokenKey()` の既定値は
  `state.roomType` で、待機後には新しいルームの種別になりうる）。
- 回帰testは `dissolveRoom` をモックせず、**実 useSync + MockWebSocket** で
  別店舗つなぎ替え・別ルーム参加・つなぎ替え無しの3系統を固定した。

### 2. 同一sessionIdの再開でdurable intentが消えた（P1）

`_startFresh()` は世代を進める一方で `completionUnknown` を解除し intent を削除して
いた。旧完了要求がサーバーに受理された後で `resume()` されると、旧応答は stale として
無視されるが**再送・確認に必要な body も失われ**、新しいライフサイクルは active 扱いに
戻る（サーバーだけ completed）。

- `_startFresh(next)` が、**同じ店舗・同じ sessionId の未確定 intent は保持**する。
  保持中は `completionUnknown` を立て、確認・同一 body の再送が済むまで
  `markActive()` を拒否する。
- 別 session を開始した場合と、別店舗の同じ sessionId は従来どおり破棄する。
- 「resume で intent が消える」ことを正しい挙動として固定していた test を反転した。

### 3. `dissolved` の3.5秒後処理が新しいセッションを消せた（P1）

解散通知から 3.5 秒後に無条件で `clearSession()` / `reset()` / landing 遷移を実行して
いた。待機中に別セッション開始・アカウント切替が起きると、旧ルームのタイマーが
現在の作業を削除する。

- callback 受付時に `captureLifecycle()` を取り、タイマー実行時に再確認する。
  stale なら何もしない。
- タイマー参照を保持し、`onUnmounted` で解除する（テスト間へ漏らさない）。
- fake timer による競合testと、切り替えが無い場合の従来どおりの片付けを固定した。

### 4. 不一致・欠落した `session_ended` が fail-closed でなかった（P2）

sessionId 不一致を warn するだけで return せず、そのまま guest 分岐へ進んで
**現在のルームを退出**していた。欠落時も同様。

- `sessionId` が無い、または**自分の進行中セッションと違う**通知は、完了・退出・通知を
  含めて即 return する。
- ただし **自分のセッションを持たないゲスト**（`pendingSession` 無し）は、
  従来どおりホストの完了通知で退出する。このルームについての通知であり、
  取り違える対象が無い。この差は test で明示している。

### 実行したcommandと結果

```
npx vitest run src/composables/useSync.dissolve.test.js（修正前）→ 2 failed / 1 passed
npx vitest run src/App.complete.test.js src/composables/useSession.test.js（修正前）→ 4 failed / 97 passed
npx vitest run src/composables/useSync                          → 6 files / 23 passed
npx vitest run src/App.complete.test.js src/composables/useSession.test.js → 101 passed
npm --prefix app test -- --run     → 92 files / 1004 tests passed（1回目）
npm --prefix app test -- --run     → 92 files / 1004 tests passed（連続2回目）
npm --prefix app run build         → 成功（PWA precache 17 entries / 2575.09 KiB）
npm --prefix worker test           → 26 files / 545 tests passed
git diff --check                   → 指摘なし
git diff --name-only -- worker     → 出力なし
```

### 残risk（今回の差分ぶん）

- `dissolveRoom()` は「待機中につなぎ替わったら何もしない」。旧ルームの host token は
  残るが、`dissolveRoomRemote()`（起動時の残存ルーム掃除）が同じ token で解散できる。
- `session_ended` の fail-closed により、sessionId を保存していないルームのゲストは
  この通知では退出しない。直後にホストが送る `dissolved` で退出する。

## 2026-08-18 — 再レビュー修正4（正常解散の誤判定・接続世代・remote解散の店舗境界）

基準 `e87080f`。P1 3件。`app/src/composables/useSync.js` と `App.vue` を変更（Worker は未変更）。

### 修正前に失敗を確認したtest

| file | 件数 | 内容 |
|---|---|---|
| `src/composables/useSync.dissolve.test.js` | 5 | 正常解散の誤判定、`dissolveRoomRemote` の店舗境界、接続世代 |
| `src/App.complete.test.js` | 1 | 同じ session のまま新ルームを作った場合の解散遅延処理 |

### 1. 正常なルーム解散を「接続切替」と誤認していた（P1・前回修正の回帰）

前回入れた `_ws !== socket` の中止条件が広すぎた。実 Worker（`RoomDO` の `dissolve`）は
**ホスト自身へ `dissolved` を送らず**、直後に全 socket を close する。そのため正常な解散でも

1. ホストの `onclose` が `_ws = null` にする
2. `state.mode` は `hosting` のままなので**再接続タイマーが登録される**
3. 150ms 後の照合が `_ws !== socket` に当たって return
4. `clearHostToken()` / `leaveRoom()` が実行されない

となり、hosting 状態・host token・再接続タイマーが残って**解散したルームを作り直す**。

- 中止条件を「**別の生きた接続へ張り替わった**」だけに絞った
  （`_ws && _ws !== socket`、または shopCode / roomCode / roomType の変化）。
  `_ws === null`（自分の socket が閉じただけ）は正常な解散として片付けを続行する。
- 回帰testは Worker と同じ順序（dissolve 送信 → server が socket close）を再現し、
  token 削除・`idle` 化に加えて**再接続タイマーが残っていない**ことまで確認する。

### 2. 3.5秒cleanupが同じsessionの新ルームを消せた（P1）

タイマーは App の lifecycle 世代（generation / shop / sessionId）だけを見ていた。
**同じ `pendingSession` のまま新しいルームを作る**経路（`SyncModal` は `begin()` を
呼ばないので世代が変わらない）では、旧ルームのタイマーが新ルームで使用中の
セッション・在庫を消せた。

- `useSync` に**接続世代**を追加した。`captureSyncConnection()` /
  `isSyncConnectionStale(token)`。`_connect()`（新しい接続を張る）でだけ進み、
  解散・退出では進まない（解散後の正当な後片付けを失効させないため）。
- 解散の遅延処理は lifecycle 世代と接続世代の**両方**を確認する。

### 3. `dissolveRoomRemote()` にアカウント切替競合が残っていた（P1）

`code` / `token` は捕まえていたが、`await fetch()` 後の `clearHostToken(type)` は
**現在の shopCode から key を作り直す**。待機中に店舗 A→B へ切り替わると、A の解散応答で
B の host token を削除できた。

- 削除対象の **key も待機前に確定**させ、`_clearHostTokenIf(key, token)` で
  「捕まえた key が捕まえた token のままのときだけ」消す。
  同じ店舗でも新しいルームを作って token が差し替わっていれば消さない。
- `App.onSessionStart()` も `await dissolveRoomRemote('stock')` の後に
  `isLifecycleStale()` を確認し、切替前に選んだセッションを開始しない
  （別店舗の session を `beginSession()` すると `reset()` で現在の在庫まで消える）。

### 実行したcommandと結果

```
npx vitest run src/composables/useSync.dissolve.test.js（修正前）→ 5 failed / 4 passed
npx vitest run src/App.complete.test.js -t "同じsessionで新ルーム"（修正前）→ 1 failed / 1 passed
npx vitest run src/composables/useSync            → 6 files / 29 passed
npx vitest run src/App.complete.test.js           → 50 passed
npm --prefix app test -- --run    → 92 files / 1012 tests passed（1回目）
npm --prefix app test -- --run    → 92 files / 1012 tests passed（連続2回目）
npm --prefix app run build        → 成功（PWA precache 17 entries / 2575.49 KiB）
npm --prefix worker test          → 26 files / 545 tests passed
git diff --check                  → 指摘なし
git diff --name-only -- worker    → 出力なし
```

### 未実施・残risk

- `App.onSessionStart()` の切替後guardは、`SessionListPage` を通した end-to-end の
  回帰testを持っていない（`dissolveRoomRemote` 側の破壊的動作は useSync の test で固定済み）。
  一覧からのセッション開始を駆動するtestは `SessionListPage.flow.test.js` の範囲で、
  次のセッションの課題として残す。
- 実D1・実browser・実機は未確認。migration 0012〜0016 は未適用。

## 2026-08-18 — 再レビュー修正5（接続世代の利用・練習モードguard・TZ依存test）

基準 `a5dfcbd`。P1 2件＋test安定性1件。

### 修正前に失敗を確認したtest

| file | 件数 | 内容 |
|---|---|---|
| `src/composables/useSync.dissolve.test.js` | 3 | CONNECTING中の張り直しを検出しない・戻り値が無い |
| `src/App.complete.test.js` | 2 | 解散が中止されても後片付けを続ける |
| `src/App.authLoss.test.js` | 2 | `TZ=Pacific/Kiritimati`（UTC+14）で再現 |

### 1. 接続世代を解散処理自身と呼び出し側が使っていなかった（P1）

`_ws` への代入は **onopen 後**。同じ shop/room/type へ張り直した新 socket が
CONNECTING の間は `_ws` が null のままなので、socket / shop / room / type の比較だけでは
切替を検出できない。token を消して `leaveRoom()` しても接続中の socket は閉じられず、
後から onopen して**接続が復活**する。逆に新 socket が既に OPEN なら `dissolveRoom()` は
早期 return するが、App 側は lifecycle しか見ずに session・intent・draft を消していた。

- `dissolveRoom()` が**開始時の接続世代**も捕まえて比較する。
- `dissolveRoom()` が結果を返すようにした（`{ ok: true }` / `{ ok: false, reason: 'connection_changed' }`）。
- App の呼び出し側2か所（`_finishSession` / `onStartNew`）が、
  **戻り値・lifecycle 世代・接続世代の3つ**を確認してから後片付けへ進む。

### 2. 練習モードに解散待機後の guard が無かった（P1）

`onSessionStart()` には入れたが `onStartPractice()` が未対応だった。
`dissolveRoomRemote()` の待機中にアカウントが切り替わると、その後の `reset()` /
`clearSession()` が現在の在庫・セッションを消して練習モードへ入る。
`onSessionStart()` と同じ lifecycle capture と await 後の確認を入れた。

### 3. TZ依存でApp testが落ちていた（test安定性）

`App.authLoss.test.js` の「今日」を `toISOString()`（UTC）で作っていた。
履歴カレンダーは `todayKey` を**ローカル日付**（`getFullYear/getMonth/getDate`）で決め、
セッションの日付キーは ISO 文字列の先頭10文字（**UTC**）で作る。UTC とローカルの日付が
ずれる時間帯（JST 00:00〜09:00、UTC+14 の終日など）では、seed した完了セッションが
「今日」のセルに並ばず詳細行を開けない。

- fixture の日付を**ローカル日付キー**（カレンダーの `todayKey` と同じ作り方）へ変更。
- `useInventory` の当日判定は UTC のままなので、在庫 seed の `date` は UTC を維持し、
  なぜ2種類あるかをコメントで明記した。
- 検証: `TZ=Pacific/Kiritimati`（UTC+14）/ `TZ=Pacific/Niue`（UTC-11）/ `TZ=Asia/Tokyo`
  の3つで対象testと**App全体**を実行し、いずれも全件成功。

**製品側の既知の不整合として記録**（今回は修正しない）: 履歴カレンダーは
「今日」をローカル日付、セッションの所属日を UTC 日付で決めている。JST 00:00〜09:00 に
完了した棚卸は前日のセルに並ぶ。DATA-001 の scope 外だが、UI の日付境界の課題として残す。

### 実行したcommandと結果

```
npx vitest run src/composables/useSync.dissolve.test.js（修正前）→ 3 failed / 9 passed
npx vitest run src/App.complete.test.js -t "解散が切替で中止"（修正前）→ 2 failed / 1 passed
TZ=Pacific/Kiritimati npx vitest run src/App.authLoss.test.js（修正前）→ 2 failed / 5 passed
npx vitest run src/composables/useSync           → 6 files / 32 passed
npx vitest run src/App.complete.test.js          → 53 passed
npm --prefix app test -- --run                   → 92 files / 1018 tests passed（1回目）
npm --prefix app test -- --run                   → 92 files / 1018 tests passed（連続2回目）
TZ=Pacific/Kiritimati npm --prefix app test -- --run → 92 files / 1018 tests passed
npm --prefix app run build                       → 成功（PWA precache 17 entries / 2575.90 KiB）
npm --prefix worker test                         → 26 files / 545 tests passed
git diff --check                                 → 指摘なし
git diff --name-only -- worker                   → 出力なし
```

## 再レビュー修正6（2026-08-18・Claude Code / 基準 `dea4785`）

### P1 自分の解散マークが正常解散・中止のあとも残る

`_hostInitiatedDissolve` は解散の直前に `true`、`dissolvedCallback` の中だけで `false` に
戻る boolean だった。しかし実 Worker の WebSocket 解散（`worker/src/RoomDO.js` の
`case 'dissolve'` → `this._broadcast({ type: 'dissolved' }, ws)`）は**送信元ホストを配信から
除外する**ため、ホストが正常に解散しても callback は呼ばれない。`connection_changed` で
解散を中止した場合も呼ばれない。結果、フラグは `true` のまま残る。

その状態で別ルームへゲスト参加し、そのルームが解散されると、通知を「自分が解散した」と
誤認して `clearSession()` / `reset()` / `clearAuditLog()` / landing 遷移を**実行しない**。
別店舗のゲストデータが画面とメモリに残る。

- boolean を廃止し、**接続世代に紐づく self-dissolve token** にした
  （`_markSelfDissolve()` / `_consumeSelfDissolve()` / `_clearSelfDissolve()`）。
  - 消費は1回だけ。`_consumeSelfDissolve()` は必ず token を捨ててから判定する。
  - **同じ接続で**届いた通知だけを「自分の解散」として扱う。新しいルームを張ると
    `_connectGeneration` が進むので、残った token は自動的に失効する。
  - HTTP 経路の解散（`RoomDO.js:137`）は送信元も含めて配信するため、同じ接続で自分の
    dissolved が返る経路は残る。そこは従来どおり「ルームが閉鎖されました」で扱う。
- 解散を中止した2経路（`_finishSession()` / `onStartNew()`）では token を明示的に破棄する。
- 回帰test（`App.complete.test.js`、修正前2件失敗）:
  - 正常解散 → 接続世代が進む（別ルームへ参加）→ `dissolvedCallback()` が
    「セッションが破棄されました」と3.5秒後の片付け（landing 遷移）を行う。
  - `connection_changed` で中止 → 別ルームの解散通知で `pendingSession` が消え landing へ。
  - 同じ接続のまま自分の解散通知が返る場合は従来どおり「ルームが閉鎖されました」で
    片付けない（既存の意図の固定）。

### 実行したcommandと結果

```
npx vitest run src/App.complete.test.js -t "自分の解散マーク"（修正前）→ 2 failed / 1 passed
npx vitest run src/App.complete.test.js          → 56 passed
npm --prefix app test -- --run                   → 92 files / 1021 tests passed（1回目）
npm --prefix app test -- --run                   → 92 files / 1021 tests passed（連続2回目）
npm --prefix app run build                       → 成功（PWA precache 17 entries / 2576.00 KiB）
npm --prefix worker test                         → 26 files / 545 tests passed
git diff --check                                 → 指摘なし
git diff --name-only -- worker                   → 出力なし
```
