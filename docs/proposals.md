# セッション提案箱（PMトリアージ用）

最終更新: 2026-07-17
位置づけ: 各実装/戦略セッションから **PMセッションへの「提案・設計判断・要検討」の集約箱**。
`intake-reviews.md`（PM→実装のレビュー＝下り）に対して、これは **実装/戦略→PM（提案＝上り）**。
PMがトリアージし、採否と恒久docsへの反映先を「PM判断」欄に記入する。

## 使い方

- 新規提案は**日付見出しで先頭に追記**する（新しいものが上）。
- 1提案 = 概要 / 背景・根拠 / 影響範囲・実装状況 / PM判断。
- **PM判断**の状態: ⬜未トリアージ ｜ ✅採用（→反映先ファイル） ｜ 🕓保留 ｜ ❌却下。
- PMが恒久docs（strategy / roadmap / project-status / pricing-strategy / ordering-analytics-design 等）へ
  反映したら、ここのエントリは削除せず「✅採用（→ファイル名）」に落として記録として残す。
- 実装済みの提案でも、**設計判断としてdocsに残すべきか**の判断はPMが行う（実装＝合意ではない）。

### テンプレート（コピーして先頭に貼る）

- `## YYYY-MM-DD: <タイトル>（提案元: <領域/セッション>）`
- **概要**: 何を提案するか（1〜2行）
- **背景・根拠**: なぜそうすべきか
- **影響範囲 / 実装状況**: 触る場所・すでに実装したか
- **PM判断**: ⬜未トリアージ

---

## 2026-07-26: Google Play公開buildのdata最小化（提案元: PLAY-003 / PRIV-001）

- **概要**: Google Play公開buildではPostHogを無効固定し、D1のlogin/IP失敗recordは
  rate-limit判定窓15分を過ぎた後の日次cleanup（実保持は最長約24時間15分）で削除する。
- **背景・根拠**: 旧analytics実装はkey設定時にPostHog SDKの既定`autocapture:true`が働き、
  consent/allowlist/保持期間を整備しないまま送信できる構成だった。また`login_attempts` / `ip_attempts`は
  同一keyの再利用がなければ期限切れrowが残り、privacy policyの「access log 90日」とも一致しなかった。
- **影響範囲 / 実装状況**: local実装済み。`posthog-js`依存・key例・CSP接続先を除去し、analyticsを
  常時no-op化。security rowのglobal cleanupを既存日次cronへ追加し、targeted testを追加した。
  公開buildのnetwork、Cloudflare dashboard、最終legal文面は未確認。将来analyticsを再導入する場合は、
  明示consent、event allowlist、retention、privacy/Data Safetyを同じreleaseで設計する。
- **PM判断**: ⬜未トリアージ（local実装は公開安全側の暫定措置であり、恒久方針の採用を意味しない）

## 2026-07-23: 過去の納品・棚卸の一括取込（発注理論値のコールドスタート解消）（提案元: 過去履歴取込セッション）

- **概要**: 過去の納品履歴を中間フォーマットCSVから **入庫（movements type:in）** へ一括投入し、
  過去の棚卸結果を **実行済みスナップショット** として過去日付で挿入できるようにした。両者が揃うと
  既存の消費逆算（`impliedConsumption`）・理論在庫（`theoreticalStock`）が過去に遡って算出され、
  発注理論値のコールドスタートが解消される。設計は `docs/order-history-import-design.md` v2。
- **背景・根拠**: 予測・分析エンジンは実装済みだが「過去のフローを過去日付で一括投入する経路」が
  無かった（PDF/CSV取込は品目マスタ止まり）。名寄せ(`itemMatcher`)・レシピ(`pdfProfiles`)・
  入庫(`useMovements`)の既存土台に**供給**する形で最小増設した。
- **設計判断（PMトリアージ希望）**:
  1. **D1列は未追加（別セッション）**: `source`/`import_batch_id` は localStorage のみ保持し、
     既存 `POST /movements` へは送るが worker 側は無視（後方互換）。一括Ingest・`sinceDays`窓拡張・
     列追加は DB設計セッションで（`db-design-v2.md` §10）。**過去1年超の取込は現状 GET 窓外**になる点は要対応。
  2. **プラン境界**: 取込は既存方針どおり無料。新規品目追加のみ `addItem` の `FREE_ITEM_LIMIT` に従う。
     movements/history の取込自体は無制限。要PM確認。
  3. **冪等キー**: `日付+種別+品目+数量`。同一納品書の二重取込を防止。`importBatchId` で一括取消可能。
  4. **名寄せ学習**: 取込時の「業者名→既存品目」を `registerAlias`（`masterDict`）へ学習し次回自動化。
  5. **過去棚卸は名寄せ不要**（自店の品目名）。上書き確認のみで直接挿入。
