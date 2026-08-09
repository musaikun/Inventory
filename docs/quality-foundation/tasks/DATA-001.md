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
