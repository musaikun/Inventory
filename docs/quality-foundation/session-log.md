# セッションログ

新しい記録を上に追加します。会話の全文ではなく、再開に必要な事実だけを残します。

## 2026-09-04 — UI-003 循環ホイール・面積遷移・並べ替え補間

- `develop@e704b5f`上の既存worktree差分から再開し、UI-003の実装とテストを照合。既存差分は保持した。
- 分類先を仮想slotの剰余写像にし、先頭・末尾を両方向へ循環。複数周回後も中央表示と品目の保存先が一致する回帰testを追加した。
- ホイール高さ・カード開閉・操作レール・補助表示を420msに同期。reduced motionでは即時反映。回転中の一覧操作は中央へsnapし、Pointer Captureのclick retargetもdown時slotで復元する。
- 分類先管理はドラッグ中のDOM順とFLIP補間を分類データから分け、pointerup時に1回保存。上下移動、連続反転、pointer中断、キーボード操作を回帰化した。
- 検証: 対象4 files / 62 passed。最新`origin/develop`統合後もApp全体142 files / 1588 passed、production build成功（491 modules、PWA 17 entries / 2695.34 KiB）、`git diff --check`指摘なし。既知のVite CJS・chunk size warningのみ。
- 検証環境補足: forks worker起動timeoutと単一threads workerの停滞があり、後者は中断。並列threadsのApp全体で全件成功した。
- Browserが接続されておらず実機目視は未実施。タスクは`レビュー待ち / User`とし、手動台本U-1〜U-8へ引き継いだ。
- 他セッションの取込機能更新を含む最新`origin/develop`へrebase。UI code / testは非競合で、重複した`docs/proposals.md`も双方の記録を保持した。
- API / DB / 認可 / 保存形式 / Workerは無変更。UI-003はcommit / pushを実施し、deployとversion変更は行っていない。

## 2026-09-01 — 招待リンクが別ブラウザで死ぬ問題と、ゲストの非表示申請

User報告2件。どちらも実機での使用中に出たもの。

### 1. LINEから別のブラウザで開くと、名前入力に来ないままホームが出る

**原因は起動直後の `history.replaceState`**。`?store` / `?s` を読み終えた時点でURLから
消していた。LINE のアプリ内ブラウザで開いたあと「別のブラウザで開く」を選ぶと、
移った先へ渡るのは受け取った元のリンクではなく **いま表示しているURL**なので、
パラメータの無いURLが渡り、移った先は招待だと分からずホーム（ホストとして開始）を出す。
アプリ内ブラウザ側では正常に見えるため、「別のブラウザのときだけ」の症状に見えていた。

`_clearInviteParams()` を追加し、消すのは **参加できたとき**と**結果ビューを閉じたとき**だけにした。
招待以外のクエリ（将来の入口）は巻き込まない。副作用として、参加前にリロードすると
名前入力がもう一度出る（招待がまだ使われていない状態なので、意図した動作として残す）。

### 2. ゲストがホストへ非表示を申請できるようにした

ゲストは要らない品目に気づく立場にいるが、品目リストの正はホストにある。ゲストの端末で
隠すと次の config 同期で戻ってきて「消したのに復活する」形になるため、**申請 → ホストの承認**
にした。既にある品目**追加**の申請と同じ形（`item_add_request`）に揃えている。

- WS: `item_hide_request` / `item_hide_response` を追加。DO は中継のみで何も書き換えない。
  応答は `_isHost` 検証つき、ホスト不在なら `host_offline` を即返す。→ `sync-spec.md` に追記
- `InventoryTable` は `canRequestHide` のとき **`hide-item` ではなく `request-hide`** を出す。
  同じイベントで親に分岐を任せると、親が分岐を落としたときゲスト端末だけが隠れる
- 文言もゲストでは「申請」「離すと申請」「ホストに申請しますか？」に変わる
- ホスト側は承認/拒否カード、ゲスト側は「申請中…」。ホストの操作は従来どおり（確認モーダル）
- **同じ品目への申請は品目名でまとめて返す**。DO は requestId ごとに申請元へ返すので、
  1件にだけ答えると2人目は「申請中…」のまま待ち続ける

### 検証

App 140 files / 1542 passed、production build 成功、Worker 32 files / 601 passed。
新規test 20件（App 13 / Worker 7）＋既存の join認可testに2型を追加。
うち14件が実装前に失敗することを確認済み。
**実機未確認**（LINE のアプリ内ブラウザ → 別ブラウザの実経路、2台での申請→承認）。

### 採番

ここまでを **v0.91.0** とした（User 指示。D-025 のとおり採番は User / PM のリリース区切り）。
v0.90.0 以降の12コミット＝閲覧用一覧の検索、全スワイプ非表示とその色、カナ検索、
二重スクロール、共有結果の1件引き、ホーム整理、招待リンクの持ち回り、ゲストの非表示申請、
および見直しで見つけた不具合修正。機能追加を含むため minor（D-023）。
画面には `v0.91.0 (<commit SHA>)` の形で出る。

## 2026-09-01 — v0.90.0 周りの見直しで見つけた3件を直した

`develop@bcfd832`（8/30〜8/31 に入った結果共有・完了後レポート・全スワイプ非表示・
閲覧検索・二重スクロール修正・Free上限の一時解除）を読み直し、**バグ3件**を修正した。
新機能は足していない。

### 1. ジェスチャの取り消しで、確認なしに品目が非表示になりえた

`InventoryTable` の左スワイプ非表示（`d023bf6` で全スワイプを追加）に `touchcancel` の
受け口が無かった。iOS の画面端スワイプ・通知・着信でジェスチャがシステムへ移ると
**touchend は来ない**。`swipeDragging` が立ったまま、行は引かれた位置で固定される。

危ないのはその次で、同じ行に触れると `_baseDx` がその深さ（閾値超え）を引き継ぐため、
**指を数px横へ動かして離すだけで「全スワイプ」と判定され、確認なしに非表示**になる。
全スワイプの無確認化と、取り消しの取りこぼしが噛み合って初めて出る経路だった。

`onRowTouchCancel()` で閉じた状態へ戻す（取り消しは何も確定させない）。

### 2. 横スワイプ全般が、取り消されると引きかけの位置で止まっていた

`useHorizontalSwipe` にも同じ穴があり、`onDrag` で動かした分がその位置で固定される
（タブが半分ずれたまま止まる）。`onTouchCancel()` を足し、**左右の確定は呼ばずに**
位置だけ戻す。利用側6か所（履歴カレンダー / 確認モーダル / 仕入れ / 履歴詳細 /
軸割り当て / セッション一覧）に `@touchcancel` を配線した。

### 3. 開いても表示されない共有リンクを配れてしまう

共有リンクが読むのは `store_history` のスナップショット（`handleRoomResult`）。
一方、履歴詳細は端末にスナップショットが無いとき `inventory_lines` から復元して出す
（DATA-002 / R-001）。**復元経路に来ている時点で `store_history` に行が無い**ので、
端末を替えたホストが過去の棚卸を共有すると、相手には「この棚卸は閲覧できません」しか出ない。

- 復元表示（`snapshot.source === 'd1-lines'`）では共有ボタンを出さない。
- 未送信の訂正（`dirty`）があるあいだは「相手には訂正前の内容が見える」と panel に出す
  （リンク自体は開けるので止めない）。

判断の詳細と残る論点は[提案箱](../proposals.md)へ記録した。

### 4. 金額の面の条件が、開く導線にしか無かった

レポート（単価・在庫金額を出す唯一の面）と共有 panel は `isHost` でタブ／ボタンを
出し分けているが、**面そのものは `activeTab` / `showShare` しか見ていなかった**。
ホストで開いたあとに `isHost` が下りる経路が生まれると、金額の面がそのまま残る。
いまの遷移では踏めない（ルーム参加は `currentView` ごと差し替わる）が、
条件が2か所に分かれている状態を残さない。面自身にも `isHost` を持たせ、
props が変わったら閉じることを test で固定した。

### 確認したが直していないもの

- **共有リンクが次回のルーム参加に化けないか**。`_enterStoreLink` は
  `status.isActive` **かつ** `status.sessionId` 一致のときだけ参加へ回し、完了済み
  セッションを再開する導線も無い（一覧の「再開する」は進行中のみ）。安全側だったので、
  根拠が消えないよう `resultShare.js` の説明を実際の判定に合わせた。
- **Free上限の一時解除（`39f22f0`）の取りこぼし**。`isPro()` / `FREE_*` の直接参照を
  全件たどったが、残っていたのは上限が実際に効いたときだけ出る文言で、判定は
  すべて `limitsEnforced()` 経由。サーバーに上限が無い点は提案箱の既存項目のまま。
- **履歴詳細のタブが4枚になった**（レポート追加）。375px でも折り返して収まるが、
  件数付きの「変更履歴 (128)」は2行になりうる。実機で見ないと直し方を決められないので触っていない。

検証: App 137 files / 1524 passed、production build 成功、Worker 31 files / 592 passed
（`worker/**` に差分なし）。修正前に新規test 8件が失敗することを確認済み。実機は未確認。
並行セッションの `b2717d7`（カード寸法）・`2ce21ff`（スワイプの色）を merge 済みで、
コード側の競合は無かった。

## 2026-08-29 — 本番Worker入れ替えでCORSが閉じた（復旧済み）

