# 同期アーキテクチャ仕様

## メッセージフロー

```
クライアント → DO:   join / update / remove / order_update / order_remove / config /
                     session_start / session_end / dissolve / ping
DO → クライアント:   joined / update / remove / order_update / order_remove / participants /
                     session_started / session_ended / config_update / audit_entry /
                     message / dissolved / error / pong
```
（他に recount_flag・typing・競合通知系あり。網羅列挙は RoomDO.js の `_handleMessage` が正）

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
