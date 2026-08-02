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

## 完了条件

- 各 package が単独で再現可能にテストできる。— **ローカル確認済み。CI確認待ち**
- Worker の runtime、D1、DO、WebSocket の重要経路に統合テストを加える。
- account登録→削除、host/guest同期、再接続のcritical E2Eを最低1本安定実行する。
- coverage全面導入はスプリント後でもよいが、P0/P1変更箇所の回帰testは必須。
