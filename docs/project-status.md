# プロジェクト現況と方向性

最終方針更新: 2026-08-04 / docs整理完了: 2026-08-06 / 実装確認基準 `develop@bc9fb85`
位置づけ: product overview。タスク状態の正本ではありません。

> 現在の公開判定は[Web公開準備](quality-foundation/web-release-readiness.md)、
> 状態・優先度・担当は[task board](quality-foundation/task-list.md)、
> docs全体の役割は[docs案内](README.md)を正とします。
> `quality-foundation/project-status.md`と旧sprint計画は2026-07-25時点の履歴です。

## 現在の目標

1. **W1（現在）**: Web/PWAのFree版を安全にproduction公開する。
2. **A1（将来のAndroid / Google Play milestone）**: Android app内登録を起点に14日Pro無料体験を
   提供し、終了後はFreeへ戻す。Webで明示的にStripe契約した同じaccountへserver entitlementを反映する。

W1ではtrial、Stripe、Pro販売、PostHog有効化、TWA/Play提出を行いません。
Web登録者へのtrial適用と、Stripe/backendをPlayより先に単独公開するかは未決です。

## 実装スナップショット（2026-08-04）

- HEAD `bc9fb85`まで、account削除のWorker/D1/DO/client、local data消去、Back制御、
  focus/a11y回帰がcommit / push済み。
- develop CI run `30882005257`はWorker/App test、App build、Pages preview deployに成功。
- production dependencyの直近auditは0件。spreadsheet parserはworker隔離、size/complexity/timeout制限あり。
- production公開は未完。本番URL/Pages artifact、CORS、legal route、D1 0010/0011、登録濫用、
  Free 2台制限、履歴整合、observability、critical E2E、smokeがblocker。
- production deploy、migration、外部service変更はUserの明示承認まで行わない。

以下の機能棚卸しには過去versionの詳細が残ります。現在の優先順位・test件数・branchとしては使用しません。

---

## 1. プロダクト概要

**タナオロ** — 飲食店の棚卸作業を高速化するスマホWebアプリ（PWA）。
音声入力 → 辞書変換 → 在庫記録、複数端末リアルタイム同期が中核。

- フロント: Vue 3 + Vite（PWA）/ Cloudflare Pages
- バックエンド: Cloudflare Workers + Durable Objects（WebSocket同期）
- DB: Cloudflare D1（SQLite）— 認証・店舗・在庫を永続化。履歴をD1へ集約する設計だが、
  履歴詳細のread path不整合は`DATA-002`で未解消
- 認証: Bearer トークン（D1管理）

---

## 2. 機能棚卸し（v0.58以降の履歴を含む）

### 共同品質基盤スプリント（account deletion backend / 2026-07-25・履歴）

- `PLAY-001` backend完了: `DELETE /auth/account`、PIN/店舗code再確認、UUID requestId冪等処理。
- D1 0011: 削除pending/request、匿名receipt、inactive accountへの再INSERT防止trigger。
- 関連D1 data・全auth token・Push購読と、棚卸/発注2 Durable Objectsを削除。
- 7日匿名tombstone/receiptを日次cronで清掃。pending/削除済み店舗は通常APIとroomを遮断。
- `BUG-001`完了: cronの不存在`sessions.updated_at`参照を、仕様化した`started_at`基準へ修正。
- `SEC-003`完了: Push購読APIをstrict認証、8KiB上限、標準鍵形式・tenant owner検証で保護。
- `SEC-004`完了: room gateとDOの店舗保護判定をD1障害時fail-closed化。
- Worker検証: 13 files / 191 tests passed。全migrationのインメモリSQLite適用も成功。
- in-app削除UX、端末cache/Push解除、公開Web申請導線は `PLAY-002`（Claude Code）で接続予定。
- 正式な現況・contract: [`quality-foundation/task-list.md`](quality-foundation/task-list.md) /
  [`quality-foundation/account-deletion-contract.md`](quality-foundation/account-deletion-contract.md)。

