# 共同作業ルール

最終更新: 2026-08-04

## セッション開始

1. `git status --short --branch` で現在 branch と既存差分を確認する。
2. `docs/README.md` と `docs/quality-foundation/README.md` の順に、現在の公開gate、
   タスク、判断、直近logを読む。
3. 対象タスクを一つ選び、`task-list.md`（状態の正本）の状態と担当を更新する。
   進行中・未着手P0/P1の詳細と作業記録は `tasks/<ID>.md` に置く。
   優先度・状態・担当は詳細fileへ複製せず、`task-list.md`だけで管理する。
4. 未決の製品仕様が完了条件を変える場合は、実装前に `decisions.md` へ記録する。

## 実装

- ユーザーの差分と、別エージェントが担当中の差分を上書きしない。
- セキュリティ修正は、成立条件を示す失敗テストを先に追加または同じ差分に含める。
- バグ修正と大型 refactoring を同じタスクに混ぜない。
- Web Free版のrelease gateが完了するまでは、Web公開・品質基盤以外の新機能を追加しない。
  Stripe、trial、TWA、Play提出はD-021の後続マイルストーンとして扱う。
- Cloudflare API、制限、設定は、実装時点の公式文書で再確認する。
- DB migration は後方互換性、rollback 不能性、既存データを確認する。
- deploy、commit、push、外部サービス変更はユーザーの明示依頼がある場合だけ行う。

## 検証

影響範囲に応じて最小セットを選び、最終的には関連 package を通します。

```powershell
cd worker
npm test

cd ../app
npm test
npm run build
```

依存変更時:

```powershell
npm audit --omit=dev
npm outdated
```

AppとWorkerのVitest対象は2026-08-02に分離済みです。両packageを個別に実行して結果を報告します。
`TEST-002`のcritical integration/E2Eが残る間は、unit test成功だけで同タスクを完了にしません。
既知失敗が残る場合は「全件成功」と表現しません。

## 完了・引き継ぎ

1. タスクの完了条件を確認し、検証結果を `tasks/<ID>.md` または session log に記録する。
2. API、DB、認可、ユーザー操作、運用が変わった場合は関連文書を更新する。
3. `task-list.md` の状態を `レビュー待ち` または `完了` にする。完了時は詳細を
   `tasks/completed-<年月>.md` へ移し、記録・完了条件・検証証拠は削除せずそのまま残す。
4. `session-log.md` の先頭へ、変更、検証、残件、次の一手を追記する。
5. 未追跡ファイルと意図しない差分がないか `git status` で確認する。

現在のWeb release判定は`web-release-readiness.md`を使用し、production URLのUser確認を必須とします。
Google Play releaseでは`quality-scorecard.md`をCodexとClaude Codeが独立して評価します。

## 競合時

- 同じタスクが `進行中` なら、その担当者の完了または明示的な引き継ぎを待つ。
- 別タスクでも同じファイルを触る場合は、先に小さい方を完了させるか担当を調整する。
- 文書と実装が矛盾したら、コードを無条件に正とせず、仕様変更か実装バグかを
  `decisions.md` で分ける。
