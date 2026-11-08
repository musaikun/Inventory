# 2026-11-08 — 店の今: 業務を押すとその中身へ・ホームの2枚の行き先を分ける

- version: 0.197.1 → **0.197.2**

User: 店の今で業務を押したら、その業務の詳細へ。今日のやることと店の今の遷移先が同じなので差別化したい
- `HomeNowCard.vue`: 帯・進行中の行をボタンに（@item）。見出し「予定ボード ›」と帯の無い所は @open
- 行き先: 今日のやること → 今日の一覧（見出しも「今日の一覧 ›」）／店の今の見出し → 今日の予定ボード／店の今の業務 → 業務管理を今日で開き、その中身のシート（やること=TaskRow、進行中=ProgressSheet、チェック表=✓の画面）
- `JournalPage.vue`: `openJournalDay(d, { view })`（その日の見せ方を1回だけ指定。好みは変えない）、`openJournalItem(d, item)` を足した。`DayTimeline.vue` に `initialView`
- `services/homeNow.js`: 帯に ref（task / list）
- 検証: app vitest 全件 pass（SessionListPage.home・HomeNowCard に行き先のテスト追加）、build OK
