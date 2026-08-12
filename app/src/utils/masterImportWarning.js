/**
 * 全置換取込（品目リストを丸ごとファイルの内容へ入れ替える操作）の最終確認。
 *
 * 元は S2 の止血として**すべての取込入口**に挟んでいた。S5 で通常取込を
 * 「追加・更新」（既存品目を消さない）へ変えたため、この確認は
 * **全置換操作にだけ**残している（S2 の申し送りどおり）。
 * 呼び出し元は ItemImportPreviewModal の「全入れ替え」確定時のみ。
 *
 * 確認画面には削除件数・削除される品目名・確認チェックがあり、これはその上での
 * 最終同意にあたる（品目マスタ一括削除が店舗コード＋confirm の二段なのと同じ扱い）。
 * 経緯は docs/quality-foundation/cc-session-plan.md の S2 / S5。
 */

/** 全置換であることを説明する確認文を組み立てる */
export function buildMasterImportWarning(currentCount) {
  const n = Number.isFinite(currentCount) && currentCount > 0 ? currentCount : 0
  return [
    `現在の品目リスト${n}件は、このファイルの内容にすべて置き換わります（追加ではありません）。`,
    '',
    '・ファイルに無い品目は削除されます',
    '・単価・別名・カテゴリもファイルの内容に置き換わります',
    // 「取り消しはできません」は誤り（undoLastImport がある）。実挙動どおりに書く。
    '・取込の直後にかぎり「取込前に戻す」で1回だけ戻せます',
    '・戻せるのはこの端末のメモリ上だけです。再読み込みや他の変更で戻せなくなります',
    '',
    '続けてよろしいですか？',
  ].join('\n')
}

/**
 * 取込実行前の確認。続行してよければ true。
 * 登録済み品目が0件のときは失うものが無いため確認しない。
 *
 * @param {number} currentCount 現在登録されている品目数
 * @param {object} [opts]
 * @param {(msg: string) => boolean} [opts.confirmFn] 差し替え用（テスト）
 */
export function confirmMasterImport(currentCount, { confirmFn } = {}) {
  if (!(currentCount > 0)) return true
  const ask = confirmFn ?? (typeof window !== 'undefined' ? window.confirm?.bind(window) : null)
  // confirm が使えない環境では黙って破壊しない（明示的な同意が取れないため中止）
  if (!ask) return false
  return ask(buildMasterImportWarning(currentCount)) === true
}
