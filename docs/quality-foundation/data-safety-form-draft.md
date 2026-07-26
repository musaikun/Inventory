# Google Play Data Safety 回答案

最終更新: 2026-07-26
担当: Codex
状態: Play Console転記前のdraft（`DS-02`、`DS-05`〜`DS-10`の確認待ち）

## 1. このdraftの前提

- 対象はGoogle Playへ提出するタナオロの公開build。
- 第三者analyticsは使用しない。`posthog-js`は依存から除去し、analytics callは送信しない実装とした。
- 現行Appのfile importは端末内でparseし、原fileをserverへ送信しない。Appから未使用のWorker `/pdf`
  endpointはこの回答の対象外とするが、公開前に削除または別途申告を決める。
- camera映像・barcodeは端末内処理で、serverへ送信しない。
- microphoneはWeb Speech APIのTWA実機挙動を確認するまで最終回答しない。
- 本書は法的助言ではない。Play Consoleへ転記する前に公開build、provider契約、公開privacy URLと
  実機networkを再確認する。

Google Playでは、端末外への送信は一時処理でも原則「収集」に含まれる。端末内だけで処理するdataは
「収集」に含まれない。「共有」はservice provider、利用者が明示的に開始した処理等の例外に該当する場合が
あるため、providerの役割と契約を確認して確定する。

## 2. Play Consoleの全体質問

| 質問 | 回答案 | 確定条件 |
|---|---|---|
| アプリは対象data typeを収集または共有するか | **はい** | D1/DO/Pushへの送信、位置情報の外部送信がある |
| 収集dataは転送中に暗号化されるか | **はい（候補）** | 公開buildでHTTPS/WSSのみであることを最終確認 |
| 利用者はdata削除を依頼できるか | **はい** | in-app削除と匿名公開削除URLを公開し、URLをConsoleへ登録 |
| dataを第三者と共有するか | **いいえ（暫定）** | Cloudflareをservice providerとして扱える契約根拠と、天気providerへの送信が利用者開始の例外に該当することを確認。該当しなければ「はい」へ変更 |
| 独立したsecurity reviewを受けているか | **いいえ** | 認証済みの該当制度がないため |

## 3. data type別の回答候補

「任意」は利用者がその機能を使わなくてもアプリの主機能を利用できる場合を指す。

| Play data type | 収集 | 共有 | 一時処理 | 必須/任意 | 目的 | 対象data・根拠 |
|---|---:|---:|---:|---|---|---|
| Location > Precise location | はい | いいえ（暫定） | いいえ | 任意 | App functionality | 天気機能で利用者が明示操作した緯度・経度。Open-Meteo / BigDataCloudへ直接送信し、端末にも保持 |
| Personal info > Name | はい | いいえ（暫定） | いいえ | 任意 | App functionality | 端末名・nickname。自由入力なので氏名を入力でき、DO参加者表示・chat/auditへ含まれ得る |
| Personal info > User IDs | はい | いいえ（暫定） | いいえ | 必須 | App functionality, Account management | 店舗code。account、D1、同期roomの識別子 |
| App activity > Other actions | はい | いいえ（暫定） | いいえ | 主機能利用時 | App functionality, Security and compliance | 棚卸・注文・移動の操作記録、DO audit、失敗試行 |
| App info and performance > Diagnostics | 要確認 | いいえ（暫定） | 要確認 | 自動 | App functionality, Security and compliance | Cloudflare Workers Logsの実環境設定とpayloadを`OPS-001`で確認後に確定 |
| Device or other IDs | はい | いいえ（暫定） | いいえ | 一部任意 | App functionality, Fraud prevention/security, Developer communications | 端末ID、Push endpoint/key、IP address。Pushと同期は利用時のみ、rate-limitは自動 |
| Messages > Other in-app messages | はい | いいえ（暫定） | いいえ | 任意 | App functionality | 同期roomのchat自由記述。DOで最大200件、room参加者へ表示 |
| Files and docs | いいえ（現行App） | いいえ | — | — | — | 原PDF/Excel/CSVは端末内parse。正規化して保存した品目等はOther user-generated contentとして扱う |
| Audio files > Voice or sound recordings | **保留** | **保留** | **保留** | 任意 | App functionality | Web Speech APIの音声が端末外へ送られるかTWA実機・OS/browser条件で確認 |
| App activity > App interactions | いいえ（analytics） | いいえ | — | — | — | PostHogを削除・無効化。DO auditは上記Other actionsへ申告 |
| Financial info | いいえ | いいえ | — | — | — | Stripe/決済は現行実装に存在しない |

### Other user-generated content の扱い

Play Consoleの選択肢に合う場合、棚卸品目名、数量、価格、発注、移動、設定、chatを
`Other user-generated content` として「収集あり」に含める。accountを作成してcloud同期を使う場合の業務dataは
主機能に必要、chat・file import・位置情報・Push・音声・端末名は任意と回答する。

## 4. 収集目的の対応

| data | 目的候補 |
|---|---|
| 店舗code、業務data、端末名/ID、chat、操作audit | App functionality |
| auth token、PIN hash、IP/失敗時刻 | Account management / Fraud prevention, security and compliance |
| Push endpoint/key | App functionality / Developer communications |
| precise location | App functionality |
| anonymous削除receipt | Account management / Security and compliance |

広告、marketing、personalization、analytics目的は現行公開buildでは選択しない。

## 5. 転記前gate

- [ ] `DS-02`: 端末ID・端末名・位置情報をaccount削除後も端末設定として保持する方針と消去方法を確定
- [ ] `DS-05`: 本番D1 planとTime Travel期間、Workers Logs設定をdashboardで確認
- [ ] `DS-06`: TWA実機でmicrophone処理とnetworkを確認
- [ ] `DS-07`: dormant `/pdf` endpointの存廃を確定
- [ ] `DS-08`: privacy / terms / supportのHTTPS URLと統一contactを公開
- [ ] Cloudflare、Open-Meteo、BigDataCloud、Push serviceのprovider/共有例外を契約・policyで確認
- [ ] 公開buildのnetworkでPostHog requestがなく、HTTPS/WSS以外のdata送信がないことを確認
- [ ] UserとCodexがPlay Consoleの最終回答を独立照合し、exportまたはscreenshotを保存

## 6. 公式根拠

- [Google Play Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)
- [Google Play account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
- [PostHog JavaScript configuration](https://posthog.com/docs/libraries/js/config)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
