# CLAUDE.md

共通の指示は `AGENTS.md` が正本です（→ D-029）。下の import で読み込まれます。
ここには **Claude Code 固有の差分だけ**を書きます。共通ルールはここに足さず `AGENTS.md` へ。

@AGENTS.md

## Claude Code 固有

- **`develop` への push はUserの都度確認なしで行ってよい**（D-022）。
  本番デプロイ、本番マイグレーション、`main` への統合は引き続き明示依頼が必要
- クラウドのセッションには `~/.claude/CLAUDE.md`（ユーザー設定）が無い。
  このリポジトリの作業に必要なルールは `AGENTS.md` に書く