### 直近セッションの追加（過去履歴の一括取込 / 2026-07-23）
- **過去の納品履歴の一括取込** — 中間フォーマットCSV → 入庫（`movements type:in`）へ一括投入。
  名寄せ（`itemMatcher`）・冪等（日付+種別+品目+数量）・ステージングUI（`DeliveryImportModal`）・
  `importBatchId` で一括取消。導線は入出庫画面の入庫モード。
- **過去棚卸の実行済みインポート** — `resultCsvParser.parseResultSnapshots` ＋
  `useHistory.importPastSnapshot`（過去日付スナップショット挿入）。過去棚卸＋過去納品で
  消費逆算・理論在庫が遡及算出される。
- **算出のゲート表示** — `services/analysisCapability`。下地が無い店に「過去の棚卸を取り込むと
  消費・適正在庫・発注の理論値が算出できます」バナー＋品目詳細の動的ヒント。
- **導線を「データ管理」に集約** — 品目マスタ管理を **データ管理**（`MasterManagePage`）へ格上げ。
  取り込む（品目／過去納品／過去棚卸）・書き出す（品目マスタ／棚卸結果）を1画面に集約。取込フローは
  `composables/useDataImport.js` に抽出し、入出庫画面（入庫モード）とデータ管理の2導線で共用。
- 設計 → `docs/order-history-import-design.md` v2 §9.1。D1列追加・バルクIngest・sinceDays窓拡張は
  別セッション（DB）へ（`db-design-v2.md` §10）。

### 直近セッションの追加（入出庫D1化ほか / 2026-07-21 取り込み）
- **入出庫の D1 永続化** — Wave 2.5 #2 完了（`0010_movements`・冪等POST＋開始時ロード・
  再送キュー・削除もD1連動）。R5-01（upsertのテナント境界）修正済み ✅。
- **論理出庫（消費量の逆算）** — 発注点の目安を消費ベースへ。
- **日別メモ**（内部イベント・学習除外）R5-02: アカウント切替消去に配線済み ✅。
- 天気の地名表示（BigDataCloud 逆ジオ）。位置情報のポリシー記載（R4-01）・キー登録（R4-02）済み ✅。
- 発注削除のD1連動fix・給料日25日化＋五十日・カレンダーUX多数・TOP整理
  （引き継ぎカードは会員登録/ログインで置換予定）。

### 前回までの追加（需要カレンダー・発注スケジュール / 2026-07-18 取り込み）
- **需要カレンダー** — 暦の需要要因を純関数で判定（`jpHolidays`＝祝日近似式・
  `demandFactors`＝連休/祝前日/給料日/ゴトー日/お盆・年末年始/長期休暇）。
  ダッシュボードカレンダーに層として重ね、全日タップで日別詳細（週/比較/前回棚卸）。
- **発注スケジュール（Phase A）** — 発注曜日・締切を config `orderSchedule` に保存。
  ホーム発注カード下に要約・締切カウントダウン・今日の位置づけを表示。
  （R3-01 worker側対応は 2026-07-19 修正済み ✅）
- **在庫タブ拡張** — 品目タップで詳細展開・手動発注点 `reorderPoints` の設定
  （提案採用 → `proposals.md`）・状態フィルタ（在庫あり/要補充）・ゼロ/マイナス在庫の強調・
  暫定「目安」（30日平均消費×発注間隔）。
- 発注の数値入力改善（テンキー・整数・完了ゲート=発注数基準）／品目マスタのヘルプ「?」／
  入出庫の既定日付リグレッション修正（R2-01 ✅）。
- **天気連携（P3）** — Open-Meteo（鍵不要・オプトイン位置取得・1hキャッシュ）で
  カレンダーに気温/降水/天気を表示。ポリシーへの位置情報記載（R4-01）済み ✅。
- 発注時の品目×同曜実績（前週/先月/中央値/推移）・給料日の実務化（銀行休業日繰り上げ・15日）・
  R3-01（orderSchedule の worker 側）修正 ✅。

