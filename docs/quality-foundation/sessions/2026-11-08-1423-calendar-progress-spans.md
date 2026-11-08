# 2026-11-08 — 業務管理のカレンダーに進行中の帯

- version: 0.197.4 → **0.198.0**

User: モック docs/mocks/calendar-progress.html で決定 — 1週2本まで・締め切りなしは今日までの帯・〆の札はいらない
- `JournalMonth.vue`: prop `spans`・emit `span`。マスを grid の行・列に明示配置し、帯を同じ grid に列の範囲で重ねる（週をまたぐと行ごとに切る、続きは「…」と角なし）。帯の分だけマスに空きを取る。1週2本・あふれは「ほかn」。祝日名は日付の横へ。凡例に「進行中」
- `JournalPage.vue`: progressTasks → 帯（始まり=実施日 t.date、終わり=締め切り／無ければ今日、未開始は今日ではなく実施日まで）。色: 締め切り過ぎ赤・止まっている黄・待ち灰・進行中青、未開始は薄く。帯を押すと ProgressSheet
- 検証: app vitest 全件 pass（JournalPage に帯のテスト追加）、build OK、画面を確認
