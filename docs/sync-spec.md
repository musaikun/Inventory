# 同期アーキテクチャ仕様

## メッセージフロー

```
クライアント → DO:   join / update / remove / config / session_start / session_end / dissolve / ping
DO → クライアント:   joined / update / remove / participants / session_started / session_ended /
                     config_update / audit_entry / message / dissolved / error / pong
```

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

## auditLog 構造

```js
{
  id:          string,         // `${timestamp}-${random}`
  ingredient:  string,
  action:      'new' | 'add' | 'overwrite' | 'remove',
  delta:       number,         // 変化量（remove は負）
  totalQty:    number,
  unit:        string,
  enteredBy:   string,         // 表示名（名前変更時に更新される）
  enteredById: string,         // deviceId（不変）
  timestamp:   number,         // Unix ms
}
```

最大200件。古いものから削除。