- **影響範囲 / 実装状況**: 実装済み・app全テストgreen。
  - 追加: `utils/deliveryImportParser` `utils/importBatch` `services/deliveryImportMatch`
    `services/deliveryImportCommit` `services/analysisCapability`、`components/DeliveryImportModal.vue`、
    `resultCsvParser.parseResultSnapshots`、`useHistory.importPastSnapshot`、
    `useMovements`（source/importBatchId・deleteImportBatch）、`MovementPage` 導線＋ゲート表示。
- **PM判断**: ⬜未トリアージ

## 2026-07-21: 入出庫（movements）を D1 永続化・端末間で揃える（提案元: 入出庫セッション）

- **概要**: これまで localStorage 専用だった入出庫レコードを、発注・棚卸と同様に **D1 を正**として
  永続化。保存時 POST・開始/表示時ロードの「非リアルタイム同期」で、端末をまたいで入出庫が見え、
  キャッシュ削除・端末紛失でも消えないようにした。
- **背景・根拠**: 発注・棚卸は D1 化済みなのに入出庫だけローカル専用で、①別端末で入出庫が存在しない
  ②「発注はD1・入庫はローカル」で理論在庫/発注→入庫反映が端末間で食い違う、という非対称があった。
  加えて、発注削除がローカルのみで D1 から復活し「未反映の入庫」に再表示される不具合の同型リスクが
  入出庫にも生じるため（D1化するなら削除もD1連動が必須）、あわせて対処した。
- **設計判断**: 入出庫は「確定済み記録の追記ログ」で複数人同時編集が無いため、棚卸・発注のような
  **WebSocket リアルタイム同期は採用せず**、発注レコードと同じ「保存時POST＋開始時ロード（id重複排除で冪等）」に
  留めた（DO 併設は過剰と判断）。
- **影響範囲 / 実装状況**: 実装済み。
  - 追加: マイグレーション `0010_movements.sql`（`movements`/`movement_lines`）、
    worker `handleMovementsGet/Create/Delete` ＋ ルート `/store/:code/movements`、
    client `useStore` の `loadMovementsFromD1/saveMovementToD1/deleteMovementFromD1`（再送キュー込み）、
    `useMovements.applyRemoteMovements`。
  - 配線: `MovementPage.onSave` で保存後 POST、`App._pullMovements` を認証後/入出庫ページ表示時にロード、
    `HistoryCalendar.onDeleteMove` で D1 からも削除。
  - テスト: worker 5件（往復・出庫はorderId無し・400・冪等・削除）＋ client 2件（applyRemoteMovements）。
- **補足（PM論点）**: これらの削除は D1 からも消え **復元不可**。今回は現状維持だが、誤タップ対策として
  「削除直後のUndoトースト」を将来入れる余地あり（別提案化の候補・本セッションで方針保留）。
- **PM判断**: ✅採用（2026-07-21 PMセッション・条件付き）
  - 採用理由: Wave 2.5 #2（料金戦略「無料の床」の前提）そのもの。「追記ログに
    リアルタイム同期は過剰」の判断も妥当（複雑さは同期コアに集中させる方針と一致）。
  - **条件（必須修正）**: R5-01 — upsert の `ON CONFLICT(id) DO UPDATE` に shop_code 条件が無く
    テナント境界が破れる。修正まで「完了」扱いにしない（→ `intake-reviews.md`）。
  - 付帯: ①削除Undoトーストは推奨として採用（実装時期は任意・小）
    ②S-10 の残課題「共有端末のログアウト後残存」は入出庫D1化で前提が揃ったため、
    **ログアウト時の全消去への引き上げ**を次の対応候補に格上げ（security-review S-10 参照）。
  - 反映先: `roadmap.md` F節・Wave 2.5、`security-review.md` S-10 注記、`project-status.md`。

---

## 2026-07-19: config フィールドの client/worker 二重管理を守りのテストで塞ぐ（提案元: R3-01修正セッション）

- **概要**: 品目リスト config のフィールド一覧が client（`useConfig._serializeConfigData`）と
  worker（`RoomDO.normalizeConfig`）で**二重管理**されており、新フィールド追加時に片方へ
  入れ忘れると DO 中継でフィールドが脱落する。B-01（軸/非表示）→R3-01（orderSchedule）で
  **2回発生済み**。再々発を防ぐ構造対策を入れたい。
- **背景・根拠**: 根因は R-03（監査）の worker 側が未解決＝単一の真実が無いこと。
  以前 `utils/configFields.js` に集約する案を出したが、ブランチ統合時に client 側実装を
  正として worker 側は手動ミラーのまま残った経緯。フィールドは今後も増える（発注系・分析系）ため、
  「追加漏れ＝サイレントなデータ欠落」の構造が残り続けるのはリスク。
