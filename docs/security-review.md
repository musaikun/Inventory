# セキュリティレビュー — 飲食店棚卸システム

多店舗展開前のセキュリティチェックリスト。
「対応済み」と「残課題」を一目で把握できるよう管理する。

---

## 対応済み ✅

### S-01 ログイン総当たり対策
- **リスク**: PIN 4桁 × 高速ハッシュ × 試行制限なし → 数秒で突破可能
- **対策**: `login_attempts` テーブルで失敗回数を記録。15分以内に5回失敗で429ブロック。成功でクリア
- **実装**: `authHandler.js` / migration `0003_login_attempts.sql`
- **テスト**: `authHandler.test.js` — 3ケース

### S-02 データ系APIの後方互換ソフト認証
- **リスク**: `config` / `inventory` / `history` / `room` が店舗コードだけで誰でも読み書きできた
- **対策**: `verifyStoreAccess` — PIN設定済み店舗はBearerトークン必須。レガシー（PIN未設定）店舗は従来通り許可
- **実装**: `authHandler.js` + `index.js` ルーターにゲート追加
- **テスト**: `authHandler.test.js` — 4ケース

### S-03 ペイロードサイズ上限
- **リスク**: サイズ無制限のJSONをPUT/POSTしてD1容量を圧迫する経済的DoS
- **対策**: `config` / `inventory` / `history` の書き込みを約1MB（1,000,000文字）で制限。超過時は413
- **実装**: `storeHandler.js` `_tooLarge()` + 各ハンドラの先頭でチェック
- **テスト**: `storeHandler.test.js` — 5ケース

### S-05 ✅ HTTPレート制限（IPベース）
- **リスク**: `/auth/login` の店舗単位制限（S-01）は店舗コードを変えながらの総当たりに無力だった
- **対策**: IP単位の失敗カウント（15分窓・30回）。超過で429。`kind='login'` と `kind='probe'` を独立管理
- **実装**: `rateLimiter.js`（`clientIp` / `isIpBlocked` / `recordIpFail`）+ `index.js` ログインルート + migration `0005_ip_attempts.sql`
- **テスト**: `rateLimiter.test.js` 8ケース + `index.test.js` 統合6ケース

### S-06 ✅ ルームコード総当たり対策
- **リスク**: ルームコード（24^6 ≈ 1.9億通り）をWebSocket接続で総当たりするとゲストとして入室可能。DO起動コストも攻撃者に握られていた
- **対策**:
  1. `/room/:code/(ws|status|dissolve)` で店舗コードの存在を Worker 層（D1）で先に確認。存在しなければ404で **DOを起動させない**
  2. 存在しないコードへのアクセスを IP 単位で記録（`kind='probe'`）。15分窓30回で429
- **実装**: `index.js` ルームルート共通ゲート + `rateLimiter.js`
- **テスト**: `index.test.js` — 404/DO非到達・転送・記録・429・別IP非ブロック

### S-A ✅ ホスト乗っ取り（DOトークン復旧の認可強化）
- **リスク**: `RoomDO` の join は hostToken 不一致でも「空室 / 同一deviceId / 他にホスト不在」のいずれかで
  トークンを再発行しホスト承認していた。店舗コードを知る第三者（招待URLを受け取った元ゲスト等）が
  正規ホストのオフライン中に `role: 'host'` で接続するだけで、在庫・**単価**・監査ログ・チャットの取得と
  ルーム解散が可能だった。②の deviceId は自己申告のため詐称も可能
- **対策**: PIN設定済み（保護）店舗はホスト権限の（再）発行に **D1認証トークンの検証を必須**化。
  ブラウザ WS はヘッダを付けられないため、認証トークンは join メッセージに載せ（WSS暗号化）、
  DO は自分の店舗コード（URLパス由来・Worker で存在検証済み）に対して `verifyAuthToken` で照合する。
  hostToken 一致の再接続は従来どおり高速パス（D1照合なし）。レガシー（PIN未設定）店舗は後方互換で
  従来のトポロジ判定を維持。D1障害時はフェイルオープン（レガシー扱い）で可用性を優先
- **実装**: `RoomDO.js`（`canGrantHost` / `_isStoreProtected` / `_hostAuthOk` / fetch で店舗コード記録）、
  `authHandler.js`（`verifyAuthToken` 分離）、`useSync.js`（ホスト join に `authToken` 同梱）
