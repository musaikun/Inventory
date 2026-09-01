# 同期アーキテクチャ仕様

| Field | Value |
|---|---|
| Status | **Current baseline**。W1 Web Free版の同期・認可境界。公開可否は[Web release gate](quality-foundation/web-release-readiness.md)を正とする |
| Role | App / Worker / Durable Objects / D1の責務と、実装済み境界・既知gapを結ぶ現行仕様 |
| Source of truth | [`useSync.js`](../app/src/composables/useSync.js)、[`RoomDO.js`](../worker/src/RoomDO.js)、[`index.js`](../worker/src/index.js)、[`authHandler.js`](../worker/src/authHandler.js)、migration、関連test |
| Last verified | **2026-08-04 / `develop@bc9fb85`**（code review。production反映済みを意味しない） |

## 現行baseline

### 権限とdataの正

- `shopCode`は店舗account、room URL、DOのrouting keyを兼ねる。棚卸は`room:<shopCode>`、
  発注は`room:<shopCode>:order`の別DOへ分離する。
- active room中の共有在庫、発注数、config、recount flag、chat、audit、session状態は
  **RoomDO storage**が共有stateの正。参加済み権限はWebSocket attachmentの`joined`、
  `deviceId`、`isHost`を正とし、hibernation後も復元できる。
- account、Bearer token、店舗data、session一覧、完了明細はD1が正。localStorageは端末cache、
  host token、接続復元情報、未送信queueの一部を持つが、accountやserver entitlementの正ではない。
- DOは一律20 device ID、24時間inactivity TTL、chat/audit各200件を上限とする。
  この20台上限はplan-awareではなく、W1のFree 2台契約を強制していない。

### 接続・join認可

1. Workerの`/room/:code/{ws,status,dissolve}` gateが、削除中でない店舗をD1で確認してから
   DOへ転送する。DB binding欠落、D1例外、店舗不明は503/404で閉じる。
2. WebSocket upgrade後も、`join`成功前は`ping`以外を`join_required`（1008）で拒否し、
   未参加socketへroom dataを配信しない。空`deviceId`、二重joinも拒否する。
3. PIN設定店舗のhost tokenが一致しない初回発行・復旧では、有効Bearer tokenと店舗codeの
   一致を必須にする。保護状態不明、DB欠落、D1例外は**fail-closed**。D1でPIN未設定と
   明示確認できたlegacy店舗だけ、従来のtopology判定を使う。
4. guestはactive sessionと一致する`joinSessionId`が必要。host-only操作はconfig、dissolve、
   session start/end、conflict lock、品目追加応答。単価を含みうるconfigはguest宛てに除去する。

根拠testは[`RoomDO.joinAuth.test.js`](../worker/src/RoomDO.joinAuth.test.js)、
[`RoomDO.hostAuth.test.js`](../worker/src/RoomDO.hostAuth.test.js)、
[`index.test.js`](../worker/src/index.test.js)。現在turnでは再実行していない。

### lifecycle・再接続

- hostは`join`後に`session_start`を送り、新規sessionでは在庫、発注、flag、configを保存して
  `session_started` snapshotを配信する。同一session IDの再開ではDOの既存stateを読む。
- guestの初回参加はlocal在庫/configをhost snapshotへ揃える。再接続は1.5 / 3 / 6 / 12 /
  30秒backoffで、在庫の`updatedAt`と切断時刻を比較する。双方更新かつ値が違う場合は
  conflict、localだけ更新なら再送、server値があればserverを適用する。
- 発注は在庫と異なり、参加・再接続時にDO snapshotを採用し、offline中のlocal発注編集を
  再送しない。
- `session_end`はDOの`isActive`をfalseにして通知する。恒久履歴のD1保存は別経路であり、
  DOの終了通知だけでは履歴dataの永続化成功を保証しない。

### account削除

