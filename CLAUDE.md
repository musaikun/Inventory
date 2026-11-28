# CLAUDE.md

共通の指示は `AGENTS.md` が正本です（→ D-029）。下の import で読み込まれます。
ここには **Claude Code 固有の差分だけ**を書きます。共通ルールはここに足さず `AGENTS.md` へ。

@AGENTS.md

## Claude Code 固有

- **`develop` への push はUserの都度確認なしで行ってよい**（D-022）。
  本番デプロイ、本番マイグレーションは引き続き明示依頼が必要。`main` は使わない（D-045。push・統合しない）
- クラウドのセッションには `~/.claude/CLAUDE.md`（ユーザー設定）が無い。
  このリポジトリの作業に必要なルールは `AGENTS.md` に書く
