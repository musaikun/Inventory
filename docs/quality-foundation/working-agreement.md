# 共同作業ルール

最終更新: 2026-07-25

## セッション開始

1. `git status --short --branch` で現在 branch と既存差分を確認する。
2. `docs/quality-foundation/README.md` の順にsprint、現状、タスク、判断、直近logを読む。
3. 対象タスクを一つ選び、`task-list.md` の状態と担当を更新する。
4. 未決の製品仕様が完了条件を変える場合は、実装前に `decisions.md` へ記録する。

## 実装

- ユーザーの差分と、別エージェントが担当中の差分を上書きしない。
- セキュリティ修正は、成立条件を示す失敗テストを先に追加または同じ差分に含める。
- バグ修正と大型 refactoring を同じタスクに混ぜない。
- 2026-08-08まではGoogle Play要件と品質基盤以外の機能を追加しない。
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

`app` の現在のテストは Worker テストも含むため、`TEST-002` 完了までは重複を認識して
結果を報告します。既知失敗が残る場合は「全件成功」と表現しません。

## 完了・引き継ぎ

1. タスクの完了条件を確認し、検証結果をタスクまたは session log に記録する。
2. API、DB、認可、ユーザー操作、運用が変わった場合は関連文書を更新する。
3. `task-list.md` の状態を `レビュー待ち` または `完了` にする。
4. `session-log.md` の先頭へ、変更、検証、残件、次の一手を追記する。
5. 未追跡ファイルと意図しない差分がないか `git status` で確認する。

最終release判定では、担当者自身の採点だけで完了にせず、
`quality-scorecard.md` をCodexとClaude Codeが独立して評価します。

## 競合時

- 同じタスクが `進行中` なら、その担当者の完了または明示的な引き継ぎを待つ。
- 別タスクでも同じファイルを触る場合は、先に小さい方を完了させるか担当を調整する。
- 文書と実装が矛盾したら、コードを無条件に正とせず、仕様変更か実装バグかを
  `decisions.md` で分ける。