### 前々回セッションの追加（発注同期・入出庫ドラフト / 2026-07-15 取り込み）
- **発注数のリアルタイム同期** — DO に `orders` チャネル追加（在庫とは別マップ）。
  品目ごとに「発注N（誰が）」チップを一覧表示。audit に order_set/order_clear。
- **入出庫の未記録ドラフト保持** — `useMovementDraft`：未記録の入力・日付・メモ・発注紐付けを
  端末に保持し、ホームカードに「未記録 N」バッジ。
- 発注開始時に棚卸カードが「開始中」と誤表示される問題を修正。
- 取り込みレビューの指摘（日付の既定値リグレッション等）→ `docs/intake-reviews.md`

### 前回セッションの追加（入出庫・在庫の環）
- **入出庫（在庫のフロー）** — `useMovements`：入庫/出庫を発注と同型のフロー記録で保存。
  専用ページ `MovementPage`（表示中マスタ全品目を一覧・品目ごとに＋入庫/−出庫・ジャンル/軸で
  アコーディオン・グリーンテーマ）。ホームに入出庫カード。
- **理論在庫の導出** — `services/theoreticalStock`：直近棚卸残高＋その後の入出庫。純関数。
  発注時に「理論在庫を使う」プリフィルと入力値とのズレ検出（未記録の使用/入庫漏れの示唆）。
- **発注→入庫のワンタップ取込** — 未入庫の発注を入庫にプリフィル（LOT換算）・`orderId`で紐付け。
- **発注アシスト＝実装済み**（`ordering-analytics-design` は設計、実コードは稼働）。
  発注セッション（type=order・オレンジテーマ）・適正在庫の曜日別学習・推奨発注数。
- **履歴カレンダー** — `HistoryCalendar`：日付ベースで棚卸/発注/入出庫を統合表示・種別フィルタ・
  セルに品目数と金額（概算）・詳細シート・天気表示スロット（実データ連携は未）。
- ホームのカードUIを統一（白枠・共通サイズ・機能別テーマ色 青/緑/オレンジ）。

### 実装済みの主要機能
- 音声 / テキスト / バーコード / CSV・Excel・PDF による品目入力・取込
- 複数端末リアルタイム同期（Durable Objects + WebSocket）・競合解決
- D1永続化・認証（店舗コード＋PIN）・セッション履歴・監査ログ
- ゲスト品目追加 → ホスト承認フロー
- Free制限のclient土台とTWA用UI判定。server強制とsigned TWA/DAL/build/署名は未完
- 招待リンク共有（ネイティブ共有 / LINE / メール）
- 「空リスト / 練習モード」開始、品目追加フォームのトグル
- **在庫分析ダッシュボード**（ManagerDashboard：在庫金額・前回差・ABC・曜日・信頼度）
- **分類軸／並び替え**（AxisAssignModal：場所・仕入先など最大2軸、1品目→複数グループ、
  振り分けページ、ドラッグ並び替え＋FLIP＋端オートスクロール、逆引き・ハイライト、
  スマホ=上下/PC=左右のレスポンシブ、再インポート時の割り当て維持）
- **ホーム再構成**（各種設定カード：端末名・プッシュ通知・並び替え）
- CSV/Excel 取込時の**同名品目の統合**（品目名の完全一致で1件に）
- **端末間のアカウント設定同期**（品目・軸を D1 経由で任意端末に再現／ログイン時の取りこぼし修正）
- **未送信データの端末保存と自動バックフィル**（DATA-002 Phase 2 / 2026-08-08）。
  D1 へ送れなかった保存は localStorage に残り、再起動をまたいで再送する。棚卸完了時に明細を
  保存できなければ完了トーストではなくその旨を出す。起動・ログイン時に、端末にあって D1 に無い
  スナップショットを送り直す（詳細 → `quality-foundation/tasks/DATA-002.md`）
- **ホームを棚卸中心の順路へ再編**（2026-08-08）。「① 品目を準備 → ② 棚卸をする → ③ 記録を見る」を
  第一導線とし、入出庫・発注内容の確認・記録・発注スケジュールをβ機能として二段目へ移動。
  発注は仕入先へ自動送信されないことを常時表示（設計判断は `proposals.md` でPMトリアージ待ち）

