# 共同品質スコアカード

> **適用対象:** D-021のW1 Web/PWA Free版です。[web-release-readiness.md](web-release-readiness.md)の
> gateを前提に、release candidateをCodexとClaude Codeが独立採点します。
> Google Play/TWAへ進む際は別profileとして公式要件を再確認します。

適用期間: 2026-08-08〜W1 release判定

## 採点規則

- CodexとClaude Codeが、互いの点数を見ずに各項目を採点する。
- 正式点は `min(Codex, Claude Code)`。平均値や高い方を使用しない。
- `A+ = 9.5〜10.0`、`A = 9.0〜9.4`、`未達 = 8.9以下`。
- 目標は全10項目9.0以上、うち8項目以上A+。
- command、test、code location、公開URLなどの証拠がない加点は認めない。
- mandatory gateが1つでも失敗した場合、点数に関係なくrelease不可。

### 点数の目安

| 点数 | 判定 |
|---:|---|
| 10 | 既知riskなし。自動test、失敗時挙動、運用手順まで再現済み |
| 9 | releaseに十分。軽微な改善余地はあるが、回避策とownerが明確 |
| 8 | 主経路は動くが、重要なtest・運用・例外処理のいずれかが不足 |
| 7以下 | 既知の重大gap、未検証、または文書と実装の不一致がある |

## 評価項目

| ID | 評価項目 | 9点の最低条件 | A+条件 |
|---|---|---|---|
| Q1 | 認証・認可 | 未参加・偽host・失効token・未認証APIをserverで拒否 | 異常系integration testとfail-closedが全重要経路にある |
| Q2 | 店舗分離・data integrity | 全write/deleteでtenant ownerを検証、部分失敗を制御 | 2店舗越境testと再試行・冪等性testがある |
| Q3 | account lifecycle | 登録・logout・削除・token失効・端末消去が一貫 | D1/DO/Push/外部分析を含む削除証跡と保持例外が検証済み |
| Q4 | privacy / public surface | privacy・terms・support・削除URLと実data処理が一致し、分析通信が無効 | 公開URL・network・削除証跡を第三者が照合済み |
| Q5 | 棚卸core / import safety | 品目取込が非破壊で、完了保存と別端末履歴が一貫 | 全置換・衝突・再試行・過去取込・同日複数回の異常系まで検証 |
| Q6 | automated tests | App/Worker全件成功、重要riskに回帰testあり | core E2Eとruntimeに近いD1/DO/WS testが安定成功 |
| Q7 | CI / release再現性 | developで自動test・build、secretなしで失敗理由が明確 | clean checkoutから同一成果物を再現しrollback/runbookも確認 |
| Q8 | dependency / input safety | high以上の未処理脆弱性なし、upload制限とerror明細あり | file parserにsize/complexity/time limit、悪性入力、取消testがある |
| Q9 | reliability / observability | 非同期処理・主要errorを捕捉し、利用者が未保存を識別可能 | alert条件、correlation、障害注入、復旧確認まである |
| Q10 | UX / scope / traceability | 棚卸が第一導線で、β境界、API、privacy、task、test結果が一致 | mobile/desktop独立UX reviewとcommit→証拠→rollbackの追跡が完了 |

## Mandatory release gates

- [ ] 未解決P0が0件
- [ ] [web-release-readiness.md](web-release-readiness.md)のWEB-01〜WEB-10がすべて完了
- [ ] Web公開対象P1が0件、またはrelease影響・owner・期限・回避策をUserが受容
- [ ] App testが全件成功
- [ ] Worker testが全件成功
- [ ] App production build成功
- [ ] critical integration/E2E成功
- [ ] production dependencyに未処理high/criticalがない
- [ ] 品目取込が非破壊defaultで、全置換・上限超過・不正行を処理前に確認できる
- [ ] 棚卸完了が部分成功を残さず、別browserで履歴一覧と明細を取得できる
- [ ] 入出庫・発注確認が主要導線から分離され、β・非送信であることが明確
- [ ] account deletionのin-app経路と公開Web経路が動作
- [ ] 関連data削除・保持例外・privacy policyが一致
- [ ] develop CI成功
- [ ] release対象commit、production resource、rollback、test証拠が一意に追跡可能
- [ ] CodexとClaude Codeの独立採点で正式点が基準を満たす
- [ ] Userがrelease candidateを承認

## 採点表

最終監査時に記入します。`証拠` はtest command、CI run、文書、公開URLへlinkします。

| ID | Codex | Claude Code | 正式点 | Grade | 証拠 / 残件 |
|---|---:|---:|---:|---|---|
| Q1 | — | — | — | — | |
| Q2 | — | — | — | — | |
| Q3 | — | — | — | — | |
| Q4 | — | — | — | — | |
| Q5 | — | — | — | — | |
| Q6 | — | — | — | — | |
| Q7 | — | — | — | — | |
| Q8 | — | — | — | — | |
| Q9 | — | — | — | — | |
| Q10 | — | — | — | — | |

現在値は初回監査結果から推測せず、修正後の独立監査で初めて採点します。
