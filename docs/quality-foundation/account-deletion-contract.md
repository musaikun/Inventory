# Account deletion contract

最終更新: 2026-08-17
Backend owner: Codex / UI・公開Web owner: Claude Code
役割: W1 Webと将来A1で共用する削除境界の正本
最新照合: 2026-08-17 / `claude/data-002-worker-d1-api-bogzyq`
状態: code/testは実装済み。本番D1 0011〜0016、canonical URL、実機確認は未完

## 目的

Web利用者の自己削除と将来のGoogle Play account deletion要件に対し、in-appと公開Webの両方から同じbackendを使って
店舗accountと関連dataを削除します。論理削除だけで完了とはせず、業務dataを物理削除し、
再利用や復元に使えない最小tombstoneだけを短期間保持します。

## API

`DELETE /auth/account`

Headers:

```http
Authorization: Bearer <current-token>
Content-Type: application/json
```

Body:

```json
{
  "requestId": "UUID generated once by the client",
  "pin": "1234",
  "confirmation": "ABCDEF"
}
```

- `requestId`: 削除画面を開いた時点で1回だけ生成し、再試行でも同じ値を使う。
- `pin`: 現在の4桁PIN。Bearer tokenだけでは削除しない。
- `confirmation`: 認証tokenの店舗codeを大文字のままcase-sensitiveで完全一致させる。

Success / replay:

```json
{
  "ok": true,
  "status": "deleted",
  "requestId": "...",
  "deletedAt": "2026-07-25T00:00:00.000Z",
  "alreadyDeleted": false
}
```

同じ `requestId` の再送は、account token削除後でも7日間は `200` と
`alreadyDeleted: true` を返します。7日経過後はreceiptも削除され、失効tokenでの再送は
`401 reauthentication_failed` になります。

| HTTP | code | UIの扱い |
|---:|---|---|
| 400 | `invalid_request` / `confirmation_mismatch` | 入力を修正 |
| 401 | `reauthentication_failed` | PINまたはsessionを再確認 |
| 429 | `too_many_attempts` | PIN失敗が15分に5回以上。15分ほど空ける |
| 409 | `deletion_in_progress` | 別requestIdが進行中。新しいIDでは再試行せず、保存済みの元IDを復元する |
| 503 | `deletion_temporarily_unavailable` | dataは完了扱いにせず、同じrequestIdで再試行 |

## Backend処理順

1. UUID形式を確認し、完了receiptがあれば同一requestIdの冪等成功を返す。
2. 有効token、case-sensitiveな店舗code confirmation、現在PINを照合する。PIN失敗は
   loginと共通の `login_attempts` に記録し、15分5回で429にする。
3. `stores.deletion_pending_at` と `deletion_request_id` を設定する。通常token、store API、
   store参照、room gateを遮断し、0011のtriggerでaccount子dataの新規INSERTも拒否する。
4. Worker内部から `X-Inventory-Internal-Action: account-delete-v1` を付け、棚卸用・発注用の
   2つのDurable Objectをcloseする。互換日を考慮してalarmを消し、storageを `deleteAll()` する。
5. D1 `batch()` で関連data削除、全token失効、store匿名化、receipt作成を原子的に行う。
6. 日次cronで7日後に匿名tombstoneとreceiptを削除する。

DO削除またはD1 batchが失敗した場合は `503 retryable` とし、成功を返しません。
途中まで消えたDOは同じrequestIdで安全に再削除できます。

## Data map

| Data | 処理 |
|---|---|
| `store_configs`, `store_inventory`, `store_history` | 物理削除 |
| `sessions`, `inventory_lines`, `item_par_levels` | 物理削除 |
| `import_batch_requests`（過去棚卸取込の要求台帳・migration 0015） | 物理削除。取込の再送判定に使う指紋と対象sessionIdを持つため業務dataとして扱う |
| `session_completions`（棚卸完了のclaim・migration 0016） | 物理削除。確定済み完了の指紋・件数・合計・棚卸日を持つため業務dataとして扱う |
| `orders`, `order_lines` | 物理削除 |
| `movements`, `movement_lines` | 物理削除 |
| `push_subscriptions` | 物理削除し、以後のPush送信を停止 |
| `auth_tokens`, `login_attempts` | 物理削除、全token失効 |
| `stores` | 店名・PIN hash・plan・active roomを消去したtombstoneを7日保持後に物理削除 |
| account deletion receipt | account識別子を持たないrequestIdと完了時刻だけを7日保持 |
| stock/order Durable Objects | 接続を閉じ、全storageを削除 |
| R2 | 現在binding・保存実装なし。削除対象なし |
| PostHog | shopCode/emailをidentifyしていない。端末identity resetと保持方針は `PLAY-003` / `PRIV-001` |
| localStorage（業務data、端末ID・端末名、天気位置/cache）/ PushSubscription | 削除成功後にclientで消去 |
| Cache API / Service Worker | app shell・font・PDF cMapの公開静的assetだけを保持し、account/API dataは保存しない。account削除時のcache削除・SW解除は不要 |
| D1 Time Travel / provider backup | providerの回復期間満了まで残り得る。通常復元へ使用せずprivacy policyへ明記 |
| `ip_attempts` / platform log | account keyを持たないsecurity record。保持期間とData Safetyは `PLAY-003` / `OPS-001` で確定 |

## UI integration

- 設定内に見つけやすい「アカウント削除」を置く。
- 店舗名、店舗code、削除対象、復元不能であることを表示する。
- PINと店舗code再入力の後に最終確認する。
- `requestId` は再試行で変えない。
- `200 deleted` を受けてから、Push購読解除、account data/local cache、PostHog local identityを消去する。
- `503` やnetwork errorではlocal tokenを先に消さず、同じrequestIdの再試行手段を残す。
- `409` は別requestId競合のため、新しいrequestIdを再送し続けない。端末に保存した元IDを使う。
- 公開Web導線はアプリ再installを要求せず、login後に同じAPIを使えるようにする。

## Release evidence

- 正常、誤PIN、429、confirmation不一致、別店舗、別requestId競合、同一requestId再送、
  DO失敗、D1失敗、cleanupを自動testする。
- 削除testは`import_batch_requests` / `session_completions`を含む全業務tableへ
  **対象店舗と別店舗の行を実際にseed**し、対象店舗だけが消えること・別店舗が残ることを固定する
  （`worker/src/accountDeletion.test.js`）。batch途中失敗ではこれらを含めて全体がrollbackする。
- migration適用、Worker test、App integration、公開Web URLをrelease前に記録する。
- deployとmigration適用はUser承認後に行う。
