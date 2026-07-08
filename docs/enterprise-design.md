# 企業導入（多店舗）設計書

最終更新: 2026-06-27
ステータス: ドラフト（実装前の設計合意用）

飲食チェーン・複数店舗を持つ企業が本システムを採用する際の、
アカウント発行・管理・課金のアーキテクチャを定義する。

---

## 1. 現状と課題

### 現在のデータモデル（フラット構造）

```
stores
  ├ shop_code   TEXT PRIMARY KEY   -- ランダム生成
  ├ store_name  TEXT
  ├ pin_hash    TEXT               -- 4桁PIN
  └ active_room TEXT
```

- 店舗は独立アカウント。上位（企業・本部）の概念がない
- 登録は1店舗ずつ手動（`POST /auth/register` でランダムコード発行）
- **プラン（PRO/無料）はクライアントの localStorage のみ** — サーバーは契約状態を知らない
- 複数店舗を横断する管理画面・集計が存在しない

### 企業導入で顕在化する問題

| 問題 | 影響 |
|---|---|
| 一括発行不可 | 30店舗 = 30回手動登録。コードもバラバラ管理 |
| 本部の管理単位がない | 「この企業の全店」を表現・集計できない |
| サーバー側プラン管理がない | 「30店舗PRO契約」を技術的に表現できない |
| マスター品目の配信不可 | 各店が個別に品目リストを作る二度手間 |

---

## 2. 目標とする導入フロー

```
① 契約（Web/営業）       本部アカウント作成・PRO契約
② 一括プロビジョニング     店舗名リスト → コード＋初期PIN を一括発行
③ 配布                   本部が各店長へコード＋PINを配布（CSV DL）
④ 各店ログイン            店長がログイン → すぐ棚卸
⑤ 本部ダッシュボード       全店の棚卸状況・在庫金額を横断閲覧
（任意）マスター品目配信     本部の標準品目を全店へpush
```

---

## 3. データモデル（v3 拡張）

後方互換を維持する（既存の個人店舗 = org に属さない店舗 として動作継続）。

### 3.1 新規テーブル: organizations

```sql
CREATE TABLE IF NOT EXISTS organizations (
  org_id      TEXT PRIMARY KEY,             -- 例: ORG-XXXXXX
  name        TEXT NOT NULL,                -- 企業名
  plan        TEXT NOT NULL DEFAULT 'free', -- 'free' | 'pro' | 'enterprise'
  plan_status TEXT NOT NULL DEFAULT 'active',-- 'active' | 'past_due' | 'canceled'
  seat_limit  INTEGER,                      -- 契約店舗数の上限（NULL=無制限）
  billing_ref TEXT,                         -- Stripe customer / 請求書管理ID
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.2 新規テーブル: org_admins（本部管理者）

```sql
CREATE TABLE IF NOT EXISTS org_admins (
  org_id     TEXT NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  pin_hash   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'admin', -- 'owner' | 'admin' | 'viewer'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, email)
);
```

### 3.3 既存 stores へ列追加（後方互換）

```sql
ALTER TABLE stores ADD COLUMN org_id        TEXT;   -- NULL = 個人店舗（従来通り）
ALTER TABLE stores ADD COLUMN plan          TEXT DEFAULT 'free'; -- org非所属店舗の個別プラン
ALTER TABLE stores ADD COLUMN provisioned   INTEGER DEFAULT 0;   -- 一括発行された店舗フラグ
ALTER TABLE stores ADD COLUMN initial_pin   TEXT;   -- 初回ログイン前の配布用（ログイン後にクリア）
CREATE INDEX IF NOT EXISTS idx_stores_org ON stores(org_id);
```

### プラン判定の一元化（重要）

`isPro()` を **「店舗の実効プラン」** で判定する：

```
effectivePlan(store) =
  store.org_id ? organizations[store.org_id].plan
               : store.plan
isPro = effectivePlan in ('pro', 'enterprise') && plan_status == 'active'
```

クライアントの localStorage は「キャッシュ」に降格し、ログイン時にサーバーの実効プランで上書きする。

---

## 4. API 設計

### 4.1 一括プロビジョニング

```
POST /org/:orgId/stores/bulk
Authorization: Bearer <org_admin_token>
body: { stores: [{ name: "渋谷店" }, { name: "新宿店" }, ...] }

