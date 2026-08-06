# 保留タスクの詳細（P2 / P3）

状態の正本は [`../task-list.md`](../task-list.md) です。

2026-07-27〜2026-08-08のスプリントではP0と公開対象P1だけを実装し、ここに載る項目は
原則保留します。スプリント後に優先度を再評価します。

対象: `REF-001` `PERF-001` `SEC-006` `CFG-001`

`DOC-001`は2026-08-04にP1へ変更し、[DOC-001.md](DOC-001.md)へ移しました。

> `DATA-002`（履歴検索とDO/D1の成長時設計）は 2026-08-01 に **P1へ変更**し、
> 実使用バグ（R-001 / F-001〜F-004）を統合したため、このファイルではなく
> [`DATA-002.md`](DATA-002.md) にあります。

---

## REF-001 — 大型コンポーネントと composable を段階分割

- 対象候補: `App.vue`、`SessionListPage.vue`、`InventoryTable.vue`、`ConfirmModal.vue`、
  `useConfig.js`、`useSync.js`、`RoomDO.js`。
- 完了条件: 先に責務と既存テスト境界を可視化し、挙動を変えない小さい差分で分割する。

---

## PERF-001 — フロント bundle を分割

- 根拠: build は成功するが 1 MB 超の JavaScript chunk 警告がある。
- 完了条件: 実測を取り、PDF/Excel/分析など重い機能を遅延 load し、主要導線の回帰を確認する。

---

## SEC-006 — 店舗コード・PIN・保存トークンを再評価

- 対象: `Math.random` の店舗コード、4桁 PIN、D1 と localStorage の bearer/host token。
- 完了条件: 脅威 model を作り、Web Crypto、試行制限、rotation、失効、保存方式の改善順を決める。
- 関連: `docs/proposals.md`（2026-07-28）のアカウント登録拡張提案が、PIN復旧トークンの要件と
  4桁PINとの強度差をこのタスクの脅威モデルで判定することを求めている（PM未トリアージ）。

---

## CFG-001 — Claude Code の古い hook/command を可搬化

- 根拠: `.claude` 配下に `/home/user/Inventory` と旧固定ブランチを前提にした設定がある。
- 完了条件:
  - Windows と Linux の両方で、repository 相対 path から動く検証入口を用意する。
  - 失敗を `|| true` で隠さない。
  - hook の実行コストと発火条件を明文化する。
