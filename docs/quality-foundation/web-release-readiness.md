# Web Free版 公開準備チェックリスト

最終更新: 2026-08-08
状態: **現在のrelease gateの正本**
初回監査基準: `develop@bc9fb85`

## 公開scope

今回公開するのはWeb/PWAのFree版です。**中心は棚卸業務の効率化**で、第一導線は
「品目を準備 → 棚卸開始 → 入力 → 完了 → 履歴」です。

- account登録、店舗コード+PIN login、棚卸、同期、履歴、取込・書出しを提供する。
- **入出庫・発注確認は中核機能ではなくβ機能**として提供する。理論在庫は記録状況によって誤差が出る旨を
  画面に明示し、発注確認は仕入先へ自動送信しない。出庫は初回公開の主導線から外す。
- **新機能は追加しない。** 今回は既存機能の整理と安定化に限定する（画面構成の再編は整理として扱う）。
- 現行Free上限を公開文面と実装で一致させる。
- 14日無料体験、Stripe、Pro販売、自動課金は提供しない。
- PostHogはrelease buildで無効とし、送信がないことを確認する。
- TWA、Google Play Console、store listing、Play Data Safetyは今回の判定対象外。

後続の提供順は [D-021](decisions.md#d-021--web先行とplay向け将来フローの分離) を参照します。

## 現在のblocker

| ID | Gate | 現状 / 完了条件 | Owner |
|---|---|---|---|
| WEB-01 | canonical URL・contact | 実際に200で配信するhostと正式問い合わせ先を決定し、legal・削除URL・supportを同期 | User |
| WEB-02 | production origin / CORS | remote Workerは2026-08-04確認時に任意Originを反射する旧状態。実hostを`ALLOWED_ORIGIN`とtestへ反映し、deploy後に許可/拒否を実probe | Codex / User |
| WEB-03 | Pages production / routing | `inventory-app-c40.pages.dev`のproductionは旧build。develop previewのlegal 3 routeは308 loop。routingを修正し、production branch、Wrangler版、commit SHA、resource名を固定 | Codex |
| WEB-04 | D1 migration | 本番で未適用の0010/0011をpreflightし、User承認後に適用。schema確認後にWorkerを更新 | Codex / User |
| WEB-05 | 登録濫用 | `/auth/register`をrate limit/bot対策し、legacy `/store/create`を廃止または保護。**`WEB-07`のDATA-002 Phase 1完了後に着手**（同じstoreルート群で競合） | Codex |
| WEB-06 | Free上限 | 規約の「2台」とserver挙動を一致させる。既存Pro Review・再接続・既存3台以上の扱いも決定 | User / Codex |
| WEB-07 | 履歴・data integrity | DATA-002 Phase 1/2と、棚卸完了時の独立writeによる欠落（DATA-001）を解消し、別端末から詳細を取得可能にする。Phase 3はscope外 | Claude Code / Codex |
| WEB-08 | observability | log masking、閲覧担当、最低限のalert/通知先、障害確認手順を確定 | User / Codex |
| WEB-09 | critical E2E | 登録→棚卸→同期/再接続→別browser履歴→削除を本番相当環境で安定実行 | Codex |
| WEB-10 | production smoke / rollback | 公開URLで主要route・API・CORS・PWA・legal・削除を確認し、直前版へ戻す手順を検証 | User / Codex |

`https://inventory-app.pages.dev/` は2026-08-04のread-only確認で正常な公開先として利用できませんでした。
実projectのproductionは旧build、現行buildの稼働確認先はdevelop previewです。
URLを推測で本番正本にしません。

## 実装済み・再確認対象

- [x] CORSの現行repository実装はfail-closedで、許可/拒否の回帰testがある
- [x] sourceにはCSP、静的privacy/terms/support、rewrite、PWA denylistがある
- [ ] Cloudflare Pages上で`/privacy`、`/terms`、`/support`がredirect loopせず、最終200本文とCSPを返す
- [x] account削除のWorker/D1/DO/client処理とBack/a11y回帰testがある
- [x] `migrate.sh`は0001〜0011を列挙し、列挙testがある
- [x] production dependency auditは直近記録で0件。spreadsheet parserに隔離・上限・timeout testがある
- [x] develop CIはNode 24でWorker/App test、App build、preview deployに成功
- [ ] release candidateのclean checkoutでWorker test、App test、App production buildを再実行
- [ ] release artifactでPostHog・Stripeへの通信がないことをnetwork確認
- [ ] account削除を375px相当とkeyboardで実機確認

上の`[x]`はコードまたはpreviewまでの準備を示し、本番公開済みを意味しません。

## 公開手順

すべてUserの明示承認下で実行し、各段階の証拠をこの文書または [WEB-001](tasks/WEB-001.md) に残します。

1. release対象commit、resource名、canonical/contact、環境変数を固定する。
2. clean checkoutでWorker/App test、App build、production dependency auditを実行する。
3. 本番D1をread-only preflightし、backup/recovery条件を確認する。
4. 0010、0011を順番に適用し、table/column/triggerをread-only確認する。
5. Workerをdeployし、health、認証、許可Origin、拒否Originをprobeする。
6. Pagesを明示したproduction branchへdeployする。
7. 公開URLで新規登録、login、棚卸、同期、履歴、legal、削除、PWAをsmokeする。
8. observabilityで当該requestを確認し、Userがrelease candidateを承認する。

途中で失敗した場合は次段階へ進みません。migrationは不可逆変更として扱い、
frontend/Workerのrollbackとdata recoveryを分けて記録します。

## 公開判定

- [ ] `WEB-01`〜`WEB-10`がすべて完了
- [ ] task board上のWeb P0が0件
- [ ] 未完のWeb P1にrelease影響、owner、期限、回避策がある
- [ ] test/build/auditの対象commitとcommandが記録済み
- [ ] production URLでUserが主要導線を確認
- [ ] Userがdeployと公開継続を明示承認

## 今回の対象外

- DATA-002 **Phase 3**（`store_history`のsession単位キー化、データ源一本化、`LIMIT 50`見直し、削除のサーバー側完結）。
  migrationを伴い、`WEB-04`完了とPM判断が前提
- 過去棚卸取込の再設計（`importBatchId`、日付衝突の選択、一括取消）。**Phase 3完了後**
- 推奨発注・分析・スケジュールの新規拡張
- 14日Pro無料体験、trial entitlement
- Stripe Checkout / Customer Portal / webhook
- Pro契約の解約、支払失敗、猶予、返金
- TWA、Digital Asset Links、署名、target API
- Play Console、Data Safety提出、reviewer credentials、store画像
- PostHogの本番有効化

対象外機能を先にlegal文面で「提供中」としません。

## Cloudflare公式資料

- [Pagesの静的HTML配信とextensionless redirect](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Wrangler Pages設定と`--branch`の推論](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)

本repositoryはD1の標準migration履歴tableではなくschema sentinel方式を使うため、
公式の一般手順をそのまま実行せず、`scripts/migrate.sh`と実schemaを照合します。