- **対策案（いずれか）**:
  1. **守りのテスト（低コスト・推奨）**: client serialize の出力キー集合と worker normalizeConfig の
     出力キー集合を突き合わせ、不一致で落ちるテスト。キー一覧だけを両パッケージ共有の小さな
     定数（例 `shared/configFieldKeys.js`）に出し、双方がそれを参照＋テストで照合。
  2. **完全共有（中コスト）**: 正規化ロジックごと共有モジュール化（app/worker 双方から import）。
     ビルド構成（Vite / wrangler）を跨ぐため配置と bundling の検討が要る。
- **影響範囲 / 実装状況**: 未実装（提案のみ）。R3-01 の即時修正（normalizeConfig に orderSchedule 追加＋
  テスト）は完了済み。本提案はその再発防止レイヤー。
- **PM判断**: ✅採用（2026-07-20 PMセッション・**案1「守りのテスト＋共有キー定数」を採用**）
  - 理由: 同型事故2回は構造問題。案1は低コストで「追加漏れ＝テスト即失敗」に変えられる。
    案2（正規化ロジック完全共有）はビルド構成を跨ぐ複雑さに見合う破綻がまだ無いので現時点は見送り
    （キー定数共有がその布石にもなる）。
  - 実装時の注意: 共有定数は repo 直下 `shared/` に置き、app/worker 双方から相対 import。
    「serialize が返すキー ⊆ 定数」「normalizeConfig が返すキー ⊆ 定数」の両向きで照合すること。
  - 反映先: `roadmap.md` H節に追加済み。着手は次の config フィールド追加の前が理想。

---

## 2026-07-17: 発注点は「人間が決める床＋データの推奨」の二段構え（提案元: カード/入出庫セッション）

- **概要**: 手動発注点＝人間が決める絶対下限（床）として扱う。予測モデルは発注点/発注量の
  「推奨」を出す側で、**手動値は自動上書きしない**（タップ採用で合成。実務は `max(手動床, 推奨)` が安全側）。
- **背景・根拠**: 在庫理論では別レイヤー。
  - **発注点(ROP)**＝*いつ*頼むか＝リードタイム中の予測需要＋安全在庫
  - **発注量**＝*いくつ*頼むか＝次納品までの予測需要＋安全在庫−現在庫（曜日別・外的/内的要因はここ）
  - **安全在庫**＝*切らせない*緩衝＝需要のブレ×リードタイム×目標欠品率
  - 「これさえ守れば絶対切れない」は数学的に不可能。実装上は**サービスレベル（欠品率）で安全在庫の大きさを選ぶ**話に落ちる。
  - 発注点はリードタイム前提で意味を持つ → 他セッションの**発注スケジュール（発注曜日/締切）がリードタイム構造**、
    **需要カレンダー（祝日・給料日等）が外的要因**として噛み合う。
- **料金戦略との整合**: 手動発注点＝シンプル/データ不要＝**無料の床でも出せる**。
  予測（曜日別・外的/内的要因）の推奨＝データと計算＝**有料の差別化**。`pricing-strategy.md` の wedge と一致。
- **影響範囲 / 実装状況**: 実装済み（`5e918d6` ほか）。
  - `reorderPoints` を config フィールド化（default/serialize/assign/rename/remove/setter＋RoomDO中継。localStorage/D1/ルーム同期）
  - 「要補充」判定を `理論在庫 ≤ 発注点`（未設定は0以下）に。在庫タブのフィルタ・件数・強調が連動
  - 在庫タブの品目詳細に手動入力＋**暫定「目安」**（直近30日の平均日消費 × 発注間隔）。タップ採用・自動上書きなし
  - 暫定ヒューリスティックは需要カレンダー/曜日別モデル完成時に置換予定
- **PM判断**: ✅採用（2026-07-18 PMセッション）
  - 反映先: `ordering-analytics-design.md` §2.3（パー→発注点の二段構えとして全面更新・用語定義も同節に収録）、
    同書ヘッダの実装状況、`roadmap.md` E節。
  - 採用理由: ①在庫理論と整合（ROP/発注量/安全在庫のレイヤー分離）②「手動値を自動上書きしない」は
    本プロダクトの原則「勘を潰さず、目安を出す」と一致 ③無料の床=手動/有料=予測の切り分けが
    `pricing-strategy.md` の wedge と噛み合う。
  - 補足条件: 「絶対切らさない」は数学的に不可能のため、UI文言では「切れにくくする目安」等の
    表現を使い、保証と誤読される語（必ず・絶対）を避けること（レビュー時に確認する）。
