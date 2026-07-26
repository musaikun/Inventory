---
title: "UI設計"
aliases:
  - "UI設計"
---
# 03 UI設計

スナップショット: 2026-07-15 / v0.48

## デザイン規約（現行）
- **ホームはカードUI統一**: 白枠・共通サイズ・機能別テーマ色（棚卸=青／入出庫=緑／発注=オレンジ）
- **モバイルファースト**: iPhone SE2 基準・タップ領域44px以上・最小フォント13px
- **レスポンシブ分岐**: スマホ=上下分割／PC=左右分割（例: 軸振り分けページ）
- **戻る操作の規約**: スマホの戻る＝最前面のモーダルを閉じる→ホームへ（`_pushBackSentinel`/`_closeTopLayer` 系に載せる。独自実装禁止）
- **スワイプ**: 入出庫タブは在庫/入庫/出庫をスワイプ切替（スライド下線＋ヒント表示）
- **ローディング/接続状態**: ConnectionBanner（オフライン・再接続表示）

## 主要画面（コンポーネント）
| 画面 | ファイル |
|---|---|
| ランディング/認証 | LandingPage / AuthPage |
| ホーム | HomeScreen（各種設定カード含む） |
| セッション一覧 | SessionListPage |
| 棚卸入力 | InventoryTable + NumPad + VoiceButton + ConfirmModal |
| 入出庫 | MovementPage |
| 発注 | OrderModal |
| 履歴 | HistoryCalendar / HistoryModal / SessionDetailPage |
| 分析 | ManagerDashboard |
| 軸振り分け | AxisAssignModal / AxisAssignFocus |
| 取込 | CsvMapperModal / PdfImporterModal / PdfColumnMapper / TextPasteParserModal |
| 同期・共有 | SyncModal / ChatModal / GuestResultView |
| その他 | BarcodeScanner / MasterManagePage / SettingsModal / UpgradeModal |

## 既知のUI課題
- ユーザー向けマニュアル・ヘルプが未整備（Play公開前に着手）
- App.vue が画面遷移を手動管理（router なし・3,400行 → [20 技術的負債](20-tech-debt.md)）

## 記録すること（今後）
- 新画面のワイヤ・スクショ・ユーザーの声（使いにくい箇所）
- UI変更時は共通チェックリスト（スマホ/タブレット/PC・戻る・ローディング）の結果
