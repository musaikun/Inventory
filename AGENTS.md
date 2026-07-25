# Repository agent instructions

このリポジトリで作業する Codex / coding agent は、開始時に次を読んでください。

1. `CLAUDE.md`
2. `docs/codex/README.md`
3. `docs/codex/project-status.md`
4. `docs/codex/task-list.md`
5. `docs/codex/working-agreement.md`
6. `docs/codex/session-log.md`

## Shared workflow

- `docs/codex/` を Codex、Claude Code、ユーザー間の共有作業入口とする。
- 着手前に対象タスクを `進行中` にし、担当を記録する。
- 現在 branch は Git で確認し、文書に固定された古い branch 名を前提にしない。
- dated audit と `docs/export/` は履歴であり、現在仕様へ上書きしない。
- API、DB、認可、動作、運用を変えた場合は、関連する現行文書も同じタスクで更新する。
- 実行していない test を成功と報告しない。対象 commit と command を残す。
- ユーザーの既存差分を保持し、担当外の変更を巻き戻さない。
- deploy、DB migration 適用、commit、push は明示依頼なしに行わない。

Cloudflare Workers / Durable Objects の変更では、実装時点の公式ドキュメントと利用可能な
Cloudflare skills を確認してください。

