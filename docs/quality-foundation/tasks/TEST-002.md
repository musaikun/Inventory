# TEST-002 — App / Worker テスト責務を分離

- 状態の正本は [`../task-list.md`](../task-list.md)
- **統合**: App/Worker テスト分離の課題は新規IDを作らず本タスクで扱う。

- 根拠: `app/vitest.config.js` が `../worker/src/**/*.test.js` も含み、CIで重複していた。
- 影響:
  - `develop-preview.yml` は Worker テストと App テストを別ステップで実行するため、
    Worker のテストが**2回**走る。CI時間と失敗箇所の特定コストが増える。
  - 「App 67 files / 65x tests」という報告値に Worker 分が混ざり、どちらの回帰かを読み取りにくい。
  - App全体実行時にWorkerのrate-limit testが5秒timeoutとなり、単独実行では成功する不安定性が再現した。
- 経緯: Node SQLite を使う `pushHandler.test.js` は 2026-07-26 に `worker/src` から `worker/test` へ移し、
  App の Vitest include 対象から分離済み（`PLAY-002` の Codex 再レビュー時）。
  その後も残りの `worker/src/**/*.test.js` がApp側から拾われていた。

## package分離の対応（2026-08-02 / Codex）

- `app/vitest.config.js`のincludeを`src/**/*.test.js`だけに変更し、Worker testを分離した。
- Worker: 15 files / 196 tests passed。
- App: 54 files / 467 tests passed。分離前に再現した5秒timeoutは発生しなかった。
- App production build成功（444 modules）。
- package分離は完了。runtimeに近いintegration testとcritical E2Eは未着手のため、本タスク全体は進行中。

## E2E基盤と1本目（2026-11-02 / Claude Code）

- `e2e/`（独立package・`@playwright/test` 1.63.0）。`npx playwright test` 1コマンドで
  ローカルWorker（`wrangler dev --local` = Miniflare。DO/D1/R2を模擬、毎回まっさらなD1に全migrationを適用）と
  ローカルWorker向けにbuildしたアプリ（vite preview）を起動する。本番・previewのD1/Workerには触れない。
- 1本目 `tests/new-device-history.spec.js`（R-001の型）: 端末Aで登録→品目登録→数量→完了、
  別browser context（=localStorage空の端末B）でログイン→レポート→詳細の変更履歴に「トマト 7」。
- **mutation確認**: `GET /store/:code/history` の `handleHistoryGet` を空配列へ差し替えると落ち、戻すと通る。
  一方 `/sessions/:id/audit` GET を空にしても通った（変更履歴は完了時snapshotに同梱され、`/history` で届く）。
  「テストが何を守っているか」はコードを壊して確かめないと分からない例として残す。
- 所要: 初回起動（migration+build）込み約77秒、テスト本体約9秒。
- 注意: 店舗登録はIPあたり5回（`REGISTER_MAX_PER_IP`）。1回の実行で登録は5回以内にする（D1は毎回作り直すので持ち越さない）。
  `confirm()` は helpers の `acceptDialogs` で自動OKにしている。
- CI: `.github/workflows/test.yml` を追加（2026-11-07に`ci.yml`の`e2e` jobへ統合）。develop/main以外へのpushとPRで unit（Worker・App・build）と e2e を回す。
  secretは使わない。develop-preview.ymlは変更していない。

### 残り（次の候補）

- host/guest同期（QR参加→ゲスト入力がホストに出る・途中参加でホストに揃う）
- 同日2回目の棚卸が1回目を上書きしない（F-001）
- 再接続（オフライン中の入力→復帰で再送）
- account登録→削除

## 完了条件

- 各 package が単独で再現可能にテストできる。— **ローカル確認済み。CI確認待ち**
- Worker の runtime、D1、DO、WebSocket の重要経路に統合テストを加える。
- account登録→削除、host/guest同期、再接続のcritical E2Eを最低1本安定実行する。
- coverage全面導入はスプリント後でもよいが、P0/P1変更箇所の回帰testは必須。