→ 200
{
  created: [
    { name: "渋谷店", shopCode: "ACME-SHIBUYA", initialPin: "4821" },
    { name: "新宿店", shopCode: "ACME-SHINJUKU", initialPin: "9134" },
    ...
  ],
  skipped: [],          // 重複等
  seatUsage: { used: 30, limit: 50 }
}
```

- seat_limit を超える分は `skipped` に回しエラーにしない（部分成功）
- レスポンスから本部が配布用CSV（店舗名・コード・PIN）を生成できる
- 初期PINは `stores.initial_pin` に保持し、店長の初回ログイン後にクリア＆本人PINへ変更を促す

### 4.2 本部ダッシュボード

```
GET /org/:orgId/overview
→ { stores: [{ shopCode, name, lastInventoryAt, lastItemCount, lastTotalValue, isActiveNow }], totals: {...} }
```

既存の `sessions` / `store_inventory` を org_id で集約するだけで実現可能。

### 4.3 マスター品目配信

```
POST /org/:orgId/master-config/push
body: { config: {...}, targetStores: "all" | [shopCode...] }
```

各店の `store_configs` に本部の標準品目を配信。既存のconfig同期ロジックを流用。
店舗側で「本部マスター + 店舗独自品目」をマージする方針（独自品目は消さない）。

---

## 5. コード体系

- 個人店舗: 従来通りランダム6文字（`A7K2Q9`）
- 企業店舗: `<org接頭辞>-<店舗識別>`（例 `ACME-SHIBUYA`）任意。衝突回避のためサフィックス付与可
- いずれも `shop_code` のユニーク制約は維持

---

## 6. 移行・後方互換

- 既存の個人店舗は `org_id = NULL` のまま完全に従来動作
- v2スキーマ同様、列追加のみ（既存データを壊さない）
- `verifyStoreAccess` は変更なし（PIN認証は店舗単位のまま）
- org_admin は店舗PINとは別の認証系（email + PIN/パスワード）

---

## 7. 段階実装プラン

| フェーズ | 内容 | 価値 |
|---|---|---|
| **E0（土台）** | `stores.plan` 追加＋ `isPro()` のサーバー判定化 | 個人課金（Stripe）にも必須の前提 |
| **E1** | organizations / org_admins ＋ 一括発行API | 企業の最小導入が成立 |
| **E2** | 本部ダッシュボード（集計閲覧） | 本部の継続利用価値 |
| **E3** | マスター品目配信 | 各店の初期設定ゼロ化 |
| **E4** | 請求連携（Stripe/請求書）・seat管理 | 課金の自動化 |

**推奨**: まず E0 を単独で入れる。これは個人課金でもどのみち必要で、
入れておけば「企業の引き合い → E1 を足すだけ」の状態になる。
E2 以降は最初の企業顧客の実要望を聞いてから着手し、過剰投資を避ける。

---

## 8. 未決事項（要検討）

- org_admin の認証方式（email+パスワード or SSO/SAML — 大企業はSSO要求あり）
- 店舗の途中解約・seat減のハンドリング（データ保持期間）→ §10 で方針確定
- マスター品目と店舗独自品目の競合解決ルール詳細
- 監査ログ（誰がいつ店舗を発行/削除したか）= エンタープライズ要件

---

## 9. テナンシー方針の確定（2階層アカウント・フルRBACは採用しない）

検討の結論。詳細な議論経緯はこの節に集約する。

### 9.1 前提の再確認
現状は「**店舗 = 共有アカウント**」。個人ユーザー・ロール・権限は存在せず、
`shop_code + PIN` を知る全員が同一の識別、deviceName は表示ラベルにすぎない。
これは「在庫管理の単位＝店舗」という業種特性に**合った良い割り切り**であり、
弱点ではない。

### 9.2 採用する構造：2階層アカウント
```
本部/組織アカウント   ← 管理・横断閲覧・分析・店舗発行・請求
   └─ 店舗アカウント × N   ← 現状のまま。運用（数える）の単位
