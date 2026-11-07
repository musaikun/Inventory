# セッション記録（1件1ファイル）

2026-11-07から、作業の記録は1件ごとにこのディレクトリへ別ファイルで置きます（D-033）。
同じファイルへ追記しないので、並行セッションのmergeで競合しません。

## ファイル名

```
YYYY-MM-DD-HHMM-<slug>.md
```

- 日時は **UTC**（`date -u +%Y-%m-%d-%H%M`）。ファイル名の順がそのまま時系列になる
- `<slug>` は英小文字・数字・ハイフン（例: `doc-004-staff-perms`、`fix-order-save`）。タスクIDがあれば先頭に
- 1回のpushにつき1ファイルを目安にする。同じ作業の続きは新しいファイルにする（過去のファイルは書き換えない）
- 名前の形は `node scripts/check-docs-links.mjs` が検査する

## 中身

```markdown
# YYYY-MM-DD — <一言の題>

- version: 0.xxx.x → **0.yyy.y**
- task: DOC-004（あれば）

User: 依頼の要点（1〜2行）
- 原因・変更（ファイル名と要点）
- 検証: 実行した command と結果（未実行のものは未実行と書く）
- 残件・次の一手
```

再開に必要な事実だけを書き、会話の全文は書きません。

## 読み方

- 直近: `ls docs/quality-foundation/sessions/ | tail -5` で新しい順に数件
- 2026-11-07より前: [`../archive/`](../archive/) の月別snapshot
