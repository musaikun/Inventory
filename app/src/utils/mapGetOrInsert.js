/**
 * `Map.prototype.getOrInsert` / `getOrInsertComputed` の穴埋め。
 *
 * pdfjs-dist 5.6 は、このごく新しいメソッドを**素で**呼ぶ。まだ出荷ブラウザに
 * 入っていないため（Chromium 141 にも無い）、PDFのページ描画が
 * `getOrInsertComputed is not a function` で落ちる。
 * テキスト抽出（自動読み取り）は通るので、**「列を指定して読み取る」だけが
 * 白いページとエラーになる**という気づきにくい壊れ方をしていた。
 *
 * 仕様（tc39/proposal-upsert）どおりの、あるときは何もしない実装にしてある。
 * ブラウザが実装したら、この穴埋めは自動的に何もしなくなる。
 */
export function installMapGetOrInsert(target = globalThis) {
  const M = target?.Map
  if (typeof M !== 'function') return
  const proto = M.prototype
  if (typeof proto.getOrInsert !== 'function') {
    Object.defineProperty(proto, 'getOrInsert', {
      value: function getOrInsert(key, value) {
        if (this.has(key)) return this.get(key)
        this.set(key, value)
        return value
      },
      writable: true, configurable: true, enumerable: false,
    })
  }
  if (typeof proto.getOrInsertComputed !== 'function') {
    Object.defineProperty(proto, 'getOrInsertComputed', {
      value: function getOrInsertComputed(key, callback) {
        if (typeof callback !== 'function') throw new TypeError('callback must be a function')
        if (this.has(key)) return this.get(key)
        const value = callback(key)
        this.set(key, value)
        return value
      },
      writable: true, configurable: true, enumerable: false,
    })
  }
}