本番Workerを新版へ入れ替えた直後、フロントが全滅した。画面は `Failed to fetch`、
実体は **preflight が 403 で `Access-Control-Allow-Origin` を返さない**状態。
`Production Backend` の apply を `579867c` で流し直して復旧
（[run 33240600803](https://github.com/musaikun/Inventory/actions/runs/33240600803)）。

### 原因: host名の食い違い（旧Workerの緩さで隠れていた）

`isAllowedOrigin` が常に許可していたのは `*.inventory-app.pages.dev` だが、
実際の Pages project は **`inventory-app-c40.pages.dev`**（`-c40` 付き）。
旧本番Workerは**任意Originを反射する状態**（WEB-02 に記録あり）だったため、
この食い違いは入れ替えるまで表面化しなかった。**fail-close 化そのものが正しく、
設定が実態に追いついていなかった**という形。

修正は2段階になった。1回目（`bb983a6`）は `ALLOWED_ORIGIN` に固定URLを列挙しただけで、
利用者は **deployment hash の preview URL**（`568e490f.…`）から開いており直らなかった。
hash は deploy のたびに変わり列挙できない。2回目（`3db6486`）でコード側の
`PAGES_HOSTS` に `-c40` を入れ、**サブドメインごと許可**して解決。
ついでに Pages host の許可を **https のみ**に絞った（従来は host名だけ見ていた）。

### 復旧後の実測

| Origin | health | ACAO |
|---|---|---|
| `568e490f.inventory-app-c40.pages.dev` | 200 | 返る |
| `inventory-app-c40.pages.dev` | 200 | 返る |
| `develop.inventory-app-c40.pages.dev` | 200 | 返る |
| `evil.example.com` | **403** | **返らない**（fail-close 維持） |

新経路も `lines` / `audit` ともに 401（＝経路あり）。

### 再発防止

- `test/corsOrigins.test.js` … wrangler.toml の値を読み、**実際に人が開く URL**
  （hash preview を含む）が通ること、接尾辞偽装・ハイフン違い・http が拒否されることを固定。
  `isAllowedOrigin` の単体testだけでは「設定値と実host の対応」が抜けていて防げなかった。
- `Guard stale commit` … Actions の **Re-run は当時の commit を流し直す**ため、
  修正後に再実行しても古いWorkerが出る（実際に2回起きた）。commit が develop の
  先端でなければ migration にも deploy にも進まず中断するようにした。

### 反省

deploy の成否判定に `GET /store/TEST00/sessions/x/lines` の 404/401 を使っていたが、
router は英字4〜8桁の店舗コードと36桁UUIDを要求する。`TEST00` も `x` も合わず
**新旧どちらでも404**で、deploy 成功後に「まだ古い」と誤報告した。
**判定に使う値は、合格側と不合格側の両方で確かめてから使う。**

## 2026-08-28 — 本番backendを更新（migration 0009〜0017 + Worker deploy）

`Production Backend (D1 + Worker)` の `step=apply` を develop（`b1381eb`）から実行
（[run 33158311069](https://github.com/musaikun/Inventory/actions/runs/33158311069)）。**成功**。

- 事前ゲートはすべて通過: 合言葉 / branch=develop / 本番varsに`DEBUG_ERRORS`なし /
  Worker 580 passed / App 1420 passed。テストはmigrationより前に走るので、
  失敗していればDBに触れずに止まっていた。
- **migration 0009〜0017 を適用**。最後の 0017 適用後で `num_tables` 19 → 20、
  DBサイズ 0.94 → 0.96 MB。最終bookmark
  `00000530-0000003d-000050d5-cb88e0829b73391b3ad16586c17700fd`。
- **Worker deploy 成功**。`inventory-sync` / Version ID `6e19f979-aabe-41e8-aca0-905fc14826ed`。
  bindings は ROOMS(DO) / DB(inventory-store) / ALLOWED_ORIGIN のみ＝**本番に DEBUG_ERRORS は無い**。
- 適用前の復元点（0012適用前）:
  `0000052e-00000000-000050d5-1ed99a2755103305e978d5d4550c5a93`

### 反省: deploy確認プローブが間違っていた

`GET /store/TEST00/sessions/x/lines` の 404/401 で新旧を見分けようとしていたが、
router は `/^\/store\/([A-Z]{4,8})(\/.*)?$/i` と36桁UUIDを要求する。
`TEST00`（数字入り）も `x` もこれに合わず、**新旧どちらのWorkerでも 404** になる。
そのため deploy 成功後も「まだ旧Workerのまま」と誤報告した。
正しくは `TESTAA` + 36桁UUID で **401**（経路あり・認証で拒否）が合格。
workflow の確認stepを直し、理由をコメントに残した。

**判定に使う値は、合格側と不合格側の両方で1回ずつ確かめてから使うこと。**
片側（旧Worker=404）しか見ずに使ったのが原因。

frontend（Pages本番）は未実施。WEB-01・WEB-03 が未確定のため対象外のまま。

## 2026-08-28 — 本番D1 preflight の実測値（run #4 / read-only）

`Production Backend (D1 + Worker)` workflow の `step=preflight` を develop から実行
（[run 33156641459](https://github.com/musaikun/Inventory/actions/runs/33156641459)、
対象 `5368a34`）。**D1もWorkerも変更していない**。

- **適用済みは 0001〜0008 まで**。存在した sentinel は
  `stores` / `auth_tokens` / `login_attempts` / `inventory_lines` / `ip_attempts` /
  `push_subscriptions` / `idx_sessions_shop_type` / `orders` の8つ。
  **`idx_stores_plan`（0009）が無い** = 未適用は WEB-04 が想定していた 0010〜0017 ではなく
  **0009〜0017 の9本**。0009 は `stores.plan` を足す migration で、現行Workerのplan判定が
  依存する。WEB-04 の記述を訂正した。
- **データ量**: stores=3 / sessions=2 / store_history=4 / inventory_lines=357、
  DBサイズ 839,680 bytes。0012 が作り直す `store_history` は**4行**しかなく、
  不可逆点のデータ影響は小さい。
- **`sessions.import_batch_id` 列が存在しない**（0013未適用）。したがって
  「0015適用前に作られた取込バッチ」は**0件**で、`409 legacy_import_unverified` の
  事後対応は発生しない（切替境界の表のうち取込側は該当なし）。
- **Time Travel のブックマークを取得**:
  `0000052e-00000000-000050d5-1ed99a2755103305e978d5d4550c5a93`
  ← **0012 適用前の復元点**。apply で問題が出たらこれに戻す。
- CI が使う wrangler は 3.114.17（4.x が出ている旨の警告あり）。WEB-03 の「Wrangler版」は未確定のまま。

apply は未実施。**Pro Review での棚卸完了（compound SELECT 修正の実D1確認）が先**。

## 2026-08-28 — 棚卸が完了できない原因を特定：実D1のcompound SELECT上限

- **症状**: Pro Reviewで棚卸を完了できない（`HTTP 503 / complete_failed`）。
  同時に「セッション一覧へ戻れない」も出ていたが、これは`completionUnknown`が
  画面遷移を塞いでいたためで別件（`8b7f36a`で解消済み）。
- **原因**: 実D1の `SQLITE_LIMIT_COMPOUND_SELECT` が SQLite既定の 500 ではなく
  **19未満**まで絞られている。明細のまとめ書きは
  `SELECT ? AS item, … UNION ALL …` を19行ずつに切っていたので、
  **6品目の棚卸でも** `too many terms in compound SELECT: SQLITE_ERROR` で落ちていた。
- **計測方法**: 手元の実SQLite（node:sqlite）では500品目でも再現しないため、
  検証環境（`DEBUG_ERRORS=1`）だけで動く**読み取りだけのプローブ**を仕込み、
  失敗した完了要求の応答へ実測値を載せた（書き込みは一切やり直さない）。
  Pro Reviewでの実測: `stmts=6 lines=2 items=6 inv=6 snapKB=206 | s19=NG b10=NG v500=ok v1000=ok`。
  → 1文あたり19項でNG、複数行VALUESは1000行でもOK
  （SQLiteは複数行VALUESを compound SELECT の項数制限から外す）。
- **修正**: 明細のまとめ書きを**全経路 VALUES 形式**へ移した。
  `(VALUES (?,…),(?,…)) v` を組み立てる `valueRows()` を `validate.js` に置き、
  棚卸完了 / 発注 / 入出庫 / 過去取込の4経路が使う。
  まとめ行数（`constants.js`）は今後 **bound parameter 上限 100/query だけ**で決まる。
  `test/compoundSelectFree.sqlite.test.js` で4経路とも `UNION ALL` を組み立てないことを固定した。
- 検証: worker 30 files / 580 passed、app build 成功。**実D1での完了成功は未確認**（利用者の実機待ち）。
- **残: Free版の別問題**。`サーバー応答に snapshotSaved が無い` は本番Workerが約3週間古いことが原因で
  （`/lines` が404 = 2026-08-09以前）、本番Workerのdeployが必要。WEB-04（`0010`〜`0017`、
  うち`0012`が不可逆な`DROP TABLE`）が未解決のため未実施・未承認。

## 2026-08-25 — Pro Reviewをdevelopへ自動追随させ、workflowの2件の不具合を潰した

- Pro Reviewが`v0.68.0`のまま止まっていた。更新が`workflow_dispatch`のみで、Claude Codeの
  セッションからはdispatchできない（GitHub Appに`actions: write`が無く403）。
  `.github/workflows/pro-review.yml`へ`push: branches: [develop]`を追加し、developへのpushで
  Worker → Pagesが1 runで更新されるようにした（`1fa460f`）。`workflow_dispatch`も残している。
- この workflow はこれまで一度も実行されておらず（手動更新はWranglerで直接実行していた）、
  自動化して初めてtest stepが動いた結果、2件の潜在不具合が表面化した。
  - **worker test の勝者依存**: `ledgerLifecycle.sqlite.test.js`の「同一ミリ秒の異内容2要求」で、
    敗者の痕跡を`qty === 99`（B側の値）で数えていた。どちらが勝つかは競合の解決順で変わるため、
    Bが勝ったrunではB自身の5行を数えて失敗する。ローカルは常にAが勝つため通っていた。
    勝者側の`itemCount`と`session_id`で数える形に変更（`ee693c7`）。実行順を入れ替えて
    Bが勝つ状態でも通ることを確認した。
  - **Pro env が test まで漏れていた**: `VITE_DEPLOYMENT_CHANNEL=pro-review` /
    `VITE_REVIEW_PLAN=pro`をjob全体の`env:`に置いていたため`npm test`もPro判定になり、
    Free枠前提の`planLimits.test.js`（150品目・2台・残り枠）が全滅していた。
    VITE_*の3変数をbuild stepへ移した（`1423ce6`）。
- run #3（`1423ce6`）が全step成功。Worker `inventory-sync-pro-review`とPagesを同じrunで更新し、
  Pro Reviewは`v0.74.0`になった。D1マイグレーションはworkflowに含めていない（適用済みは`0001`〜`0016`）。
- 検証: worker 26 files / 545 passed、app 111 files / 1248 passed、通常buildとPro build両方成功。
  Pro buildのdistに`pro-review`とPro Worker URLが埋まることを確認した。
- 未実施: 実ブラウザでのPro Review画面確認（Access、`PRO REVIEW`表示、v0.74.0のUI）。
  本番deploy / 本番D1マイグレーション / `main`マージはいずれも未実施・未承認。

## 2026-08-23 — Pro Review D1・Worker・Pagesを復旧

- User承認のもと、本番Free環境とは分離されたPro Reviewだけを更新した。本番Worker / D1 / Pagesは未変更。
- `inventory-store-pro-review`のTime Travel bookmarkを取得し、実schemaが`0001`〜`0011`と
  一致することを確認後、migration履歴を基準登録。`0012`〜`0016`を適用し、未適用0件を確認した。
  適用前後とも店舗1件、session/history 0件。
- `inventory-sync-pro-review`をWrangler 4.125.0で配信。途中でhandler/bindingを持たない並行versionに
  上書きされ404へ戻ったため再配信し、最終version
  `f8a063d2-4139-4081-9eb8-031d9af8e7a0`でhealth 200、固定origin CORS 204を確認した。
- Appを`develop@4add746`（0.68.0）でPro Review buildし、Pages deployment
  `72feca8d-d46f-4646-939c-6349e0a98912`へ配信。固定aliasの未認証Access 302を確認した。
- Cloudflare Access配下のmanifest fetchへcookieを送るため、Pro Review buildだけ
  `crossorigin=use-credentials`を生成するよう`app/vite.config.js`を修正。
- 検証: App 99 files / 1106 passed。worker起動待ちで未実行だった4 filesは単独実行し
  80 passed（合計103 files / 1186 passed）。最終更新分の関連test 5 passed、Pro Review build成功。
  Worker全体は544 passed / 1 timeout後、対象1件の単独再実行1 passed。
- 実ブラウザ接続は利用可能browserが無く未実施。User実機で固定URLのログイン、
  `PRO REVIEW · テストデータ`表示、DevToolsのmanifest/Workboxエラー消失、`X-Robots-Tag`を確認する。
- 未実施: commit、push。本番migration / deploy。

## 2026-08-19 — DATA-001 / DATA-002 / IMPORT-001 最終承認・完了

- Codexが `develop@e8f5e16` を最終独立レビューし、3タスクともblocking findingなしで承認した。
- `DATA-002`からAppへの引継ぎ7点は、`DATA-001` / `IMPORT-001`ですべて対応済み。
- 最終確認: App 95 files / 1140 passed、Worker 26 files / 545 passed、
  production build成功、`git diff --check`指摘なし、Workerの最終IMPORT修正差分なし。
- `task-list.md`で3件を完了へ移し、各タスク詳細へ最終HEADと検証証拠を追記した。
- 本番公開は未承認。migration 0010〜0016、実D1・実browser、critical E2E、production smokeは
  `WEB-04` / `WEB-07` / `WEB-09` / `WEB-10`として継続する。

## 2026-08-19 — CC第3修正セッション: Codexレビュー指摘の修正・4回目（IMPORT-001）

- 担当: Claude Code。branch `claude/csv-past-stocktake-import-a0kjl3`、基準 `8f0674b`。
- 前回の `onPageBack()` は確認済み。残っていた **DesktopNav 経路**を塞いだ。

### DesktopNav が import中断guard を迂回する

1024px以上では `DesktopNav` が背景に常時表示される。`onDesktopNavigate()` は
`isBackBlocked()` を見ずに `currentView` を変えていた。モーダルに focus trap も
背景の inert 化も無いので、overlay がポインタを遮っても **Tab / スクリーンリーダー**から
サイドナビを実行でき、`MasterManagePage` / `MovementPage` ごと unmount されて
`importBatchId` と計画を失っていた。

- `onDesktopNavigate()` の先頭で `isBackBlocked()` を確認。guard中はどの view へも進まない。
- 判定は画面内の戻る・PWA Back と**同じ関数**を共有するので、3経路で条件がずれない。
- `matchMedia` を desktop 相当へ mock した App test を両ページぶん追加。
  guard行を外すと2件落ちることを確認した。

### 同種の指摘を4回受けたので、全経路を棚卸しした

`master` / `movement` に居るあいだに `currentView` を変えうる経路を全部数え、
`IMPORT-001.md` へ表で残した。到達可能なのは3つ（画面内の戻る / PWA Back / DesktopNav）で、
いずれも guard 済み。`AppMenu` は `context="session"` の中だけなので master / movement には無い。
ルーム解散・練習終了は `session` からのみ。両ページの emit は `back` / `clear-master` /
`saved` だけで、他に view を変える出口は無い。

**意図的に guard しない経路**: 401 auth失効と account削除。
token を失うと取消APIも呼べないので、画面を留めても復旧できない（残riskへ記録）。

### 残riskの記述を訂正した

前回「focus trap が無いのは a11y の別課題」と書いたが、**塞げていた経路が不完全だった**ため
誤りだった。focus trap の不在は**データ整合性のリスクでもある**と訂正し、
現在の方式が「新しい遷移経路が増えたら guard を足す」前提であること、
構造的には focus trap + `inert` の方が強いことを明記した。

### 検証

- 追加5 testのうち2件が修正前に失敗。
- `npm --prefix app test -- --run`: **95 files / 1140 passed**。
- `npm --prefix app run build`: 成功。
- `npm --prefix worker test`: **26 files / 545 passed**。
- `git diff --check` / `worker/**` の差分: いずれも出力なし。
- `App.vue` の累計差分: 28 insertions(+), 3 deletions(-)。

### 次の再開地点

Codex の再レビュー（第3セッションの最終完了判定）。
**migration 0012〜0016は本番未適用。`migration → Worker → App` の順で出す。**

## 2026-08-19 — CC第3修正セッション: Codexレビュー指摘の修正・3回目（IMPORT-001）

- 担当: Claude Code。branch `claude/csv-past-stocktake-import-a0kjl3`、基準 `62b0ddc`。
- 前回2件（PWA Back / 不正引用符）は修正確認済み。残っていたP1 1件を修正した。

### 画面内の「戻る」が import中断guard を迂回する

前回は `_closeTopLayer()`（PWA / ブラウザ Back）だけを塞いでいた。
`MasterManagePage` / `MovementPage` の `‹ 戻る` は `@back` を emit し、App が
**直接 `currentView = 'sessions'`** に変換していたため guard を通らなかった。
モーダルに focus trap も背景の inert 化も無いので、overlay でポインタを防いでも
**キーボードの Tab で背景の戻るボタンへ到達して実行できる**。

- App へ共通ハンドラ `onPageBack()` を追加。`isBackBlocked()` が true なら view を変えない。
- 両ページの `@back` をこのハンドラへ集約した（過去棚卸取込モーダルを載せているのはこの2つだけ）。
- PWA Back と同じ判定を共有するので、2経路で条件がずれない。guard解除後は通常どおり戻る。
- 両ページとも emit は `back`（+ master の `clear-master`）のみで、他に view を変える経路は無い。
- `App.importBack.test.js` へ両ページ×2件を追加。`@back` を修正前へ戻すと2件落ちることを確認。

### 判断: focus trap は入れていない

今回の実害（復旧情報の喪失）は view を切り替える経路を塞げば止まる。
背景要素への focus 移動そのものは他モーダルにも共通するa11yの別課題として、
`IMPORT-001.md` の残riskへ記録した。

### 検証

- 追加4 testのうち2件が修正前に失敗。
- `npm --prefix app test -- --run`: **95 files / 1135 passed**。
- `npm --prefix app run build`: 成功。
- `npm --prefix worker test`: **26 files / 545 passed**。
- `git diff --check` / `worker/**` の差分: いずれも出力なし。
- `App.vue` の累計差分: 22 insertions(+), 3 deletions(-)。

### 次の再開地点

Codex の再レビュー（第3セッションの最終完了判定）。
**migration 0012〜0016は本番未適用。`migration → Worker → App` の順で出す。**

## 2026-08-19 — CC第3修正セッション: Codexレビュー指摘2件の修正・2回目（IMPORT-001）

- 担当: Claude Code。branch `claude/csv-past-stocktake-import-a0kjl3`、基準 `15ecb2e`。
- 前回3件の修正は確認済み。今回のP1 2件も、**モーダル内だけを守っても迂回できる経路**と
  **構造解析が値を書き換える経路**で、自動testでは見えていなかった。

### 1. PWA / ブラウザBackでclose禁止を迂回できる

`App._closeTopLayer()` は `master` / `movement` から直接 view を切り替えるので、
子モーダルの `requestClose()` を通らず unmount される。`importBatchId` と計画を失い、
履歴に別の取消導線が無いため `DELETE /imports/:batchId` を呼べなくなる。

- `appMenuState.js` へ `registerModalBackGuard()` / `isBackBlocked()` を追加
  （既存の `registerDeleteAccountBackHandler` と同じパターン）。
- モーダルが `closeBlocked` を guard として登録し、`onUnmounted` で解除。
- `App.vue` の `_closeTopLayer()` **先頭**で参照。何も閉じずに `true` を返し、
  sentinel を積み直して戻る操作だけを消費する。
- **`App.vue` を変更した**（当初の変更禁止指定に対する例外）。`_closeTopLayer()` は
  App にしか無く、この経路はここでしか塞げない。差分は import 1行 + ガード1行に限定。
  第1・第2修正セッションは merge 済みなので、変更禁止の目的（並行作業との競合回避）とは競合しない。
- `App.importBack.test.js`（新規）でApp実結合として固定。ガード行を外すと落ちることを確認した。

### 2. 不正な引用符を削除して正常受理する

`tokenizeCSV` は `"` が来たら常に引用開始とし、閉じたあとの通常文字も許可していた。
実測で `foo"bar"baz` が**エラーなしで `foobarbaz`**、`"ab"c` が `abc`、`a"b` が `ab`。
引用符を落として前後をつなげるので、品目名・単位が無通知で別の文字列になる。
全取込入口が同じトークナイザを使うため4経路すべてで起きていた。

- セル単位の状態（`quotedDone` / `contentSeen`）を持つ厳密な状態機械へ書き換え。
  引用符の開始は**セル先頭だけ**、閉じたあとは**区切り・改行・EOF だけ**。
- `CSV_ERROR_BAD_QUOTE` を追加し、行番号と理由つきの構造エラーにする（推測で直さない）。
- 正しい引用（`"b,c"` / `"5"" 皿"` / 引用符内改行 / `""`）は従来どおり。
- 引用符の**前後の空白だけ**は許容（`a, "b,c"`）。値は変わらないので無通知の改変にあたらない。

### 検証

- 追加8 testのうち6件が修正前に失敗（csvParse 5件 / App Back 1件）。
- `npm --prefix app test -- --run`: **95 files / 1131 passed**。
- `npm --prefix app run build`: 成功。
- `npm --prefix worker test`: **26 files / 545 passed**。
- `git diff --check` / `worker/**` の差分: いずれも出力なし。

### 次の再開地点

Codex の再レビュー。**migration 0012〜0016は本番未適用。`migration → Worker → App` の順で出す。**

## 2026-08-19 — CC第3修正セッション: Codexレビュー指摘3件の修正（IMPORT-001）

- 担当: Claude Code。branch `claude/csv-past-stocktake-import-a0kjl3`、基準 `01e7a0f`。
- 判定は `Changes requested`。**自動testは全成功していた**ので、3件とも
  「testが挙動を確認できていなかった範囲」だった。3件とも先に失敗するtestを追加した（10件）。
- 状態は `レビュー待ち / Claude Code` のまま。`完了` / `WEB-07` 通過としていない。

### 1. 取消必須の409で閉じると復旧手段を失う（前回判断の訂正）

前回「サーバー上の状態は確定していて履歴から辿れるので close は塞がない」と書いたが**誤り**。
`useDataImport.closeStocktake()` は close で計画と `importBatchId` を捨て、
履歴画面に別の取消導線が無い。閉じた時点で `DELETE /imports/:batchId` を二度と呼べなくなる。
再試行では解消しないコードなので、取消が唯一の復旧手段だった。
→ `closeBlocked = hasUnknown || mustCancelList.length > 0` を close の3経路すべてに効かせた。
取消成功で閉じられる／取消失敗では閉じられない。誤った期待の既存testも置き換えた。

### 2. 列数不一致が正常データとして受理される

`resultCsvParser` / `deliveryImportParser` にヘッダとの列数照合が無かった
（品目取込だけが持っていた）。`日付,品目名,単位,数量,単価` に `2026-01-01,米,1,100` を渡すと
単位=1・数量=100 として **errors 空**で通っていた。納品取込では品目名まで別列へずれる。
→ 両parserへ `_colCountError()` を追加し、**値を読む前に**照合する。列が多い行も拒否。
エラー形は品目取込と同じ。列数が揃った既存の正常CSV（テンプレ含む）は影響なし。

### 3. 日付空欄の実データ行が無通知で消える

`parseResultSnapshots` は日付空欄なら品目名・数量があっても黙って `continue` していた。
他に正常行が1件あれば全体成功、`errors` も空。
→ 数量が入っている行は実データ行とみなし、日付空欄でも行エラーとして出す。
数量も空の行だけ従来どおり非データ行として飛ばす。
既存test「有効な日付行が無ければエラー」は入力が `,豚バラ,3` でまさにこのケースであり、
旧アサーションがバグ挙動を固定していたので更新した。

### 検証

- 追加10 testは修正前に **10 failed / 81 passed**。修正後は対象4 file 135 passed。
- `npm --prefix app test -- --run`: **94 files / 1110 passed**。
- `npm --prefix app run build`: 成功。
- `npm --prefix worker test`: **26 files / 545 passed**。
- `git diff --check` / 変更禁止fileの差分: いずれも出力なし。

### 次の再開地点

Codex の再レビュー。**migration 0012〜0016は本番未適用。`migration → Worker → App` の順で出す。**

## 2026-08-19 — CC第3修正セッション: develop統合と引継ぎ6（IMPORT-001）

- 担当: Claude Code。branch `claude/csv-past-stocktake-import-a0kjl3`。
  `develop@2060090`（DATA-001/DATA-002 の第1・第2修正セッション反映後）を merge した。
- **競合は docs 2file だけ。コードの競合はゼロ。**
  `e095282` 以降に develop が触った file と本branchが触った file の重なりは
  `session-log.md` と `task-list.md` の2つで、どちらも「先頭へ新記録を足す」形。
  **両方を残し、新しい順**に並べて解決した（記録の削除・書き換えなし）。
- merge直後の時点で App 94 files / 1087 passed、Worker 26 files / 545 passed。
  **統合そのものはtestを1件も壊していない。**

### 統合時にだけ現れる不具合を1件見つけて直した（DATA-002 引継ぎ6）

develop の `task-list.md` に「引継ぎ6（`409 legacy_import_unverified` の導線）は未対応で
`IMPORT-001` へ送る」と明記されていたため、統合と同時に対応した。

- migration 0015 の replay台帳で、取込は `legacy_import_unverified` /
  `import_record_missing` / `import_intent_conflict` の3つの 409 を返すようになった。
  **いずれもサーバー側にデータが残っていて、再送では解消しない**（復旧は取消→再取込だけ）。
- 本branchの 2026-08-16 の分類（409 = FAILED / retry不可）だけだと `canCancelBatch()` が
  `false` になり、**サーバーが「取り消してください」と言っているのに取消ボタンが消える**。
  develop単独でも branch単独でも起きず、統合したときにだけ出る。
- `classifyCommitError()` が3コードへ `mustCancel: true` を付け、`canCancelBatch()` が
  それを取消対象に含める。再試行は出さず、画面に
  「再試行では解消しません。取り消してから取り込み直してください」を `role="alert"` で出す。
- 結果不明ではない（サーバー上の状態は確定している）ので close は塞がない。
- サーバーの `body.retryable` は**再試行不可へ下げる方向にだけ**効かせる
  （恒久的statusを server 申告で再試行可へ格上げしない）。

### 検証

- 追加5 testは対応前に **5 failed**。対応後は対象2 file 71 passed。
- `npm --prefix app test -- --run`: **94 files / 1096 passed**。
- `npm --prefix app run build`: 成功。
- `npm --prefix worker test`: **26 files / 545 passed**。
- `git diff origin/develop --name-only -- worker app/src/App.vue …useStore.js …useDataImport.js …api.js`: 出力なし。
- `git diff --check`: 出力なし。

### 次の再開地点

Codex による独立レビュー。`WEB-001 = 進行中 / Codex`、`SEC-005 = 未着手 / Codex` は変更していない。
**migration 0012〜0016は本番未適用。`migration → Worker → App` の順で出す。**

## 2026-08-19 — DATA-001 再レビュー修正7（CONNECTING中の解散）

- 担当: Codex。branch `develop`、基準 `ee1ee6e`。User依頼により再レビュー残件を直接修正。
- `dissolveRoom()`呼び出し時点ですでに自動再接続中だと、socketはまだlocal変数だけにあり
  `_ws === null`だった。解散を送らず`ok:true`となり、Appのcleanup後に旧ルームへ遅延join
  できたため、CONNECTING socketを明示追跡して退出・account切替時にも閉じるようにした。
- 接続世代とsocket所有者を全callbackで再確認し、遅延`onopen`と旧Promiseが現在のroom stateを
  変更しないようにした。修正前の新規回帰は1 failed / 12 passed、修正後は対象16件成功。
- 検証: App 92 files / 1024 tests passed（連続2回）、build成功、
  Worker 26 files / 545 tests passed。Worker・migration差分なし。
- 未実施: 実D1・実browser・実機。migration 0012〜0016は未適用。

## 2026-08-18 — App第2セッション 再レビュー修正6（DATA-001）

- 担当: Claude Code。branch `claude/app-completion-sync-queue-z8etdp`、基準 `dea4785`。P1 1件。
  1. 自分の解散を示す `_hostInitiatedDissolve`（boolean）が、正常解散・中止のあとも true の
     まま残っていた。実 Worker の WS 解散（`RoomDO.js` の `case 'dissolve'`）は**送信元ホストを
     dissolved 通知から除外する**ため、正常に解散しても false へ戻す callback が呼ばれない。
     `connection_changed` で中止した場合も同じ。残ったフラグは、その後に別ルームへゲスト参加して
     そのルームが解散されたとき「自分が解散した」と誤認させ、session・在庫の片付けを飛ばす
     （別店舗のゲストデータが画面とメモリに残る）。**接続世代に紐づく self-dissolve token** へ
     置き換え、消費は1回だけ・同じ接続の通知だけを自分の解散として扱う。中止経路では明示的に破棄する
- 検証: App 92 files / 1021 tests passed（連続2回）、build 成功、Worker 26 files / 545 tests passed。
  修正前は新規回帰2件が失敗。
- 未実施: 実D1・実機・実browser。migration 0012〜0016 未適用。

## 2026-08-18 — App第2セッション 再レビュー修正5（DATA-001）

- 担当: Claude Code。branch `claude/app-completion-sync-queue-z8etdp`、基準 `a5dfcbd`。
  1. 接続世代を追加したのに解散処理自身と呼び出し側が使っていなかった。`_ws` への代入は
     onopen 後なので、同じ room へ張り直した CONNECTING の socket を検出できず、token を
     消して leaveRoom した後に接続が復活しうる。`dissolveRoom()` が開始時の接続世代を比較し、
     結果（`{ok,reason}`）を返す。App の2経路が戻り値・lifecycle・接続世代の3つを確認する
  2. `onStartPractice()` に解散待機後の account guard が無く、切替後に現在の在庫・セッションを
     消して練習モードへ入れた。`onSessionStart()` と同じ guard を入れた
  3. `App.authLoss.test.js` の「今日」が UTC 由来で、カレンダーのローカル日付判定とずれる
     時間帯（JST 00:00〜09:00・UTC+14 終日）で2件失敗していた。ローカル日付キーへ変更し、
     UTC+14 / UTC-11 / JST の3TZで App 全体の成功を確認
- 検証: App 92 files / 1018 tests passed（連続2回＋UTC+14でも全件）、build 成功、
  Worker 26 files / 545 tests passed。修正前は useSync 3件 / App.complete 2件 / App.authLoss 2件が失敗。
- 記録: 履歴カレンダーが「今日」をローカル日付・セッション所属日を UTC 日付で決めている
  製品側の不整合（JST 早朝の完了が前日セルに並ぶ）を DATA-001.md へ残した。今回は未修正。

## 2026-08-18 — App第2セッション 再レビュー修正4（DATA-001）

- 担当: Claude Code。branch `claude/app-completion-sync-queue-z8etdp`、基準 `e87080f`。P1 3件。
  1. **前回修正の回帰**: `_ws !== socket` の中止条件が広すぎ、Worker が解散直後に socket を
     閉じる正常経路まで「つなぎ替え」と誤判定していた。hosting 状態・token・再接続タイマーが
     残り、解散したルームを作り直す。中止は「別の生きた接続へ張り替わった」場合だけに絞った
  2. 解散の3.5秒後処理が App の session 世代しか見ておらず、**同じ session のまま新ルームを
     作る**経路で新ルームの作業を消せた。`useSync` に接続世代を追加し、両方を確認する
  3. `dissolveRoomRemote()` が待機後に現在の shopCode から key を作り直しており、
     店舗切替で別店舗の host token を消せた。key も待機前に確定し、token 一致時のみ削除。
     `onSessionStart()` も await 後に lifecycle を再確認する
- 検証: App 92 files / 1012 tests passed（連続2回）、build 成功、Worker 26 files / 545 tests passed。
  修正前は useSync 5件 / App 1件が失敗。
- 未実施: `onSessionStart` の切替後guardの end-to-end 回帰（SessionListPage 経由）。
  実D1・実機・実browser。migration 0012〜0016 未適用。

## 2026-08-18 — App第2セッション 再レビュー修正3（DATA-001）

- 担当: Claude Code。branch `claude/app-completion-sync-queue-z8etdp`、基準 `c2cb281`。
- P1 3件・P2 1件を修正。**`app/src/composables/useSync.js` を変更**（同期層の内側でしか
  直せない競合のため）。Worker は未変更。
  1. `dissolveRoom()` が 150ms 待機後にグローバルな `_ws`/`state`/`shopCode` へ作用し、
     つなぎ替え後の新しい token・socket・ルーム状態を壊していた。同期層内で
     socket/shop/room/type を捕まえて待機後に照合する。**実 useSync を使う回帰test**を追加
  2. `_startFresh()` が未確定の durable intent を消しており、同一 session の resume で
     再送用 body を失っていた。同じ店舗・同じ session なら保持する
  3. `dissolved` の3.5秒後処理が無条件だったため、待機中に開始した新セッションを消せた。
     lifecycle を capture してタイマー実行時に再確認し、unmount で解除する
  4. 不一致・欠落 `session_ended` が guest 分岐へ進んで現在のルームを退出していた。
     即 return する（自分のセッションを持たないゲストは従来どおり退出）
- 検証: App 92 files / 1004 tests passed（連続2回）、build 成功、Worker 26 files / 545 tests passed。
  修正前は useSync 2件 / useSession 1件 / App 3件が失敗。
- 未実施: 実D1・実機・実browser。migration 0012〜0016 未適用。

## 2026-08-18 — App第2セッション 再レビュー修正2（DATA-001）

- 担当: Claude Code。branch `claude/app-completion-sync-queue-z8etdp`、基準 `a20db8b`。
- 再レビューの重大2件・中2件を修正。`worker/**` は変更していない。
  1. `session_ended` が完了APIの await 後に stale を確認せず、切替後のルームを
     `leaveRoom()` していた。開始時の lifecycle token と host/guest を捕まえて判定する
  2. `_finishSession` が `dissolveRoom()` の await 後に再確認せず、現在のセッションへ
     `clearSession()` などを実行していた
  3. `_startFresh()` が世代を進めておらず、同一店舗・同一 sessionId の `resume()` で
     旧 Promise が失効しなかった。account 世代を lifecycle 世代へ改め、
     `captureLifecycle()` / `isLifecycleStale()` を公開
  4. `intent_not_persisted`（端末へ保存できず送信していない）を専用文言へ
- 検証: App 91 files / 994 tests passed（連続2回）、build 成功、Worker 26 files / 545 tests passed。
  修正前は App 4件 / useSession 4件が失敗。
- 未実施: 実D1・実機・実browser。migration 0012〜0016 未適用。

## 2026-08-18 — App第2セッション 再レビュー修正（DATA-001）

- 担当: Claude Code。branch `claude/app-completion-sync-queue-z8etdp`、基準 `e81fad1`（ancestor確認済み）。
- 再レビューの重大2件・高1件を修正。`worker/**` は変更していない。
  1. **完了payloadをAPI送信前にdurable化**。旧実装は catch の中で保存していたため、
     送信中にPC・タブが落ちると送った body が残らなかった。保存できなければ完了APIを呼ばない
     （`body:null` marker への切り下げも廃止）
  2. **generation照合を全promise chainへ**。`verifyCompletion()` / `markActive()` /
     `touch()` の遅延送信と App 側の await 後にも追加。旧店舗の応答が新店舗の
     session・draft・history・画面を変更しない
  3. **verifyCompletion が intent を早期削除しない**。削除は端末側の確定が終わったあと
     `ackCompletionFinalized()` だけ。API成功と端末の確定完了を分離した
- 検証: App 91 files / 986 tests passed（連続2回）、build 成功、Worker 26 files / 545 tests passed。
  修正前は useSession 23件 / App 6件が失敗。
- 未実施: 実D1・実機・実browser。migration 0012〜0016 未適用のため
  migration → Worker → App の順で出す必要がある。

## 2026-08-17 — App第2セッション レビュー指摘の修正（DATA-001）

- 担当: Claude Code。branch `claude/app-completion-sync-queue-z8etdp`、基準 `c3141e6`。
- 独立レビューの5点（重大3・中2）を修正。`worker/**` は変更していない。
  1. 完了結果不明と完了要求を端末へ永続化（再読込しても同じ body で再送できる）。
     `markActive()` の API エラー握り潰しも解消
  2. 完了要求に generation / shopCode / sessionId を捕捉し、応答適用の直前に照合。
     旧アカウントの応答で現在の履歴・draft を壊さない
  3. 送信 body を deep clone して固定。完了中・結果不明中は入力をロック
  4. 件数上限を Worker と同じ 500 / 2,000 へそろえ、API を呼ぶ前に拒否
  5. `session_ended` の sessionId を検証（別セッション・不明は完了させない）
- 付随: 409 の test が共有モックの実装を差し替えており、以降の全 test が 409 を受けていた。
  フラグ方式へ置き換え（単体では通るのに全体で落ちる状態を解消）。
- 検証: App 91 files / 962 tests passed（連続2回）、build 成功、
  Worker 26 files / 545 tests passed（未変更）。
- 未実施: 実D1・実機・実browser。migration 0012〜0016 は未適用のため
  migration → Worker → App の順で出す必要がある。

## 2026-08-17 — App第2セッション: 完了ライフサイクルと同期キュー（DATA-001）

- 担当: Claude Code。branch `claude/app-completion-sync-queue-z8etdp`、基準HEAD `develop@77d6d48`。
- **App側のみ**。`worker/**`・migration・取込 parser/UI は変更していない（`git diff --name-only -- worker` は空）。
- 第1修正セッションの4 commit（`38cf1cc` / `1d3cbfa` / `e9b1dbe` / `77d6d48`）と
  それ以前（`39f7776` / `e952550`）がHEADの祖先であることを確認してから着手した。
- commit / push / deploy / migration適用は**していない**。
- 状態は `DATA-001` を `進行中` → `レビュー待ち / Claude Code` へ戻すまで。
  `DATA-002` / `IMPORT-001` / `WEB-07` の状態は変更していない。

### 直したこと（詳細と証拠は [`tasks/DATA-001.md`](tasks/DATA-001.md)）

1. 完了中・結果不明中に `active` を書き戻さない（`completionUnknown` / Home・Back・切替・破棄のguard）。
2. 本番の完了経路を `services/sessionCompletion.js` へ集約し、**stock/order 別の確定契約**へ合わせた。
   order は `{ itemCount }` だけを送り、在庫入力があっても snapshot / inventory を送らない。
   `takenAt` は `snapshot.date` から1か所で決める。
3. queue再送と直接保存を同じ key 単位レーンへ入れ、遅れて決着した古い版が新しい版を上書きしない。
4. generation / shopCode / 認証主体を**論理要求の作成時**に確定させ、旧店舗の要求が新トークンで飛ばない。
5. snapshot の ack を `localRev` で「送った版」に限定し、送信中に作られた訂正を clean にしない。
6. `clearAuthBlock()` を await 可能にし、再ログインは drain → pull の順。失効直前のデバウンス
   保存は旧店舗の durable queue へ確定する。
7. App mount test の初回 import を `beforeAll` へ移し、既定5秒 timeout の枯渇要因を消した。
8. **完了の再送は同じ body を送る**。server の fingerprint は canonical snapshot 全体から
   作られるため、組み立て直すと `409 completion_intent_conflict` で確定できなくなる。

### DATA-002「Appへの引継ぎ7点」

1〜5・7 は対応済み。**6（`409 legacy_import_unverified` の導線）は未対応**で、
過去棚卸取込UIが本セッションの変更禁止範囲のため第3セッション（IMPORT-001）へ送る。

### 検証

- `npm --prefix app test -- --run` … 91 files / 935 tests passed（連続2回とも成功）
- `npm --prefix app run build` … 成功（PWA precache 17 entries / 2570.69 KiB）
- `npm --prefix worker test` … 26 files / 545 tests passed（未変更・回帰確認）
- `git diff --check` 指摘なし / `git diff --name-only -- worker` 出力なし

### 未実施・次の一手

- 実D1・実機・実browserは未確認。migration 0012〜0016 は未適用のまま。
- **適用順序に注意**: App をこの契約へ合わせたため、migration 未適用の Worker では
  完了が動かない。migration → Worker → App の順で出す判断が release gate 側に要る。
- `409 completion_intent_conflict` の復旧導線（session 作り直し）は未実装。

## 2026-08-17（追加3） — DATA-002 独立レビュー指摘（replace の孤児 claim / cancel の transaction）

- 担当: Claude Code。branch `claude/data-002-worker-d1-api-bogzyq`、基準HEAD `e9b1dbe`（clean）。
- 対象は Worker/D1・関連test・現行文書のみ。第2/第3セッションの差分には触れていない。
- **`app/src` は差分ゼロ**。状態は `レビュー待ち / Claude Code` のまま（完了にしない）。
- commit / push / deploy / migration適用は**していない**（追加指示待ち）。

### 直したこと

1. **HIGH: replace で旧 claim・旧台帳が残っていた。**
   上書き削除が `inventory_lines` / `store_history` / `sessions` の3種類だけだったため、
   通常棚卸を置換すると旧 `session_completions` が孤児になり、取込済みを別batchで置換すると
   旧 `import_batch_requests` が残って旧バッチの再送が `import_record_missing` になっていた。
   `session_completions` と `import_batch_requests` を加えた**5文**にし、
   session 本体より先に claim・台帳を消すようにした。作成中の新しい台帳は対象外。
2. **MEDIUM: 取消の対象取得が transaction 外だった。**
   SELECT を削除と同じ `db.batch()` の先頭へ移し、`removed` / `sessionIds` を batch 結果から作る。
   直前に同じバッチの取込が確定しても「消したのに `removed: 0`」を返さない。
   事前 SELECT の失敗も `cancel_failed` / `retryable: true` に含まれるようになった。
3. **LOW: migration 0015 のコメントが現行契約と不一致**だった。SQL は変えず、
   台帳なし既存取込を `409 legacy_import_unverified` で fail-closed にする現行契約へ書き直した。

### 修正前に失敗を確認したtest

追加した回帰test のうち **6件**が `e9b1dbe` で失敗（すべて `test/ledgerLifecycle.sqlite.test.js`）。
seed で `status='completed'` を直接 INSERT しても claim は作られないため、
**実API経路**（`handleSessionComplete` / `handlePastImportCreate`）で claim・台帳を作る test にしている。

### 検証

| command | 結果 |
|---|---|
| `npm test -- test/ledgerLifecycle… test/pastImportIdempotency… test/pastImport…` | 3 files / 83 passed |
| `npm test -- test/migrationFresh… test/migrationUpgrade… test/migrationScript…` | 3 files / 20 passed |
| `npm test`（worker 全体） | **26 files / 545 tests passed** |
| `npm --prefix app test -- --run` | 87 files / 875 passed |
| `npm --prefix app run build` | 成功 |
| `git diff --check` / `git diff --name-only -- app/src` | 指摘なし / 出力なし |

D1実行上限の実測: 取込 500行+replace 50件 = **40 queries / 99 bound params**、取消 = **6 / 3**、
棚卸完了 500品目 = **35 / 99**。replace が3文→5文になり取込は 38 → 40 queries（Free 50 内）。

### 次の再開地点

Codex の再レビュー。App 側の追随は 7 点のまま（[`tasks/DATA-002.md`](tasks/DATA-002.md)）。
migration 0012〜0016 は本番未適用。

## 2026-08-17（追加2） — DATA-002 再レビュー HIGH 2件の修正

- 担当: Claude Code。branch `claude/data-002-worker-d1-api-bogzyq`、基準HEAD `1d3cbfa`。
- 追加差分のみ（amend / reset / rebase なし）。**`app/src` は差分ゼロ**。
- 追加した回帰test **13件が `1d3cbfa` で失敗**することを確認してから修正した。

1. **完了 fingerprint の対象を canonical snapshot 全体へ広げた。**
   旧実装は明細（品目名・数量・単位・単価・小計）と件数・合計・日付しか見ておらず、
   `code` / `category` / `flagged` / `lotSize` / `tagA` / `tagB` / `entryLog` / `auditLog` /
   `participants` / `flaggedItems` / `axisNames` / `locked` を変えた再送が replay 成功していた
   （**サーバー旧内容・端末新内容**の食い違い）。
   意図的な除外は `savedAt`（server時刻・毎回変わる）と `activeMs`（再試行で増える）の2つだけで、
   理由をコードと `api-design.md` に明記した。
2. **台帳を持たない既存取込を 409 `legacy_import_unverified` で閉じた。**
   `existing && !ledger` をそのまま upsert していたため、0015 適用前のバッチや
   台帳だけ消えた状態を別内容で黙って上書きできた。推測で fingerprint を作らず fail-closed にし、
   復旧経路を **`DELETE /imports/:batchId` → 再取込**へ一本化した。
   これに伴い「history を消したら直接再取込できる」という前回の記述は取り下げた。

合わせて、切替境界の文書矛盾（「操作停止が必須」と「発生しても許容」の並記）を解消し、
`api-design.md` / `spec.md` / `web-release-readiness.md` の最終照合を 2026-08-17・0016 まで へ更新、
新しい 409/400 の HTTP 伝播と `_status` 非露出を `test/routerStatus.sqlite.test.js` へ追加した。

### 検証

| command | 結果 |
|---|---|
| `npm --prefix worker test` | 26 files / 534 tests passed |
| `npm --prefix app test -- --run` | 87 files / 875 tests passed |
| `npm --prefix app run build` | 成功 |
| `git diff --check` / `git diff --name-only -- app/src` | 指摘なし / 出力なし |

### 次の再開地点

App セッションでの追随は **7点**（前回5点 + `legacy_import_unverified` の案内、
完了再送時に snapshot を変えない扱い）。詳細は [`tasks/DATA-002.md`](tasks/DATA-002.md)。
その後 Codex が全差分を独立レビューする。

## 2026-08-17 — DATA-002 第1修正セッション 追加分: 再レビュー指摘（Worker / D1）

- 担当: Claude Code。branch `claude/data-002-worker-d1-api-bogzyq`、基準HEAD `38cf1cc`（clean・ancestor確認済み）。
- `38cf1cc` は既にローカル develop へ fast-forward 済みのため、**amend / reset / rebase せず追加差分**で修正した。
- 範囲は `worker/**` と現行API/DB/削除/release文書のみ。**`app/src` は差分ゼロ**。
- 状態は `進行中` → `レビュー待ち / Claude Code`。`DATA-001` / `IMPORT-001` / `WEB-001` / `WEB-07` は変更していない。
- commit / push / deploy / migration適用は**していない**。

### 直したこと（詳細は [`tasks/DATA-002.md`](tasks/DATA-002.md) の 2026-08-17 節）

1. **汎用PUTで完了契約を迂回できないようにした**。`PUT /sessions/:id` に `completed` を送ると
   409 `use_complete_endpoint`（書込み0件）。lines も history も無い completed session を作れなくした。
2. **棚卸日を `takenAt` ひとつに統一**。`snapshot.date` が違えば 400 `snapshot_date_mismatch`。
   明細が 08-09・履歴が 08-10 という分裂した記録を作れなくした。
3. **完了は最初の1要求だけが確定できる**（**migration 0016 追加・未適用**）。
   確定内容は server 生成 fingerprint として `session_completions` に残る。
   同一 intent の再送は保存済み結果、内容の違う再送は 409 `completion_intent_conflict`。
4. **時刻 marker を廃止**。`ended_at === now` は排他 token にならないため、
   claim（PRIMARY KEY + fingerprint）へ全文を従属させる形へ統一した。取込も同じ形。
   これに伴い `MAX_REPLACE_SESSIONS` を 40 → **50 へ戻した**（旧guard形状のための制約が消えたため）。
5. **stale ledger / claim で嘘をつかない**。replay 成功には session と `store_history` の実在を要求。
   あわせて `DELETE /sessions/:id` を5文の1 batch（lines / history / 台帳 / claim / session）にし、
   `DELETE /history/:sessionId` と `DELETE /imports/:batchId` も台帳・claim を整合させた。
6. **account削除**に `session_completions` を追加し、testで両店舗をseedして境界を固定。
7. **migration切替境界**を `web-release-readiness.md` に明文化（preflight件数・許容判断・maintenance条件）。
8. 現行文書（`ci-cd.md` / `spec.md` / `README.md` / `api-design.md` / 削除contract / roadmap）の
   migration記載を 0010〜0016 へそろえた。

### 修正前に失敗を確認したtest

新規2ファイル（`test/completionClaim.sqlite.test.js` / `test/ledgerLifecycle.sqlite.test.js`）と
`accountDeletion.test.js` の追加分、計41件のうち **23件が `38cf1cc` で失敗**。修正後は全件成功。

### 検証

| command | 結果 |
|---|---|
| `npm --prefix worker test` | 26 files / 511 tests passed |
| `npm --prefix app test -- --run src/App.complete.test.js` | 13 passed |
| `npm --prefix app test -- --run` | 87 files / 875 tests passed（**既知のtimeoutは再現せず**） |
| `npm --prefix app run build` | 成功 |
| `git diff --check` | 指摘なし |
| `git diff --name-only -- app/src` | 出力なし |

D1実行上限の実測（実SQLiteハーネス・batch内statementも1本ずつ計上）:
完了500品目 = 35 queries / 99 bound params、取込500行+replace50件 = 38 queries / 99 bound params。

### 次の再開地点

**App セッションで5点の追随が必要**（Worker差分だけを統合すると壊れる）。

1. `App.vue:859` `setSessionEndedCallback` — snapshot なしの `completeSessionD1`
2. `App.vue:1381` `onGoHome` の完了済み経路 — 同上
3. order モードの完了 — `{ itemCount }` を送る分岐（`useAuth.completeSession()` に引数追加）
4. `snapshot.date` と `takenAt` を一致させる（不一致は 400 `snapshot_date_mismatch`）
5. 409 `completion_intent_conflict` / `use_complete_endpoint` の扱い（前者は retryable ではない）

その後 Codex が全差分を独立レビューする。`SEC-005` は `未着手 / Codex` のまま。

## 2026-08-16 — DATA-002 第1修正セッション: Worker / D1 / API整合性

- 担当: Claude Code。branch `claude/data-002-worker-d1-api-bogzyq`、開始HEAD `e095282`（clean・ancestor確認済み）。
- 範囲は `worker/**` と現行API/DB/リリース手順文書のみ。**`app/src` は差分ゼロ**（`git diff --name-only -- app/src` が空）。
- 状態は `進行中` → `レビュー待ち / Claude Code`。`完了` / `WEB-07` 通過にはしていない。
- commit / push / deploy / migration適用は**していない**。

### 直したこと

詳細と証拠は [`tasks/DATA-002.md`](tasks/DATA-002.md)（2026-08-16 節）。要点だけ:

1. **stock / order で完了契約を分けた。** 種別を見ずに snapshot 必須にしていたため、
   在庫入力を伴わない発注セッションは `400 snapshot_required` で**完了できなかった**。
   order は `store_history` を書かず、正本は `orders` / `order_lines`（App の完了一覧も order を除外している）。
2. **stock の snapshot を server 側で canonical 化。** `sessionId` / `date` / `type` / `items` /
   `itemCount` / `totalValue` は client 値を採らない。明細と items が食い違えば `400 snapshot_mismatch` で
   何も書かない。inventory 0件は `400 empty_inventory`。任意 metadata は allowlist + 件数・長さ制限。
3. **completed からの巻き戻しを禁止。** 完了応答を取りこぼした端末の遅れた `touch()` が
   `status='active'` / `ended_at=NULL` へ戻していた。`409 session_completed`。
4. **過去棚卸 replace の応答喪失からの復帰。** 要求台帳（**migration 0015・未適用**）に
   「日付・明細・上書き対象集合」の SHA-256 指紋を残し、まったく同じ再送は置換対象が削除済みでも
   同じ成功を返す。内容が違えば `409 import_intent_conflict`。
5. **replace 権限の TOCTOU を閉じた。** preflight SELECT を削除権限の根拠から外し、
   「同店舗・同日・completed・stock がちょうどN件」を全 delete/insert 文の WHERE へ埋めた。
   1件でも外れたら全文0行。`MAX_REPLACE_SESSIONS` は bound parameter 上限から 50 → **40**。
6. **`POST /sessions` の不正 type が HTTP 400 で返るようにした**（router が 200 で包み直していた）。
7. **revision 応答を自分の write と一致させた。** 読み戻し SELECT を書き込みと同じ `db.batch` へ入れ、
   読み戻せない場合は成功にせず 503。
8. **migration 0014 / 0015 をリリース手順へ反映**（`web-release-readiness.md` / `api-design.md` /
   `project-status.md` / `task-list.md`）。適用順・sentinel・rollback可否・後方互換を明記。

### 修正前に失敗を確認したtest

新規3ファイル（`test/sessionContract.sqlite.test.js` / `test/routerStatus.sqlite.test.js` /
`test/pastImportIdempotency.sqlite.test.js`）42件のうち、**25件が修正前の実装で失敗**した。
修正後は42件すべて成功。

### 検証

| command | 結果 |
|---|---|
| `npm --prefix worker test` | 24 files / 481 tests passed |
| `npm --prefix app test -- --run` | 87 files / 875 tests passed |
| `npm --prefix app run build` | 成功 |
| `git diff --check` | 指摘なし |
| `git diff --name-only -- app/src` | 出力なし |

### 次の再開地点

**App セッションで3経路の追随が必要**（このWorker差分だけを統合すると壊れる）。

1. `App.vue:859` `setSessionEndedCallback` — snapshot なしで `completeSessionD1` を呼んでいる
2. `App.vue:1381` `onGoHome` の完了済み経路 — 同上
3. order モードの完了 — `{ itemCount }` を送る形へ分岐が必要（`useAuth.completeSession()` に引数追加）

必要な payload 例は [`tasks/DATA-002.md`](tasks/DATA-002.md) の「Appへの引継ぎ」に記録済み。
その後 Codex が全差分を独立レビューする。`SEC-005` は `未着手 / Codex` のまま（触れていない）。

## 2026-08-16 — CC第3修正セッション: CSV・過去棚卸取込のデータ品質（IMPORT-001）

- 担当: Claude Code。branch `claude/csv-past-stocktake-import-a0kjl3`、開始HEAD `e095282`（= `develop`）。
- 第1・第2修正セッションの成果（`e952550` / `39f7776` / `3f0f9c2`）が祖先であることを確認してから着手した。
  開始時の working tree は clean。既存差分の reset / stash / checkout はしていない。
- 状態は **レビュー待ちまで**。`完了` / `WEB-07` 通過 / release可としていない。
- commit / push / deploy / migration適用は**していない**（Userの明示指示待ち）。
- **変更禁止file（`worker/`、`App.vue`、`useStore.js`、`useDataImport.js`、`api.js`）に差分なし**を
  `git diff --name-only` で確認済み。

### 直した6点（詳細と証拠は [`tasks/IMPORT-001.md`](tasks/IMPORT-001.md)）

1. **ヘッダ有無の推測を選択値へ反映しない。** `CsvMapperModal` は「1行目のセルが `品目` `商品` 等を
   含むか」の推測を**既定値として採用**していた。`商品A,箱,120` `品目セット,箱,120` のような
   データ行が見出しとして確定し、1品目目が黙って消えていた。初期値を未選択にし、
   推測は `参考:` の文言だけにして、選ぶまで取込を実行させない。
2. **結果不明が残るあいだは過去棚卸モーダルを閉じさせない。** 以前は保存中・取消中だけを塞いでいた。
   確定後に結果不明が残っていても閉じられ、`importBatchId` と計画が画面から消えて
   再試行も取消もできなくなっていた。閉じるボタン・Escape・オーバーレイの3経路とも `close` を出さない。
   `useDataImport.js` は編集せず、close を発生させない側だけで解決した。
3. **HTTP失敗と通信結果不明を分けた。** `commitPastImport` は例外を無条件に「結果不明」にしていたが、
   `api.js` は非2xxでも throw する。`status` が数値なら FAILED、無ければ UNKNOWN。
   400/409/413 は retry不可、408/429/5xx は retry可。`retryableDates` が `retryable:false` を返さない。
4. **数量・単価の上限をclientでも拒否。** Worker の `constants.js` を読み取り専用の正本として
   `utils/importLimits.js` へ写し、`readNumericCell` へ `max` を追加。定数は worker と直接照合するtestで固定。
5. **通貨記号は先頭1個だけ。** `¥` `￥` を任意位置から削っていたため、`1¥2` が 12、`100￥` が 100 と、
   元のセルに無い数値になっていた。
6. **実在する日付だけを受理。** 月日の範囲だけを見ていたので `2026-02-30` `2025-02-29` `2026-04-31` が
   通っていた。`utils/importDate.js` へ共通化し、ISO化後に UTC で round-trip して確認する。
   `deliveryImportParser.normalizeDate` の export 互換は維持した。

### 検証

- 対象10 test file: 修正前 **35 failed / 175 passed**（＋ 新規2 fileは対象module未作成で読み込み失敗）
  → 修正後 **10 files / 222 passed**。
- `npm --prefix app test -- --run`: **89 files / 938 passed**（baseline `e095282` は 87 files / 875 passed）。
- `npm --prefix app run build`: 成功。
- `npm --prefix worker test`: **21 files / 437 passed**（worker無変更・回帰確認）。
- `git diff --check`: 出力なし。

### 未実施・残risk

- **ブラウザー更新・強制終了をまたぐ永続化は対象外。** リロード・タブclose・強制終了では
  `importBatchId` と計画が失われ、サーバーに残ったかもしれないバッチを取り消せない。
  退避先の設計は `storageKeys.js` とaccount切替時の消去対象に関わるため所有範囲外。
- 実D1（client と server の境界値の一致、migration 0013 適用）、実browser / 実機は未確認。
- `utils/textParser.js`（音声・貼付入力）はCSV入口ではないため上限を入れていない。

### 次の再開地点

Codex による第1〜第3修正セッション全差分の独立レビュー。
`WEB-001 = 進行中 / Codex`、`SEC-005 = 未着手 / Codex` は変更していない。

## 2026-08-10 — CCレビュー修正 第3セッション: 取込のデータ品質と最終統合（IMPORT-001）

- 担当: Claude Code。台本は [`cc-session-plan.md`](cc-session-plan.md) の第3セッション。
- branch `claude/branch-operational-status-2lwwwu`、開始HEAD `ae9c03b`（第2セッションの成果）。
- 状態は **レビュー待ちまで**。Codex承認前に `完了` / `WEB-07` 通過 / release可としていない。
- commit / push / deploy / migration適用は**していない**（Userの明示指示待ち）。

### 開始時の前提確認で一度停止した

- 指示の「前提HEAD」がプレースホルダのまま置換されておらず、照合対象が無かった。
- 当初の checkout は `claude/cc-review-session-3-1s4jxj@cda7b62`（= `main` 相当）で、
  第1・第2セッションの成果も `cc-session-plan.md` も `tasks/` も**含まれていなかった**。
  `git merge-base --is-ancestor ae9c03b HEAD` は非祖先。
- 実装を開始せず報告し、Userの確認後に `claude/branch-operational-status-2lwwwu` を
  checkout（working tree は clean・破棄した差分ゼロ）してから着手した。

### 実装

詳細と証拠は [`tasks/IMPORT-001.md`](tasks/IMPORT-001.md)。要点だけ:

1. **CSVの字句解析を `app/src/utils/csvParse.js` へ一本化。** 品目取込・棚卸結果取込・納品取込が
   同じ欠陥を持つ1行パーサを3本持っていた。`"1,200"` が `1` に、`5"" 皿` が `5 皿` になり、
   未閉じ引用符は黙って通っていた。
2. **不正数値を「既存値を維持」にすり替えない。** その行をエラーにし、同じ行の他の列も適用しない。
   列数不一致・ヘッダ無しも同様に行番号・列・理由つきで出す。
3. **エイリアス衝突を非破壊に。** 既存品目の別名を無言で奪っていた。既定では奪わず、
   画面で「既存を優先／ファイルを優先」を選ぶまで取込ボタンを無効にする。
4. **プレビューと取込が同じ計画オブジェクトを使う。** 以前は解析と計画を2回組み直していた。
5. **過去棚卸取込を sessionId モデルへ接続。** 日付キーの直接書き込みと投げっぱなしのD1保存をやめ、
   取込前プレビュー → サーバー保存確認 → 端末反映の順にした。`importBatchId` 単位の取消を
   server側で原子的・冪等に実装（**migration 0013 追加・適用は未実施**）。

### 文書の統合

- 旧計画（S1〜S8）を `36fc8ad`（`2e14e23` の親）から
  [`archive/cc-session-plan-s1-s8-2026-08-08.md`](archive/cc-session-plan-s1-s8-2026-08-08.md) へ履歴保存し、
  本ログと `proposals.md` に残っていた「`cc-session-plan.md` の S2/S3/S4/S6 節」への参照を
  そちらへ向け直した。**同名pathの現行計画に旧sectionがあるように見せない**ため。
- `UI-002` は実体file を持たず `UI-001.md` へ誤リンクしていた。新IDを作らず `UI-001` へ統合した。
- `task-list.md` / `web-release-readiness.md` の「過去棚卸取込は Phase 3 完了後」という
  scope外記述を、**記録を消さずに**前提置換の追記つきで更新した。前提だった
  「履歴が日付キーのまま」は第2セッションの migration 0012 で解消済み。
  公開scopeへ正式に含めるかは Codex再レビューと PM判断に残す。
- `api-design.md` に取込API 2本と、`history` 系の現状（0012以降）を反映した。

### 未実施

- 実D1（migration 0013 適用・statement数と実行時間の計測）。
- 実ブラウザ / 実機での 375px・1024px以上・keyboard の目視確認。
- 大量データ（500行上限付近・複数日×多品目）の実測。

### 次の再開地点

Codex による第1〜第3セッション全差分の独立レビュー。
`SEC-005` は未着手 / Codex のまま（第3セッションでは触れていない）。

## 2026-08-09 — CCレビュー修正 第1セッション: 完了失敗と保留保存の安全化

- 担当: Claude Code。台本は develop の [`cc-session-plan.md`](cc-session-plan.md)（`develop@726d819`）第1セッション。
- branch `claude/branch-operational-status-2lwwwu`、開始HEAD `6eac2a4`（`8ff46af` の子孫）。
- **範囲はApp側のみ**。`worker/`・履歴schema・品目取込・`SEC-005` には触れていない。

### 開始前のtask board統合（計画「第1開始前」）

- `IMPORT-001` を `未着手 / Claude Code` で追加（task fileは `develop@726d819` から取得）。
- `WEB-001 = 進行中 / Codex`、`SEC-005 = 未着手 / Codex` を維持。
- `DATA-001` / `DATA-002` は `進行中 / Claude Code`（`6eac2a4` で設定済みを確認）。
- `DATA-002.md` に 2026-08-09 の前提再置換を追記（旧判断は削除せず残置）。

### §1 完了失敗時に作業状態を保持（DATA-001）

- `completeSessionD1()` が `ok:false` でも、後片付けを全部実行していた。**サーバーに完了が
  無いのに端末のdraft・pendingSessionが消え、ホストではルームまで解散**していた。
- `_finishSession()` を分離し、**完了が成立したときだけ**終了通知・解散・draft削除・clear・
  遷移・完了analyticsを実行する。失敗時は `reopenSession()`（`useInventory` に追加）で
  読み取り専用を解除するだけにして、同じ画面の同じボタンから再試行できるようにした。
- 二重押しガード `completing` を追加（ボタンも `:disabled`）。
- **併せて未定義参照を除去**: ソロ完了経路の `sessionsYear.value = completedYear` は
  `sessionsYear` も `completedYear` も定義が無く、`cf25ae5` 以来 solo 完了で
  `ReferenceError` を投げていた（`clearSession()` の後・遷移の前で throw）。行ごと削除。

### §2 pending queueをlatest-winsかつ直列化（DATA-002 Phase 2）

- 保存対象を `kind + shopCode + resourceId` で識別する Map へ置き換え、要求ごとに `rev` を採番。
  成功時はその rev 以下の待ち項目を破棄し、**古いAの再送で新しいBを巻き戻さない**。
- drain を1本に束ね、起動・接続復帰・タイマー・手動が同時でも二重送信しない。
- 失敗を `auth`（401/403・停止）/ `permanent`（400番台・捨てて提示）/ `retry`（429・5xx・断）へ分類。
  再ログイン用に `clearAuthBlock()` を追加。

### §3 永続化失敗を隠さない

- snapshot 20件・order/movement 200件の `slice` を撤廃。溢れた分をメモリにだけ残して
  「端末に保存済み」と表示していたのをやめ、`unpersistedCount` として表に出す。
- バナーは**未保存の警告をオフラインより優先**。`role="status"` + `aria-live` を常設し、
  端末にも保持できていないときだけ `assertive`。拒否された保存は `rejectedSaves` で提示。

### 修正前に失敗を確認したtest

`src/App.complete.test.js` を追加し、修正箇所を一時的に旧挙動へ戻した状態で実行して
**6件中4件が失敗**することを確認してから修正を戻した。

### 検証

| command | 結果 |
|---|---|
| `cd app && npx vitest run src/App.complete.test.js` | 6 passed |
| `cd app && npx vitest run src/composables/useStore.queue.test.js` | 12 passed |
| `cd app && npx vitest run src/components/ConnectionBanner.test.js` | 11 passed |
| `cd app && npm test` | **74 files / 648 passed** |
| `cd app && npm run build` | 成功（CSS 234.43kB / gzip 37.33kB） |
| `cd worker && npm test` | 17 files / 251 passed（**未変更・回帰確認のみ**） |

- migration: **なし**（schema変更なし）
- 未実施: 実browser・実device・実D1での確認。commit / push / deploy は行っていない。

### 残っているリスク

- `rejectedSaves` は種別と件数を出すだけで、拒否された内容そのものは復元できない。
- localStorage が全く使えない環境では、依然としてアプリを閉じると未送信分が失われる。
- 完了失敗時にローカルのスナップショットは作られたまま残る（入力値保護のため意図的）。
  sessionId 単位の整合は**第2セッションの範囲**。
- `task-list.md` から旧 `cc-session-plan.md`（S1〜S8）への参照は、`2e14e23` の削除により
  このbranchでは切れたまま。**docs の3-way統合は第3セッションの範囲**なので触れていない。

### 次の再開地点

第2セッション（sessionId中心の履歴整合と完了原子性）。本セッションのcheckpoint commitを
User が承認した後、そのcommitを含むHEADから開始する。

## 2026-08-09 — CC 第1〜3セッション完了（S1〜S8 全実装）

- 全8タスク実装完了: S1（記録更新）→ S2（止血）→ S3（Phase 1）→ S4（原子性）→ S5（マージ化）→ S6（プレビュー）→ S7（可視化）→ S8（画面再編）
- 共有ブランチ: `claude/branch-operational-status-2lwwwu`（3セッション共用）
- 最終commit: `36fc8ad`（S4 の最後のシクル）
- 検証: App 619 tests / 71 files、Worker 251 tests / 17 files、ビルド成功。**migration なし**。
- 次のステップ: 旧 `cc-session-plan.md`（S1〜S8）を削除（完了条件により恒久docs へ残さない）。
  **2026-08-10 追記**: 削除直前版を[履歴スナップショット](archive/cc-session-plan-s1-s8-2026-08-08.md)として保存し、参照切れを解消した。
  Codex レビュー待ち（DATA-001 / DATA-002 は状態「レビュー待ち」）。
  SEC-005 着手可（Codex 着手待ち）。

## 2026-08-09 — CCレビュー修正を3セッションへ再編

- 担当: Codex。CC branch `claude/branch-operational-status-2lwwwu@8ff46af`をread-only reviewした結果を、
  既存の一時文書`cc-session-plan.md`へ反映した。App / Worker実装は変更していない。
- 修正順を①完了失敗・pending保存、②sessionId・原子性・D1、③品目/過去棚卸取込・最終統合へ変更した。
  `App.vue` / `useStore.js` / `useHistory.js`が重なるため、3セッションは前回checkpointを継ぐ直列実行とした。
- `develop@dcf6874`のWeb公開契約を維持し、Phase 3・過去棚卸取込をUser判断なしに公開後へ送らないこと、
  DATA-001/002はCodex承認前に完了にしないことを明記した。
- 品目マスタ取込を正式に追跡する`IMPORT-001`をP1・未着手・Claude Code担当で追加した。
  既存タスクの状態・担当は変更していない。
- 旧計画を説明していたREADME/task-listの案内文を、今回のレビュー修正計画へ同期した。
- 検証: 変更5文書のlocal Markdown link 66/66件解決、Markdown table 6件の列数一致、
  `git diff --check`成功（改行warningのみ）。docs-onlyのためcode test/buildは未実行。
- 未実施: commit、push、deploy、production migration、外部service変更。
- 次の再開地点: Userが第1セッション指示をCCへ渡し、CCのcheckpoint報告後にCodexが独立reviewする。

## 2026-08-08 — WEB-001: 棚卸中心の公開契約とWeb共同採点を追加

- 担当: Codex。Claude Codeは**同じ`develop`・同じ作業tree**で並行作業した。`task-list.md`で編集が
  競合したが、Claude Code側が作業fileに触れず index のみを操作して分離commitしたため
  （`git hash-object` + `git update-index`）、この作業treeは無傷で残った。
  同一fileを触る場合は、着手前に互いのcommit区切りを合わせる。
- WEB-001を品質基盤更新として進行中へ戻した。canonical URL/contact、production変更、deploy承認待ちは継続。
- Web Free版の主経路を、品目準備→棚卸開始→中断/再開→完了→別端末履歴詳細→CSV→削除へ固定。
- 品目取込の非破壊性、完了writeの一貫性、同日複数履歴、過去棚卸取込、β機能境界を
  release candidate product contractとして追加。
- 入出庫・発注確認は正式な在庫管理・発注送信として約束せず、搭載時はβ表示・主要導線外とした。
- quality-scorecardを旧Google Play profileからW1 Web/PWA Free版へ更新し、棚卸core/import safety、
  privacy/public surface、observability、scope/traceabilityを独立採点対象にした。
- Cloudflare skillのPages/D1資料を確認。既存のpreflight→承認済みmigration→Worker→Pages→smokeという
  本番順序は維持し、platform設定、production data、App/Worker codeは変更していない。
- 検証: git diff --check成功（改行warningのみ）、変更4文書のlocal Markdown link全件存在、
  Markdown table列数一致。
- code test/buildはdocs-onlyのため未実行。未実施: commit、push、deploy、production migration。
- 次の再開地点: Claude Codeのtask単位handoffをproduct contractで独立reviewし、WEB-07/09の証拠へ接続する。

## 2026-08-08 — S4: DATA-001 複数writeの原子性（CC 第1セッション）

- 担当: Claude Code。[旧計画（S1〜S8）](archive/cc-session-plan-s1-s8-2026-08-08.md) の S4。Worker中心＋App一部。**migration なし**。
- 棚卸完了・発注・入出庫の3つとも、ヘッダ（完了状態）と明細を**1つの `db.batch`
  （=1トランザクション）**へまとめた。従来は棚卸完了が2回、発注が別writeの連続、入出庫が3回。
- `inventoryLines.js` を「実行する」から「**文を組み立てて返す**」（`inventoryLineStatements`）へ変更。
  呼び出し側が `UPDATE sessions` と同じ batch へ載せられるようにするため。
- batch は途中で中断できないので、**明細の INSERT 自身に持ち主の確認を持たせた**
  （`WHERE EXISTS (SELECT 1 FROM sessions/orders/movements WHERE id = ? AND shop_code = ?)`）。
  `UPDATE sessions` を batch の先頭に置き、0行なら後続の INSERT も弾かれる。
- 冪等性は「毎回全削除してから入れ直す」で担保。upsert だけだと品目が減った再送で前回ぶんが残る。
- **クライアント側の部分適用も塞いだ。** `useSession.complete()` は complete API が失敗すると
  `updateSession(id, 'completed')` へフォールバックしており、「明細の保存に失敗したのに
  セッションだけ完了として残す」＝ DATA-001 が防ぎたい状態そのものをクライアントから作っていた。
  削除して `{ ok:false, reason:'save_failed' }` を返し、`_finalized` も戻して再試行を塞がない。
  **旧テスト1件（フォールバックを固定していた）を反転させた。**
- `handleMovementCreate` のヘッダ upsert に店舗境界の WHERE が無く、事前SELECT後の競合で
  他店のヘッダを上書きできる隙間が残っていた。`handleOrderCreate` と同じ形へ揃えた。
- 上限: `MAX_LINES_PER_REQUEST` = 5,000行を新設（`MAX_PAYLOAD_CHARS` はJSON全体のバイト数しか
  見ないため、短い行を大量に並べると上限内のまま数万行を1トランザクションへ詰め込める）。
  品目名・単位は既存の `MAX_INGREDIENT_LEN` / `MAX_UNIT_LEN` で slice。
  棚卸完了に `_tooLarge` と `inventory` の型チェックを追加（従来なし）。
- 検証: worker `npm test` 251 passed / 17 files（+29。`atomicity.test.js` 新設）、
  app `npm test` 619 passed / 71 files、`npm run build` 成功。
- 未実施: 実機・本番D1での確認。**本番D1で batch がトランザクションとして巻き戻ることは未検証**。
  ローカルは注入モックで再現しているだけ。手動確認台本6項目を[旧計画（S1〜S8）](archive/cc-session-plan-s1-s8-2026-08-08.md)の S4 節に残した（現行の台本は `../test-checklist-new-features.md`）。
- 範囲外: `saveSnapshotToD1`（`store_history`）は完了処理とは別 write のまま。1つにまとめるには
  `store_history` の session単位キー化（F-001）が要るため Phase 3（公開後）。
- **第1セッション（S1〜S4）はこれで完了。** 8タスク全体では S1〜S8 がすべて実装済み。

## 2026-08-08 — S3: DATA-002 Phase 1（CC 第1セッション）

- 担当: Claude Code。[旧計画（S1〜S8）](archive/cc-session-plan-s1-s8-2026-08-08.md) の S3。**Worker と App の両方**に触れた。
- `GET /store/:code/sessions/:id/lines` を追加。`storeHandler.js` の `handleSessionLinesGet` を
  `index.js` の `_requireAuth`（strict同store Bearer）の内側、`/sessions/:id/complete` の直前に登録。
  単価・在庫金額を返すためゲスト経路には置かない。
- **店舗境界テストを先に書いた**（完了条件どおり）。`worker/src/sessionLines.test.js` を作成し
  10件すべて失敗を確認してから実装。`session_id` だけで引くSQLではテストが落ちるモックにしてある。
  ルーター層の401/他店舗トークン401/他店舗セッション404/自店舗200を `index.test.js` に追加。
- 他店舗のIDと存在しないIDは**同じ404**。区別するとIDの実在を他店舗から確かめられる。
- App 側は `services/snapshotFromLines.js`（純関数）で lines から表示用スナップショットを組み立て、
  `App.vue` の `onViewSession` が端末にスナップショットが無いときだけ呼ぶ。
  **localStorage にも D1 にも書き戻さない**（User判断 2026-07-28 の方式A）。
- 復元したスナップショットは `locked: true`。`patchSnapshotItems` は localStorage の該当日付を
  書き換える実装で、端末に実体が無い記録を編集させると「保存したつもりで消える」ため。
- 1回の返却上限 `MAX_SESSION_LINES` = 2,000件。超過時は `truncated` を返しトーストで明示する
  （`F-002` の転送量問題を新経路へ持ち込まないための有界化）。
- `totalValue` はサーバーの `sessions.total_value` を優先。打ち切り時に合計が過小にならないため。
- **`SEC-005` を着手可へ変更**（順序ブロック解除）。`SEC-005.md` / `DATA-002.md` / `task-list.md` に明記。
- `docs/api-design.md` に認証区分つきで登録（feature-checklist §5）。DATA-002 の未解消行も更新。
- 検証: worker `npm test` 210 passed / 16 files（+14）、app `npm test` 617 passed / 71 files（+13）、
  `npm run build` 成功。
- 未実施: 実機・本番D1での確認。別端末で詳細が開けること、2026-07-07の351品目が出ることは
  **未確認**で、手動確認台本6項目を[旧計画（S1〜S8）](archive/cc-session-plan-s1-s8-2026-08-08.md)の S3 節に残した（現行の台本は `../test-checklist-new-features.md`）。
- 残る穴: 復元経路では `entryLog` / `participants` / `auditLog` が空（`inventory_lines` に無い）。
  F-001（同日2回目の上書き）と F-003（データ源二重）は Phase 3 の範囲で未解消。
- 次の再開地点: 第1セッションの **S4（DATA-001・完了処理の原子性）**。

## 2026-08-08 — CC第2セッション: 品目マスタ取込の本修理（S5・S6）

- 担当: Claude Code。範囲は[旧計画（S1〜S8）](archive/cc-session-plan-s1-s8-2026-08-08.md)の第2セッション（S5・S6）。`worker/` は無変更。
- 基点: `develop@f8da4c1` で実装し、push 時に `claude/branch-operational-status-2lwwwu`
  （S1・S2・S7・S8 が先行）へ rebase して統合した。
- **S2（止血）の後始末**: S2 の申し送り「S5 で通常取込からこの確認を外し、全置換操作にだけ残す」を実施した。
  - 外した: `SettingsModal.handleFile` / `SettingsModal.onMapperImported` / `PdfImporterModal.onImport`
    の `confirmMasterImport` 呼び出し3箇所、`SettingsModal.vue` の `.replace-warn` とそのCSS、
    `useConfig.js` の暫定コメント2箇所（全置換代入そのものが無くなったため）。
  - 残した: `utils/masterImportWarning.js` は削除せず、`ItemImportPreviewModal` の
    **「全入れ替え」確定時だけ**呼ぶようにした。冒頭コメントを現状に合わせて書き換え、
    `masterImportWarning.test.js` の8件はそのまま緑。
  - `HELP.import` は S2 の全置換文言からマージ後の挙動へ書き換えた。
  - S2 の手動確認台本のうち 2〜5・7 は前提が変わったため、差し替えを
    `../test-checklist-new-features.md` の S 節へ置いた（旧計画の S2 節は[履歴](archive/cc-session-plan-s1-s8-2026-08-08.md)に保存）。
- 統合時のコード衝突は S2 由来のみ（4ファイル）。S7・S8 とはファイルが重ならず衝突なし。

### S5 — 取込のマージ化

- 取込を「解析 → 計画 → 適用」の3段へ分離し、純粋関数を `app/src/utils/itemImport.js` へ新設。
  計画（`buildImportPlan`）は `config` を書き換えないため、プレビューと実取込が同じ結果になる。
- **既定を「追加・更新」に変更**。`loadFromCSV` / `loadFromCSVMapped` はファイルに無い既存品目を
  消さず、同名品目はファイルにある列だけ上書きする。空欄列は既存値を保持。
- **全入れ替えは `{ mode: 'replace' }` を明示したときだけ**。UI では確認画面のラジオ＋
  削除件数の警告＋確認チェックを通さないと実行できない。
- Free上限はマージ時に既存品目を削らない。空きぶんだけ新規を入れ、残りを `truncated` で返す。
- 推奨フォーマット（`exportConfigCSV` の出力）の往復を成立させた。従来 `loadFromCSV` が
  無視していた並び替え軸列（10・11列目）を読み、軸名未設定なら列名を採用する。
- 発注点の既存仕様（列があって空セルなら解除／列が無ければ非破壊）は維持。

### S6 — 取込前プレビュー

- `ItemImportPreviewModal.vue` を新設し、CSV / 列指定 / PDF・Excel の**全経路を確定前に通す**。
  PdfImporterModal は品目マスタへ直接書かず、変換したCSVを確認画面へ渡す方式へ変更した。
- 表示: 追加・更新・変更なし・除外（＋全入れ替え時は削除）の件数、取込後の総件数、
  更新される品目のフィールド単位の差分（変更前 → 変更後）、除外行の**行番号と理由**。
- Free上限による切り捨てを**取込前に**警告する（従来 `_capForPlan` が無言で切っていた）。
- PDF取込をβ表記にした（PdfImporterModal のタイトル・注記、取込導線のサブテキスト、
  SettingsModal のドロップゾーン）。
- 取込直後に限り1回だけ「取込前に戻す」ができる（`undoLastImport`）。メモリ上の退避のみで、
  再読込・アカウント切替（`resetLocalData`）・ホスト設定受信（`applyRemoteConfig`）・
  取込以外の品目変更（`_save`）で失効する。[旧計画（S1〜S8）](archive/cc-session-plan-s1-s8-2026-08-08.md) S6 の注記どおり、
  恒久的なスナップショット機構は作っていない。

### 変更ファイル

- 新規: `app/src/utils/itemImport.js`、`app/src/components/ItemImportPreviewModal.vue`、
  `app/src/composables/useConfig.importMerge.test.js`、`app/src/composables/useConfig.importPreview.test.js`
- 変更: `app/src/composables/useConfig.js`、`app/src/components/SettingsModal.vue`、
  `app/src/components/PdfImporterModal.vue`、`app/src/components/MasterManagePage.vue`、
  `app/src/composables/useConfig.axes.test.js`

### 検証（S1・S2・S7・S8 と統合したあとの実行結果）

- `cd app && npx vitest run`: **70 files / 604 tests passed**。
  S5・S6 単体では 65 files / 569 tests passed（S1〜S4・S7・S8 を含まない基点での実行）。
- `cd app && npm run build`: 成功（PWA precache 17 entries / 2518.25 KiB）。既知のchunk警告のみ。
- `cd worker && npm test`: **15 files / 196 tests passed**（無変更の確認）。
- `git diff --check`: 指摘なし。
- 既存テストの変更は1件のみ: `useConfig.axes.test.js` の
  「再インポートで既存割り当てを名前一致で維持し、新規はその他」を `mode: 'replace'` へ明示化し、
  既定（マージ）側の対応ケースを追加した。全置換前提を書いていたのはこの1件だけ。
  S2 の `masterImportWarning.test.js`（8件）は変更せずに緑のまま。

### 仕様上の判断

- 実装とヘルプ文言が食い違っていた件は**文言側（追加マージ）を正**とした。
- 「上書き」は列単位。同名品目でも空欄列は既存値を消さない（発注点だけ明示解除あり）。
- 取込の取り消しは永続化していない。永続化の要否は提案箱でPM判断待ち。

### 残っているリスク

- 🖐 実機UI未確認（375px・デスクトップ）。この環境にブラウザ自動化がない。
- 全入れ替えを選んだ場合の破壊性は変わらない。確認UIと事前の削除件数表示で防いでいる。
- 取込の取り消しはメモリ上のみ。取込直後にタブを閉じる・再読込すると戻せない。
  マージ既定で破壊性自体が下がっているため許容範囲と判断したが、永続化の要否はPM判断。
- 差分計算は「取込後の値 vs 現在の値」で、品目数×フィールド数に比例する。
  Free上限150品目では問題ないが、Pro相当の数千品目でプレビューの体感を実測していない。

### migration

- **なし**。D1スキーマ・`worker/migrations/` は無変更。config スキーマも変えていないため
  `RoomDO.normalizeConfig` と同期payloadへの影響もない。

### Codex にレビューしてほしい点

1. **既定をマージへ変えた判断そのもの**。`loadFromCSV(csv)` の意味が変わる後方非互換で、
   呼び出し元は全て付け替えたが、これを製品仕様として確定してよいか。
2. **`buildImportPlan` の全置換モード**（`app/src/utils/itemImport.js`）。
   `reorderPoints` だけ「発注点列が無ければ既存を保持」という既存の非対称仕様を引き継いでいる。
   ファイルに無い品目の発注点が残る点は従来どおりだが、意図した挙動か再確認してほしい。
3. **Free上限の扱い**。マージ時は `itemLimit - 既存件数` を空きとし、既存が上限を超えていても
   （Pro→Free の降格や過去データ）既存は削らず新規だけ弾く。プラン境界としてこれでよいか。
4. **取り消し（`undoLastImport`）の失効条件**。`_save()` 経由で失効させ、
   `resetLocalData` / `applyRemoteConfig` でも明示的に破棄している。
   アカウント境界で前アカウントの品目マスタが復元されうる経路が残っていないか。
5. **`masterImportWarning.js` の残し方**。S2 の申し送りに従い全入れ替え確定時だけ呼んでいるが、
   確認画面のチェックボックスと二段になる。片方に寄せるべきかは判断を仰ぎたい。

### 未実施

- deploy、production migration（migration は不要）。
- DoD セルフチェックは下記。N/A 理由つき。
  - 1 UI・表示: 🖐 スマホ / タブレット / PC の実機確認が**未実施**（要User確認）。
    空状態（0件取込・全行除外）はエラーメッセージで処理。
  - 2 入力・データ: 🤖 バリデーション済み。localStorage キー追加なし（退避はメモリのみ）。
    config フィールド追加なし＝`RoomDO.normalizeConfig` 影響なし。D1・migration なし。
    再インポート時の軸割り当て維持はテストで固定。
  - 3 エラー処理: 解析エラーは日本語で確認画面に表示。通信を伴わないため通信エラー項目は N/A。
  - 4 同期・多人数: 取込は既存どおり `_save()` → `_onConfigChanged` で伝播。WSメッセージ型の追加なし。
    ゲストは取込導線が非表示のため多人数項目は N/A。
  - 5 権限・認可: 新エンドポイントなし・D1クエリなしのため N/A。プラン境界は `isPro()` 経由で維持。
  - 6 ログ・監査: 品目マスタ取込は従来から auditLog 対象外（同期の config 更新として伝播）。変更なし。
  - 7 ナビゲーション: 確認画面は既存モーダル規約（`useEscapeKey` + `.modal-overlay`）に合わせた。
    🖐 Android の戻る操作は未確認。既存モーダルと同じ扱いが必要かは実機確認で判断する。
  - 8 通知: N/A（通知を出さない）。
  - 9 テスト・ドキュメント: 🤖 ユニットテスト追加済み。
    `test-checklist-new-features.md` と `project-status.md` の更新は本セッションで実施。

## 2026-08-08 — CC第3セッション: S7（保存失敗の可視化）/ S8（画面を棚卸中心へ）

- 担当: Claude Code。台本は[旧計画（S1〜S8）](archive/cc-session-plan-s1-s8-2026-08-08.md)の第3セッション（S7・S8）。**現行の第3セッションとは別物。**
- ブランチ: `claude/branch-operational-status-2lwwwu`（`develop@f8da4c1` から）。
  作業開始時点で S1〜S6 は本ブランチに未取り込みだったため、**S7/S8 はそれらに依存しない範囲で完結させた**。
  push 時に第1セッションの S1・S2（`6b336ac` / `d12878b`）が先に入っていたため rebase し、
  docs 3件（`session-log` / `task-list` / `DATA-002`）の衝突を解消した。コードの衝突は無し。

### S7 — DATA-002 Phase 2（保存失敗の可視化・バックフィル）

- 未送信キュー（`_pending` / `_snapQueue` / `_orderQueue` / `_moveQueue`）を localStorage
  `_pending_saves_v1` へ永続化。payload に `shopCode` を持たせ、**別店舗のキューは読み込み時に破棄**する。
  `resetAccountData` / `clearLocalAccountData` の消去対象に追加した。
- 棚卸完了が `saveSnapshotToD1` の結果を待つようにし、未送信ならトーストで明示。
  `ConnectionBanner` に `failed`（連続失敗2回以上）表示を追加し、未送信件数を出す。
- `services/historyBackfill.js`（純関数 `missingSnapshots`）を追加。履歴を読む3経路
  （起動 / ログイン / セッション開始）で、端末にあって D1 に無い・D1 側が古いスナップショットを送り直す。
- 起動時に `resumePendingSaves()` を呼び、接続復帰イベントを待たずに前回の未送信分を送る。
- 付随修正2点: `applyRemoteHistory` が端末側の新しいスナップショットを潰していたのを修正（同時刻はリモート優先＝従来どおり）。
  再送間隔を指数バックオフ化（8秒 → 最大2分）。
- **Phase 1（`GET /store/:code/sessions/:id/lines`）は未着手**。別セッション担当のため `worker/` は1行も触っていない。
  2026-07-07 の351品目の復旧は Phase 1 側。

### S8 — 画面を棚卸中心へ

- セッションタブを「① 品目を準備 → ② 棚卸をする → ③ 記録を見る」の順路へ組み直し、
  履歴カレンダーへの導線を第一導線の終点として追加した。
- 入出庫・発注確認・発注スケジュールを区切り線から下の **β機能**（`.beta-group`）へ移動。
  「発注確認」→「**発注内容の確認・記録（β）**」へ改称し、**仕入先へ自動送信されない**旨を常時表示。
- 出庫は主導線から外し、`MovementPage` 内のタブとしては残した（記録は削除していない）。
- 理論在庫の誤差要因（未記録の使用・ロス・納品）をホームカードと `MovementPage` の両方に明示。
- データ管理カードの点滅を**品目0件のときだけ**にした（棚卸開始と注意を奪い合わないため）。
- `DesktopNav` の並びを 棚卸 → 品目マスタ → 在庫・入庫（β）へ。
- `eb99895` の2列グリッドを書き換え、対象を panel 全体から `.beta-group` へ縮小。
  同コミットの `(pointer: coarse)` タップ領域確保は**残している**。

### 検証

- App: `npm test` 67 files / **558 passed**（変更前 63 files / 531）。`npm run build` 成功。
  CSS 226.06kB → 228.08kB（gzip 35.98 → 36.33kB）。
- Worker: `npm test` 15 files / **196 passed**（`worker/` は未変更・回帰確認のみ）。
- 追加テスト4件: `useStore.pending.test.js`（永続化・店舗境界・容量不足・失敗回数）、
  `historyBackfill.test.js`（差分判定）、`useHistory.remote.test.js`（上書き規則）、
  `SessionListPage.flow.test.js`（順路の並びと文言）。
- **未実施**: 実ブラウザでの目視確認（この環境にブラウザ自動化が無い）。手動確認の台本は
  [`tasks/UI-001.md`](tasks/UI-001.md) に追加した。deploy・D1 migration は行っていない（migration の追加なし）。

### 共通DoD（[`../feature-checklist.md`](../feature-checklist.md)）セルフチェック

| 節 | 結果 |
|---|---|
| 1. UI・表示 | 🖐 375px / タブレット / PC の目視は**未実施**（台本を `tasks/UI-001.md` へ追加）。空状態は「完了した棚卸はまだありません」を履歴導線に用意。ホームカードのテーマ色（棚卸=青 / 入出庫=緑 / 発注=オレンジ）は維持。最小フォントは 11px の注記が既存カードと同水準 |
| 2. 入力・データ | `_pending_saves_v1` を `storageKeys.js` へ登録。`clearLocalAccountData` と `resetAccountData` の消去対象に追加。D1永続化の要否＝**未送信キューは端末専用で正しい**（D1 へ送れなかったものの控えなので、D1 に置く対象ではない）。schema変更なし＝**migration なし**。config へのフィールド追加なし＝`normalizeConfig` 変更不要 |
| 3. エラー処理・通信 | 保存失敗は日本語の明示表示（トースト＋バナー）。再送はバックオフ上限2分で無限即時リトライにしない。バックフィルは1回10件上限。**フェイルの方針**: 履歴取得が失敗（null）したときは「D1 は空」と解釈せず**何も送らない**（誤って全件上書きしないため）。機内モード実機確認は未実施 |
| 4. 同期・多人数 | **N/A**。WS メッセージ型・DO storage は未変更。ホスト完了経路の待ち追加のみで、ゲストへ送る内容は変わらない |
| 5. 権限・認可 | **N/A（サーバー側は未変更）**。client 側の店舗境界として、復元した未送信キューは `shopCode` 照合で他店舗分を破棄する |
| 6. ログ・監査 | 秘匿情報の出力なし。未送信件数のみ表示（単価・PIN・トークンは出さない） |
| 7. ナビゲーション | 履歴導線はタブ切替のみで `currentView` を変えないため、`_closeTopLayer` の規約に影響しない。β機能の移動は既存 emit の位置変更のみ |
| 8. 通知 | プッシュは**N/A**。トーストは保存失敗時の1回のみ（成功時は従来どおり） |
| 9. テスト・ドキュメント | ユニットテスト4ファイル追加（App 558 passed）。手動台本は `tasks/UI-001.md` へ（`test-checklist-new-features.md` は自ら「履歴snapshot・現行checklistではない」と宣言し、現在のtask固有検証は `tasks/<ID>.md` を正としているため、そちらへ追加した）。`project-status.md` の実装済み節を更新。設計判断は `proposals.md` へ投稿 |

### 未決・引き渡し

- 設計判断は [`../proposals.md`](../proposals.md) の 2026-08-08 エントリ2件へ投稿済み（PMトリアージ待ち）。
  特に **`applyRemoteHistory` の上書き規則変更**と**完了処理が明細保存を待つようになった点**は既存挙動の変更。
- Codex へのレビュー希望: アカウント境界（`_pending_saves_v1` の店舗照合）、
  バックフィルが D1 を過剰に上書きしないか、完了処理の待ち追加と `DATA-001`（S4）の設計が衝突しないか。
- 次の再開地点: Phase 1（S3）と DATA-001（S4）。どちらも `worker/` 側で、本セッションの差分とは重ならない。

## 2026-08-08 — S2: 品目マスタ取込の止血（CC 第1セッション）

- 担当: Claude Code。[旧計画（S1〜S8）](archive/cc-session-plan-s1-s8-2026-08-08.md) の S2。**挙動は変えず、警告と文言だけを追加**。
- 実害: `loadFromCSV` / `loadFromCSVMapped` は品目リストを**全置換**する。ファイルに無い品目と、
  その単価・別名・カテゴリが消える。一方UIの説明は「品目名が一致するものは上書き、無いものは追加」＝
  追加マージを約束しており、300品目の店舗が50品目のファイルを入れると250品目が消えていた。
- `app/src/utils/masterImportWarning.js` を新設。全置換であることを説明する確認を、
  **3つの取込入口すべて**へ入れた（CSV直接 / 列指定マッパー / PDF・Excel）。
  品目0件のときは失うものが無いため確認しない。confirm が使えない環境では中止（同意なしに破壊しない）。
- ファイル選択**前**に見える警告を `SettingsModal` のドロップゾーン上へ追加（`.replace-warn`）。
  確認ダイアログはファイルを選んだ後にしか出ないため。
- `MasterManagePage.vue` の `HELP.import` を実装の挙動へ一致させた。
- 暫定である旨を `masterImportWarning.js` 冒頭、`useConfig.js` の全置換代入の直前2箇所、
  `HELP.import` の上に残した。S5 で外す対象も[旧計画（S1〜S8）](archive/cc-session-plan-s1-s8-2026-08-08.md)に列挙した。
- 検証: `npm test` 539 passed / 64 files（新規8件）、`npm run build` 成功。
  CSS 226.06 → 226.26kB（gzip 35.98 → 36.03kB）。
- 未実施: 実ブラウザでの目視確認。手動確認台本8項目を[旧計画（S1〜S8）](archive/cc-session-plan-s1-s8-2026-08-08.md)の S2 節に残した（現行の台本は `../test-checklist-new-features.md`）。
- feature-checklist セルフチェック結果は同節と本コミットに記載。
- 次の再開地点: **S3（DATA-002 Phase 1）**。完了時に Codex へ `SEC-005` の着手可を通知する。

## 2026-08-08 — S1: 担当と公開範囲の記録更新（CC 第1セッション）

- 担当: Claude Code。[旧計画（S1〜S8）](archive/cc-session-plan-s1-s8-2026-08-08.md) の第1セッション S1。**docsのみでcode変更なし**。
- 作業ブランチ `claude/branch-operational-status-2lwwwu` を3セッション共有として確定。
  `develop@f8da4c1` を fast-forward 取り込み済み。
- 担当変更: `DATA-001` を Codex → **Claude Code**、`DATA-002` を 未割当 → **Claude Code**。
  優先度・状態・release gate（`WEB-01`〜`WEB-10`）の判定基準は変更していない。
- 初回Web版の中心を **棚卸業務の効率化** と明記。第一導線は
  「品目を準備 → 棚卸開始 → 入力 → 完了 → 履歴」。入出庫・発注確認は **β機能**、出庫は主導線から外す。
  新機能は追加せず既存機能の整理と安定化に限定する方針を `task-list.md` と
  `web-release-readiness.md` の両方へ記載した。
- `DATA-002.md` の「着手時期: Codexの作業が完了した後。それまで着手しない」（2026-07-28 User判断）を
  **打ち消し線で原文を残したまま失効**とし、失効理由（担当がCCへ移り前提が成立しない）と
  新しい着手時期（即時着手可・ただしPhase 1をSEC-005より先に完了）を追記した。
- **`DATA-002` Phase 1 → `SEC-005` の順序を固定**。`worker/src/index.js` の store ルート群で競合するため。
  `DATA-002.md` / `SEC-005.md` / `task-list.md` / `web-release-readiness.md`（`WEB-05`）へ記載。
  CCはPhase 1完了時にCodexへ着手可を通知する。
- `DATA-002` **Phase 3** と **過去棚卸取込の再設計** を初回公開scope外（公開後）と確定。
  Phase 3 は migration を伴い、本番D1に 0010/0011 未適用（`WEB-04`）のため判断材料が揃わない。
  過去棚卸取込は Phase 3 完了が前提。新規IDは作らず `DATA-002` の公開後フェーズとして扱う。
- `WEB-07` の Owner を Codex → **Claude Code / Codex** へ更新（実装がCCへ移ったため。公開判定はCodexのまま）。
- 未実施: code修正、test/build（docsのみのため）、production deploy、migration、外部service変更。
- 次の再開地点: 第1セッションの **S2（品目マスタ取込の止血）**。その後 S3（DATA-002 Phase 1）→ S4（DATA-001）。

## 2026-08-04〜2026-08-06 — DOC-001: Web公開を目標にdocs全体を再編

- 担当: Codex。文書整理とread-only監査のみ。App/Worker実装は変更していない。
- User判断をD-021へ記録し、現在と将来フローを分離:
  - W1（現在）: Web/PWA Free版。trial、Stripe、Pro販売、PostHog有効化、Play配布なし。
  - A1（将来）: Android app内登録を起点に14日Pro無料体験→Free。Web Stripeの明示契約を
    同一accountのserver entitlementへ反映するconsumption-only Play版。
  - Web登録へのtrial適用とStripe/backendの単独公開順は未決として残した。
- docs配下90 Markdown＋export ZIPを棚卸し。正本、現行候補、runbook/draft、将来設計、履歴へ分類した。
- `docs/README.md`を総合索引、`web-release-readiness.md`を現在のrelease gateとして新設。
  WEB-001/DOC-001を作成し、task boardとagent入口をWeb先行へ同期。Play資料は削除せず後続へ保留した。
- Dated audit、export、完了記録、過去session entryは改変していない。大量のfile移動/renameも行っていない。
- 初回Web preflightで新たに確認したblocker:
  - 文書の`inventory-app.pages.dev`は正常な公開先でなく、実project productionは旧build。
  - develop previewのprivacy/terms/supportはPages上で308 redirect loop。
  - remote Workerは旧CORSで任意Originを反射し、repositoryの許可Originは実Pages hostと不一致。
  - production branch/Wrangler/rollback未固定、本番D1 0010/0011未適用。
  - 登録濫用、Free 2台制限、履歴data integrity、observability、critical E2Eが未完。
- `bug-reports.md`の壊れたrepository相対link 41件を`../../app` / `../../worker`へ修正。
- Phase 2で`spec/api/sync/security/test/ci-cd`を`develop@bc9fb85`へ照合。現行W1 baseline、
  known gap、旧reference snapshot、履歴実績の境界を追加し、DOC-001を完了した。
- 8/5に並行追加されたUI-001とApp差分は保持し、DOC-001のcode変更・検証実績には含めていない。
- 基準: `develop@bc9fb85`。develop Actions run `30882005257`はpreviewまで成功。
- 未実施: code修正、test/build再実行、production deploy、migration、外部service変更、commit、push。
- 最終検証: 92 files（Markdown 91 + ZIP 1）、local Markdown link全件解決、Markdown table列崩れなし、
  `git diff --check`成功。DOC-001としてcode test/buildは未実行。
- 次の再開地点: WEB-01のcanonical/contactをUserが決定後、Pages routing/CORS/deploy経路から着手。

## 2026-08-04 — PLAY-002: data削除境界の独立reviewとrace修正

- 担当: Codex（data削除・Cache/SW・Worker/D1/DO）。Claude CodeのUI/a11y差分を保持し、
  Back blocker解消に限って共有境界の`App.vue` / `DeleteAccountModal.vue` / `appMenuState.js`を最小変更。
- client側で3つの削除raceを修正:
  - 旧店舗のD1未送信queue/retry timerと、境界前に開始した保存の遅延失敗によるqueue復活。
  - 削除後も残る同期WebSocket再接続と、参加者/message/audit/競合のmemory data。
  - 天気fetch・逆geocode・geolocation callbackの遅延完了による位置/cache/state復活。
- `clearLocalAccountData()`をbest-effort化し、1 resetの例外で後続消去が止まらないよう補強。
- Cache/SW監査: Workboxはapp shell/font/PDF cMap、push SWは通知だけ。account/API dataは保存しないため、
  account削除時のSW解除・静的cache削除は不要。専用testで回帰固定。
- Cloudflare公式仕様と現行実装を再照合:
  - DOは互換日付が古くても`deleteAlarm()`後に`deleteAll()`し、stock/order両方を消去。
  - D1の削除中/削除後INSERT競合はmigration 0011の`account_inactive` triggerで既に遮断。
  - 公開Worker routeからDO内部削除pathへは到達しない。Worker変更は不要と判断。
- CCのUI/a11y差分はfocus trap・focus復帰・375px対応を承認。独立reviewで検出したAndroid/browser Back
  blockerは、modal登録handlerをApp共通制御が消費する方式で解消。入力・確認・errorは閉じ、
  削除処理中・完了はmodalを維持する。設定内と公開削除pageの両方を同じ配線で扱う。
- 検証: data境界対象5 files / 27 tests、Back/UI関連5 files / 28 tests、App全体63 files / 531 tests、
  Worker全体15 files / 196 tests、App production build成功（448 modules、PWA precache 17 entries /
  2476.36 KiB）、`git diff --check`成功。
- 判定: code review範囲は承認。PLAY-002はcanonical/contact確定とUser実機確認が残るため進行中。
- 未実施: commit、push、deploy、production migration、Play Console変更。

## 2026-08-04 — PLAY-003: D-019端末data削除とData Safety再照合

- 担当: Codex。既存のPLAY-002/004・DEP-001差分を保持し、PLAY-003の監査台帳・回答draft・進捗記録だけを更新した。
- D-019のApp実装を独立再照合:
  - account削除成功時に端末ID・端末名・天気位置情報/cacheとmemory stateを消去する。
  - 削除失敗、logout、account切替では端末設定を保持し、再試行・通常利用を壊さない。
  - privacy/support/legalの公開文面と削除確認UIが同じ範囲を説明する。
- `data-safety-audit.md`、`data-safety-form-draft.md`、`google-play-readiness.md`を実装へ同期し、
  `DS-02`を整合済みとした。PLAY-003自体は他gateが残るため進行中を維持。
- 公式仕様を2026-08-04に再確認: D1 Time TravelはWorkers Free 7日、Workers LogsはFree 3日。
  Google Playは端末外への送信を原則collectionに含め、account削除時は関連dataも削除対象とする。
- 検証:
  - 対象: 5 files / 81 tests passed。
  - App全体: 58 files / 502 tests passed。
  - App production build成功（447 modules、PWA precache 17 entries / 2473.26 KiB）。
  - `git diff --check`成功。既知のVite CJS・500 kB超chunk警告と改行warningのみ。
- 残件: canonical URL/contact、Workers Logs閲覧担当・payload masking・alert、provider共有例外、
  TWA microphone、`/pdf`存廃、公開build network、0010/0011適用承認。
- 未実施: commit、push、deploy、production migration、Play Console変更。

## 2026-08-02 — CI-001完了・DEP-001 production high解消

- 担当: Codex。Claude CodeのPLAY-002/004差分は保持し、依存・Excel取込境界とCI証拠だけを変更した。
- **CI-001完了**: `develop@7d47cb4`のActions run
  [`30725392991`](https://github.com/musaikun/Inventory/actions/runs/30725392991)が成功。
  Node 24でWorker test、App test/build、Pages deploy、develop alias更新の全stepが成功した。
  develop aliasは`https://develop.inventory-app-c40.pages.dev`。実ブラウザ接続は環境に利用可能なbrowserがなく未確認。
- **DEP-001完了**:
  - `postcss` 8.5.15 → 8.5.25。
  - `xlsx`をnpm registry 0.18.5からSheetJS公式CDN 0.20.3へ変更。
  - Excel解析をWeb Workerへ隔離し、5 MiB、20シート、各5,000行・100列、合計10万セル、8秒timeoutを追加。
  - 日本語を含む`.xlsx` / `.xls`、入力上限、Worker timeoutの回帰testを追加。
- 検証: `npm audit --omit=dev` 0 vulnerabilities、App 58 files / 498 tests、production build成功。
  `spreadsheetImport.worker-*.js`の独立bundleとPWA precacheを確認。`git diff --check`成功。
- 残件: 通常の`npm audit`にはbuild/test用依存の6 high / 3 moderate / 1 lowが残る。
  commit、push、deploy、実機Excel取込は未実施。

## 2026-08-04 — PLAY-002: focus trap・誤操作防止・375px対応（UI/a11y）

- 担当: Claude Code（UI・a11y主担当）。Codexは独立reviewとdata削除検証。Worker無変更。
- **focus trap**: `composables/useFocusTrap.js` を新規追加し `DeleteAccountModal` へ適用。
  `role="dialog" aria-modal="true"` だけではブラウザはTabの移動範囲を制限しないため、
  トラップ無しでは**削除処理中に背後の画面を操作できる**状態だった。capture で Tab を先取りする。
  可視性では絞らず「DOMにある＝操作できる」で判定（局面ごとに`v-if`で差し替える構造、
  かつjsdomでは`offsetParent`が常にnullのため）。
- **フォーカス復帰**: 開く直前の`document.activeElement`を保持し`onUnmounted`で戻す。
  元の要素が消えている場合は何もしない。
- **局面切り替え**: `watch(phase)`で新局面の先頭へフォーカスを移す。処理中は操作対象が無いため
  `tabindex="-1"`のダイアログ自身へ移し、トラップの外へ出さない。
- **375px**: 店舗名・サーバー由来エラー文へ`overflow-wrap: anywhere`。`.da-actions .btn`へ`min-width: 0`
  （flex itemはこれが無いと内容幅より縮まず狭い端末で溢れる）。`.btn`の`line-height: 1`は折り返し時に
  文字が重なるため1.35へ。`DeleteAccountPage`にも同様の対策。
- **文面の不整合を修正**: `SettingsModal`の端末データ説明がD-019の実装と矛盾していたため改めた。
- 確認: 公開ページの店舗コード正規化（`[^A-Z]`除去）はWorkerの発行規則（英大文字6桁・数字なし）と一致。
- 検証:
  - 新規`DeleteAccountModal.a11y.test.js` 12件。実装を`git stash`した状態で**7件が失敗**することを確認。
  - App 59 files / 514 tests passed。production build成功（precache 17 entries / 2474.95 KiB）。
  - `vite preview`で未ログインの`/?delete-account` `/privacy(.html)` `/terms(.html)` `/support(.html)`が
    すべて200。配信物のsupport.htmlから「残るもの」表の端末ID行が消え、自動削除の記載が入ることも確認。
- **実機確認手順（375px・User実施）をPLAY-002.mdへ記録**（A:削除導線 / B:誤操作防止 / C:失敗と再試行 /
  D:公開Web未ログイン / E:キーボード の27項目）。
- 未対応: canonical URL/contact確定後の絶対URL反映（`DS-08`待ち）、実機での目視・タップ確認。
- 未実施: commit、push、deploy。

## 2026-08-02 — PLAY-004: terms正本の同期とD-019の公開文面反映

- 担当: Claude Code。legal文面と回帰testのみ。App/Worker実装は無変更。
- **terms正本の同期（Codex review指摘1・長期未解消だった項目）**: 公開/landing termsは既に正しく、
  `docs/legal/terms.md`だけがずれていたため正本を公開版へ寄せた。
  - 第6条3・第11条3を「利用者へ通知」→「本サービス上へ掲示／お知らせ」。
    **連絡先を保持しない実装では個別通知を履行できない**ため。将来メール登録を入れる場合は「通知」へ再改定する。
  - 第7条2/5の「一切の責任を負いません」→「責任を負いません」（全部免責は消費者契約法8条で無効となり得る）。
  - 第1・2・8条の表現差も解消し、改定日と理由を追記。
- **D-019の公開文面反映**: 端末ID・端末名・天気の位置情報とキャッシュを「削除しても残る」→
  「アカウント削除の完了時に自動削除される」へ。privacy/support/landing/正本の計6ファイルを同時更新。
  「残るもの」は表示設定のみになった。
- **回帰test追加**（`legalPages.test.js`）: 条文単位の同期チェックと、端末固有データの自動削除の記述。
  旧文言（`利用者へ通知します`/`一切の責任を負いません`/`操作ログ等`/`端末の設定として残ります`/
  「残るもの」表の端末ID行）を再発防止として禁止。
- 検証: 文面を`git stash`した状態で**6件が失敗**することを確認。`legalPages.test.js` 56 tests passed。
  App 58 files / 497 tests passed。App production build成功。
- 注意: 作業ツリーにCodexのDEP-001（`xlsx`をSheetJS CDN 0.20.3へ）が進行中のため`app/package.json`は触っていない。
  buildのprecacheが16 entries / 2346.54 KiBへ増えているのはその差分の影響。
- **PLAY-003へ引き継ぎ**: `data-safety-form-draft.md` / `data-safety-audit.md` の端末データ保持の記述は未更新。
- 未実施: commit、push、deploy。実機UI確認。

## 2026-08-02 — D-019: account削除時に端末固有データも自動削除（PLAY-002）

- 担当: Claude Code。App実装＋test＋削除UX。Worker・legal文面は無変更。
- 実装:
  - `useDeviceId.resetLocalData()` — `_device_id`/`_device_name`を削除し、`deviceId`はメモリ上だけ
    新しい値へ差し替える（`export const`→`export let`のlive binding）。永続化しないため次回起動で
    通常の初期化経路が新IDを採番・保存する。削除済みaccountのIDを送り続けず、IDが空にもならない。
  - `useWeather.resetLocalData()` — `weather_loc`/`weather_cache`とmodule scopeの`state`を初期化。
    stateを戻さないとリロードするまで前の位置・天気が残るため。
  - `accountData.clearDeviceLocalData()` を追加し `clearDeletedAccountLocalData()` の`finally`から呼ぶ。
    logout/account切替の`clearLocalAccountData()`には含めない。
  - 削除UX: 削除対象一覧へ「この端末の設定（端末名・端末ID・天気の位置情報）」を追加し、最終確認にも明記。
- 失敗時の保持: `finalize()`は200後にしか呼ばれないため、503/409/通信失敗では認証・業務data・端末設定が
  すべて残り再試行できる。実装変更は不要で、回帰testで固定した。
- 検証:
  - 実装を`git stash`した状態で新規・追加testのうち**9件が失敗**することを確認（回帰として機能する）。
  - 対象4 files / 25 tests passed。App 56 files / 481 tests passed。Worker 15 files / 196 tests passed。
  - App production build成功（precache 2076.40 KiB）。
- **同一release内の未完（PLAY-003/004へ引き継ぎ）**: `app/public/privacy.html:249,291` と `support.html` は
  「端末設定はサイトデータを消去するまで残る」と記載しており、実装と矛盾する状態になった。
  privacy/support/landing/`docs/legal/*`とData Safety申告を自動削除の説明へ更新してから公開する。
  `legalPages.test.js`は`端末ID`の存在しか見ておらずこの矛盾を検出できないため、アサーション追加が要る。
- 未実施: commit、push、deploy。実機UI確認。

## 2026-08-02 — task分割の独立review修正・CI/Test分離を反映

- 担当: Codex。Claude Codeの`task-list.md`進捗ボード化と`tasks/`分割を独立reviewし、構造は採用した。
- 文書修正:
  - 優先度・状態・担当は`task-list.md`だけを正本とし、詳細fileの重複metadataを削除。
  - `develop@96233d4`のcommit/pushとPro Review deploy済み事実を反映。本番Pages / Worker / D1は未変更。
  - Free 2台制限は現行App/Workerでは成立しないP1として`PLAY-004`へ記録し、server-side拒否testを完了条件へ追加。
  - D-019（account削除時の端末ID・端末名・天気位置情報/cache自動削除）とD-020（Cloudflare Free、
    Time Travel 7日、Workers Logs有効）を追加し、PLAY/Data Safety/retention/runbook/checklistへ反映。
  - 現行buildと公開privacy/supportは端末設定を保持する挙動で一致しているため、D-019のApp実装・test後に
    同じreleaseで公開文面を切り替える。
- CI/Testのローカル対応:
  - 2026-08-01のdevelop Actions `30690499992`はNode 20の`node:sqlite` importで失敗し、preview未更新。
  - `develop-preview.yml` / `pro-review.yml`をNode 24へ更新し、App VitestからWorker testを分離。
  - Worker 15 files / 196 tests、App 54 files / 467 tests、App production build（444 modules）成功。
  - `TEST-002`はpackage分離のみ完了。critical integration/E2Eが残るため状態は進行中。
- 文書検証: 新規`tasks/`と更新した品質基盤文書のlocal Markdown linkは全件解決。
  trailing whitespaceなし、`git diff --check`成功（改行形式warningのみ）。
- 残り: commit/push後のActions・develop preview確認、Free 2台制限、端末設定自動削除、各公開P0/P1。
- 未実施: commit、push、追加deploy、本番migration。

## 2026-08-01 — task-listを進捗ボード化し、詳細を tasks/ へ分割

- 担当: Claude Code。**文書整理のみ。コード変更なし。**
- **状態の正本は `task-list.md`**（進捗ボード）。根拠・実装・検証証拠・完了条件は `tasks/<ID>.md` へ移した。
  完了分は `tasks/completed-2026-07.md`、P2/P3は `tasks/backlog.md`。
- 副次効果: CodexとCCが**別ファイルを編集できる**ため、単一の巨大ファイルでの競合が減る。
- 新規タスクIDは作らず、以下を既存タスクへ統合した。
  - CI/検証環境のNode不整合（`@zxing/library`がNode >=24宣言、CIはNode 20） → `CI-001`
  - App VitestがWorkerテストを含み重複実行 → `TEST-002`
  - `postcss` / `xlsx` のproduction high → `DEP-001`
  - TWA価格表示・無料版2台制限（D-016の公開面反映） → `PLAY-004`
  - 履歴の端末依存（`R-001`・`F-001`〜`F-004`） → `DATA-002`（**P2→P1へ変更**）
- `bug-reports.md` は報告台帳として維持し、統合先を明記（内容は削除していない）。
- `DEP-001` は記載の鮮度確認のため `npm audit --omit=dev` を再実行（read-only）。
  production high 2件: `postcss <=8.5.17`（Path Traversal・**修正版あり**）、`xlsx`（prototype pollution / ReDoS・修正版なし）。
  対応の性質が違うため分けて記述した。
- 参照先を更新: `README.md`（読む順番・使い方）、`working-agreement.md`（開始/完了手順）、`AGENTS.md`（読む順番）。
- 検証: 旧`task-list.md`の詳細374行を新構成と全行照合し、**内容の欠落なし**を確認
  （差分は見出し構造・相対リンク化・節見出しへの昇格のみ）。内部リンクは全件解決。
  旧26タスクID＝新12ファイル＋completed 9＋backlog 5 で一致。
- 未実施: commit、push、deploy。

## 2026-08-01 — Access保護付きPro Review Pagesを初回deploy

- 担当: Codex。UserがCloudflare PagesのPreview access policy有効化を完了したため、
  `inventory-app-pro-review`の`pro-review` Previewだけを初回deploy。本番Pages、通常Worker、本番D1、
  migration、commit、pushは変更していない。
- 対象: `develop@e35c2ba`＋未commit差分。Wrangler `4.118.0`を使用。
- 検証:
  - Worker: 15 files / 196 tests passed。
  - App: 67 files / 658 tests passed。
  - `VITE_SYNC_WORKER_URL=wss://inventory-sync-pro-review.yuya-takaki.workers.dev`、
    `VITE_DEPLOYMENT_CHANNEL=pro-review`、`VITE_REVIEW_PLAN=pro`でproduction build成功（444 modules）。
  - build内に専用Worker URLと`PRO REVIEW · テストデータ`表示を確認。通常Worker URLはJS assetに不在。
  - deployment ID `4e8cedd7-2dbf-4ab6-b4b4-bee250fea610`。
    固定URL `https://pro-review.inventory-app-pro-review.pages.dev`、固有URL
    `https://4e8cedd7.inventory-app-pro-review.pages.dev`。
  - 両URLとも未認証アクセスはCloudflare Access loginへ`302`。専用Worker healthは`200 OK`。
    固定Review originにはCORS許可、develop originには`Access-Control-Allow-Origin`なし。
  - 専用D1をread-only確認し、`PRO REVIEW TEST`（`EXCFGA`）1店舗、`plan=pro`、`deleted_at=null`、
    queryの`rows_written=0`を確認。
- 残件: このセッションでは操作可能なbrowserが無く、Access login後の画面目視とDevTools上の
  `X-Robots-Tag: noindex`確認は未実施。Userが固定URLを開き、レビュー識別表示・ログイン・主要機能を実機確認する。
- 既知warning: Vite CJS API deprecated、500 kB超chunk。commit、pushは未実施。

## 2026-07-28 — 無料枠上限メッセージからPlay課金誘導表現を除去

- 担当: Claude Code。D-016（恒久無料＋将来Web PRO）に伴い、**契約手段が存在しないPROの利用を促す文言**を除去。
- 判断根拠: Play Billingの義務は「アプリ内でデジタル商品を販売する場合」に発生する。現状は決済導線・
  外部リンクがゼロ（`app/src` に `href="http(s)://` の一致なし）で課金ポリシー違反には当たらない。
  残るリスクは**購入できないプランの利用を促す誤認表示**であり、事実の告知へ置換して解消した。
- 変更（Codex編集中ファイルとは行が重複しない範囲のみ）:
  - `App.vue` 3か所: 「さらに登録するにはPROプランをご利用ください」→
    「無料プランの上限（150品目）に達しました。上限の緩和は将来提供予定です。」
  - `SessionListPage.vue`: 「過去N件の履歴はPROプランで閲覧できます」→「〜は無料プランでは表示されません」。
    **「アップグレード」ボタンを「詳しく」へ改称**（購入動作を示唆するCTAだった）。reason文にも将来提供予定を明記。
- 非対象: `UpgradeModal.vue`（Codexが価格・CTA撤去済み）、接続端末数の警告（`App.vue:225`。元から事実告知のみ）。
- 検証: App 67 files / 657 tests passed。production build成功（precache 2075.73 KiB）。
  文言に依存するtestは存在しないことをgrepで確認済み。
- 残る要判断（User）:
  - `terms` 第4条の「月額2,980円」表記。アプリ内から到達する法務ページに価格が載る状態。購入導線がないため
    通常は問題ないが、完全に安全側へ倒すなら金額を落として「提供開始時に別途掲示」に留める。
  - Play Consoleの「アプリ内購入」申告を**なし**にする。
  - 購入手段がない以上、上限到達時にPROモーダルを開く体験自体の是非（トースト等へ変更するか）。
- 注意: 作業中に`App.vue`がCodex側でも編集された（`isProReviewEnvironment`とPRO REVIEWバッジの追加）。
  今回の変更とは行が重複せず競合しなかったが、**`App.vue`は現在共有ファイル**のため以降の編集は要調整。
- 未実施: commit、push、deploy。task-listの状態更新はCodexの編集中のため未実施。

## 2026-07-28 — D-016無料版方針を実装・PostHog設定手順を整理

- 担当: Codex。User採用の「恒久無料版＋将来Web PRO」を実装と現行文書へ反映。
- 無料登録でも1店舗の店舗コードと4桁PINを発行し、無料枠を接続端末2台・品目150件・
  棚卸履歴直近3回とした。
- `LIMITS_DISABLED`とlocalStorageのPRO自己申告、Workerの14日トライアル算出を撤去。
  初回公開では全店舗をfreeとして扱い、自動課金・自動有料化を行わない。
- アプリ内の価格・Stripe・外部決済CTAと3か月無料表記を撤去。landing、公開/正本terms、
  support、reviewer guide、料金戦略を同期し、将来Web PROは月額2,980円の提供予定とした。
- `posthog-setup-checklist.md`を追加。EU Cloud、IP破棄、autocapture/replay等off、明示同意、
  custom event allowlistを採用する。現行Freeの保持は1年のため、User承認まではno-opを維持する。
- 検証:
  - 対象App 3 files / 67 tests passed。
  - 対象Worker 2 files / 30 tests passed。
  - App全体 67 files / 652 tests passed。
  - Worker全体 15 files / 193 tests passed。
  - App production build成功（444 modules）。
  - `git diff --check`成功。Vite CJSと500 kB超chunkの既知warningあり。
- 未実施: commit、push、deploy、Cloudflare resource変更。
- 残り: server-side無料枠強制、PRO entitlement配線、PostHog 1年保持のUser承認とproject情報、
  developと分離したAccess保護付きPRO review環境の採否。

## 2026-07-28 — アカウント登録拡張（復旧用メール・PIN復旧・アンケート）の設計を提案箱へ起票

- 担当: Claude Code。**コード変更なし**。User構想の共有を受けた設計整理のみで、Codexへは未共有。
- User判断: 実装時期は決めず「まず設計だけ固める」。PIN復旧の方式（リンク/コード）は未決。
- `docs/proposals.md` へ起票。主な論点:
  - **メールを identity にしない**。`enterprise-design.md` §9.1/§9.2 は「店舗＝共有アカウント」を採用済みで、
    email認証は org_admins（本部層）に置く設計のため、店舗層のidentityをメールへ移すと衝突する。
    → 復旧用の連絡先として `stores` に任意列を足すに留め、ログインは `shop_code + PIN` を維持。
  - **PIN復旧はログイン相当**。`authHandler.js:142` の単一ホストセッション（成功時に全token失効）により、
    復旧すると稼働中の他端末が落ちる。挙動は維持しUIで明示する。
  - **強度差**: メール到達だけでPIN再設定できると実強度＝メールアカウントの強度。単回・短命・ハッシュ保存の
    復旧トークン、復旧後の全token失効、メール/IP単位のレート制限、**列挙対策（応答を常に同一に）**、
    未確認メールでの復旧禁止を条件とする。
  - **削除範囲**: `accountDeletion.js` の13グループへメール・復旧トークン・アンケート回答を追加し、
    `0011` と同型のトリガを新表にも付ける。7日tombstone中の再登録判定は**メールハッシュのみ保持**を推奨。
  - **アンケートは任意・目的限定**。Data Safety申告対象になるため必須化しない。
  - **配信基盤が未存在**。Cloudflare Email Serviceが構成上自然。送信ドメインとSPF/DKIM/DMARCが先行作業で、
    canonical host（`DS-08`）の決定と同時に決めるのが効率的。
- 既存成果への影響（実装する場合）: `data-safety-form-draft.md` の前提「アカウントに紐づく個人情報なし」が崩れ、
  privacy §2/§4/§5/§6 とterms第6条3・第11条3の再改定が必要になる。スプリント凍結の対象外作業のため、
  着手は8/8以降または凍結解除のUser判断が要る。
- **確認**: 本件があっても、`PLAY-004` 残blocker①のterms同期を「掲示」方向で進める判断は変わらない。
  規約は現況の実装を述べるものであり、メール登録の実装時に改めて「通知」へ改定するのが正規手順。
- 未実施: commit、push、deploy。task-listへの新規タスク登録はPMトリアージ後。

## 2026-07-26 — TEST-001完了・develop CI local gate全件成功

- UserがD-005を「日付昇順＋同一日内はCSVでの仕入先初出順」で決定。
  同一日・仕入先の複数行は最初の登場位置へ1件に集約する。
- `deliveryImportCommit.js`へgroupの`firstSeen`を追加し、locale依存の仕入先名sortを除去。
  日付が前後する入力、同一仕入先の再登場、日本語名を含む回帰testを追加した。
- 検証: 対象4/4、clean install後にApp 67 files / 658 tests、Worker 15 files / 195 testsが全件成功。
  App production build成功（444 modules）、`git diff --check`成功。
- `TEST-001`を完了へ更新。CI-001の残りはcommit/push後のActions実行とpreview更新確認。
- 既知warning: App `npm ci`はNode 22に対するZXing Node >=24 engine警告、buildは500 kB超chunk警告。
  dependency auditはApp 12件、Worker 7件を報告するが、このタスクでは変更していない。
- commit、push、deploy、remote migrationは実施していない。

## 2026-07-26 — Codex: PLAY-004後半独立review・全体回帰

- CCの公開privacy/terms/support、削除/landing/settings導線、retention・外部送信文面を独立review。
  公開3 HTMLと主要実装事実は承認。targeted 5 files / 66 tests passed。
- 全体回帰: Worker 15 files / 195 passed。App 67 files中66 passed、656 passed / 1 failed。
  失敗は仕様判断待ちの既知`TEST-001`だけ。App production build成功（444 modules）、`git diff --check`成功。
- 未解消review指摘: `docs/legal/terms.md`（正本）と公開/landing termsに終了通知・免責・規約変更等の文面差が残る。
  また`landing/index.html`の月額1,980円・解約表現は「現在無料・決済なし」のtermsと矛盾する。
- canonical URL/contact、料金表示、D-005仕入先順はUser判断待ち。実機UI/公開networkは未確認。
- commit、push、deploy、remote migrationは実施していない。

## 2026-07-26 — PLAY-004後半: 公開legalページ・URL導線・legal文面の実装整合

- 担当: Claude Code。Codexの`PLAY-003`成果（`privacy-retention-draft.md`、`data-safety-audit.md`）を公開面へ反映。
- **配信方式の判断**: 公開legalは `app/public/` の静的HTML（`/privacy.html` `/terms.html` `/support.html`）。
  SPA・認証・installを介さず到達でき、アプリからは**相対リンク**で繋ぐため canonical host 未確定（`DS-08`）でも
  導線を完成できる。Play Console へ登録する絶対URLだけがUser待ちになる。
  `landing/` はどのdeploy scriptにも含まれない手動サイトのため、公開面は app deploy（`app/dist`）に一本化した。
- **配信の落とし穴に対処**: ①`_redirects`のSPA catch-all（`/* → /index.html`）より前に
  `/privacy` `/terms` `/support` の200 rewriteを追加。②`vite.config.js`の`navigateFallbackDenylist`へ
  3 pathを追加し、インストール済みPWAが拡張子なしURLでアプリ本体へ倒れないようにした。
- **文面の実装整合**: 保持期間（token 30日 / DO chat・監査 200件かつ24時間 / login・IP失敗記録 最長約24時間15分 /
  削除receipt・匿名tombstone 7日 / D1 Time Travel 契約planに応じ最大30日）、外部送信先（Cloudflare、Push service、
  Open-Meteo、BigDataCloud）、任意権限の発生条件を反映。旧記載の「操作ログ1年」「アクセスログ90日」を削除。
  Stripe・PostHogを委託先から外し「現在利用していません」と明記（`DS-09`）。termsの第4条を
  「無料提供・決済機能なし」へ改定し、料金前払い・返金・支払未確認による登録取消の条項を落とした。
  Workers Logsは有効/無効が未確認のため「記録される場合はCloudflareの仕様に従う」という条件付き表現にした。
- **端末内データ（`DS-02`）**: 削除後も残る端末ID・端末名・天気の位置情報を明示し、Android/Chrome・
  PWA・iOS Safari・PCブラウザ別の消去手順をsupportページに用意。privacy §8 と設定画面から接続した。
  削除時に端末設定まで消す方針へ変える場合は、文面より先に実装とtestを変える必要がある旨を台帳へ残した。
- **導線**: LandingPage下部、SettingsModal「法的情報・サポート」、公開削除ページ（`PRIVACY_URL`等を実URLへ）。
- 正本 `docs/legal/{privacy-policy,terms}.md` と `landing/{privacy,terms,support}.html`（support は新規）も同期。
- 検証:
  - 新規 `src/utils/legalPages.test.js` 47件: ページの存在、viewport/lang、外部リソース非依存（CSP self）、
    contact統一（`support@tanaoro.com`混在の検出）、旧記載（90日・1年間・Stripe, Inc.）の再発防止、
    実装事実の記載、アプリ3導線、`_redirects`の順序、PWA denylist。
  - `DeleteAccountPage.login.test.js` に未ログインでの3リンク到達を1件追加。
  - build後 `dist/` に3ページと`_redirects`が出力（precache 15 entries）。`vite preview`で
    `/privacy.html` `/terms.html` `/support.html` `/?delete-account` が**未ログインでHTTP 200**、
    titleも期待どおりであることを確認。
  - App全体: 67 files / 656 passed、既知`TEST-001`のみ1 failed。build成功。
- 未実施: commit、push、deploy。実機（375px）での目視確認。
- 次の再開地点: Codexによる公開legalページ・導線・文面の独立review。
  Userは canonical host と統一contact（`DS-08`）を決定。決定後にCCが絶対URLを反映する。
- 要User判断: `landing/index.html` の「¥1,980/月」表示が改定後のterms（決済機能なし）と矛盾する。
  landingはdeploy対象外だが、公開するなら料金表示の扱いを決める必要がある。

## 2026-07-26 — Cloudflare read-only preflight・D1 migration列挙修正・CC legal再review

- 担当: Codex。Cloudflare/Wranglerをread-onlyで確認。D1 Time Travel info取得は成功したが、bookmark値は
  repositoryへ記録していない。account plan名と保存済みWorkers Logs設定はCLIで取得できず、
  Dashboard用browserも未接続のためUser確認を残した。
- 本番D1 schemaには0010の`movements`/`movement_lines`、0011の削除列・receipt・triggerが存在せず、
  両migrationが未適用と確認。remote write、migration、deployは実施していない。
- 手動backend deploy用`scripts/migrate.sh`が0009までしか列挙していなかったため、0010/0011を追加。
  migration directory全件を順序どおり列挙する`worker/test/migrationScript.test.js`を追加し、1 test passed。
- develop workflowはfrontend preview専用でD1/Workerを変更しないことを再確認。標準Wrangler migration履歴ではなく、
  repositoryのschema sentinel方式で適用状態を判定する運用を`docs/ci-cd.md`へ明記した。
- CCの公開privacy/terms/support・app導線を独立reviewし、対象5 files / 66 tests passed。
  canonical URLと統一contactはUser確定待ちで、公開済みとは判定していない。
- ZXing: `@zxing/browser@0.2.0`が要求する`@zxing/library@^0.22.0`はNode >=24を宣言。
  現行Node 22ではwarningのみでtest/build可能だが、CI Node 20との組合せをrelease前にNode 24へ揃えるか、
  browser 0.1.5/library 0.21系へ下げるかを別依存判断とする。
- commit、push、deploy、remote migrationは実施していない。

## 2026-07-26 — PLAY-003 / PRIV-001 data最小化実装・回答draft・CC再review

- 担当: Codex。CCの`DS-01`、名称統一、reviewer手順書を独立reviewし、`_data_owner`は
  account削除成功時だけ消し、logout/account切替では保持する設計を承認した。途中cleanupが例外でも
  owner削除を必ず試すよう`clearDeletedAccountLocalData()`を`finally`で補強した。
- Data Safety / privacy: `data-safety-form-draft.md`と`privacy-retention-draft.md`を作成。
  位置情報、音声、Push、端末名/ID、chat、security record、D1 Time Travelをdata type/保持期間へ対応付けた。
  現行policyの「操作log 1年」「access log 90日」「Stripe利用中」は実装不一致として公開前修正対象にした。
- PRIV-001: `posthog-js`依存、key例、CSPのPostHog接続先を除去。analytics moduleを常時no-op化し、
  旧PostHog localStorageだけを削除するunit testを追加。source/package/CSP/buildにimport/key/host残存なし。
- Security retention: `login_attempts` / `ip_attempts`は15分の判定窓を維持し、期限切れrowを既存日次cronで
  全体cleanupする実装とtestを追加。実保持は最長約24時間15分。platform logはdashboard確認を別gateとした。
- D1: `d1-recovery-runbook.md`を作成。Time TravelはFree 7日/Paid 30日、restoreは破壊的であり、
  復元前の削除抑止list退避と復元後の再削除を必須化。現状はmaintenance modeと外部削除ledgerがないため、
  本番restoreを安全に完遂できないことを明記した。
- 検証:
  - App clean install `npm ci`成功。`npm ls vitest vite esbuild posthog-js`成功。
  - Worker: 14 files / 194 tests passed。
  - App: 608 passed / 1 known failure（`TEST-001`の日本語仕入先名順序）。
  - App production build成功（444 modules）。500 kB超chunk警告は既知の`PERF-001`。
  - `git diff --check`成功。
- 注意: `npm ci`は現行Node 22.14.0に対し`@zxing/library@0.22.0`がNode >=24を要求する
  engine warningを出すが、test/buildは上記結果。別の依存更新判断が必要。
- 未完了gate: public privacy/terms/support URL・統一contact、端末設定保持、TWA microphone、`/pdf`存廃、
  本番Cloudflare plan/Workers Logs、provider共有例外、公開build network、Play Console双方照合。
- deploy、remote migration、commit、pushは実施していない。

## 2026-07-26 — PLAY-004前半の実施（名称統一・reviewer手順書）とDS-01修正

- 担当: Claude Code。前回の前半監査で「User判断待ち」だった指摘を実施し、Codexの`DS-01`へ対応した。
- **名称統一（前半の最重要指摘）**: `index.html`（`title`=`棚卸入力`→`タナオロ`、`apple-mobile-web-app-title`=
  `棚卸`→`タナオロ`）、`AuthPage.vue`・`HomeScreen.vue`（`棚卸管理`→）、`LandingPage.vue`・
  `StoreSetupModal.vue`（`棚卸アプリ`→）を`タナオロ`へ統一。`app/`配下の旧表記は残存0で、
  manifest・公開削除ページ・onboarding と5表記すべてが一致した。旧表記に依存するtestは無し。
- **reviewer手順書を新規作成**: `play-reviewer-guide.md`。Play Consoleの「アプリのアクセス権」へ貼る本文、
  社内実機チェック9手順、削除2経路（アプリ内はログイン済みのみ表示／公開Webは未ログイン可）、
  権限4種の発生条件、TWAで課金導線が出ない根拠、未確定項目の owner 一覧。
  test店舗のcode/PINと公開URLはUser記入待ち。reviewerが削除を実行するとその店舗は再ログイン不可
  （7日tombstone）になるため、予備のtest店舗を用意する注意を明記した。
- **DS-01（Codex指摘）**: 削除完了後も`_data_owner`（店舗code）がlocalStorageへ残る不整合を修正。
  `clearDeletedAccountLocalData()`を追加し`DeleteAccountModal.finalize()`から使用。ログアウト・
  アカウント切替では`_data_owner`を残す（消すと再ログイン時に切替を検出できず前アカウントのデータが残る）。
  修正前に公開削除ページの通しテストが`_data_owner="STOREA"`残留で失敗することを確認済み。
- 前半監査の補正: cameraは`BarcodeScanner.vue`が直接`getUserMedia`を呼ばず`@zxing/browser`の
  `decodeFromConstraints`経由。位置情報は自動取得ではなく「📍 現在地で天気を表示」押下時のみ
  （`SessionListPage.vue:636`）で、拒否しても主機能は完結する。→ `DS-02`の申告文はこの前提で作れる。
- 検証:
  - 新規`DeleteAccountPage.delete.test.js` 2件＋`accountData.test.js` 4件追加。削除経路 6 files / 35 passed。
  - `cd app && npm test`: 64 files / 603 passed、既知`TEST-001`（仕入先順）のみ1 failed。回帰なし。
  - `cd app && npm run build`: 成功（PWA precache 2244.75 KiB）。
- 未実施: commit、push、deploy。実機UI確認。
- 次の再開地点: Codexが①DS-01修正 ②reviewer手順書 ③名称統一 を独立review。
  Userは手順書§1のtest店舗と`DS-08`のURL/contactを確定。後半（公開legalページ）は`PLAY-003`完了後。

## 2026-07-26 — PLAY-003 / PRIV-001 初回実装整合監査

- 担当: Codex。`data-safety-audit.md`を新設し、App/Worker/D1/DO/localStorage/第三者SDKを
  data type単位で収集・送信・保存・削除・保持・Data Safety候補へ整理した。
- PLAY-002追加gate: 削除成功後も`_data_owner`（店舗code）がlocalStorageへ残る。画面回帰の承認は維持するが、
  account data削除はClaude Code修正→Codex再reviewまで未完了。
- PRIV-001: tracked build設定ではPostHog key未注入でno-op。ただしkey設定時はautocapture default=true、
  default opt-in、自由記述feedback送信となる。品質凍結期間は無効固定を推奨。
- privacy差分: 現行の操作log 1年/access log 90日は実装証拠と不一致。Push/Web Speech/DO chat/device IDs、
  7日tombstone/receipt、D1 Time Travel、即時削除導線も記載不足。Stripeは未実装なのに現行サービスとして記載。
- 公開前gate: device名/ID・位置情報保持、security row保持、D1 plan、`/pdf`存廃、canonical URL/contactをUser決定。
  Claude Codeは`_data_owner`修正と公開legal route/URL導線、Codexは保持・PostHog・Worker/運用整合と再reviewを担当。
- 検証根拠: PLAY-002 6 files / 40 tests passed。監査はdocs/code reviewで、追加testは未実施。
- 未実施: deploy、migration、commit、push。

## 2026-07-26 — PLAY-004 前半監査（TWA・reviewer導線・名称・store metadata）

- 担当: Claude Code。**監査のみでコード変更なし**（指摘は起票し、実施はUser判断後）。
- TWA課金導線: **問題なし**。価格・決済CTAは `UpgradeModal.vue` に集約され `twaMode` で非表示。
  呼び出しは `App.vue:2604` の1箇所のみで `isTwaApp()` を必ず渡す。`STRIPE_CHECKOUT_URL` は空文字で
  他参照なし。TWAでは `LandingPage` が無料版案内＋PRO契約済みログイン入口のみ表示。
- **最重要指摘: アプリ名が5表記に分裂**（`タナオロ` / `棚卸入力`(title) / `棚卸`(apple title) /
  `棚卸管理`(AuthPage・HomeScreen) / `棚卸アプリ`(LandingPage・StoreSetupModal)）。
  store listing・アプリ内・公開削除リソースの名称一致はPlay要件のため `タナオロ` への統一が必要。
  Deliverable B で公開ページのみ先に `タナオロ` へ揃えた件の残りにあたる。
- reviewer導線: 削除は `SettingsModal.vue:360` の `isAuthenticated && !isGuest` ガード下にあり、
  **未ログインでは不可視**。reviewer用test店舗の認証情報が必須。公開Web `?delete-account` は
  未ログインでも到達できるため審査手順に使える。
- 権限申告の要確認: camera(BarcodeScanner)・microphone(useVoice)・通知(usePush)に加え、
  **位置情報(useWeather の geolocation)** を検出。棚卸の主機能と無関係に見えるため
  Data Safety申告・機能説明との整合を `PLAY-003` と突き合わせる必要がある。
- store metadata: manifest description は実機能と整合。icon 192/512/maskable あり。
- 次の再開地点: 名称統一の実施可否をUser判断 → 反映。reviewer手順書の作成。
  公開legalページ・URL導線は `PLAY-003` 完了後、screenshots は 8/6 UI freeze 後。

## 2026-07-26 — PLAY-002 Deliverable B承認 / PLAY-003・PRIV-001着手

- 担当: Codex。
- PLAY-002再レビュー: 公開routeと削除pageを実mountする画面レベル回帰を承認。追加blockerなし。
- 検証: 削除関連6 files / 40 tests passed。未login/login済みroute、入力、login成功/失敗、
  削除対象表示、削除modal起動、通常route非干渉を確認。
- PLAY-002残件: User実機UI、PLAY-003後のprivacy/terms/support確定URL、据え置き合意済みfocus trap。
- 着手: PLAY-003とPRIV-001。App/Worker/D1/DO/端末/第三者SDKをdata type単位で監査し、
  Data Safety案、privacy保持文面、公開URLのCC handoffを作る。
- 未実施: deploy、migration、commit、push。

## 2026-07-26 — CI-001 develop Pages preview 自動化（ローカル適用）

- 担当: Codex。User承認によりD-006を更新し、`develop` push後の固定preview自動更新を採用。
- 追加: `.github/workflows/develop-preview.yml`。Worker/App testとApp buildに成功した場合だけ、
  Cloudflare Pagesの`develop` branchへfrontendをdeployする。
- 固定URL: `https://develop.inventory-app-c40.pages.dev`。
- 安全境界: D1 migration、Worker、本番Pagesは自動変更しない。preview frontendは本番Workerを参照するため、
  実機確認にはtest店舗を使う。
- 文書: `CLAUDE.md`、`docs/ci-cd.md`、D-006、CI-001を現行workflowへ同期。
- CI安定化: フルsuite時だけ5秒を超えた`App.deleteRoute.test.js`の公開削除画面testに15秒timeoutを設定。
- 検証:
  - `cd worker && npm test`: 13 files / 191 passed。
  - `cd app && npx vitest run src/App.deleteRoute.test.js`: 1 file / 3 passed。
  - `cd app && npm test`: 62 files / 597 passed、既知`TEST-001`のみ1 failed。
  - `cd app && npm run build`: 成功（445 modules、PWA precache 2244.68 KiB）。
- 状態: CI-001は進行中。commit/pushとActions実行は未実施。`TEST-001`解消まではtest gateでdeployされない。
- 未実施: D1 migration、Worker deploy、本番Pages deploy、commit、push。

## 2026-07-26 — PLAY-002 Deliverable B 画面レベル回帰テストへの作り直し

- 担当: Claude Code。Codex 指摘（前回のtestは画面を描画せず回帰にならない）は妥当と判断し全面的に作り直し。
- テスト基盤（新規依存なし・既存devDependencyのみ）:
  - `vitest.config.js` に `@vitejs/plugin-vue`（ビルドで既に使用）を追加し、`.vue` を mount 可能にした。
  - `virtual:pwa-register/vue` は PWA プラグイン非搭載のテストで解決できないため、
    `src/test-stubs/pwaRegister.js` へ alias（Windows 対応のため `fileURLToPath` 使用）。
  - `@vue/test-utils` は導入せず、Vue 本体の `createApp` + jsdom の実 DOM 操作で検証。
- `DeleteAccountPage.login.test.js`（5件・実mount）: 未ログイン時の入力欄表示／店舗コード小文字→大文字化を
  含む input イベント→ログインボタンclick→**削除対象アカウント画面への遷移**／PIN 4桁未満はAPIを呼ばず
  エラー表示・非遷移／ログイン失敗は非遷移／「アカウント削除に進む」で削除モーダル（role=dialog・
  再認証PIN欄・店舗コード確認欄）が開く。
- `App.deleteRoute.test.js`（3件・App を実mount）: 未ログイン+`?delete-account` で公開削除ページが描画される／
  ログイン済みでも同ルートを優先し削除対象を表示／パラメータ無しでは削除ページを出さない（通常起動を阻害しない）。
- 検証:
  - App 全体: 63 files / 597 passed、既知 `TEST-001`（仕入先順）のみ 1 failed。config 変更由来の回帰なし。
  - Worker 全体: 13 files / 191 passed。App production build 成功。
- 未対応（合意済み/依存）: focus trap、実機UI確認、privacy/terms/support 確定URLと保持方針文面（`PLAY-003`）。
- 未実施: commit、push。
- 次の再開地点: Codex 再レビュー（画面レベル回帰の充足確認）。

## 2026-07-26 — PLAY-002 Deliverable B レビュー指摘の修正

- 担当: Claude Code。Codex の changes requested 2点へ対応。Worker 無変更。
- 指摘1（アプリ名）: 事実確認のうえ修正。PWA manifest（`vite.config.js`）は `name/short_name = タナオロ`、
  アプリ内も「タナオロの使い方」「タナオロ プロプラン」が正式名。`DeleteAccountPage.vue` の
  `APP_NAME` を「棚卸管理」→「タナオロ」へ。manifest と併せて更新する旨をコメントで明記。
  ※`AuthPage.vue` / `HomeScreen.vue` の見出しは「棚卸管理」のままで表記が混在。公開ページのみ
  listing 名に一致させる方針（User 判断 2026-07-26）。アプリ全体の表記統一は `PLAY-004` で扱う。
- 指摘2（公開routeのtest）: URL 判定を `utils/startupRoute.js` の `isDeleteAccountRoute()` へ切り出し、
  App.vue から使用。`@vue/test-utils` は未導入のため依存追加はせず、描画に依存しない形でテスト化。
  - `startupRoute.test.js` 7件: 値なし/値付き/他param併用/部分一致は反応しない/room・store では false/
    null・undefined 安全。＝未認証でも公開ページが優先表示され、通常起動を妨げない回帰。
  - `DeleteAccountPage.login.test.js` 3件: 店舗code+PIN login 成功で認証済み・削除対象確定、
    失敗では認証状態を作らない、別アカウント login で前アカウントのローカル業務データが掃除される。
- 検証: 削除経路 5 files / 35 tests passed、`npm run build` 成功（precache 2244.68 KiB）。
- 未対応（合意済み/依存）: focus trap、実機UI確認、privacy/terms/support 確定URLと保持方針文面（`PLAY-003`）。
- 未実施: commit、push。
- 次の再開地点: Codex 再レビュー（指摘2点の解消確認）。

## 2026-07-26 — PLAY-002 Deliverable B Codex独立レビュー（changes requested）

- 判定: 公開Web削除経路の設計・実装方針は妥当。ただし、Google Playへ登録できる完成状態としては
  修正2点と`PLAY-003`の公開前gateが残る。
- 確認できた点:
  - `?delete-account`を認証・room・session復元より先に判定し、未install/未loginでも専用viewへ到達する。
  - 店舗code+PINでlogin後、承認済み`DeleteAccountModal`と同じbackend contractを再利用する。
  - account切替時はlocal auth/shop codeを消去し、別account login時はowner差分でlocal業務dataを掃除する。
- 修正依頼:
  1. `DeleteAccountPage.vue`の`APP_NAME`が「棚卸管理」だが、PWA manifest・privacy policy・termsの
     正式サービス名は「タナオロ」。Google Playの公開Web resourceはstore listing上のapp名または
     developer名を参照する必要があるため、listingと一致させる。
  2. 新規の公開route/viewに専用の自動testがない。少なくとも`?delete-account`が未認証でも優先表示される
     回帰testと、公開pageのlogin入力/遷移のtestを追加する。
- 公開前gate（`PLAY-003`依存）:
  - privacy/terms/support URLは現在空で非表示。確定HTTPS URLを反映する。
  - privacy policyへ、匿名tombstone/receiptの7日保持、D1 Time Travel/provider backupの回復期間、
    account非連結security recordの保持方針を実装と矛盾なく反映する。保持するdataがある場合は明示が必要。
- 根拠: Google Play公式のaccount deletion要件は、Web linkが機能し、削除申請手段を目立つ形で示し、
  store listing上のapp/developer名を参照することを要求。正当な理由でdataを保持する場合は保持方針を明示する。
- 検証:
  - App全体: 60 files中59 passed / 1 failed、582 tests passed / 既知`TEST-001`のみ1 failed。
  - production build成功（444 modules、PWA precache 2244.58 KiB）。
  - local `/?delete-account`のHTTP応答を確認。操作可能なbrowser接続が無かったため目視・click・mobile実機は未実施。
- 未実施: App実装変更、deploy、commit、push。
- 次の再開地点: Claude Codeが上記2点を修正後、Codex再レビュー。公開URL/保持文面は`PLAY-003`で確定する。

## 2026-07-26 — SEC-004 ホスト認可境界のfail-closed化 完了

- 担当: Codex。Claude CodeのPLAY-002 Deliverable B（App）とは非競合のWorker lane。
- 問題: D1のstores照会失敗時にWorkerがDOへ素通しし、RoomDOも保護状態不明をlegacy扱いしたため、
  空室では第三者へ新規host tokenを発行できた。
- 修正:
  - Worker room gateはDB未設定/D1例外を503で閉じ、DOへ到達させない。
  - RoomDOは明示的に存在するPIN未設定店舗だけlegacy互換。不明/DB未設定/D1例外は保護扱いとし、
    有効auth tokenなしの新規host tokenを拒否。
  - レート制限table障害は認可境界ではないため、従来のfail-openを維持。
- テスト: 修正前に4経路の失敗を確認。対象3 files / 86 tests、Worker全体13 files / 191 tests passed。
- 根拠: Cloudflare Workers/DOの最新best practices（例外境界、明示的エラー、DO呼出し失敗の伝播）を確認。
- 未実施: deploy、実環境変更、commit、push。
- 次の再開地点: CCのDeliverable B独立レビュー。またはCodexの次タスク`SEC-005`。

## 2026-07-26 — PLAY-002 Deliverable B 公開Web削除ビュー 実装（レビュー待ち）

- 担当: Claude Code。承認済みの Deliverable A（削除フロー）を再利用。Worker 無変更。
- 対象: アプリ未インストールでもブラウザから削除申請できる公開Webリソース（Play の Data deletion URL 用）。
- 実装:
  - `App.vue` の onMounted 冒頭で `?delete-account` を検出し、認証・ルーム・セッション復元より優先して
    `currentView='delete-account'` を表示（未ログインでも到達可）。テンプレートに専用ビュー分岐を追加。
  - 新規 `DeleteAccountPage.vue`: アプリ名・削除対象・復元不能を明示。未ログインは店舗コード+PIN で
    `login()`→承認済み `DeleteAccountModal` を再利用して削除。完了時は静的な完了表示。
  - privacy/terms/support は設定値化（`PRIVACY_URL` 等）。未設定なら導線非表示。**確定URLは PLAY-003 依存**。
- 検証: `npm run build` 成功（precache 2244 KiB＝新ページ反映）。削除ロジックの unit test 16 緑（回帰なし）。
- 残り: 🖐実機UI（in-app＋公開ページ）、privacy/terms/support の確定URL反映（PLAY-003）、focus trap、
  Codex による公開ビューの独立レビュー。
- 未実施: commit、push。
- 次の再開地点: Codex の公開ビュー独立レビュー＋実機確認 → 確定URL反映。

## 2026-07-26 — PLAY-002 Deliverable A 低優先残件のCodex確認

- 判定: **対応2点を承認、追加指摘なし**。Deliverable Aのコードレビューは完了。
- Push非対応時も先に購読表示state/keyを消し、既存購読の有無にかかわらずremote `apiFetch`を
  呼ばないことをテストで固定したことを確認。
- 検証:
  - `usePush.local.test.js` + `accountDeletionFlow.test.js` + `api.test.js`: 3 files / 25 tests passed。
  - App全体: 59 files / 578 tests passed、既知`TEST-001`のみ1 file / 1 test failed。
  - App production build成功（442 modules）。
- Deliverable Aにコード上の追加残件なし。PLAY-002全体は実機UI、focus trap、公開Web削除ビュー、
  privacy/terms/support導線を継続する。
- 未実施: App実装変更、commit、push、deploy。

## 2026-07-26 — PLAY-002 Deliverable A 低優先残件の対応

- 担当: Claude Code。Codex 追再レビュー（承認）の低優先2点へ対応。Worker 無変更。
- A（非対応環境でも購読key掃除）: `unsubscribePushLocal()` の `pushSubscribed=false`＋`_KEY`削除を
  `pushSupported` 早期returnより前へ移動。Push 非対応環境で削除しても「通知ON」表示が残らない。
- B（remote未呼出しの固定）: `usePush.local.test.js` で `api.js` をモックし、`apiFetch` が呼ばれない
  ことを全ケースで assert。加えて非対応環境で key を消して false を返す test を追加（計3件）。
- 検証: `usePush.local.test.js`＋`accountDeletionFlow.test.js` `16 passed`、`npm run build` 成功。
- 据え置き（合意済み）: focus trap。PLAY-002 残タスク: 実機UI・公開Web削除ビュー・privacy/terms/support導線。
- 未実施: commit、push。

## 2026-07-26 — PLAY-002 Deliverable A 再レビュー残件のCodex確認

- 判定: **対応2点を承認**。Deliverable Aの承認状態を維持する。
- UUID: 保存済みrequestIdをWorkerと同一のUUID patternで検証し、非UUIDを再生成することを確認。
- Push: `getRegistration()`によりSW未登録時も即時完了し、既存購読はremote APIを使わず
  browser側だけ解除することを確認。
- 検証:
  - `accountDeletionFlow.test.js` + `usePush.local.test.js` + `api.test.js`: 3 files / 24 tests passed。
  - App全体: 59 files / 577 tests passed、既知`TEST-001`のみ1 file / 1 test failed。
  - App production build成功（442 modules）。`git diff --check`成功（改行warningのみ）。
- 低優先残件: `pushSupported === false`でも購読表示keyを消すこと、remote API未呼出しをspyで固定するtest。
- PLAY-002全体の残件は実機UI、focus trap、公開Web削除ビュー、privacy/terms/support導線。
- 未実施: App実装変更、commit、push、deploy。

## 2026-07-26 — PLAY-002 Deliverable A 再レビュー残件の対応

- 担当: Claude Code。Codex 再レビュー（承認）の非Blocker残件へ対応。Worker 無変更。
- ①保存 requestId の UUID 検証: `resolveRequestId` が保存値の `id` を UUID 形式で検証し、
  非UUID（改変/破損）は破棄して再生成。→ 直せない 400 デッドロックを防止。
- ②SW 未登録での finalize hang: `unsubscribePushLocal()` を `serviceWorker.ready`（未登録だと
  永久未解決）から `getRegistration()`（未登録なら即 undefined）へ変更。削除済みなのにスピナーが
  回り続ける事象を回避。
- テスト: `accountDeletionFlow.test.js` に非UUID破棄を追加（計13）。`usePush.local.test.js` 新規2件
  （SW未登録でも hang せず解決／既存購読は browser 側 unsubscribe のみ・remote 呼ばない）。
  対象 `15 passed`、`npm run build` 成功。
- 据え置き（合意済み）: focus trap（全モーダル共通課題）。実機UI確認・公開Web削除ビュー・
  privacy/terms/support 導線は PLAY-002 残タスクとして継続。
- 未実施: commit、push。

## 2026-07-26 — PLAY-002 Deliverable A Codex再レビュー

- 判定: **承認**。前回Blocker 2件は解消され、アプリ内削除UXは次工程へ進められる。
- requestId: `{shop,id}`で保存し、別店舗または壊れた保存値を破棄することを確認。
- Push: backend成功後は`unsubscribePushLocal()`を使い、失効済みtokenでremote DELETEせず
  browser購読解除へ到達することを確認。
- Accessibility: dialog semantics、label/input関連付け、PIN初期focus、status/alert live regionを確認。
- 検証:
  - `accountDeletionFlow.test.js` + `api.test.js`: 2 files / 21 tests passed。
  - App全体: 58 files / 574 tests passed、既知`TEST-001`のみ1 file / 1 test failed。
  - App production build成功（442 modules）。`git diff --check`成功（改行warningのみ）。
  - Worker対象4 tests、全体13 files / 187 tests passed。
- テスト配置修正: Node SQLiteを使う`pushHandler.test.js`を`worker/src`から`worker/test`へ移し、
  AppのVitest include対象から分離。実装変更なし、Worker全体成功を確認。
- 非Blocker残件: 保存requestIdのUUID形式検証、Service Worker未登録時もfinalizeを停止させない保証と
  `unsubscribePushLocal()`/finalizeの結合テスト、focus trap。
- PLAY-002全体の残件: 実機UI確認、公開Web削除ビュー、privacy/terms/support導線。
- 未実施: commit、push、deploy。

## 2026-07-26 — PLAY-002 Deliverable A レビュー指摘の修正

- 担当: Claude Code。Codex の changes requested（下記エントリ）へ対応。Worker 無変更。
- 吟味結果: Blocker 2件・a11y・unit test 要求はいずれも妥当と判断し修正。
- Blocker1（requestId 店舗scope化）: `deleteRequestId` を `{shop,id}` で保持し、`resolveRequestId()` が
  別店舗/壊れ値を破棄して再生成。backend が認証前に receipt を冪等判定するため、別店舗の残存 requestId
  再送で「別店舗を削除せず 200 alreadyDeleted」→ローカルだけ消去、の誤認経路を遮断。
  `accountData.clearLocalAccountData` の切替掃除にも `deleteRequestId` を追加。
- Blocker2（成功後 Push local-only 解除）: `unsubscribePushLocal()` を追加し finalize から使用。
  remote DELETE(401)を呼ばないため browser `PushSubscription.unsubscribe()` に必ず到達し、
  失効ハンドラ誤発火も回避。
- Accessibility: `role=dialog`/`aria-modal`/`aria-labelledby`、label と input の for/id 関連付け、
  初期 focus(PIN)、処理中=`role=status aria-live=polite`、エラー=`role=alert aria-live=assertive`。
- テスト: 純粋ロジックを `utils/accountDeletionFlow.js` へ切り出し、`accountDeletionFlow.test.js` 12件追加
  （requestId scope 5・error 写像 7）。`npx vitest run` 12 passed、`npm run build` 成功（441 modules）。
- 未対応（合意済み残件）: focus trap（アプリ全モーダル共通課題として別途）、実機UI確認、公開Web削除ビュー、
  privacy/terms/support 導線、docs更新。
- 未実施: commit、push。
- 次の再開地点: Codex 再レビュー（blocker解消確認）→ 実機確認 → 残DoD。

## 2026-07-26 — PLAY-002 Deliverable A Codex独立レビュー

- 判定: **changes requested**。AppファイルはCC担当のためCodexは未編集。
- Blocker 1: `deleteRequestId`が店舗にscopeされていない。backend成功後に応答を失いreceiptが残った状態で
  別店舗へloginすると、前店舗requestIdのreplay 200を新店舗削除成功と誤認し、localだけ消去し得る。
- Blocker 2: 削除成功時点で全tokenは失効済み。現行`unsubscribePush()`はremote DELETEの401でcatchへ入り、
  browser `PushSubscription.unsubscribe()`を実行せず、通常の「別端末login」失効handlerも誤発火する。
- Accessibility残件: `role=dialog` / `aria-modal`、label関連付け、focus管理、処理中/エラーのlive region。
- 検証: `npx vitest run src/utils/api.test.js` 1 file / 9 tests passed、`npm run build`成功（441 modules）。
- CCへの修正条件: requestIdを店舗scope化、削除成功後のPushをlocal-only解除、上記flowのunit test追加。

## 2026-07-25 — SEC-003 Push購読API保護 完了

- 担当: Codex。CCの`PLAY-002` App変更とは非競合。既存`apiFetch`のBearer自動付与も確認済み。
- 実装: Push購読作成・削除へstrict店舗認証、8KiB stream上限、公開HTTPS endpointと
  RFC 8291 / Push API準拠のP-256・auth鍵形式検証を追加。
- tenant境界: endpoint owner事前確認と原子的UPSERT条件で別店舗の奪取を409拒否。DELETEは
  `shop_code + endpoint`一致だけを削除し、他店舗操作はidempotent no-op。
- テスト:
  - 実装前に未認証、不正payload、payload超過、越境upsert/deleteの5失敗を確認。
  - 対象43 tests、Worker全体`13 files / 187 tests` passed。
- 未実施: deploy、実環境変更、commit、push。
- 次の再開地点: `SEC-004`（ホスト認可のfail-closed化）。CCは`PLAY-002`のtest・公開Web・実機確認。

## 2026-07-25 — PLAY-002 アプリ内削除UX 実装（レビュー待ち）

- 担当: Claude Code。User 承認済み方針（アプリ内UXから着手・公開Webは SPA 内 URL 起動ビュー）。
- 対象: `DELETE /auth/account`（PLAY-001 backend / D-013 確定）に対する in-app 削除フロー。
- 変更ファイル（App lane のみ・Worker 無変更）:
  - 新規 `app/src/components/DeleteAccountModal.vue`（再認証→最終確認→処理中→エラー/再試行→完了）。
  - `useAuth.js` に `deleteAccount()`、`api.js` に `err.code/err.body` 公開、`analytics.js` に `resetAnalytics()`。
  - `storageKeys.js` に `deleteRequestId`、`appMenuState.js` に `showDeleteAccount`。
  - `SettingsModal.vue` の「設定」に danger 区画（認証済みのみ）、`App.vue` にモーダル配線・戻る操作・成功時 landing 遷移。
- 契約準拠: requestId は開いた時に1回生成→保持→再試行不変・成功で破棄。409=`retryable:false` で元ID保持、
  503/通信失敗=token 温存で同一ID再試行。200 後にのみ Push解除→業務data消去→分析reset→auth破棄。
  confirmation は認証店舗コード完全一致（越境ガード）。
- 検証: `cd app && npm run build` 成功（441 modules、モーダルがバンドルに反映）。
- DoD 未了（レビュー・実機後に着手）: 🤖ユニットテスト、🖐実機UI(375px)、公開Web削除ビュー(Deliverable B)、
  privacy/terms/support 導線、test-checklist/project-status 更新、Codex 独立レビュー。
- 未実施: commit、push、deploy。
- 次の再開地点: Codex の現行実装完了後に **レビュー＋実機確認** を実施。その結果を受けて残りDoD（テスト・公開Web）へ。

## 2026-07-25 — BUG-001 cron schema修正 完了

- 担当: Codex。Claude Codeの`PLAY-002` App変更と重ならないWorker laneで実施。
- 仕様: D1に最終操作時刻がないため、途中session通知は`started_at`基準。開始24時間超・7日以内、
  activeかつ論理削除されていないsessionだけを対象にする。
- 実装: `pushHandler.js`の存在しない`sessions.updated_at`参照を`started_at`へ修正。
- テスト:
  - 全migrationを適用したNode SQLiteで、修正前の`no such column: s.updated_at`を再現。
  - cron全体実行と、開始25時間/23時間/8日超の通知境界を自動test化。
  - `cd worker && npm test`: 13 files / 182 tests passed。
- 運用: User採用の自律作業/停止確認境界をD-014へ記録。
- 未実施: deploy、実環境変更、commit、push。
- 次の再開地点: Codexは`SEC-003`（Push購読APIの認証・payload検証）。Claude Codeは`PLAY-002`継続。

## 2026-07-25 — PLAY-001 account deletion backend 完了

- 担当: Codex。Claude Codeのcontractレビュー指摘（D-013）を反映済み。
- 実装:
  - `DELETE /auth/account` と、PIN再認証・店舗code確認・UUID requestId・15分5回制限を追加。
  - 0011 migrationでpending/request列、匿名receipt、inactive accountへの再INSERT防止triggerを追加。
  - D1関連dataと全token/Push購読をbatch削除し、storeを7日匿名tombstone化。
  - 棚卸/発注2 DOの全接続・alarm・storageを内部経路から削除。
  - pending/削除済み店舗のlogin、token、store API、store参照、room gateを遮断。
  - 日次cronへ7日経過receipt/tombstone cleanupを接続。
- テスト:
  - account deletion 11件を含め、`cd worker && npm test`: 12 files / 180 passed。
  - 全11 migrationをインメモリSQLiteへ適用。削除列/receipt列と`account_inactive` triggerを確認。
- 文書: contract、D-012/D-013、Google Play data map、API/DB現況を実装へ同期。
- 未実施: production migration、deploy、commit、push。
- 次の再開地点: Claude Codeは `PLAY-002` UI/公開Web接続。Codexは接続後の認可/data削除review、
  並行可能なら `PLAY-003` または次の公開対象P1へ進む。

## 2026-07-25 — PLAY-001 backend 契約レビュー

- 担当: Claude Code（依頼: `account-deletion-contract.md` のレビュー）。アプリ本体・契約 doc は無変更（B 方針）。
- 対象: 契約 doc と実装 `accountDeletion.js` / migration 0011 / `accountDeletion.test.js` の突き合わせ。
  ※レビュー中に `accountDeletion.js` が新規出現。Codex が PLAY-001 backend を並行実装中。
- 整合を確認できた点:
  - migration 0011 の全 child 表 active-insert トリガと tombstone UPDATE が実スキーマと整合。
    line 系 4 表（inventory/order/movement/par）すべてに `shop_code` 列あり。
  - `accountDeletion.js` の data map（13 表を物理削除＋stores 匿名化＋receipt）が契約と完全一致。
  - PIN 照合は `verifyPinHash` 再利用で PBKDF2 / legacy 両対応。rate limit は login 共有窓（15分/5回）。
  - test 10 件（400 / 401 / 正常 / replay / DO失敗 / D1失敗 / cleanup）。
- 契約 doc の鮮度ズレ（未編集・申し送りのみ）:
  - `confirmation` は「認証店舗の `shop_code` と case-sensitive 完全一致」（大文字化しない）。
  - 429 閾値未記載（login 共有 15分/5回）。
  - 409 UI「同一 requestId 再試行」は誤り。409 は別 requestId 進行中のみ。
  - 処理順に requestId 形式チェック優先と PIN 失敗時 `login_attempts` 記録が未記載。
  - 7日経過後の replay は 401（冪等でなくなる）が未記載。
- 未完の配線（Codex lane、PLAY-001 完了 blocker）:
  - `DELETE /auth/account` 未配線、`purgeRooms`＋RoomDO 内部 purge（`account-delete-v1`）未実装、
    `scheduled()` の cleanup 未呼び出し。
  - `deletion_pending_at` 時の通常 API / room read・update 遮断は未確認。
- 未決は `decisions.md` D-013 に登録（決定者 Codex）。
- 次の再開地点: Codex が wiring＋429/409 テストを完了後、Claude Code が PLAY-002（削除 UX・公開 Web）へ着手。

## 2026-07-25 — SEC-002 完了

- 担当: Codex
- 変更:
  - order ownerの事前確認と、`ON CONFLICT` 内のshop条件を追加。
  - owner確認後の競合でも別店舗upsertを409で拒否し、明細変更前に停止。
  - 他店舗・不存在のorder DELETEを404に統一し、HTTP statusを伝播。
- テスト:
  - 修正前に越境POST、競合、越境DELETE、HTTP statusの4失敗を確認。
  - 対象: 62 passed。Worker全体: 11 files / 159 passed。
  - インメモリSQLiteで別店舗 `changes=0`、同店舗 `changes=1` を確認。
- 未実施: deploy、commit、push。
- 次の再開地点: account deletion contractを固定し、`PLAY-001` backendへ着手。

## 2026-07-25 — SEC-001 完了

- 担当: Codex
- 変更:
  - `join` 成功前は `ping` 以外を拒否し、認可状態をWebSocket attachmentへ永続化。
  - 空deviceId、二重join、招待session不一致、偽hostを拒否。
  - 未参加ソケットへの配信を遮断し、退出時の認可を即時失効。
  - `conflict_lock` をhost-onlyに修正。
- テスト:
  - 失敗testを先に追加し、修正前は29件中28件の失敗を確認。
  - `RoomDO.joinAuth.test.js`: 33 passed。
  - Worker全体: 11 files / 154 passed。
- 未実施: deploy、commit、push。Workers runtime統合テストは `TEST-002` で継続。
- 次の再開地点: `SEC-002` の2店舗衝突testとowner check。

## 2026-07-25 — SEC-001 着手

- 担当: Codex
- 対象: WebSocket参加完了前の更新遮断、空deviceId、host-only操作。
- 方針: 失敗testを先に追加し、connection attachmentを認可状態の正として最小修正する。
- 使用指針: Cloudflare Durable Objects / Workers best practices（2026-07-25再取得）。
- 状態: 進行中。

## 2026-07-25 — 共同品質基盤スプリントを採用

- 担当: User / Codex。Claude Codeへの共有待ち。
- 決定:
  - 2026-07-27〜2026-08-08はGoogle Play要件と品質基盤以外の機能開発を停止。
  - 共有場所を `docs/quality-foundation/` とし、特定agent名に依存しない名称へ変更。
  - Codexはsecurity/data/backend/CI、Claude CodeはPlay必須UI/UX/legal surfaceを主担当とする。
  - 全10評価項目9.0以上、8項目以上A+をrelease targetとする。
  - 双方の独立採点の低い方を正式点にする。
- 作成:
  - `sprint-plan-2026-07-27.md`
  - `quality-scorecard.md`
  - `google-play-readiness.md`
- アプリ本体の変更: なし。
- 次の再開地点: `SEC-001`、`SEC-002`、account deletion contractの確定。

## 2026-07-25 — 初回横断監査と共有基盤

- 担当: Codex
- 対象: `develop@131a36f`
- 実施:
  - コード、Worker/DO、D1、CI、テスト、依存関係、既存 Markdown を横断確認。
  - App / Worker で `npm ci`、test、App build、production audit を実行。
  - P0 2件、P1/P2 の改善候補を完了条件付きタスクへ変換。
  - `docs/quality-foundation/` の前身となる共有文書と `AGENTS.md` を作成し、`CLAUDE.md` に共有入口を追加。
  - ローカル生成物を `.gitignore` に追加。既存生成物は削除していない。
- 検証結果:
  - Worker: 121 tests passed。
  - App: 500 passed / 1 failed。
  - App build: 成功、chunk size と Vite CJS の警告あり。
  - App production audit: low 1 / high 2。
  - Worker production audit: 0。
- アプリ本体の変更: なし。
- 未決:
  - 仕入先の正しい並び順 (`D-005`)。
  - `develop` で CI のみか preview も行うか (`D-006`)。
- 次の推奨:
  1. `SEC-001` を担当中へ変更し、未参加 WebSocket の失敗テストから開始。
  2. 続いて `SEC-002` の2店舗衝突テストと owner check。
- 注意:
  - 作業開始時点で `.wrangler/`、`worker/dist/`、ルート `package-lock.json` が未追跡。
    ignore しただけで削除していない。
