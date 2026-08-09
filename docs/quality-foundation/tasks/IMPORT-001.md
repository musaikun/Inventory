# IMPORT-001 — 品目マスタ取込を非破壊かつ確認可能にする

- 状態の正本は [`../task-list.md`](../task-list.md)
- Web公開との関係: [`../web-release-readiness.md`](../web-release-readiness.md)の
  Release candidate product contract / `WEB-07`
- 過去棚卸取込と履歴identityは[`DATA-002.md`](DATA-002.md)で扱い、本タスクへ重複させない。

## 背景

CC branch `claude/branch-operational-status-2lwwwu@8ff46af`で、非破壊mergeと共通previewの
初回実装が追加された。Codexの2026-08-09独立reviewでは方向性を承認した一方、次のdata riskを確認した。

- quoted comma、escaped quote、未閉じquote、headerなしfileを正しく処理できない。
- invalid numberをerrorにせず、既存値維持として扱う。
- alias衝突で別品目のaliasを無言で奪える。
- `categoryCodes`、`axisNames`、名称切り詰め、行errorがpreviewに完全表示されない。
- merge / replace、発注点、backup / undoの説明と実挙動が一致しない。
- modal / 全取込入口のcomponent・integration testが不足している。

## 完了条件

- 通常取込は非破壊mergeで、fileに無い既存品目を削除しない。
- replaceは別操作とし、削除・保持対象と影響をcommit前に表示する。
- CSV、mapped CSV、Excel、PDFが同じpreview / commit contractを使用する。
- quoted comma、escaped quote、BOM、日本語、CRLF/LF、空行、重複を仕様どおり処理する。
- 未閉じquote、列数不一致、headerなし、不正数値を行番号・列・理由付きで処理前に表示する。
- alias衝突で既存品目を傷つけず、明示解決なしにcommitしない。
- 追加・更新・変更なし・除外・error、Free上限、名称切り詰め、全変更fieldをpreviewする。
- previewとcommitで同じ計画dataを使い、cancel / Escapeでconfigを変更しない。
- backup / undoと画面文言を実挙動へ一致させる。
- 対象の異常系test、全取込入口のintegration test、App全test、production buildが成功する。
- 実browser未確認などの残件を明記し、Codexの独立reviewを受ける。

## 作業順

[`../cc-session-plan.md`](../cc-session-plan.md)の第3セッションで扱う。
着手時に`task-list.md`を`進行中 / Claude Code`へ更新し、証拠提出後は`レビュー待ち`までとする。
Codex承認前に`完了`またはWEB-07通過としない。
