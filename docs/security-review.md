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

---

## 残課題（優先度順）

### S-04 🔴 PINハッシュ強化（PBKDF2/scrypt）
- **リスク**: 現在 SHA-256（高速ハッシュ）。S-01のブロックをかいくぐれた場合でも耐久性が低い
- **対策案**: `crypto.subtle.deriveBits` でPBKDF2（100,000イテレーション）に移行
- **移行方針**（要決定）:
  - 新規登録は即日新形式
  - 既存ユーザーは次回ログイン時に再ハッシュ（透過移行）
  - DB設計v2 Step 5 として計画済み
- **ブロッカー**: 移行UXの確認（強制ログアウトの是非）

### S-05 🟡 HTTPレート制限（IPベース）
- **リスク**: `/auth/login` 以外のエンドポイント（`/store/create` 等）にはIP単位の制限がない
- **対策案**: Cloudflare WAFのレートルール（管理画面で設定・コード変更不要）か、Worker側でIPヘッダーを見て制限
- **備考**: Cloudflare Pro以上ならWAFルールで対応可。Freeプランは Worker実装が必要

### S-06 🟡 ルームコード総当たり対策
- **リスク**: ルームコード（24^6 ≈ 1.9億通り）をWebSocket接続で総当たりするとゲストとして入室可能
- **対策案**:
  1. コード長を8桁に延長（24^8 ≈ 1,100億通り）
  2. WebSocket接続時にIPベースのレート制限（Workers AI / DO内で管理）
  3. ゲスト入室時もPIN/トークン確認を要求（UXへの影響あり・要検討）
- **備考**: S-05（HTTPレート制限）と合わせて対応するのが効率的

### S-07 🟡 XSS対策（トークン漏洩リスク）
- **リスク**: `_auth_token` が `localStorage` に平文保存。XSSが起きると盗まれる
- **対策案**: Content Security Policy（CSP）ヘッダーを Pages に設定。`script-src 'self'` で外部スクリプトの注入を防ぐ
- **備考**: このアプリは外部スクリプトを読み込んでいないため、CSPの設定コストは低い

### S-08 🟢 CORS フェイルセーフ
- **リスク**: `env.ALLOWED_ORIGIN` が未設定の場合、全オリジンからのアクセスを許可してしまう
- **対策案**: 未設定時は `''`（許可なし）をデフォルトにし、明示設定を必須化
- **備考**: Cloudflare Pagesのオリジンが固定なので、設定漏れは起きにくい。優先度は低

### S-09 🟢 セッション完了処理のトランザクション化
- **リスク**: `sessions更新` → `inventory_lines INSERT` → `R2保存` の途中失敗で不整合が残る
- **対策案**: API設計v2 3.1 の `POST /sessions/:id/complete` で1エンドポイントに集約（DB設計v2 Step 3 と連動）
- **備考**: DB設計v2の実装フェーズで対応予定

---

## デプロイチェックリスト（S-01〜S-03 反映時）

```bash
# 1. マイグレーション（必ずWorkerデプロイより先）
npx wrangler d1 execute inventory-store --remote \
  --file=./migrations/0003_login_attempts.sql

# 2. Workerデプロイ
cd worker && npx wrangler deploy

# 3. フロントエンドデプロイ
cd app && npm run build && npx wrangler pages deploy dist
```

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
