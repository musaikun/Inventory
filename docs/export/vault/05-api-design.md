---
title: "API設計"
aliases:
  - "API設計"
---
# 05 API設計

スナップショット: 2026-07-15 / v0.48（正: `docs/api-design.md`）

## 認証は3段階
| 区分 | 対象 | 内容 |
|---|---|---|
| Bearer必須 | sessions系・complete | トークン無しは401 |
| ソフト認証 | config/inventory/history/orders/room | PIN設定店舗はBearer必須、レガシー店舗は店舗コードのみ（残課題S-C） |
| 無認証 | /room/:code/result（URLが鍵+IPレート制限）・/pdf（⚠️要対策S-D）・/health | |

## エンドポイント系統
- `/auth/*` … register / login / logout（+ plan/isPro/inTrial を返す）
- `/store/:code/*` … config / inventory / history / sessions / sessions/:id/complete / orders / push/subscribe / room
- `/room/:code/*` … ws（WebSocket→DO）/ status（orderItemCount 含む）/ dissolve / result
  - WS には発注数チャネル（order_update / order_remove・2026-07追加）→ リポジトリ `docs/sync-spec.md`
- `/pdf`（PDFテキスト抽出）／ `/api/push/vapid-key` ／ `/health`

## 規約
- 成功 `{ ok: true }` or データ／失敗 `{ error }` + HTTPステータス（形式のブレが残課題）
- 店舗コードはパスで大文字正規化／ペイロード上限 約1MB（S-03）

## 事故防止ルール（必読）
- **新エンドポイントは index.js のソフト認証ゲートの内側に入れる**（push/subscribe がゲート外に漏れた S-F の再発防止）
- 無認証エンドポイントには必ずレート制限
- 追加したら `docs/api-design.md` の一覧に認証区分つきで登録

## 公開API（外部連携）
方針: **課金する連携先が出るまで作らない**。今は内部境界を綺麗に保つ＋バージョニング方針のみ。

## 記録すること（今後）
- API追加・変更の履歴（破壊的変更は特に）
- 連携の引き合い（誰が・何のAPIを欲しがったか）
