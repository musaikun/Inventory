# PostHog privacy-first セットアップ

更新日: 2026-07-28  
対象: `PRIV-001`

## 現在の状態

公開buildのPostHogは依存を外して常時no-opにしている。以下のUser設定、
実装・policy・Data Safety・network確認が揃うまでは有効化しない。

Userは2026-07-28に**PostHog Freeの範囲で、最小eventを1年保持**する方針を承認した。

## Userが行う設定

1. [PostHog Cloud](https://posthog.com/)でアカウントを作り、**EU Cloud（Frankfurt）**を選んで
   production用projectを1つ作成する。無料プランでよく、カード登録は不要。
2. `Settings > Organization > General`で、新規projectのIP data capture defaultが無効であることを確認する。
3. `Settings > Project > General`で、IP data captureを**Discard client IP data**にする。
4. `Settings > Project > Autocapture & heatmaps`でautocaptureとheatmapsを無効にする。
5. session replay、error tracking、browser logs、surveysを有効にしない。SDK側でも明示的にoffへ固定する。
6. project token、project ID、EU ingestion hostを控える。通常のclient実装に必要なのはproject tokenとhost。

## UserからCodexへ渡すもの

- project token（client用。公開buildに含まれる種類のtoken）
- project ID
- ingestion host（EUは通常 `https://eu.i.posthog.com`）

Personal API keyは秘密情報なので、chat、Git、`.env`へ貼らない。account削除とPostHog削除APIを
接続する段階で、必要最小権限のkeyをCloudflare Worker secretとして設定する。

## Codexが実装する設定

- `autocapture:false`
- `capture_pageview:false`
- `capture_pageleave:false`
- `capture_dead_clicks:false`
- `capture_exceptions:false`
- `capture_heatmaps:false`
- `capture_performance:false`
- `disable_session_recording:true`
- `disable_surveys:true`
- `opt_out_capturing_by_default:true`
- 明示同意時の`opt_in_capturing()`、撤回時の`opt_out_capturing()`とidentity reset
- allowlistにあるcustom event以外を`before_send`で破棄
- analytics専用の疑似IDを使用し、店舗code・端末IDをdistinct IDにしない

## 送信しないdata

- 店舗code、PIN、Bearer/host token、削除requestId
- 店舗名、端末名、品目名、価格、数量、棚卸・発注・入出庫の内容
- chat、feedback等の自由記述
- 緯度経度、天気検索地点、共有URL、query string
- camera、microphone、PDF/CSV/Excelの内容
- console log、例外本文、session replay、DOM text

## 初期event allowlist案

- `session_started`: propertyなし
- `session_completed`: `item_count_bucket`、`mode`のみ
- `item_added`: `method`のみ（`walk` / `manual`）
- `voice_used`: propertyなし
- `review_prompt_shown`: `completed_count_bucket`のみ
- `review_rated`: `stars`、`positive`のみ

feedback本文はPostHogへ送らない。event/propertyは実装時に定数allowlistとunit testで固定する。

## 保持期間

PostHogの現行Freeプランは1 project・**1年のdata retention**。User判断により、収集を上記の
疑似・最小eventに限定して1年保持し、有効化と同時にprivacy policyとData Safetyへ記載する。

## 公式資料

- [JavaScript web configuration](https://posthog.com/docs/libraries/js/config)
- [Controlling data collection](https://posthog.com/docs/privacy/data-collection)
- [Controlling data storage](https://posthog.com/docs/privacy/data-storage)
- [PostHog pricing](https://posthog.com/pricing)
