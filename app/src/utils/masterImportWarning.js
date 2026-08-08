/**
 * 品目マスタ取込の破壊的挙動を、実行前にユーザーへ明示するための警告。
 *
 * 【暫定措置】現在の `loadFromCSV` / `loadFromCSVMapped` は品目リストを**全置換**する。
 * ファイルに無い品目と、その単価・別名・カテゴリは削除される。
 * UIの説明文は長らく「品目名が一致するものは上書き、無いものは追加」＝追加マージを
 * 約束しており、実装と食い違っていた（300品目の店舗が50品目のファイルを入れると250品目が消える）。
 *
 * ここは本修理までの**止血**であり、恒久的な仕様ではない。
 * 本修理（通常取込のマージ化と全置換の分離）が入ったら、この確認は
 * 「全置換」操作にだけ残し、通常取込からは外すこと。
 * 経緯と完了条件は docs/quality-foundation/cc-session-plan.md の S2 / S5 にある。
 */

/** 全置換であることを説明する確認文を組み立てる */
export function buildMasterImportWarning(currentCount) {
  const n = Number.isFinite(currentCount) && currentCount > 0 ? currentCount : 0
  return [
    `現在の品目リスト${n}件は、このファイルの内容にすべて置き換わります（追加ではありません）。`,
    '',
    '・ファイルに無い品目は削除されます',
    '・単価・別名・カテゴリもファイルの内容に置き換わります',
    '・取り消しはできません',
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
