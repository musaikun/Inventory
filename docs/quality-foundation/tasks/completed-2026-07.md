# 完了タスクの詳細（2026-07）

状態の正本は [`../task-list.md`](../task-list.md) です。このファイルは完了済みタスクの
根拠・実装・検証証拠を保存する記録で、内容は完了時点のまま保持します。

対象: `SEC-001` `SEC-002` `SEC-003` `SEC-004` `PLAY-001` `BUG-001` `TEST-001` `DOC-000` `REPO-001`

各タスク内の「未実施」は完了記録時点の状態です。実装は `develop@96233d4` までにcommit / push済みです。
Pro Reviewは2026-08-01にdeploy済みですが、本番Pages / Workerの更新と本番D1 migrationは未実施です。

---

## PLAY-001 — account削除backendと関連data削除

- 着手: 2026-07-25 / Codex
- 完了: 2026-07-25 / Codex（backend。in-app / 公開Webは `PLAY-002`）
- 根拠: account作成API/UIは既に存在するが、削除API/UIがなく、`stores.deleted_at` だけでは
  Google Playのaccount deletion要件を満たさない。
- 主担当: Codex。UI contractはClaude Codeと実装前に固定する。
- 完了条件:
  - 有効な再認証と削除確認を要求する。
  - D1 table、DO state、Push購読、auth token、local cacheの削除/匿名化/保持mapを確定する。
  - 他店舗を削除できず、削除後の全tokenが無効になる。
  - 部分失敗時に再試行可能で、完了状態を一意に返す。
  - 正常、誤認証、越境、再送、途中失敗を自動testする。
- Checklist: [`../google-play-readiness.md`](../google-play-readiness.md)
- Contract: [`../account-deletion-contract.md`](../account-deletion-contract.md)
- 実装:
  - `DELETE /auth/account` にBearer、現在PIN、店舗code、UUID requestIdを要求。
  - pendingで通常アクセスを停止し、D1 13 data group、全token、Push購読を原子的に削除。
  - 棚卸/発注2 DOの接続・alarm・storageを削除。匿名tombstone/receiptは7日cron cleanup。
  - 同一requestId replay、別requestId競合、DO/D1部分失敗を明示状態で返す。
- 検証:
  - 失敗testを先に追加し、実装前はmodule未存在、DO内部pathは426で失敗することを確認。
  - `cd worker && npm test`: 12 files / 180 tests passed（2026-07-25）。
  - インメモリSQLite: 0001〜0011適用、削除列/receipt列、pending後INSERTの`account_inactive`を確認。
- 未実施: production migration、deploy、commit、push。User承認後に行う。

---

## SEC-001 — WebSocket の参加完了前メッセージを遮断

- 着手: 2026-07-25 / Codex
- 完了: 2026-07-25 / Codex
- 根拠: `worker/src/RoomDO.js:156` の共通メッセージ処理には参加済みガードがなく、
  `join` は 173 行付近、在庫更新は 315 行付近、競合ロックは 778 行付近にある。
- 影響: ルームを知る未参加接続が更新系メッセージを送れる。空の `deviceId` は参加者上限の
  一意 ID 集計を回避する可能性がある。`conflict_lock` のホスト限定コメントと実装も不一致。
- 実装:
  - `join` 成功を Durable Object の WebSocket attachment に永続化し、`ping` 以外の
    参加前メッセージを `1008 / join_required` で拒否。
  - 空・空白 `deviceId`、二重 `join`、招待 session 不一致、偽 host token を拒否。
  - 未参加ソケットへの broadcast を遮断し、`leave` 時に認可状態を即時無効化。
  - `conflict_lock` を参加済みホスト専用にし、参加者公開値から内部rate-limit情報を除外。
- 検証:
  - `worker/src/RoomDO.joinAuth.test.js`: 33 tests passed。
  - `cd worker && npm test`: 11 files / 154 tests passed（2026-07-25）。
  - Workers runtimeに近い統合テストへの移行は、既存Node mock基盤全体を扱う `TEST-002` で継続。

---

## SEC-002 — 注文 upsert の店舗境界を保証

- 着手: 2026-07-25 / Codex
- 完了: 2026-07-25 / Codex
- 根拠: `worker/src/storeHandler.js:266` 以降の注文保存は
  `ON CONFLICT(id) DO UPDATE` を使うが、既存 ID の `shop_code` 所有確認がない。
- 影響: 認証済みの別店舗から既知または衝突した注文 ID を指定すると、別店舗の注文ヘッダーを
  更新できる可能性がある。
- 実装:
  - 既存order ownerを事前確認し、別店舗の同一IDを409で拒否。
  - `ON CONFLICT` 自体にも `orders.shop_code = excluded.shop_code` を付け、
    owner確認後の競合を原子的に拒否。ヘッダー成功確認前は明細を変更しない。
  - DELETEは不存在と他店舗所有を同じ404にし、HTTP routeへstatusを伝播。
- 検証:
  - 2店舗の越境POST、owner確認後の競合、同店舗再送、越境DELETE、HTTP 404をtest。
  - インメモリSQLite: 別店舗 `changes=0`、同店舗 `changes=1`、owner保持を確認。
  - `cd worker && npm test`: 11 files / 159 tests passed（2026-07-25）。

