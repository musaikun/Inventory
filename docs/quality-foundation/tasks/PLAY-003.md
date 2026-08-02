# PLAY-003 — Data Safety・privacy・第三者SDKの整合監査

- 状態の正本は [`../task-list.md`](../task-list.md)

- 着手: 2026-07-26 / Codex
- 主担当: Codex。Claude Codeは公開画面と文言を反映する。
- 対象: PostHog、Push、位置情報、camera/microphone、upload、token、localStorage、log。
- 監査台帳: [`../data-safety-audit.md`](../data-safety-audit.md)（収集・利用・共有・保存・削除・保持根拠とcode evidenceを記録）。
- 初回監査(2026-07-26 / Codex): data flow台帳、Data Safety申告候補、retention、privacy差分、
  CC/User/Codexの公開前gateを記録。`_data_owner`残存、security rowの期限なし保持、D1 Time Travel plan未確認、
  公開legal URL未実装をblockerとした。
- 実装・文書対応(2026-07-26 / Codex): [`../data-safety-form-draft.md`](../data-safety-form-draft.md)、
  [`../privacy-retention-draft.md`](../privacy-retention-draft.md)、
  [`../d1-recovery-runbook.md`](../d1-recovery-runbook.md)を作成。PostHogを依存ごと無効化し、
  security rowを15分の判定窓後の日次cronでcleanupする実装とtestを追加。CCの`DS-01`修正は独立review済み。
- 実環境read-only確認(2026-07-26 / Codex): D1 Time Travel bookmark取得は成功（値は記録しない）。
  plan名とWorkers Logsの保存設定はCLIで取得できず、Dashboard用browserも未接続のためUser確認を残す。
  本番D1には0010/0011のtable/column/triggerがなく、未適用と確認した。remote writeは未実施。
- User判断(2026-08-01): CloudflareはFree plan、D1 Time Travelは7日。Workers Logsは有効化済み。
  account削除時は端末ID・端末名・天気用位置情報も自動削除する方針を採用したが、実装と公開文面は未対応。
- 残り: 公開URL/contact、privacyのD1 Time Travel文面をFree 7日へ確定、端末設定の自動削除実装、
  TWA microphone、`/pdf`削除可否の最終確認、
  Workers Logsの保持期間・閲覧担当・alert、provider共有例外、0010/0011適用承認、公開build networkを確定する。
- 完了条件:
  - data typeごとに収集・利用・共有・保存・削除を一覧化する。
  - Data Safety申告案、privacy policy、実装が一致する。
  - 公開HTTPS policy URLとin-app導線を確認する。
  - 保持例外に目的と期間を明記する。

## 将来の再照合が必要な変更（未実装）

- `docs/proposals.md`（2026-07-28）のアカウント登録拡張（復旧用メール・PIN復旧・アンケート）を採用すると、
  `data-safety-form-draft.md` の前提「アカウントに紐づく個人情報なし」が崩れ、
  `Personal info > Email address` がアカウント連結で追加される。PM未トリアージ。
