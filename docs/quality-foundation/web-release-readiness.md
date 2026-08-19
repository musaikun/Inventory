# Web Free版 公開準備チェックリスト

最終更新: 2026-08-19
状態: **現在のrelease gateの正本**
初回監査基準: `develop@bc9fb85`
最新照合: 2026-08-19 / `develop@e8f5e16`（DATA-001 / DATA-002 / IMPORT-001の実装レビュー完了。migration 0016 まで・すべて本番未適用）

## 公開scope

今回公開するのは、棚卸効率化を中心とするWeb/PWAのFree版です。

- account登録、店舗コード+PIN login、品目準備、棚卸、同期、履歴詳細、CSV書出し、account削除を提供する。
- 主経路は「品目を準備→棚卸を開始→中断/再開→完了→別端末で履歴確認→書出し」とする。
- 入出庫・発注確認は正式な在庫管理・発注送信として約束しない。搭載する場合はβ表示し、主要導線から分離する。
- 現行Free上限を公開文面と実装で一致させる。
- 14日無料体験、Stripe、Pro販売、自動課金は提供しない。
- PostHogはrelease buildで無効とし、送信がないことを確認する。
- TWA、Google Play Console、store listing、Play Data Safetyは今回の判定対象外。

後続の提供順は [D-021](decisions.md#d-021--web先行とplay向け将来フローの分離) を参照します。

## Release candidate product contract

以下はURL・deploy条件とは独立した製品受入条件です。Claude Codeが実装し、Codexが差分と証拠を
独立reviewします。

- [ ] 品目取込は取込前に追加・更新・除外・errorを確認でき、通常操作で既存品目を黙って削除しない
- [ ] 全置換・上限超過・不正行・同日履歴衝突は、処理前に影響と選択肢を表示する
- [ ] 棚卸完了はsession・明細・snapshotの部分成功を残さず、再試行しても重複しない
- [ ] 同一店舗の別browser/端末から履歴一覧と明細を取得でき、同日複数回を上書きしない
- [ ] 過去棚卸取込はpreview、server保存確認、batch単位の取消、calendar/detail整合を持つ
- [ ] 入出庫は任意β、出庫は主要導線外、発注確認は「確認・記録（β）」で送信しないことが分かる
- [ ] β機能を利用しなくても、棚卸の主経路とaccount削除が完結する

## 現在のblocker

| ID | Gate | 現状 / 完了条件 | Owner |
|---|---|---|---|
| WEB-01 | canonical URL・contact | 実際に200で配信するhostと正式問い合わせ先を決定し、legal・削除URL・supportを同期 | User |
| WEB-02 | production origin / CORS | remote Workerは2026-08-04確認時に任意Originを反射する旧状態。実hostを`ALLOWED_ORIGIN`とtestへ反映し、deploy後に許可/拒否を実probe | Codex / User |
| WEB-03 | Pages production / routing | `inventory-app-c40.pages.dev`のproductionは旧build。develop previewのlegal 3 routeは308 loop。routingを修正し、production branch、Wrangler版、commit SHA、resource名を固定 | Codex |
| WEB-04 | D1 migration | 本番で未適用の0010〜0016をpreflightし、User承認後に**この順で**適用。schema確認後にWorkerを更新。**0012は`DROP TABLE`を含む不可逆点**、0013/0014は列・index追加のみ、0015/0016は新規table追加のみでいずれもロールバック可。**migration適用からWorker deployまでの間は過去棚卸取込と棚卸完了を行わせない**（下記「切替境界」） | Codex / User |
| WEB-05 | 登録濫用 | `/auth/register`をrate limit/bot対策し、legacy `/store/create`を廃止または保護 | Codex |
| WEB-06 | Free上限 | 規約の「2台」とserver挙動を一致させる。既存Pro Review・再接続・既存3台以上の扱いも決定 | User / Codex |
| WEB-07 | 取込・履歴・data integrity | DATA-001/002・IMPORT-001の実装とCodex独立reviewは完了。release candidateで実D1・別browser・取込主経路を確認して通過判定する | Codex |
| WEB-08 | observability | log masking、閲覧担当、最低限のalert/通知先、障害確認手順を確定 | User / Codex |
| WEB-09 | critical E2E | 登録→品目取込→棚卸→同期/再接続→完了→別browser履歴詳細→CSV→削除を本番相当環境で安定実行 | Codex |
| WEB-10 | production smoke / rollback | 公開URLで主経路・β境界・API・CORS・PWA・legal・削除を確認し、直前版へ戻す手順を検証 | User / Codex |

`https://inventory-app.pages.dev/` は2026-08-04のread-only確認で正常な公開先として利用できませんでした。
実projectのproductionは旧build、現行buildの稼働確認先はdevelop previewです。
URLを推測で本番正本にしません。

## 実装済み・再確認対象

- [x] CORSの現行repository実装はfail-closedで、許可/拒否の回帰testがある
- [x] sourceにはCSP、静的privacy/terms/support、rewrite、PWA denylistがある
- [ ] Cloudflare Pages上で`/privacy`、`/terms`、`/support`がredirect loopせず、最終200本文とCSPを返す
- [x] account削除のWorker/D1/DO/client処理とBack/a11y回帰testがある
- [x] `migrate.sh`は0001〜0016を列挙し、列挙testがある（0012〜0016は**本番未適用**）
- [x] production dependency auditは直近記録で0件。spreadsheet parserに隔離・上限・timeout testがある
- [x] develop CIはNode 24でWorker/App test、App build、preview deployに成功
- [ ] 品目取込のpreview・非破壊default・明示的な全置換・error明細をrelease candidateで確認
- [ ] 棚卸完了後、同一店舗の別browserで一覧と明細が一致することを確認
- [ ] 入出庫・発注確認のβ表示、主要導線からの分離、発注非送信の文言を確認
- [ ] release candidateのclean checkoutでWorker test、App test、App production buildを再実行
- [ ] release artifactでPostHog・Stripeへの通信がないことをnetwork確認
- [ ] account削除を375px相当とkeyboardで実機確認

上の`[x]`はコードまたはpreviewまでの準備を示し、本番公開済みを意味しません。

## 公開手順

すべてUserの明示承認下で実行し、各段階の証拠をこの文書または [WEB-001](tasks/WEB-001.md) に残します。

1. release対象commit、resource名、canonical/contact、環境変数を固定する。
2. clean checkoutでWorker/App test、App build、production dependency auditを実行する。
3. 本番D1をread-only preflightし、backup/recovery条件を確認する。
   preflightで確認するsentinel（`scripts/migrate.sh`と同じ）は
   `idx_movement_lines_item`（0010）、`trg_movement_lines_active_insert`（0011）、
   `idx_history_session`（0012）、`idx_sessions_import_batch`（0013）、
   `idx_history_revision`（0014）、`import_batch_requests`（0015）、
   `session_completions`（0016）。
   あわせて**既存の取込バッチ件数**を read-only で数える（切替境界の判断材料）:
   `SELECT COUNT(*) AS n FROM sessions WHERE import_batch_id IS NOT NULL`。
   **0012を適用する前に、D1 Time Travelの保持期間内であることを必ず確認する**
   （`DROP TABLE store_history`を含み、適用後は戻せない）。
4. 0010 → 0011 → 0012 → 0013 → 0014 → 0015 → 0016 を**この順で**適用し、
   各段階で table / column / index / trigger を read-only 確認する。
   `scripts/migrate.sh`はsentinel方式で未適用ぶんだけを当てるため、
   途中まで適用済みの本番へ再実行しても二重適用にならない。

   | migration | 変更 | rollback |
   |---|---|---|
   | 0012 | `store_history`を作り直し、一意制約を`(shop_code, session_id)`へ | **不可**（`DROP TABLE`を含む） |
   | 0013 | `sessions.import_batch_id`列 + index | 可（indexをDROP。列はNULLのまま無害） |
   | 0014 | `store_history.revision` / `updated_at`列 + index、取込sessionの一意index | 可（同上） |
   | 0015 | `import_batch_requests` table + index + trigger | 可（`DROP TABLE import_batch_requests`） |
   | 0016 | `session_completions` table + trigger、`idx_import_requests_session` | 可（`DROP TABLE session_completions` と index の DROP） |

   後方互換: 0013〜0016はいずれも既存行の意味を変えない。0014適用前の履歴行は
   `revision = id` / `updated_at = created_at` でバックフィルされる。

### migration → Worker deploy の切替境界

0015 の取込台帳と 0016 の完了 claim は、**適用後に届いた要求からしか記録されない**。
そのため「記録の無い既存データ」が2種類できる。

| 状況 | 影響 | 判断 |
|---|---|---|
| 0015 適用前に作られた取込バッチ（`import_batch_id IS NOT NULL` かつ台帳行なし） | 同じ `batchId` + 日付への再送は **`409 legacy_import_unverified`** で拒否される（内容を保証できないものを黙って上書きしないため）。取り込み直すには `DELETE /imports/:batchId` で明示的に取り消す | 許容。preflightの件数で影響範囲を把握し、Userへ取消→再取込の手順を伝える |
| 0016 適用前に完了した session（claim 行なし） | 同じ内容の完了を再送しても `409 completion_intent_conflict`（`reason: already_completed`）。保存済みデータは無傷で、詳細APIから内容を確認できる | 許容。fail-closed 側 |

**推測で fingerprint を作らない。** 当時の明細から再計算しても「当時の要求と同一である」
保証がないため、偽の replay 成功を生む。自動 backfill は行わない。

**maintenance条件（必須）**: migration 適用から新Worker deploy 完了までの窓では、
旧Workerが台帳・claim を書かないまま取込・完了を処理できる。この窓の書き込みは
上表と同じ「記録の無いデータ」を増やすため、**この間は過去棚卸取込と棚卸完了を行わせない**。
これは必須条件であり、選択肢ではない。

- 利用の少ない時間帯に migration適用 → Worker deploy を**連続して**実施し、窓を最小化する。
- 窓を開けたまま放置しない。deployが失敗した場合はWorkerを旧版へ戻して窓を閉じてから再試行する。

窓の間に発生してしまった完了・取込の扱い（**事後対応であって、事前の許可ではない**）:

| 発生したもの | 状態 | 対応 |
|---|---|---|
| 棚卸完了 | データは正しく保存される。claim が無いだけ | data修復は不要。ただし同じ完了の再送は `409 completion_intent_conflict`（`reason: already_completed`）になる |
| 過去棚卸取込 | データは正しく保存される。台帳が無いだけ | **同じ batchId + 日付への再取込が `409 legacy_import_unverified` で塞がる**。取り込み直すには `DELETE /imports/:batchId` で明示的に取り消してから再取込する |

いずれも保存済みデータは無傷で、data修復作業は不要。
件数を記録し、Userへ「その取込は取り消してから入れ直す必要がある」ことを伝えられるようにする。

5. Workerをdeployし、health、認証、許可Origin、拒否Originをprobeする。
6. Pagesを明示したproduction branchへdeployする。
7. 公開URLで新規登録、品目取込、棚卸、同期、別browser履歴詳細、CSV、β境界、legal、削除、PWAをsmokeする。
8. observabilityで当該requestを確認し、Userがrelease candidateを承認する。

途中で失敗した場合は次段階へ進みません。migrationは不可逆変更として扱い、
frontend/Workerのrollbackとdata recoveryを分けて記録します。

## 公開判定

- [ ] `WEB-01`〜`WEB-10`がすべて完了
- [ ] task board上のWeb P0が0件
- [ ] 未完のWeb P1にrelease影響、owner、期限、回避策がある
- [ ] test/build/auditの対象commitとcommandが記録済み
- [ ] [quality-scorecard.md](quality-scorecard.md)をCodexとClaude Codeが独立採点し、低い方でも基準を満たす
- [ ] production URLでUserが主要導線を確認
- [ ] Userがdeployと公開継続を明示承認

## 今回の対象外

- 14日Pro無料体験、trial entitlement
- Stripe Checkout / Customer Portal / webhook
- Pro契約の解約、支払失敗、猶予、返金
- TWA、Digital Asset Links、署名、target API
- Play Console、Data Safety提出、reviewer credentials、store画像
- PostHogの本番有効化
- 仕入先への発注送信、自動発注、入出庫・発注β機能の精度保証

対象外機能を先にlegal文面で「提供中」としません。

## Cloudflare公式資料

- [Pagesの静的HTML配信とextensionless redirect](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Wrangler Pages設定と`--branch`の推論](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)

本repositoryはD1の標準migration履歴tableではなくschema sentinel方式を使うため、
公式の一般手順をそのまま実行せず、`scripts/migrate.sh`と実schemaを照合します。
