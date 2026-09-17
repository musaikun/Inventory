# REPO-002: developのmerge競合解消

User依頼（2026-09-17）。`develop@1c9729885aaf399d0b44acb0d9b18210c5f70298` と `f820bf6d643a814216618bb78293afcd758bef68` のmerge作業ツリーが対象。

競合は `app/src/components/HistoryCalendar.vue` のみ。発注スケジュール表示と定型メモチップ廃止を保持し、以前のメモのtagsを上書き保存で失わないよう統合する。既存の他ファイルのステージ差分を保持する。

完了条件: unmerged entryがなくなること、カレンダー関連testとApp package test、production buildの結果を記録すること。commit / push / deployは今回の依頼に含まない。

## 検証（上記merge作業ツリー）

- `npm.cmd test -- src/components/HistoryCalendar.plan.test.js src/components/HistoryCalendar.cell.test.js src/components/HistoryCalendar.import.test.js src/components/HistoryCalendarPage.test.js --pool=threads --maxWorkers=1 --hookTimeout=30000 --reporter=dot`: 4 files / 31 tests成功。既存タグ・学習除外の保持と、別日へのタグ持ち越し防止を既存testファイルの1ケースで確認。
- `npm.cmd run build`: 成功（501 modules、PWA 17 entries / 2734.30 KiB）。chunkサイズの警告あり。
- `git ls-files --unmerged`: 出力なし。競合解消ファイルとtestをstage済み。
- `git diff --cached --check`: exit 0。
- `npm.cmd test -- --pool=threads --maxWorkers=2 --hookTimeout=30000 --reporter=dot`: 159 files / 1779 tests成功（458.82s、exit 0）。

競合解消と検証は完了。merge commitは未実施のままUserへ引き継ぐ。作業中にorigin/developが進んだが、今回のMERGE_HEADは上記f820bf6のまま保持し、追加のpull / mergeは行っていない。