---

## SEC-003 — Push 購読 API の認証・検証を追加

- 着手・完了: 2026-07-25 / Codex
- 根拠: `worker/src/index.js:201-209` の購読作成・削除が現在の soft auth 対象外。
- 実装:
  - 作成・削除とも対象店舗のBearer tokenを必須化。bodyはstream実測を含む8KiB上限。
  - endpointは2048文字以内の公開HTTPS URL（credential/fragment/非標準port/local・IP literalを拒否）。
  - `p256dh`はURL-safe base64の非圧縮P-256公開鍵（65 bytes / 0x04）、`auth`は16 bytesを要求。
  - endpoint ownerを確認し、UPSERTにも同一`shop_code`条件を付与。別店舗の奪取は409、DELETEは
    `shop_code + endpoint`条件で他店舗dataを変更しない。
- 検証:
  - 実装前に未認証、不正URL/keys、8KiB超、越境upsert/deleteの5失敗を確認。
  - 実SQLiteでvalidationとtenant境界、Worker routeで正常/401/400/413/409をtest。
  - `cd worker && npm test`: 13 files / 187 tests passed。
- 未実施: deploy、実環境変更、commit、push。
- 完了条件:
  - 店舗認証を必須化する。
  - endpoint、keys、payload size、許容 URL を検証する。
  - 未認証、異常 payload、別店舗操作、正常更新をテストする。

---

## SEC-004 — ホスト認可境界を fail-closed 化

- 着手・完了: 2026-07-26 / Codex
- 根拠: ルーム店舗確認と `RoomDO._isStoreProtected()` が D1 例外時に legacy 扱いへ倒れる。
- 実装:
  - Workerのルーム店舗確認はDB binding欠落・D1例外を503 `service_unavailable`で拒否し、DOを起動しない。
  - RoomDOは、D1で存在とPIN未設定を明示確認できた店舗だけlegacy扱い。不明・binding欠落・D1例外は
    保護店舗として扱い、有効auth tokenなしの新規host token発行を拒否する。
  - `ip_attempts`障害は認可判定ではないため従来どおりfail-openとし、店舗認可の成功要件と分離する（D-015）。
- 検証:
  - 実装前にD1例外・binding欠落でDO到達/host token発行する4失敗を確認。
  - 対象3 files / 86 tests、Worker全体13 files / 191 tests passed。
- 未実施: deploy、実環境変更、commit、push。
- 完了条件:
  - D1 障害時に保護店舗のホスト権限を新規取得できない。
  - 可用性を優先してよい読み取り処理と、閉じるべき認可処理を分離する。
  - D1 例外を注入したテストを追加する。

---

## BUG-001 — cron の存在しない列参照を修正

- 着手・完了: 2026-07-25 / Codex
- 根拠: `worker/src/pushHandler.js:115` は `sessions.updated_at` を参照するが、
  現在の sessions migrations に同列がない。
- 決定: 最終操作時刻はD1へ保存されていないため、既存の正である`started_at`を基準にし、
  開始から24時間超・7日以内のactive sessionを再開通知対象とする。
- 実装: queryを`started_at`へ整合させ、`deleted_at IS NULL`で論理削除済みsessionを除外。
- 検証:
  - 全migration 0001〜0011をNode SQLiteへ適用してcron全体を実行するtestを追加。
  - 修正前に`no such column: s.updated_at`で失敗することを確認。
  - 25時間、23時間、8日超の境界を固定し、`cd worker && npm test`: 13 files / 182 tests passed。
- 未実施: deploy、実環境変更、commit、push。
- 完了条件:
  - 「放置セッション」の基準時刻を仕様として決める。
    - query または schema を整合させる。
    - cron 全体を既存 schema で実行するテストを追加する。

---

## TEST-001 — 仕入先順の仕様を決め App テストを復旧

- 着手・完了: 2026-07-26 / Codex（User判断: 入力順）。
- 根拠: `deliveryImportCommit.test.js` の期待順と `localeCompare` による実装順が不一致。
- 決定: 日付昇順。同一日内はCSVで仕入先が最初に登場した順を保持し、同一日・仕入先の行は
  最初の登場位置に1件の入庫レコードとして集約する（D-005）。
- 実装: group作成時の`firstSeen`を保持し、日付→初出順でsort。locale依存の仕入先名sortを除去した。
- 検証: 対象4/4、App 67 files / 658 tests、Worker 15 files / 195 testsが全件成功。
  App production build成功（444 modules）、`git diff --check`成功。
- 未実施: commit、push、deploy。
- 完了条件: 判断を `decisions.md` に記録し、実装とテストを一致させ、App テストを全件成功させる。

---

## DOC-000 — 共有監査・引き継ぎ基盤を作成

- 完了: 2026-07-25
- 成果物: `docs/quality-foundation/`、`AGENTS.md`、`CLAUDE.md` の共有導線。

---

## REPO-001 — ローカル生成物を `.gitignore` に追加

- 完了: 2026-07-25
- 対象: `/.wrangler/`、`/worker/dist/`、ルートの偶発的 `package-lock.json`。
- 注記: 既存ファイルは削除していない。