- [account deletion contract](quality-foundation/account-deletion-contract.md)に従い、Worker内部header付きで
  棚卸・発注の2 DOへDELETEし、接続close、item request破棄、alarm削除、`deleteAll()`を行う。
- DO purge成功後にD1関連dataをbatch削除する。DOまたはD1失敗は成功扱いにせず、同じ
  `requestId`で再試行する。Appは削除成功時に同期socket、再接続timer、memory/local sessionを消す。
- repository code/testは存在するが、production D1の0011適用と現行Worker deployは未完。

## 既知gapと追跡先

| Gap | 現状 | 追跡先 |
|---|---|---|
| Free接続上限 | Appの事前guardは新規端末のroom人数を信頼できず、DOはplanを見ず20台まで許可 | [`WEB-001`](quality-foundation/tasks/WEB-001.md) / WEB-06 |
| 履歴の端末依存 | 一覧は`sessions`、表示snapshotはlocalStorage / `store_history`、明細は読取APIのない`inventory_lines`に分裂 | [`DATA-002`](quality-foundation/tasks/DATA-002.md) |
| 完了writeの部分失敗 | snapshot保存は非awaitの別request。`inventory_lines`とsession完了更新、注文・移動のheader/linesも単一transactionではない | [`DATA-001`](quality-foundation/tasks/DATA-001.md) |
| 未送信queue | snapshot/order/movement queueはmemoryのみでreloadに耐えず、保存失敗の恒久可視化もない | [`DATA-002`](quality-foundation/tasks/DATA-002.md) |
| offline削除 | 在庫mergeにtombstoneがなく、切断中のlocal/server削除を区別できない。発注offline編集も破棄される | [`TEST-002`](quality-foundation/tasks/TEST-002.md) / WEB-09 |
| hibernation | 品目追加要求のrequest先はmemory `Map`だけで、DO休止復帰時に失われる | [`DO-001`](quality-foundation/tasks/DO-001.md) |
| production証拠 | critical host/guest再接続E2E、実production CORS/migration/smokeは未完 | [`WEB-001`](quality-foundation/tasks/WEB-001.md) / [`TEST-002`](quality-foundation/tasks/TEST-002.md) |

直近のCI成功は[session log](quality-foundation/session-log.md)の対象commit・commandを参照する。
unit testの過去成功をproduction WebSocket / D1 / DO integration成功とは扱わない。

## 参考snapshot（旧詳細）

以下は既存の詳細説明を履歴として保持する。上のbaselineまたは現行codeと矛盾する場合は、
上のbaseline、code、現行taskを優先する。特に旧「3方向マージ」の削除推定は現行実装に無く、
削除tombstone問題は上記gapが正しい。

## メッセージフロー

```
クライアント → DO:   join / update / remove / order_update / order_remove / config /
                     session_start / session_end / dissolve / ping
DO → クライアント:   joined / update / remove / order_update / order_remove / participants /
                     session_started / session_ended / config_update / audit_entry /
                     message / dissolved / error / pong
```
（他に recount_flag・typing・競合通知系あり。網羅列挙は RoomDO.js の `_handleMessage` が正）

### ゲストからの申請（ホスト承認つき）

ゲストは品目リストを直接変えられない。変更は**申請 → ホストの承認**を通し、
承認された結果は config の配り直しで全員へ降りる。DO は中継だけを行い、何も書き換えない。

| メッセージ | 向き | 内容 | 備考 |
|---|---|---|---|
| `item_add_request`  | ゲスト → DO → ホスト | `requestId` / `name` / `unit` / `code` | DO が `fromDeviceId` / `fromDeviceName` を付ける |
| `item_add_response` | ホスト → DO → 申請者 | `requestId` / `approved` / `name` | **`_isHost` 検証あり**。ホスト不在なら DO が `reason:'host_offline'` で即返す |
| `item_hide_request`  | ゲスト → DO → ホスト | `requestId` / `name` | 同上。**ゲスト端末では隠さない**（隠すと次の config で戻り、消えたのに復活して見える） |
| `item_hide_response` | ホスト → DO → 申請者 | `requestId` / `approved` / `name` | 同上 |

