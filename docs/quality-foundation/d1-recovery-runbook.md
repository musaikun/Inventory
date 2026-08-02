# D1 Time Travel 復元・削除再適用runbook

最終更新: 2026-08-02
担当: Codex
状態: 運用draft。maintenance modeと削除抑止listの外部保管が整うまで本番実行不可

## 1. 目的と重要な制約

このrunbookは、Cloudflare D1のTime Travelで障害前へ復元する場合に、過去に削除したaccount dataを
復活させたままにしないための手順を定める。

- Time Travelは常時有効で、復元可能期間はFree planで7日、Paid planで30日。
- restoreは同じdatabaseを指定時点へ戻す破壊的操作で、実行中のqueryをcancelする。
- restore後には、restore直前へ戻すためのbookmarkが返される。
- repoの`D-014`により、deploy、remote DB操作、migration適用にはUserの明示承認が必要。
- このrunbookはcommand例を示すだけで、Codexは承認なしに実行しない。

最重要の制約として、`account_deletion_receipts`は意図的にaccount識別子を保持しない。
7日後には匿名tombstoneも消えるため、restore前に「現在までに削除されたaccountの抑止list」を
安全な外部記録として確保できなければ、削除済みdataの完全な再削除を保証できない。

## 2. 実行条件

次をすべて満たさない場合はrestoreを開始しない。

- [ ] Userが対象database、復元時点、影響範囲を明示承認した
- [ ] 本番のwriteを止めるmaintenance/read-only手段がある
- [ ] 現在bookmarkとdatabase exportを取得できる
- [ ] 現在の削除済み/削除処理中accountを特定できる抑止listを、暗号化・access制限した別保存先へ退避できる
- [ ] 復元対象時点、migration履歴、incident timelineが確定している
- [ ] 復元後のowner、検証者、利用者通知方針が決まっている

現状はapplication-level maintenance modeと永続的な外部削除ledgerが未実装のため、
このrunbookは`OPS-001`の準備手順であり、本番restoreを安全に完遂できる状態ではない。

## 3. 復元前

1. incident ID、開始時刻、判断者、実行者、対象database名を記録する。
2. write trafficとscheduled cronを停止し、read-only/maintenance状態を確認する。
3. 現在のTime Travel bookmarkを記録する。

   ```sh
   npx wrangler d1 time-travel info inventory-store
   ```

4. 現在databaseをexportし、復元対象時点とは別のrestricted storageへ保存する。
5. 現在の削除抑止listを退避する。最低限、次を含める。

   - `stores.deleted_at IS NOT NULL` の店舗codeとdeleted_at
   - `stores.deletion_pending_at IS NOT NULL` の店舗code、request ID、pending時刻
   - incident中に受理した削除request

   `account_deletion_receipts`だけでは店舗codeを復元できないため、代替にしない。
6. 現在適用済みmigrationとtable/schemaを記録する。
7. active store、child row、Push購読、削除tombstoneの件数を記録する。
8. 指定時点のbookmarkを確認する。

   ```sh
   npx wrangler d1 time-travel info inventory-store --timestamp=YYYY-MM-DDTHH:MM:SSZ
   ```

## 4. restore

User承認済みのtimestampまたはbookmarkを1つだけ使う。

```sh
npx wrangler d1 time-travel restore inventory-store --timestamp=YYYY-MM-DDTHH:MM:SSZ
```

または:

```sh
npx wrangler d1 time-travel restore inventory-store --bookmark=BOOKMARK
```

command出力、開始/終了時刻、restore前へ戻すために返されたbookmarkをincident recordへ保存する。
失敗時に別時点を推測して連続実行しない。

## 5. 復元後の削除再適用

write trafficを再開する前に実施する。

1. 復元後schemaが現在codeに必要なmigration levelか確認する。migration適用が必要なら別途User承認を得る。
2. §3で退避した全店舗codeについて、現行`accountDeletion.js`と同じ範囲を再削除する。

   - `inventory_lines` / `sessions`
   - `order_lines` / `orders`
   - `movement_lines` / `movements`
   - `item_par_levels`
   - `store_history` / `store_inventory` / `store_configs`
   - `push_subscriptions`
   - `login_attempts`
   - `auth_tokens`
   - `stores`の匿名tombstone化、または保持期間経過済みなら物理削除

3. 対象店舗のstock/order Durable Objectsをpurge/dissolveする。D1 restore自体はDurable Objectsを復元しないが、
   incident中に再生成されたroomを残さない。
4. incident期間中に発行・復元されたauth tokenを無効化する。
5. 期限切れ`login_attempts` / `ip_attempts`と削除receipt/tombstoneのcleanupを実行する。
6. 各対象店舗について、child row、token、Push購読、DO storageが0であることと、
   `stores`が匿名tombstoneまたは削除済みであることを二者確認する。
7. account削除以外の復元対象dataを件数・sampling・application testで検証する。
8. 検証完了後にのみtrafficとcronを再開する。

削除再適用には、account削除APIを利用者のPINなしで代用しない。運用専用script/transactionを実装する場合は、
現行削除table listを共有化し、tenant境界と冪等性をtestしてから使用する。

## 6. rollbackと終了

- restore結果が不正なら、§4で返されたrestore前bookmarkへの再restoreをUser判断で検討する。
- rollback後も、削除抑止listの再適用を省略しない。
- incident recordへ、使用bookmark、再削除対象数、検証結果、未解決差分、通知判断を保存する。
- 一時exportと抑止listはincidentの承認済み保持期間後に安全に削除する。

## 7. 公開前の残作業

- Free plan / 回復可能期間7日はD-020で確定済み。plan変更時にprivacy policyを更新
- maintenance/read-only modeを実装
- account識別可能な削除抑止listをD1以外へ最小限・暗号化して保管する設計を承認
- 復元後再削除scriptとverification queryをstagingで演習
- Cloudflare dashboard/CLI権限を最小化し、実行者と承認者を分離

### 2026-07-26 read-only preflight

- `wrangler d1 time-travel info inventory-store`は成功し、Time Travelを利用可能と確認した。
  bookmark値はcredentialに準ずる運用情報として本repositoryへ記録しない。
- command出力にaccount plan名はなく、Dashboard用browserも未接続だったため、Free/Paidの確定はUser確認を残す。
- 2026-08-01 User確認: 当面はFree planを使用し、Time Travelは7日として扱う（D-020）。
- 本番schemaのread-only queryで、0010の`movements`/`movement_lines`と0011の削除列・receipt・triggerが
  存在しないことを確認した。remote migrationは実行していない。
- `scripts/migrate.sh`に0010/0011の列挙漏れがあったため修正し、migration directory全件を検査する
  `worker/test/migrationScript.test.js`を追加した。標準の`wrangler d1 migrations list`は、このrepositoryの
  schema sentinel方式の適用判定には使用しない。

## 8. 公式根拠

- [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/#d1)
