# Privacy policy 保持・削除文面案

最終更新: 2026-07-26
担当: Codex
状態: `PLAY-003`監査draft。CCが公開legal文面へ反映する前にUser判断と実環境確認が必要

## 1. 反映方針

この文面案は`docs/legal/privacy-policy.md`の「保存期間」「削除」「localStorage」
「業務委託先」へ反映するための実装準拠素材である。現行policyの「操作ログ1年」「アクセスログ90日」
「Stripeを利用中」は現行実装と一致しないため、そのまま公開しない。

## 2. 保存期間の文面候補

> 当サービスは、サービス提供、不正利用防止、アカウント削除処理に必要な期間に限って情報を保持します。
> 主な保存期間は次のとおりです。

| data | 文面候補 |
|---|---|
| 店舗code、棚卸・品目・価格・注文・移動・設定・履歴 | アカウント削除までCloudflare D1に保存します。削除処理では関連する業務dataを削除し、店舗recordを匿名化します |
| 認証token | 発行から30日以内、またはlogout、再login、account削除のいずれか早い時点まで保持します |
| 同期roomのchat・操作履歴 | Durable Objects内で各最大200件を保持し、room解散、account削除、または最終activityから24時間後に削除します |
| Push購読情報 | 利用者が購読を解除する、accountを削除する、またはPush serviceがendpoint無効を返すまで保持します。通知payloadのTTLは24時間です |
| login/IP失敗record | 不正利用防止の15分間の判定窓に使用します。期限切れrecordは毎日1回のcleanupで削除するため、実際の保持は最長約24時間15分です |
| account削除tombstone・receipt | 削除処理の再試行と冪等性のため7日間保持します。receiptはaccount識別子を含みません |
| 端末内の業務data・店舗所有者marker・認証情報 | account削除の成功後に削除します |
| 端末ID・端末名・天気の位置情報/cache | accountとは独立した端末設定として、browser storageを消去するまで端末内に残ります。保持方針のUser確定と、利用者向け消去手順の追加が公開前gateです |

## 3. provider側の回復・log保持

> Cloudflare D1のTime Travelは障害復旧のため常時有効です。復元可能期間は契約planにより
> Free planで過去7日、Paid planで過去30日です。この履歴は通常利用には使わず、障害復旧に限って
> accessを制限します。復旧により削除済みdataが戻る可能性がある場合は、運用手順に従って削除を再適用します。

本番planを確認するまではprivacy policyへ「7日」と断定せず、
「契約planに応じて最大30日」または確認済みの期間を記載する。

> Cloudflare Workers Logsを有効にしている場合、request/exception等の運用logはCloudflareの仕様に従い、
> Free planで3日、Paid planで7日保持されます。

現行`wrangler.toml`には`observability`の明示設定がない。dashboardで有効/無効、plan、log内容を確認するまで
上記文面を公開版へ確定しない。独自に90日保持する実装根拠はない。

## 4. 外部serviceの文面候補

現行公開buildで利用するserviceとして、Cloudflare Pages / Workers / D1 / Durable Objects、
browser/OSのPush service、Open-Meteo、BigDataCloudを記載する。位置情報は利用者が天気機能を
明示操作した場合だけ端末からOpen-MeteoとBigDataCloudへ送信されることを示す。

PostHogは依存と送信処理を削除したため、現行公開buildの委託先・analyticsとして記載しない。
Stripe/決済は未実装のため「現在利用するservice」から外す。将来導入時は実装、policy、Data Safetyを
同じreleaseで更新する。

Web Speech APIはTWA実機で外部音声処理の有無を確定後、必要ならbrowser/OS providerと音声処理を追記する。

## 5. account削除文面候補

> 利用者はアプリ内の設定画面、またはlogin不要のaccount削除web pageから削除できます。
> 本人確認後、店舗の業務data、認証token、Push購読、同期roomを削除します。
> 削除処理の安全な再試行のため、accountを特定しないreceiptと匿名tombstoneを7日間保持した後に削除します。
> 端末ID、端末名、天気機能の位置情報/cacheはaccountとは独立した端末設定です。これらも消去する場合は
> browserのsite dataを削除してください。

最後の端末設定文は`DS-02`で保持方針と実際のUI/手順が確定した場合だけ使用する。
削除時に端末設定も消す方針へ変更する場合は、文面ではなく実装とtestを先に合わせる。

## 6. 自由入力への注意

端末名、品目名、chat等には氏名その他の個人情報を入力できるため、
「氏名等を収集しない」と断定しない。次の注意書きを導線へ置く候補とする。

> 端末名、品目名、chatには、業務に不要な氏名、連絡先、健康情報その他の個人情報を入力しないでください。

## 7. 公開前に決める項目

- 公式support contactをVAPID、privacy、terms、Play listingで統一
- 端末ID・端末名・位置情報/cacheのaccount削除後の扱い
- 本番Cloudflare plan、Workers Logsの有効/無効と保持期間
- dormant `/pdf` endpointの存廃
- TWA/Web Speechの実機処理
- providerを「共有なし」の例外として扱う契約根拠

## 8. 公式根拠

- [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Google Play Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
