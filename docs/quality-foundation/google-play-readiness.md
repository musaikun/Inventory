# Google Play 公開準備チェックリスト

最終更新: 2026-07-25

公式資料を最終判断の正とします。

- [Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
- [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)
- [Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Store listing best practices](https://support.google.com/googleplay/android-developer/answer/13393723?hl=en)

## 1. Account creation / deletion

- [ ] account作成を提供するすべての導線を列挙
- [ ] account設定内に見つけやすい削除開始導線
- [ ] 削除直前に有効な認証を再確認
- [ ] 対象店舗名・店舗code・削除対象を明示
- [ ] 誤操作を防ぐ明示確認
- [ ] account無効化ではなく、関連dataを削除
- [ ] 削除完了後に全auth tokenを失効
- [ ] 端末のlocalStorage、cache、service worker上のaccount dataを消去
- [ ] appを再installしなくても使える公開Web削除申請resource
- [ ] Webページにapp名またはdeveloper名と具体的な削除申請手段を表示
- [ ] Play ConsoleのData deletion URLに公開Web resourceを登録
- [ ] 削除中・失敗・再試行・完了状態をユーザーへ表示

## 2. 削除対象data map

実装前にtable/binding単位で `削除 / 匿名化 / 保持` を決めます。

| Data group | 保存先候補 | 初期方針 | 確定・証拠 |
|---|---|---|---|
| account/store | D1 `stores` | 削除または復元不能な匿名化 | 未確定 |
| auth token / attempts | D1 | 削除 | 未確定 |
| sessions / inventory lines | D1 | 削除 | 未確定 |
| config / history | D1 | 削除 | 未確定 |
| orders / order lines | D1 | 削除 | 未確定 |
| movements / movement lines | D1 | 削除 | 未確定 |
| push subscriptions | D1 / Push service | unsubscribe後に削除 | 未確定 |
| active room state | Durable Objects | close・purge | 未確定 |
| device cache / token | localStorage / Cache API | 削除 | 未確定 |
| analytics / feedback | PostHog | identity・event取扱いを決定 | 未確定 |
| security records | D1/logs | 必要最小限のみ保持候補 | User判断・policy記載 |

法令・不正防止などの正当な保持理由がある場合、対象、目的、期間、問い合わせ先を
privacy policyに明記します。

## 3. Privacy / Data Safety

- [ ] privacy policyをapp内から閲覧可能
- [ ] Play Consoleに公開HTTPS URLを登録
- [ ] PDFではなく、公開・非geofence・閲覧者が編集できないページ
- [ ] app名またはdeveloper/entity名を表示
- [ ] privacy問い合わせ先を表示
- [ ] 収集、利用、共有、保存、削除をdata type別に説明
- [ ] PostHogを含む第三者SDKの収集・共有を確認
- [ ] Push endpoint、位置情報、camera、microphone、upload file、device情報を確認
- [ ] transport encryption、token取扱い、削除方針を実装と一致
- [ ] Data Safety form案をcode review後に双方で照合
- [ ] SDKや権限変更時にData Safetyを更新するownerを決定

## 4. TWA / App review

- [ ] signed TWA buildとDigital Asset Linksを確認
- [ ] app版で価格・外部決済導線が露出しないことを実機確認
- [ ] offline、戻る、外部link、file picker、camera、microphone、Pushの挙動を確認
- [ ] loginが必要な画面用に有効なreviewer credentialsまたはreview手順を準備
- [ ] account削除をreviewerが確認可能
- [ ] privacy/terms/support/deletion URLが審査環境から到達可能
- [ ] target API level、権限、package名、version code、署名を確認

## 5. Store listing / Screenshots

- [ ] UI freeze後の実際の提出buildから取得
- [ ] listing説明と表示機能が一致
- [ ] 対応device・orientationの要件をPlay Consoleで再確認
- [ ] 文字入り画像はsupport languageごとに作成
- [ ] ranking、award、期間限定価格など誤解を招く表現を使わない
- [ ] 実在店舗・個人・token・位置情報・棚卸dataを含めない
- [ ] app icon、feature graphic、short/full description、support連絡先を確認

## 公開判定

このchecklistの未完了項目に、owner、期限、審査への影響が記載されていない場合はrelease不可です。

