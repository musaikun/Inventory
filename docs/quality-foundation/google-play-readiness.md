# Google Play 公開準備チェックリスト

最終更新: 2026-08-02

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
| account/store | D1 `stores` | 匿名tombstoneを7日後に削除 | `PLAY-001` code/test完了。本番D1は0011未適用のため公開前migration gate |
| auth token / login attempts | D1 | 削除 | `PLAY-001` 完了 / test |
| sessions / inventory lines | D1 | 削除 | `PLAY-001` 完了 / test |
| config / history | D1 | 削除 | `PLAY-001` 完了 / test |
| orders / order lines | D1 | 削除 | `PLAY-001` 完了 / test |
| movements / movement lines | D1 | 削除 | code/test完了。本番D1は0010未適用のため公開前migration gate |
| push subscriptions | D1 / Push service | D1削除で送信停止、client購読解除 | `PLAY-001`削除 + `SEC-003`認証/検証 完了 / clientは`PLAY-002` |
| active room state | Durable Objects | stock/orderをclose・purge | `PLAY-001` 完了 / test |
| device cache / token | localStorage / Cache API | 削除 | Claude Code |
| analytics / feedback | 現行公開buildでは保存・送信なし | PostHog依存除去、analytics no-op、legacy identity cleanup | `PLAY-003` / `PRIV-001` code・unit test済み |
| deletion receipt | D1 | account識別子なしで7日保持 | `PLAY-001` 完了 / cron cleanup test |
| D1 Time Travel | Cloudflare管理backup | provider回復期間満了、通常復元禁止、restore時は削除再適用 | `d1-recovery-runbook.md`作成 / plan・運用準備待ち |
| security records | D1/logs | D1失敗rowは15分判定窓＋日次cleanup。platform logはdashboard確認 | code・cron test済み / `OPS-001` |

法令・不正防止などの正当な保持理由がある場合、対象、目的、期間、問い合わせ先を
privacy policyに明記します。

## 3. Privacy / Data Safety

実装監査台帳: [`data-safety-audit.md`](data-safety-audit.md)

- Play Console回答案: [`data-safety-form-draft.md`](data-safety-form-draft.md)
- 保持文面案: [`privacy-retention-draft.md`](privacy-retention-draft.md)
- D1復元手順: [`d1-recovery-runbook.md`](d1-recovery-runbook.md)

- 初回code audit済み（2026-07-26 / Codex）。申告候補は作成したが、以下は未解消のためcheckしない。
- ~~account削除後に`_data_owner`が残る。~~ → CC修正、Codex独立review済み（2026-07-26・`DS-01`）。
- ~~PostHogはkey設定時にautocaptureが有効化され得る。~~ → 依存除去・常時no-op化、公開build network確認待ち。
- ~~D1 security rowに期限切れ全体cleanupがない。~~ → 15分判定窓＋日次cleanup実装・test済み。
- D1 Time TravelはFree / 7日、Workers Logsは有効化済み（D-020）。Logs保持期間・閲覧担当・payloadは未確定。
  端末ID・端末名・天気位置情報はaccount削除時の自動削除を採用済み（D-019）だが、App実装と公開文面は未対応。
- 本番D1は0010/0011未適用。修正済み`migrate.sh`による適用はUser明示承認後に行う。
- privacy/terms/supportの静的pageとapp導線はCC実装済み。canonical HTTPS URLとcontactはUser確定待ち。

- [x] privacy policyをapp内から閲覧可能（ランディング画面下部と「各種設定」→「法的情報・サポート」）
- [ ] Play Consoleに公開HTTPS URLを登録（canonical host確定後・`DS-08`）
- [x] PDFではなく、公開・非geofence・閲覧者が編集できないページ（静的HTML。未ログインでHTTP 200を確認）
- [x] app名またはdeveloper/entity名を表示（`タナオロ` / musaikun）
- [x] privacy問い合わせ先を表示（統一contactの最終確定は`DS-08`）
- [x] 収集、利用、共有、保存、削除をdata type別に説明
- [x] PostHogを含む第三者SDKの収集・共有を確認（依存ごと除去し、legal文面からも削除）
- [ ] Push endpoint、位置情報、camera、microphone、upload file、device情報を確認
- [ ] transport encryption、token取扱い、削除方針を実装と一致
- [x] Data Safety form案をcode reviewに基づいて作成
- [ ] Data Safety form最終案をUser/Codex双方で照合
- [ ] SDKや権限変更時にData Safetyを更新するownerを決定

## 4. TWA / App review

reviewer向け手順書: [`play-reviewer-guide.md`](play-reviewer-guide.md)（Play Consoleへ貼る本文と社内実機チェック）

- 2026-07-26: TWAでの価格・決済導線の非露出をcode確認済み（実機確認は未）。アプリ名は`タナオロ`へ統一済み。
  test店舗のcredentialsと公開URLがUser未確定のため、下記はcheckしない。

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
