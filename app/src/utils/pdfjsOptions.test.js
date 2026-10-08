// PDF を開く設定と、pdfjs-dist 5.6 系の既知の脆弱性（GHSA-hq66-cqwq-w95j）の前提に当たらないことの固定。
// その脆弱性は「PDF 内のスクリプトを有効にした使い方（enableScripting）」と「スクリプトを許す CSP」が前提。
// この App は canvas への描画と文字の取り出ししか使わない。使い方を広げるときは、このテストを見直す。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pdfDocumentOptions } from './pdfjsOptions.js'

const appRoot = process.cwd()   // vitest は app/ を cwd として実行する

function sourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (/\.(js|vue)$/.test(name) && !/\.test\.js$/.test(name)) out.push(p)
  }
  return out
}

describe('pdfDocumentOptions', () => {
  it('文字列からコードを作らず、XFA を組み立てない', () => {
    const o = pdfDocumentOptions(new Uint8Array(1), 'https://x/cmaps/')
    expect(o.isEvalSupported).toBe(false)
    expect(o.enableXfa).toBe(false)
    expect(o.cMapPacked).toBe(true)
    expect('enableScripting' in o).toBe(false)
  })
})

describe('pdfjs の使い方（脆弱性の前提に当たらない）', () => {
  const files = sourceFiles(resolve(appRoot, 'src'))
  const using = files.filter(f => readFileSync(f, 'utf8').includes('pdfjs-dist'))

  it('PDF を開くのは pdfDocumentOptions だけ', () => {
    for (const f of using) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/getDocument\(([^)]*)/g)) expect(m[1], f).toMatch(/^pdfDocumentOptions\(/)
    }
    expect(using.length).toBeGreaterThan(0)
  })

  it('注釈レイヤー・PDF 内のスクリプト・ビューア部品を使わない', () => {
    for (const f of files.filter(f => !f.endsWith('pdfjsOptions.js'))) {   // 設定の説明文は除く
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/AnnotationLayer|enableScripting|pdfjs-dist\/web|pdf_viewer|PDFScriptingManager/)
    }
  })

  it('公開 CSP はスクリプトの埋め込み・eval を許さない', () => {
    const headers = readFileSync(resolve(appRoot, 'public/_headers'), 'utf8')
    const scriptSrc = headers.match(/script-src([^;]*)/)?.[1] ?? ''
    expect(scriptSrc).toContain("'self'")
    expect(scriptSrc).not.toMatch(/'unsafe-inline'|'unsafe-eval'|\*|data:|blob:/)
    expect(headers).toMatch(/object-src 'none'/)
  })
})
