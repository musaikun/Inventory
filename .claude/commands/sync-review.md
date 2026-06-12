# /sync-review — 同期コードの整合性チェック

`useSync.js` と `RoomDO.js` の整合性を確認する。
ファイルを読んで以下のチェックリストを検証し、問題点をリストアップせよ。

## チェックリスト

### 1. メッセージ型の対称性
- クライアントが送る全 `type` が DO 側の `switch` に対応しているか
- DO がブロードキャストする全 `type` がクライアントの `_handleMessage` に対応しているか

### 2. ホスト専用操作のガード
以下のメッセージは DO 側で `_isHost(ws)` チェックがあるか：
- `config` / `dissolve` / `session_start` / `session_end`

### 3. ゲスト参加時の状態同期（`joined` メッセージ）
- inventory が渡されてクライアントに適用されているか
- config がホストのものに揃えられているか（`isCustom` 問わず）
- auditLog が渡されているか
- sessionId / isSessionActive が同期されているか

### 4. 新セッション vs 再開の判定
- `session_start`: `isResume = !!(newId && newId === prevId)` で正しく分岐しているか
- 新セッション時: inventory・auditLog・config が DO に原子的に保存されているか
- `session_started` ブロードキャストに config が同梱されているか

### 5. オフラインマージ
- `_disconnectedAt` が `ws.onclose`（mode !== idle 時）にセットされているか
- `_resetClientState()` で `_disconnectedAt` がリセットされているか
- マージ後に `_disconnectedAt = 0` されているか

### 6. hostToken フロー
- 初回: DO が発行 → `joined` に含めて返す → クライアントが localStorage に保存
- 再接続: クライアントが `join` に付与 → DO が照合 → 不一致で auth_failed
- dissolve 時: `clearHostToken()` が呼ばれるか

## 報告形式
問題なし / 要修正 に分けてリストアップ。
修正が必要な場合はそのまま修正してよい。
