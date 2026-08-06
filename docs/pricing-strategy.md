# 料金・提供順（W1採用仕様 / A1将来フロー）

2026-07-28 D-016、2026-08-04 D-021 / User決定。

## 現在の公開状態（W1）

- まずWeb/PWAのFree版を公開する。
- 現行releaseでは14日trial、Stripe、Pro販売、自動有料化、自動課金を行わない。
- 無料でも登録時に1店舗の店舗コードと4桁PINを発行し、別端末ログインとルーム同期を利用できる。
- 公開文面は現在提供中のFree機能だけを現在形で説明する。

## 確定した将来フロー（A1）

1. 利用者がGoogle PlayからAndroid appをinstallする。
2. app内で新規account登録すると14日間のPro無料体験を開始する。
3. trial終了後は自動でFreeへ戻す。card登録や自動課金は行わない。
4. 利用者がWebで明示的にStripe契約するとserver entitlementをProへ更新する。
5. 同じaccountでAndroid appへloginするとPro権利を自動反映する。

trial終了時のAndroid app文言は[D-021](quality-foundation/decisions.md#d-021--web先行とplay向け将来フローの分離)
を正とする。

- plan/trialの正はbackendとし、localStorageやURL queryでPro化しない。
- Google Play版はconsumption-onlyとする。
- Play内にStripe Checkout、外部購入link、購入CTAを置かない。
- Stripe提供前にWeb購入面とPlay配布artifact/originの分離方法を確定する。
- アプリ名は無料版/Pro版に分けず「タナオロ」とする。

Webから登録したaccountへのtrial適用と、Stripe/backendの単独公開順は未決です。
D-016との置換関係は
[D-021](quality-foundation/decisions.md#d-021--web先行とplay向け将来フローの分離)を正とする。

## 無料枠

| 項目 | Free | 将来のPro |
|---|---:|---:|
| 店舗 | 1店舗（店舗コード1つ） | 初回は1店舗 |
| 同時接続端末 | 2台 | 上限緩和 |
| 登録品目 | 150件 | 上限緩和 |
| 棚卸履歴の閲覧 | 直近3回 | 全期間 |
| 棚卸・ルーム・手入力・音声入力 | 利用可 | 利用可 |
| 現行のCSV/PDF取込・書出し | 利用可 | 利用可 |

現行の予定価格は月額2,980円。最終価格、具体的な最大値、fair-use上限は、
Stripe提供開始前に負荷試験と利用状況を見て確定する。

## この形を採用する理由

- 無料利用者も2台同期まで体験でき、タナオロの中核価値を理解できる。
- 課金境界を基本機能の有無ではなく、端末数・品目数・履歴という運用規模に置ける。
- W1で課金・配布面の複雑さを切り離し、Web品質と運用を先に検証できる。
- Android trialは自動課金へ接続しないため、無料体験と有料契約の意思を分離できる。
- A1は同じaccountの権利を利用するだけにし、Play内の購入面を持たない。

## 実装状況（2026-07-28）

- `planLimits.js` を2台・150品目・履歴3回へ更新し、本番で全員PRO扱いにしていた一時解除を撤去した。
- `tanaoro_is_pro` のlocalStorage自己申告ではPROにならない。初回公開のクライアントは全店舗を無料枠として扱う。
- Workerの14日トライアル算出を撤去した。API互換のため `inTrial:false` と `trialEndsAt:null` は残す。
- `stores.plan`（`free` / `pro`）は将来のサーバー判定用に維持する。
- アプリ内の旧1,980円、3か月無料、外部決済導線を撤去し、公開規約・サポート・landingを新仕様へ同期した。

## A1開始前に必要な実装

1. Android app内登録を起点とするtrial開始・終了をserver時刻で管理し、`trialEndsAt`後にFreeへ戻す。
2. trial起算、既存accountへの付与、再登録防止を決定する。
3. Stripe Checkoutは認証済みWeb accountから開始し、Webhookを冪等処理してserver entitlementを更新する。
4. Appは認証APIのserver判定を使い、localStorageを権限の正にしない。
5. 端末・品目・履歴の上限をWorker/Durable Object側でも強制し、直接APIによる迂回を防ぐ。
6. 解約、支払失敗、猶予、返金、account削除時の契約停止を実装する。
7. `0009_store_plan.sql`で既存店舗へ設定された`pro`値を、本番運用開始前に意図したプランへ整理する。
8. 特商法表示、利用規約、privacyと、A1のconsumption-only配布面をrelease前に再監査する。

## 未決事項

- Webから登録したaccountにもtrialを付与するか
- Stripe/backendをPlay前に単独releaseするか、Playと同時にreleaseするか
- Android trialの起算時点、既存accountへの付与、同一利用者の再trial防止
- 予定月額2,980円の最終確定とPro上限
- 支払失敗時のgrace期間、解約・返金のeffective date
- Web購入面とPlay artifact/originの分離方式
