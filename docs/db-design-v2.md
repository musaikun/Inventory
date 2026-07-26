# DB設計 v2 — スケール・10年運用に向けた設計書

飲食店棚卸システムを「100店舗以上・10年運用・Phase 2分析」に耐える構造へ移行するための設計。
本書は**設計のみ**。実装は段階的に別途行う。

---

## 1. 現状（v1）の評価

### 1.1 現行スキーマ

| テーブル | 主キー | 中身 | 形式 |
|---|---|---|---|
| `stores` | shop_code | 店舗・active_room・store_name・pin_hash | リレーショナル |
| `store_configs` | shop_code | 品目リスト・単価・辞書など全部 | **JSONブロブ** |
| `store_inventory` | shop_code | 進行中在庫 | **JSONブロブ** |
| `store_history` | id | 完了スナップショット（全品目＋auditLog） | **JSONブロブ** |
| `auth_tokens` | token | 認証トークン（30日） | リレーショナル |
| `sessions` | id | 棚卸セッションのメタ | リレーショナル |

### 1.2 設計思想

現状は **「SQLite を JSON ドキュメントストアとして使う」** 設計。
CRUD には十分だが、スケールと分析の観点で2つの致命的弱点がある。

---

## 2. なぜ v1 は10年で破綻するか

### 2.1 🔴 履歴JSONブロブが D1 の容量上限（10GB/DB）を超える

```
100店舗 × 365日 × 10年 = 365,000 スナップショット行
1スナップショット ≈ 50〜200KB（品目数・auditLog 次第）
→ 合計 18GB 〜 73GB
```

**D1の10GB上限を確実に突破する。** 店舗が増えるほど早まる。これが破綻の本体。

### 2.2 🔴 JSONブロブでは分析できない

分析フェーズは「食材別・週別の使用量トレンド」を要求する（`docs/ordering-analytics-design.md`）。
v1 だと「コーヒー豆の過去52週推移」を出すのに **365個のJSONを全パースして1品目を抽出**することになり、実用速度にならない。

### 2.3 🟡 構造的な穴

| 問題 | 影響 |
|---|---|
| `store_configs/inventory/history` に FK なし | 店舗削除で孤児行が残る |
| 論理削除なし（物理DELETEのみ） | 誤削除の復旧・監査ができない |
| `auth_tokens` の期限切れが溜まり続ける | 無駄な行が増え続ける |
| PIN が SHA-256（高速ハッシュ） | 総当たりに弱い |
| 単価が在庫と別管理 | 分析時に「当時の単価」が復元できない |

---

## 3. 目標アーキテクチャ — 3層ハイブリッド

**原則：D1には「集計に使う軽い構造化データ」だけ置き、重い生データは R2 に逃がす。**

| 層 | 保存先 | 中身 | 役割 |
|---|---|---|---|
| **操作系（正）** | D1（正規化） | stores, sessions, 現config, 現在庫, auth | 小さく保つ・トランザクション |
| **分析系** | D1（明細テーブル） | `inventory_lines`（1行=1品目×1セッション） | 食材別・週別クエリを高速に |
| **アーカイブ** | **R2** | 完了スナップショットの生JSON・auditLog | 容量無制限・激安・D1を圧迫しない |

### 3.1 容量試算（v2）

```
D1 inventory_lines:
  100店舗 × 365日 × 10年 × 平均200品目 = 約7,300万行
  1行 ≈ 80バイト（数値中心）→ 約 6GB ... ⚠ 10GB に近い

→ 対策: inventory_lines も「直近2年だけD1、それ以前はR2へ集約エクスポート」
  運用2年想定なら 100×365×2×200 = 1,460万行 ≈ 1.2GB で安全圏
```

R2 は容量無制限・読み書き単価が極小なので、**生スナップショットと古い明細はすべて R2** に置けば D1 は恒久的に数GB以内に収まる。

---

## 4. スキーマ v2（D1）

### 4.1 stores（変更小）

```sql
CREATE TABLE stores (
  shop_code   TEXT PRIMARY KEY,
  store_name  TEXT,
  pin_hash    TEXT,              -- PBKDF2/scrypt 形式（v2でハッシュ強化）
  active_room TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT               -- 論理削除（NULL=有効）
);
```

