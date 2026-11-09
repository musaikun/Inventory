# 2026-11-09 — 触診の不具合1〜3を修正

- version: 0.198.4 → **0.198.5**

User: 触診で見つかった不具合 1〜3 を直して
1. 品目名が壊れる: `useVoice.js` parseText を作り直し。数量は末尾の数（＋直後の単位1つ）だけ。名前の途中の数字・単位の文字は残す。手で打った文字（`runSearch(raw, { typed: true })`）は数の前に空白があるときだけ数量に（「トマト 3」「牛乳 1.5L」）、「コーラ500ml」「A001」「LATTE」はそのまま。声はくっついた「トマト3個」も読む。空白は日本語どうしだけ詰め、英字の単語の間は残す。さらに App.vue runSearch で、文字全体が既存の品目名と同じならその品目を開く
2. 同名の品目があるのに「新しく登録」が主ボタン: `CandidateModal.vue` で同じ名前（空白・大小無視）があれば新しく登録を出さず、その品目を先頭に「同じ名前の品目があります」。※実際の重複は `_walkRegister` が既存を開くので起きていなかった
3. 毎週の繰り返しが今日から始まる: TaskAddSheet が選んだ日付を startDate に渡し、`saveChecklist` は先の日なら繰り返しもその日から（今日以前・直しは今まで通り）
- 検証: app vitest 2239 pass（useVoice.parse・CandidateModal・TaskAddSheet にテスト追加）、build OK、E2E（e2e/ `npx playwright test`）1 passed
- 残り（触診の4・5ほか）: 予定ボードの短い記録・名前の折れ、長い名前のトースト、文言
