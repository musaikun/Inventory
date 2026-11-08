# 2026-11-08 — アプリ名を「pantops」に（D-034）

- version: 0.195.9 → **0.196.0**

User: アプリの名前を pantops にする。関連部分を変更
- 表示名「タナオロ」→「pantops」: app（appInfo の APP_NAME・画面の見出し・案内文・PWA manifest name/short_name・index.html の title/og・push-sw の既定の題）、worker（通知の題・参加申請のやることの作成者名）、app/public と landing の利用規約・プライバシー・サポート・LP、テスト
- `app/public/og-image.png` の名前の部分を描き直し
- 現行docs（legal・Play関連・project-status・pricing）も更新。decisions に D-034（D-016 の名前の項を置き換え）
- 変えていない: 端末保存キー `tanaoro_*`（変えると設定が消える）、通知の送り元 `support@tanaoro.com`、archive・export・古いモック・過去の提案
- 検証: app vitest 2224 pass、worker vitest 761 pass、build OK
- 残件: 連絡先メール・ドメイン、ストア掲載名（Google Play 提出時）。本番に出すには Pages のデプロイと Worker の反映（通知の題）が要る
