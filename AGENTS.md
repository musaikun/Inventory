# Repository agent instructions

このリポジトリで作業する Codex / coding agent は、開始時に次を読んでください。

1. `CLAUDE.md`
2. `docs/quality-foundation/README.md`
3. `docs/quality-foundation/sprint-plan-2026-07-27.md`
4. `docs/quality-foundation/project-status.md`
5. `docs/quality-foundation/task-list.md`（状態の正本＝進捗ボード。
   進行中・未着手P0/P1の詳細は `docs/quality-foundation/tasks/<ID>.md`、
   完了分と保留分は同directoryの集約file）
6. `docs/quality-foundation/working-agreement.md`
7. `docs/quality-foundation/session-log.md`
8. `docs/quality-foundation/google-play-readiness.md`
9. `docs/quality-foundation/quality-scorecard.md`

## Shared workflow

- `docs/quality-foundation/` を Codex、Claude Code、ユーザー間の共同品質基盤とする。
- 着手前に対象タスクを `進行中` にし、担当を記録する。
- 2026-07-27〜2026-08-08はGoogle Play要件と品質基盤以外の新機能を追加しない。
- 現在 branch は Git で確認し、文書に固定された古い branch 名を前提にしない。
- dated audit と `docs/export/` は履歴であり、現在仕様へ上書きしない。
- API、DB、認可、動作、運用を変えた場合は、関連する現行文書も同じタスクで更新する。
- 実行していない test を成功と報告しない。対象 commit と command を残す。
- ユーザーの既存差分を保持し、担当外の変更を巻き戻さない。
- deploy、DB migration 適用、commit、push は明示依頼なしに行わない。
- release判定は `docs/quality-foundation/quality-scorecard.md` を双方が独立採点し、
  低い方の点数を採用する。

Cloudflare Workers / Durable Objects の変更では、実装時点の公式ドキュメントと利用可能な
Cloudflare skills を確認してください。