- **テスト**: `RoomDO.hostAuth.test.js` — 保護店舗8ケース（認証必須の確認）／レガシー後方互換

---

### S-04 ✅ PINハッシュ強化（PBKDF2）
- **リスク**: 旧実装は SHA-256(shopCode:pin)（高速ハッシュ・saltは公開情報の店舗コードのみ）。
  D1流出時に全店舗のPINが総当たりで即割れる。S-01/S-05 のオンライン制限をかいくぐれた場合も脆弱
- **対策**: PBKDF2（`crypto.subtle.deriveBits`・SHA-256ベース・100,000反復・16バイトのランダムsalt）へ移行。
  保存形式 `pbkdf2$<iter>$<saltB64>$<hashB64>`。照合は定数時間比較（`_ctEqual`）
- **透過移行**: 新規登録は即PBKDF2。既存の旧SHA-256店舗は**次回ログイン成功時に自動で再ハッシュ**して
  `stores.pin_hash` を更新（ユーザー操作・強制ログアウト不要）。反復回数を将来引き上げた場合も同経路で更新
- **実装**: `authHandler.js`（`_hashPin` / `_verifyPin` / `_legacySha256` / login の rehash）、`constants.js`（`PBKDF2_ITERATIONS`）
- **テスト**: `authHandler.test.js` — PBKDF2形式・衝突しない・旧hash移行成功・誤PINは非移行
- **残**: PIN 4桁の空間は依然 10^4。総当たりスプレー（1234等×全店舗）への追加対策（6桁化 or 頻出PIN拒否）は別途検討

---

## 残課題（優先度順）

### S-07 🟡 XSS対策（トークン漏洩リスク）
- **リスク**: `_auth_token` が `localStorage` に平文保存。XSSが起きると盗まれる
- **対策案**: Content Security Policy（CSP）ヘッダーを Cloudflare Pages に設定（`app/public/_headers` ファイル）。`script-src 'self'` で外部スクリプトの注入を防ぐ
- **備考**: このアプリは外部スクリプトを読み込んでいないため、CSPの設定コストは低い

### S-08 🟢 CORS フェイルセーフ
- **リスク**: `env.ALLOWED_ORIGIN` が未設定の場合、全オリジンからのアクセスを許可してしまう
- **対策案**: 未設定時は `''`（許可なし）をデフォルトにし、明示設定を必須化
- **備考**: Cloudflare Pages のオリジンが固定なので、設定漏れは起きにくい。優先度は低

### S-09 🟢 セッション完了処理のトランザクション化
- **リスク**: `sessions更新` → `inventory_lines INSERT` → `R2保存` の途中失敗で不整合が残る
- **対策案**: API設計v2 3.1 の `POST /sessions/:id/complete` で1エンドポイントに集約（DB設計v2 Step 3 と連動）
- **備考**: DB設計v2の実装フェーズで対応予定

---

## デプロイチェックリスト

```bash
./scripts/deploy.sh
```

スクリプトが「テスト → 未適用マイグレーションのみ適用 → Worker → Pages」の順序を保証する（すべて Cloudflare）。
手動デプロイは migration 漏れで /room 全ルートが落ちる事故（2026-06-12 発生）の再発リスクがあるため非推奨。

なお、レート制限（login_attempts / ip_attempts）は**フェイルオープン**実装:
テーブル未作成・D1障害時は制限を素通しし、ログイン・ルーム接続自体は止めない。

> **注意（S-06）**: ルーム接続は店舗コードの存在チェックを通るようになった。
> stores テーブルに無いコードのルームは接続不可（ルームID = 店舗コードの統一設計が前提）。

---

## テスト状況

| ファイル | ケース数 | カバー範囲 |
|---|---|---|
| `worker/src/authHandler.test.js` | 18件 | 登録・ログイン・トークン検証・総当たり対策・ソフト認証 |
| `worker/src/storeHandler.test.js` | 5件 | ペイロードサイズ上限 |
| `app/src/composables/useInventory.test.js` | 既存 | 在庫CRUD |
| `app/src/composables/useSync.conflict.test.js` | 既存 | 競合検知 |
| `app/src/composables/useSync.reconnect.test.js` | 既存 | 再接続 |

合計 **43件** / 全パス