`requestId` → 申請元 WebSocket の対応は DO のメモリ（`_itemAddRequests` / `_itemHideRequests`）に
持つ。hibernation で失われるが、失われた場合は申請が返らないだけで state は壊れない。

同じ品目へ複数人が申請したとき、DO は**それぞれの `requestId` に対して申請元へ返す**。
ホスト側は品目名でまとめて返すこと（1件にだけ答えると、もう一方は承認待ちのまま残る）。

## セッションライフサイクル

```
ホスト: createRoom() → _connect(shopCode) → join{role:host, hostToken}
          → session_start{sessionId, inventory, config}
          → session_end{status} → dissolve（任意）

ゲスト: joinRoom(code) → _connect(code) → join{role:guest}
          → joined{inventory, config, sessionId, ...}
          → session_started（ホストが開始したとき）
```

## ホスト認証

- 初回接続: DO が UUID トークンを発行 → DO storage + client localStorage に保存
- 再接続: join に hostToken を付与 → DO が照合 → 不一致は ws.close(1008)
- `_host_token_{shopCode}` キーで店舗ごとに localStorage 保存

## 在庫マージ（オフライン再接続）

`_disconnectedAt` タイムスタンプ + 各エントリの `updatedAt` で3方向マージ:

| 状況 | 処理 |
|---|---|
| サーバー側が新しい | サーバーを適用 |
| ローカルが新しい | ローカルを維持 → サーバーへ再送信 |
| ローカルのみ（切断後追加） | 保持 → サーバーへ再送信 |
| ローカルのみ（切断前から存在） | サーバーで削除されたとみなし削除 |

## ゲスト参加時の品目リスト同期

- `joined` 受信時: `isCustom` に関わらず**常にホストの config を適用**
- ホストに config がない場合: `_onResetConfig?.()` でデフォルト復帰
- 新セッション（sessionId 変化）: `session_started` に config を同梱 → ゲストに強制適用

## 発注数の同期（orders チャネル・2026-07 追加）

- 発注セッション中の発注数は在庫(`inventory`)とは**別マップ** `orders`（DO storage 単一キー）で同期する。
  エントリ: `{ orderQty, unit, lot, enteredBy, enteredById, updatedAt }`
- `order_update`（orderQty>0）／`order_remove`（取り消し）。DO はサニタイズ後に保存し、
  audit（`order_set`/`order_clear`）を記録して送信者以外へブロードキャストする。
- スナップショット同梱: `joined`（ゲスト参加時）と `session_started`（新規=ホスト送信の
  `session_start.orders` を保存／再開=既存を読み出し）。新規の**棚卸**セッションでは
  `orders` は空にリセットされる。
- クライアントの発注下書きはセッション単位の localStorage キー
  （`order_draft_ord_<sessionId>`）で分離。
- ⚠️ **オフライン時の仕様（現状・要検討）**: 参加/再接続時は DO のスナップショットが正で、
  ローカルのみの発注編集は**破棄**される（在庫の3方向マージ＋再送とは非対称）。
  ホスト再接続時もローカルの発注下書きは DO へ再送されない。
  → 取り込みレビュー 2026-07-15 の指摘 R2-03（`docs/intake-reviews.md`）。

## auditLog 構造

```js
{
  id:          string,         // `${timestamp}-${random}`
  ingredient:  string,
  action:      'new' | 'add' | 'overwrite' | 'remove'
             | 'flag_recount' | 'unflag_recount' | 'order_set' | 'order_clear',
  delta:       number,         // 変化量（remove は負）
  totalQty:    number,
  unit:        string,
  enteredBy:   string,         // 表示名（名前変更時に更新される）
  enteredById: string,         // deviceId（不変）
  timestamp:   number,         // Unix ms
}
```

最大200件。古いものから削除。
