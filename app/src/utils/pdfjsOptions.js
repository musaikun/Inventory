/**
 * PDF を開くときの pdfjs の設定（取込・元の紙の表示で共通）。
 *
 * PDF は取引先から届く外部のファイルなので、中身に仕込まれたものを動かさない設定を明示する。
 * - isEvalSupported: false … フォントの描画で文字列からコードを作らない（CSP でも止めているが、頼らない）
 * - enableXfa: false       … XFA フォームを組み立てない（既定も false。版が変わっても固定する）
 * 注釈レイヤー（AnnotationLayer）と PDF 内のスクリプト（enableScripting）は使わない。
 * pdfjs-dist 5.6 系の既知の脆弱性（GHSA-hq66-cqwq-w95j）はスクリプトを有効にした使い方と、
 * スクリプトを許す CSP が前提で、この App はどちらにも当たらない（テストで固定している）。
 */
export function pdfDocumentOptions(data, cMapUrl) {
  return {
    data,
    cMapUrl,
    cMapPacked: true,
    isEvalSupported: false,
    enableXfa: false,
  }
}
