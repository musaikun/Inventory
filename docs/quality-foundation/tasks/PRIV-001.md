# PRIV-001 — PostHog の収集内容と同意・規約を照合

- 状態の正本は [`../task-list.md`](../task-list.md)

- 着手: 2026-07-26 / Codex（PLAY-003の第三者SDK監査と同じ証拠台帳で実施）。
- 根拠: autocapture 設定と、自由記述 feedback を分析基盤へ送るコードがある。
- 初回監査: 現行tracked build設定では`VITE_POSTHOG_KEY`未注入でno-op。ただしkey設定時は
  `autocapture` default=true、default opt-in、自由記述feedback送信となる。品質凍結期間は無効固定を推奨し、
  有効化する場合は明示off/allowlist、同意・撤回、保持期間、policy/Data Safetyの同時整備をgateとする。
- 対応(2026-07-26 / Codex): `posthog-js`依存、key例、CSP接続先を除去し、analytics moduleを
  build環境に関係なく常時no-op化。旧PostHog storageだけをcleanupするtestを追加。
- User方針(2026-07-28): PostHogをprivacy-first構成で再導入する。EU Cloud、custom event allowlist、
  default opt-out＋明示同意/撤回、IP保存off、autocapture/pageview/pageleave/session replay/error/log off、
  自由記述・店舗code/PIN/token/品目/数量/価格/位置/端末名/URLを送らない。設定完了まではno-opを維持する。
- User準備: PostHog Cloud EUでprojectを作成し、Project > GeneralのIP data captureをdiscardにする。
  project tokenとEU hostはclient設定用として受領する。個人API keyはchat/repositoryへ貼らず、削除連携時にWorker secret化する。
- Checklist: [`../posthog-setup-checklist.md`](../posthog-setup-checklist.md)
- 保持期間確定(2026-07-28 / User): PostHog Freeの範囲で、上記の疑似・最小eventを1年保持する。
  有効化と同時にprivacy policyとData Safetyへ記載する。
- 再導入準備(2026-08-04 / `dd68a50`):
  - SDK、明示同意UI、event/property allowlist、analytics専用ID、account削除時cleanupを実装した。
  - `VITE_POSTHOG_ENABLED=true`、public project token、EU hostの3条件が完全一致しないbuildでは無効。
  - 自動capture/replay/error/log等をoffにし、slim no-external bundleを遅延loadする。
- W1の残り: release buildで分析用変数を有効にせず、PostHogへのnetwork送信がないことを確認する。
- 有効化releaseへ保留: privacy/Data Safety改定、opt-out/opt-in/撤回network確認、
  PostHog dashboardの受信property、server側削除連携を照合する。
- 完了条件: 収集最小化、同意、保存期間、privacy policy との一致を確認し、必要なら設定を変更する。

## 注意

- 現在の公開legal文面は「PostHogを現在利用していません」と明記している（`DS-09`）。
  再導入する場合は、**有効化と同じリリースで** privacy policy・Data Safety・
  `legalPages.test.js` の再発防止アサーションを更新する必要がある。