### 検討中（未実装・要吟味）
- **料金・提供順** → `docs/pricing-strategy.md`（W1 Web Free → A1 Android trial / Web Stripe。未決事項あり）
- **過去発注（納品）履歴 取込** → `docs/order-history-import-design.md` v2（既存の入出庫/消費逆算/
  レシピ/名寄せエンジンへ、過去の納品を一括バックフィルする設計。**P0＋過去棚卸import＋ゲート表示は
  実装済み**。DB層＝source/import_batch_id列・バルクIngest・sinceDays窓拡張は別セッション）

### 品質
- 自動test/buildの現在証拠は対象commit付きで`web-release-readiness.md`へ記録する。
- `develop@bc9fb85`のpreview CIは成功。本番自動deployはなく、production release経路はWEB-001で整備中。

### 開発ブランチ
- 固定しない。`git branch --show-current`で確認する。

---

## 3. これまでの主要な意思決定

| テーマ | 決定 | 理由 |
|---|---|---|
| 無料プラン | 1店舗コード / 150品目 / 履歴直近3回 / 同期2台 / 取込は無料 | 中核機能を体験でき、履歴・規模で課金転換 |
| 課金基盤 | Web=Stripe主体（実装は保留） | 手数料・全デバイス対応 |
| アプリ版(Play) | A1でconsumption-only。Android登録trialとWeb契約済みserver entitlementを利用 | D-021 |
| 配布面の境界 | URL query/localStorageをpolicy境界にしない。Stripe開始前にWeb購入面とPlay artifact/originを分離 | client判定漏洩を防ぐ |
| ホスト同時ログイン | 1端末に制限（単一トークン） | 多重ホストによるセッション破壊を防止 |
| 企業導入 | 設計のみ先行（E0=サーバー側プラン管理から） | 引き合い前の過剰投資を回避 |
| AI | 方針確定・実装は保留（フェーズ3） | データが貯まってから着手 |

---

## 4. 戦略・方向性（詳細 → `docs/strategy-10yr.md`）

### 核となる原則
> **「もしAIがすでにデータを持っていたら、我々はまだ必要か？」** で機能を選別する。
> 物理現実の捕捉点を押さえ、記録の正になり、AIの競合でなく手足になる。

### 4フェーズ
```
フェーズ1（現在）  棚卸を速くする道具          ← ほぼ完成段階。データ収集の最適化
フェーズ2         本部×多店舗の在庫基盤        ← 設計済み（enterprise-design.md）
フェーズ3         AI発注・ロス検知・最適化      ← 未着手（データが燃料）
フェーズ4         仕入先連携・取引決済          ← 未着手（最大の市場）
```

---

## 5. 次にやること

現在の順序は[Web公開準備](quality-foundation/web-release-readiness.md)を正とします。

1. canonical/contact、Pages legal routing、本番origin/CORS、production deploy/rollbackを固定する。
2. 本番D1 0010/0011、登録濫用、Free上限、履歴data integrityを解消する。
3. observability、critical E2E、production smokeを整え、User承認でW1を公開する。
4. W1の運用が安定してからAndroid trial、Web Stripe、server entitlementを設計・実装する。
5. Web登録へのtrial適用とStripeの公開順をUserが決め、権利境界と配布面を検証後にA1を再開する。

多店舗、AI、需要予測、大型refactoringなどはこの公開順より後に再評価します。

---

## 6. ドキュメントマップ