```
- **個人ユーザー / memberships / フルRBAC は採用しない**（大工事を回避）。
- 必要なのは「組織」という 1つ上の器と、店舗をぶら下げる `stores.org_id` のみ。
- 数える人（個人）にアカウントは不要。「誰が数えたか」は deviceName で足りる。

### 9.3 なぜ本部（横断閲覧）層は必要か
各店で数えるのは現状のままでよい。だが**横断して見る上位視点**こそ企業が
支払う理由：店舗別ステータス／在庫金額／全店合計／店舗間比較・トレンド。
これは蓄積データの価値が“買い手に見える”唯一の面であり、将来のAI発注・
ロス検知もこのダッシュボードの上に乗る（→ E2）。

### 9.4 将来の芽（今は決め打ちしない）
「SVはエリアA店だけ、部長は全店」のように**管理者の閲覧範囲を分けたい**要望が
出たら、そのとき初めて**本部側だけ**に軽いロール／スコープを足す（例：エリア
単位のサブ管理アカウント）。**店舗運用レイヤーは共有アカウントのまま**。
v1 は「組織アカウント＝全店見える」で出す。

### 9.5 対応表
| 関心 | 対応 |
|---|---|
| 一括契約・店舗発行 | E1 組織＋一括プロビジョニング |
| SV/部長の横断閲覧・分析 | E2 本部ダッシュボード |
| （土台） | E0 サーバー側プラン管理 |
| フルRBAC（users/memberships） | **当面不要** |

---

## 10. 店舗ライフサイクルと契約変更フロー

課金は組織単位・**有効店舗数（席）**が契約量。「契約変更 = 有効店舗数の増減」。

### 10.1 顧客規模で2トラック
| | 自己申込（中小） | エンタープライズ（大手） |
|---|---|---|
| 課金 | 月額・カード（Stripe）・自動 | 年間契約・請求書・営業経由 |
| 増減 | コンソールで即時・日割り自動 | ベースライン＋超過はtrue-up |
| 反映 | リアルタイム | 更新時/精算時 |
→ **自己申込（Stripe自動増減）を先に**作る。請求書運用は後付け。

### 10.2 店舗の状態機械
```
発行 → 稼働(active) ⇄ 一時停止(suspended) → 削除予約(grace) → 完全削除
        （課金対象）    （課金停止/減額・再開可）  （データ保持・復活可）  （データ消去）
```
これ1本で増減・課金・データ保持を表現する。

### 10.3 増える（店舗追加）
1. 本部が「＋店舗を追加」
2. 契約席数内 → そのまま発行・追加課金なし／超過 → 「追加 ¥X/月（日割り ¥Y）」確認
3. 即発行（コード＋PIN）→ 使用可。Stripe は quantity +1（日割り）
- **発行と課金を連動**（＝有効な店舗＝課金対象。“作ったけど無料”を作らない）

### 10.4 減る（店舗削減）— いきなり削除しない
- **一時停止(suspend)**：季節休業・改装用。データ保持、課金は次期から停止/減額、いつでも再開。
- **削除(remove)**：閉店用。猶予期間（例60〜90日）後にデータ削除。エクスポート案内必須。

### 10.5 課金ポリシー（推奨）
- 追加は**即時に日割り加算**
- 削減は**次の請求サイクルから**（月途中の返金なし＝SaaS標準・予測可能・不正防止）
- 季節営業は**停止**で回す

### 10.6 決めておくこと
1. 課金対象の定義：active な店舗＝1席（suspended は課金外）
2. 年間契約の超過：**ソフトキャップ**（運用は止めず超過を後精算）。ハードキャップは現場が困る
3. データ保持期間：削除予約後 60〜90日＋エクスポート必須
4. 操作できる人：本部の owner/admin だけ（店舗は自分を消せない）
5. 監査ログ：誰がいつどの店舗を増減したか（エンタープライズ必須）

### 10.7 実装の位置づけ
- 発行・停止・削除・状態機械・データ保持・監査 → **E1**
- 課金の自動増減（Stripe quantity・日割り・請求書） → **E4**
- 順序：E1で状態機械を正しく作れば、E4は「active店舗数を数えて Stripe quantity に反映」するだけになる。
