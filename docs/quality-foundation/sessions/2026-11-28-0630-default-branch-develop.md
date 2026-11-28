# 2026-11-28 — default branch を develop に（D-045）

- version: 0.223.1 → **0.223.2**（docs と workflow のコメントのみ）

User: もはや develop が main のようになっている？ → 案2（develop を default branch にし、main は使わない）で進める

- 事実: `main` の最後は 2026-09-19（`7d15e90`）。`develop` に `main` に無い commit が 589、`main` に `develop` に無い commit が 73（中身は未確認・消していない）
- 変更: `decisions.md` に D-045。`AGENTS.md`・`CLAUDE.md`・`quality-foundation/README.md`・`ci-cd.md`・`pro-review-runbook.md` の `main` の扱いを現行に。
  `health-check.yml`・`production-backend.yml` はコメントだけ（動きは同じ。apply は develop だけのガードはそのまま）
- **User の操作が残っている**: GitHub の Settings → General → Default branch を `develop` に切り替える。
  切り替えるまで、Worker Health Check の定期実行は `main` の古い版のまま

検証: `node scripts/check-docs-links.mjs` ／ `cd app && npm run build` OK