| 知りたいこと | ドキュメント | 状態 |
|---|---|---|
| **docs全体の正本・履歴区分** | `docs/README.md` | 現行 |
| 全体の現在地（この文書） | `docs/project-status.md` | 現行（更新は随時） |
| 長期戦略・設計原則 | `docs/strategy-10yr.md` | 現行（安定） |
| 実行計画（トラック別＋ウェーブ） | `docs/roadmap.md` | 現行 |
| **全体レビュー（PM/QA/セキュリティ横断）** | `docs/holistic-review-2026-07.md` | 記録（2026-07） |
| コード監査（リファクタ・スケール） | `docs/audit-2026-07.md` | 記録（対応状況を追記） |
| セキュリティ対応状況 | `docs/security-review.md` | 現行W1 baseline＋known gap |
| アーキテクチャ全体・オンボーディング | `docs/spec.md` | 現行W1 baseline＋旧reference snapshot |
| API設計（現状＋v2） | `docs/api-design.md` | 現行W1 API baseline＋将来v2 snapshot |
| 同期アーキテクチャ | `docs/sync-spec.md` | 現行baseline＋known gap |
| 企業導入（多店舗）設計 | `docs/enterprise-design.md` | 設計のみ |
| 料金・提供順 | `docs/pricing-strategy.md` | W1採用仕様＋A1将来フロー |
| 発注アシスト＆分析基盤 設計 | `docs/ordering-analytics-design.md` | 実装済み（A/B/D/E）＋残設計 |
| 過去発注（納品）履歴 取込 設計 | `docs/order-history-import-design.md` | v2・P0実装済み（DB層は別セッション） |
| ルーム限定URL設計 | `docs/room-url-design.md` | 実装済み（記録） |
| DB設計v2（時系列基盤） | `docs/db-design-v2.md` | 設計のみ（一部実装: inventory_lines / complete API） |
| **新機能の共通チェックリスト（DoD）** | `docs/feature-checklist.md` | 現行（PMセッションが改訂） |
| **取り込みレビュー記録**（PM→実装・下り） | `docs/intake-reviews.md` | 現行（PMセッションが追記） |
| **セッション提案箱**（実装/戦略→PM・上り） | `docs/proposals.md` | 現行（各セッションが追記・PMがトリアージ） |
| 手動テスト: 同期コア回帰 | `docs/test-cases.md` | 現行scenario。件数・一回の実績は保持しない |
| 手動テスト: 新機能 | `docs/test-checklist-new-features.md` | 2026-07-28までの履歴snapshot |
| CI/CD | `docs/ci-cd.md` | 現行 |
| 法務（規約・プライバシー） | `docs/legal/` | 現行（課金開始時に改定要 → holistic-review §3.2） |

---

## 7. 開発の進め方（運用ルール）

- **セッションは役割で分ける** — 相談/戦略 と 実装 と バグ修正 を混ぜない。
  **docs の管理（更新・削除・整合性）は PM セッション（PM/アーキテクト/QA/セキュリティ役）で行う**
- **文脈は会話でなくファイルに残す** — 決定は `docs/` へ。会話は揮発、ファイルは不揮発
- **docs の鮮度ルール** — 各文書の冒頭に「最終更新／位置づけ」を持つ。機能を実装したら
  project-status を同セッションで更新し、roadmap への反映は PM セッションでまとめて行う。
  完了した設計書は削除せず「実装済み（記録）」に格下げして残す（room-url-design 方式）
- **定型作業はスキルに逃がす** — 一次レビュー `/code-review`、確定 `/ship`（ビルド→コミット→プッシュ）
- **diffは小さく** — 1機能=1コミットを目安に
- **人間が最終レビュー** — 「テストが通った」≠「正しい」。実機確認を必ず挟む
- **新機能は共通チェックリストを通す** — `docs/feature-checklist.md`（UI3サイズ・権限・多店舗・
  同時操作・オフライン・戻る操作 等18観点＋事故由来の項目）。実装セッションがセルフチェック、
  PM セッションが取り込みレビューで再照合する
- **提案は提案箱へ（上り）** — 実装/戦略セッションの設計判断・仕様提案は `docs/proposals.md` に
  テンプレで投稿し、恒久docsは直接編集しない。PM がトリアージして恒久docsへ反映し、
  エントリは「✅採用（→反映先）/🕓保留/❌却下」で記録として残す。
  `intake-reviews.md`（PM→実装・下り）と対になる仕組み