### 4.2 store_configs / store_inventory（現状維持・FK追加）

設定と「進行中在庫」は店舗あたり1行で頻繁に上書きされる**運用データ**。
JSONブロブのままで問題ない（小さい・1行）。FK と論理削除整合だけ追加。

```sql
CREATE TABLE store_configs (
  shop_code   TEXT PRIMARY KEY REFERENCES stores(shop_code) ON DELETE CASCADE,
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE store_inventory (
  shop_code      TEXT PRIMARY KEY REFERENCES stores(shop_code) ON DELETE CASCADE,
  inventory_json TEXT NOT NULL DEFAULT '{}',
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 4.3 sessions（拡張）

```sql
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  shop_code   TEXT NOT NULL REFERENCES stores(shop_code) ON DELETE CASCADE,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  status      TEXT NOT NULL DEFAULT 'active',  -- active|completed|incomplete
  item_count  INTEGER NOT NULL DEFAULT 0,
  total_value REAL,             -- 完了時の在庫金額（分析の起点）
  archive_key TEXT,             -- R2 の生スナップショット格納キー
  deleted_at  TEXT
);
CREATE INDEX idx_sessions_shop ON sessions(shop_code, started_at);
```

### 4.4 inventory_lines（新設・分析の核）

完了セッションの明細を1品目1行で展開。**当時の単位・単価を焼き込む**ので
後でマスタを変えても過去が狂わない。

```sql
CREATE TABLE inventory_lines (
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  shop_code   TEXT NOT NULL,
  taken_at    TEXT NOT NULL,   -- 棚卸日（週別集計に使用）
  item_name   TEXT NOT NULL,   -- 正規化せずテキストで焼き込む（品目名は頻繁に変わるため）
  category    TEXT,
  qty         REAL NOT NULL,
  unit        TEXT,
  unit_price  REAL,            -- スナップショット単価
  line_value  REAL,            -- qty × unit_price（集計の事前計算）
  PRIMARY KEY (session_id, item_name)
);
CREATE INDEX idx_lines_item ON inventory_lines(shop_code, item_name, taken_at);
CREATE INDEX idx_lines_date ON inventory_lines(shop_code, taken_at);
```

**これで Phase 2 のクエリが一発：**
```sql
-- コーヒー豆の週別推移
SELECT taken_at, qty, line_value
FROM inventory_lines
WHERE shop_code = ? AND item_name = ?
ORDER BY taken_at;
```

### 4.5 auth_tokens（変更なし・掃除対象）

期限切れは Cron Trigger で定期削除（4.7）。

### 4.5b item_par_levels（将来拡張・アラート/予測の基準値）

「適正在庫」を持つマスタ。**アラート（過剰・不足・発注サイン）の前提**になる。
これがないと「在庫が多いか少ないか」を判断する基準が存在しない。
品目名は `inventory_lines` と同じくテキストで持つ（マスタFKにしない＝品目名の変更に強い）。

```sql
CREATE TABLE item_par_levels (
  shop_code     TEXT NOT NULL REFERENCES stores(shop_code) ON DELETE CASCADE,
  item_name     TEXT NOT NULL,
  min_qty       REAL,      -- 下回ったら不足アラート
  max_qty       REAL,      -- 超えたら過剰在庫アラート
  reorder_point REAL,      -- この量で発注サイン
  reorder_qty   REAL,      -- 標準発注量（予測の初期値）
  lead_days     INTEGER,   -- 発注から納品までの日数
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (shop_code, item_name)
);
```

実現できること：
- 棚卸完了後の「○○が適正在庫を下回っています」アラート
- 「あと何日分あるか」表示（平均日次消費量で割る）

### 4.5c deliveries（将来拡張・仕入れ実績＝消費量計算の精度向上）

**消費量を正確に算出するためのテーブル**。棚卸の差分だけだと「期間中の仕入れ」が
混ざって消費量が狂う。仕入れを記録すると `消費量 = 前回在庫 − 今回在庫 + 仕入れ量` が成立する。

```sql
CREATE TABLE deliveries (
  id          TEXT PRIMARY KEY,
  shop_code   TEXT NOT NULL REFERENCES stores(shop_code) ON DELETE CASCADE,
  item_name   TEXT NOT NULL,
  qty         REAL NOT NULL,
  unit        TEXT,
  unit_price  REAL,            -- 仕入単価（原価推移の分析にも使える）
  received_at TEXT NOT NULL,   -- 納品日
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_deliveries_item ON deliveries(shop_code, item_name, received_at);
```

⚠️ **入力コストが高い**ため優先度は低い。まず仕入れなしの近似値（棚卸差分）で
始め、予測精度が問題になってから導入する段階的アプローチを推奨。

> 注：`item_par_levels` / `deliveries` は **発注予測・アラート構想**のための拡張。
> 現行機能（月1棚卸）だけでも ABC分析・在庫金額推移・滞留在庫検出などの
> 「ストック分析」は `inventory_lines` だけで可能。フロー分析（消費・発注）には
> これらの追加テーブルが要る、という棲み分け。

### 4.6 R2 レイアウト（アーカイブ）

```
バケット: inventory-archive
キー: {shop_code}/{YYYY}/{YYYY-MM-DD}_{session_id}.json
中身: 完了スナップショットの生JSON（全品目・auditLog・参加者）
```

- 完了時：明細を `inventory_lines` に展開 ＋ 生JSONを R2 に保存 ＋ `sessions.archive_key` に記録。
- 履歴画面：一覧は `sessions` から（軽い）、詳細は R2 から都度取得。

### 4.7 メンテナンス（Cron Trigger）

Cloudflare Workers の Cron で日次実行：
1. `auth_tokens` の `expires_at < now` を削除。
2. 2年より古い `inventory_lines` を R2 に集約エクスポートして D1 から削除（D1を恒久的に小さく保つ）。
3. `deleted_at` が一定期間（例:90日）過ぎた論理削除行を物理削除。

---

## 5. データフロー（v2）

### 5.1 書き込み

| タイミング | D1 | R2 |
|---|---|---|
| 設定変更 | `store_configs` 上書き（デバウンス2s） | — |
| 在庫入力中 | `store_inventory` 上書き（デバウンス3s/ホスト） | — |
| **棚卸完了** | `sessions` 更新 ＋ `inventory_lines` 一括INSERT | 生スナップショットを保存 |

### 5.2 読み込み

| 画面 | ソース |
|---|---|
| 進行中の復旧 | `store_inventory`（v2で継続） |
| 履歴一覧 | `sessions`（メタのみ・軽い） |
| 履歴詳細 | R2 の生JSON |
| 分析（Phase 2） | `inventory_lines` を集計 |

---

## 6. 移行計画（後方互換・段階的）

各ステップは独立してデプロイ可能。既存データを壊さない。

```
Step 1  スキーマv2マイグレーション（0003）
        - FK・ON DELETE CASCADE・deleted_at・新カラム追加
        - inventory_lines テーブル新設
        ※ 既存 store_history はそのまま温存（読み取り互換）

Step 2  R2 バインディング追加（wrangler.toml）
        - 新規の完了スナップショットを R2 へ
        - sessions.archive_key を記録
        - 既存 store_history からの読み出しはフォールバックで維持

Step 3  完了処理で inventory_lines へ明細展開を追加
        - 既存履歴は後からバックフィル（バッチで store_history → lines）

Step 4  Cron Trigger 追加（トークン掃除・古いlines→R2集約・論理削除の物理化）

Step 5  PIN ハッシュ強化（PBKDF2/scrypt）
        - 新規登録は新形式、既存はログイン時に再ハッシュ移行

Step 6  store_history を非推奨化（R2移送完了後にD1から撤去）

Step 7  予測・アラート拡張（構想・着手は後日）
        - item_par_levels テーブル新設 → 過剰/不足アラート
        - deliveries テーブル新設（任意）→ 消費量の正確な算出
        ※ ストック分析（ABC・在庫金額推移・滞留検出）は inventory_lines だけで
          先行実装可能。フロー分析（消費・発注予測）の段階でこの2表を足す。
```

---

## 7. あえて「やらない」こと（過剰設計の回避）

| 案 | 不採用の理由 |
|---|---|
| 店舗ごとに D1 を分割（シャーディング） | 100店舗なら1DBで十分。運用が複雑になるだけ |
| 品目マスタを別テーブルでFK正規化 | 飲食店は品目名が頻繁に変わる。明細にテキスト焼き込みの方が歴史が壊れない |
| 完全な監査ログDB化 | auditLog は R2 の生JSONに同梱で足りる |
| マルチリージョン分散 | 単一国・100店舗ではD1の読みレプリカで十分 |

---

## 7.5 現状データで可能な分析 / 不可能な分析

分析を「ストック（状態）」と「フロー（流れ）」で分けると、何が今できて何ができないかが明確になる。

### ✅ 今の機能（月1棚卸＋単価）だけでできる ＝ ストック分析

| 分析 | 必要データ | 備考 |
|---|---|---|
| ABC分析（在庫金額のパレート） | 1回の棚卸 ＋ 単価 | **1回分で出せる**。金額が寝ている重点品目を特定 |
| 在庫金額の推移 | 複数回の棚卸合計額 | 資金繰りの可視化 |
| 滞留在庫（デッドストック）検出 | 複数回の棚卸 | 数量が動かない品目＝過剰/不使用の疑い |
| 廃止候補の抽出 | 品目リスト ＋ 棚卸 | 常にゼロ/ほぼ不動の品目 |
| カテゴリ別・構成比 | 棚卸 ＋ カテゴリ ＋ 単価 | 在庫の偏りの把握 |
| 棚卸作業分析 | auditLog（時刻・担当者） | 在庫でなく業務改善の分析 |

### ❌ 原理的にできない ＝ フロー分析（追加データが必要）

| 分析 | 足りないデータ |
|---|---|
| 消費量・使用量 | 仕入れ記録（`deliveries`） |
| 発注量予測・需要予測 | 消費量（＝仕入れ記録） |
| 原価率・粗利 | 売上記録 |
| 廃棄ロス | 廃棄記録 |
| 曜日・天候別需要 | 日次データ（月1では粗すぎる） |

> 結論：**フロー分析は月1スナップショットでは不可能**だが、**ストック分析（特にABC分析）は
> 追加入力ゼロで今すぐ価値を出せる**。分析機能の第一歩はABC分析・滞留在庫検出が現実的。

---

## 8. 残課題・要決定事項

- [ ] R2 バケット名・命名規約の確定
- [ ] `inventory_lines` を D1 に保持する期間（2年案）の確定
- [ ] 既存 `store_history` のバックフィル方針（全件 or 直近のみ）
- [ ] PIN 再ハッシュの移行 UX（強制ログアウトの是非）
- [ ] バックアップ方針（D1 Time Travel 30日＋R2定期エクスポートで十分か）

---

## 9. まとめ

- v1 の **JSONブロブ履歴が10GB上限を突破する**のが最大の破綻要因。
- 解は **D1（軽い構造化）＋ R2（重い生データ）＋ inventory_lines（分析明細）** の3層。
- これで **D1は恒久的に数GB以内**、**Phase 2分析は1クエリ**、**履歴は容量無制限**になる。
- FK・論理削除・トークン掃除・PIN強化を同時に入れて10年運用の堅牢性を確保する。

---

## 10. 大規模スケール（3000店 × 10年）での再検討 — 追記 2026-07-23

本書 §2〜§3 は**100店舗**基準。過去発注（納品）履歴の一括取込（→ `docs/order-history-import-design.md`）で
`movement_lines` / `order_lines` が新たに積み上がるため、**3000店 × 10年**を想定して再試算する。
スケール変更は後になるほど移行コストが跳ねるため、この見通しを**設計時点で織り込む**。

### 10.1 容量試算（桁感・前提付き）

前提：1店あたり 納品 週3回・1回20明細 ≒ 3,000明細/年、棚卸 月1回・200品目 ≒ 2,400明細/年。
1行 ≒ 80〜120バイト（SQLiteオーバーヘッド込み）。

| テーブル | 10年・3000店の行数 | 概算サイズ |
|---|---|---|
| `movement_lines`（納品） | 3,000 × 10 × 3,000 = **9,000万行** | **約 9 GB** |
| `order_lines`（発注・記録すれば） | 同程度 | 約 9 GB |
| `inventory_lines`（棚卸） | 3,000 × 10 × 2,400 = **7,200万行** | 約 6 GB |
| **合計** | 約 2.3 億行 | **20〜25 GB** |

→ **`movement_lines` 単独ですら D1 の 10GB 上限に迫り**、3表合計で上限の2〜3倍。**単一D1では確実に破綻する。**

### 10.2 容量以外に出る不具合

1. **書き込み競合** — 3000店が同一DBへ同時POST。1DB書き込みスループットに当たる。
2. **巨大テーブルの保守コスト** — 1億行超への `ALTER`（マイグレーション）や cron の一括DELETE/アーカイブが重く・危険。
3. **Time Travel（30日バックアップ）** — 20GB級DBの復元・整合。
4. **課金（rows-read）** — 店舗単位クエリはインデックスで軽いが、横断集計の走査は読み取り課金が効く。

※ 読み取り側は `GET ...?sinceDays`（既定400・最大1000日）で窓が有界。問題は**蓄積側の総量**。

### 10.3 直近窓＋R2アーカイブで一旦は収まる（が3000店では半分）

§4.7 の cron（2年より古い `_lines` を R2 へ集約→D1から削除）を効かせると、D1に残るのは直近2年ぶん：

| テーブル（直近2年・3000店） | 概算 |
|---|---|
| movement_lines | 約 1.8 GB |
| order_lines | 約 1.8 GB |
| inventory_lines | 約 1.2 GB |
| **合計** | **約 5 GB**（上限内・ただし"まだ半分"） |

上限内には収まるが、**3000店で既に半分**。店舗増加で再逼迫するため、R2アーカイブは「任意の後回し」でなく**必須要件**に格上げする。

### 10.4 DB-per-tenant / シャーディングの再判断

§7 は「店舗ごとにD1分割 → **100店舗なら不要**」と結論したが、**3000店ではこの前提が反転**する。
D1 は本来「テナントごとに1DB」を想定した設計で、多数DB運用が自然な形。

- **店舗（または地域・シャード）ごとにDBを分ける** → 各DBは常に小さく、10GB上限にもロック競合にも当たらない。
- Worker側で `shopCode → DBバインド` を**動的ルーティング**。
- 判断は別セッション（DB設計）で確定するが、**この選択肢を潰さない設計**を今から取る（§10.5）。

### 10.5 いま織り込んでおく設計判断（後の移行コストを避ける）

移行が最も高くつくのは「後からキー体系・分割方針を変える」こと。以下を**最初から**満たしておく：

1. **`shop_code` を全明細テーブルの先頭キー/インデックスに持つ**（済）。将来の DB-per-tenant 分割の**自然なシャードキー**になる。横断結合を前提にしない。
2. **品目名はテキスト焼き込み**（§7 で決定済み）。マスタFKに依存しないため、店舗単位でDBを切り出しても歴史が壊れない。
3. **アクセスをルーティング層で抽象化** — クライアント/Worker は「店舗コードで叩く」だけにし、**単一D1か分割DBかを下位で吸収**できる形にしておく（今は単一DBでよいが、切替点を1箇所に）。
4. **R2アーカイブのキー規約を先に確定** — `{shop_code}/{YYYY}/...`（§4.6）。cron実装は後でも、**境界（何年でR2へ）と鍵の形**は今決める。分割後もキーが店舗単位で自明。
5. **取込の `import_batch_id`** — R2退避後も**バッチ単位で一括取消・再取込を追跡**できる（取込機能とアーカイブの整合）。

### 10.6 過去履歴取込への含意

- バルク取込は `movement_lines` を数千行/店で積むため、**取込した時点から「古い分はR2」前提**で設計する（取込→直近はD1、閾値超はアーカイブ行き）。
- 取込は「D1が唯一の正」ではなく「**直近D1＋アーカイブR2**」の2層に最初から乗せる。

> 結論：**単一D1は3000店×10年で20GB超＝破綻**。R2アーカイブを必須化すれば直近窓で数GBに収まるが、
> 3000店規模では **DB-per-tenant シャーディングの採否**が次の分岐。**キー体系（shop_code先頭）・
> テキスト焼き込み・ルーティング抽象化・R2鍵規約**を今から満たし、分割への移行コストを最小化しておく。
> （DB本体の実装・確定は別セッションで扱う）
