/**
 * **実際に配信している host が CORS を通ること**を wrangler.toml の値そのもので確かめる。
 *
 * 2026-08-28、本番Workerを旧版（任意Originを反射する状態・WEB-02）から現行版へ
 * 入れ替えた直後、フロントが全滅した。ブラウザの表示は `Failed to fetch`、
 * 実体は **403 かつ Access-Control-Allow-Origin 無し**。
 *
 * 原因は host 名の食い違い。コード側 isAllowedOrigin が常に許可するのは
 * `*.inventory-app.pages.dev` だが、実際の Pages project は
 * **`inventory-app-c40.pages.dev`**（`-c40` 付き）だった。旧Workerが緩かったため、
 * この食い違いは入れ替えるまで表面化しなかった。
 *
 * `isAllowedOrigin` の単体testだけでは防げない。**設定値と実hostの対応**が抜けていたので、
 * ここでは wrangler.toml を読んで、その値で実hostが通るかを見る。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isAllowedOrigin } from '../src/index.js'

const toml = readFileSync(fileURLToPath(new URL('../wrangler.toml', import.meta.url)), 'utf8')

/** 指定 env の `[vars]` から ALLOWED_ORIGIN を取り出す（env=null で本番） */
function allowedOriginOf(env = null) {
  const header = env ? `[env.${env}.vars]` : '[vars]'
  const start  = toml.indexOf(header)
  expect(start, `${header} が見つからない`).toBeGreaterThan(-1)
  const rest   = toml.slice(start + header.length)
  const end    = rest.search(/^\[/m)
  const block  = end === -1 ? rest : rest.slice(0, end)
  const m      = block.match(/^ALLOWED_ORIGIN\s*=\s*"([^"]*)"/m)
  expect(m, `${header} に ALLOWED_ORIGIN が無い`).not.toBeNull()
  return m[1]
}

describe('本番の許可オリジン', () => {
  const allowed = allowedOriginOf()

  // 実際に人が開く URL。ここが落ちるとアプリが丸ごと動かない。
  it.each([
    ['production Pages',  'https://inventory-app-c40.pages.dev'],
    ['develop preview',   'https://develop.inventory-app-c40.pages.dev'],
    ['旧 alias',          'https://inventory-app.pages.dev'],
  ])('%s を許可する', (_name, origin) => {
    expect(isAllowedOrigin(origin, allowed)).toBe(true)
  })

  // フェイルクローズは維持する。緩めた結果として無関係なOriginまで通してはいけない。
  it.each([
    'https://evil.example.com',
    'https://inventory-app-c40.pages.dev.evil.com',
    'http://inventory-app-c40.pages.dev',          // scheme 違いは別Origin
  ])('%s は拒否する', (origin) => {
    expect(isAllowedOrigin(origin, allowed)).toBe(false)
  })
})

describe('Pro Review の許可オリジン', () => {
  it('Pro Review の Pages を許可し、他の環境のPagesは許可しない', () => {
    const allowed = allowedOriginOf('pro_review')
    expect(isAllowedOrigin('https://pro-review.inventory-app-pro-review.pages.dev', allowed)).toBe(true)
    expect(isAllowedOrigin('https://inventory-app-c40.pages.dev', allowed)).toBe(false)
  })
})

describe('本番に DEBUG_ERRORS を置かない', () => {
  it('[vars] に DEBUG_ERRORS が無い', () => {
    const start = toml.indexOf('[vars]')
    const rest  = toml.slice(start + '[vars]'.length)
    const end   = rest.search(/^\[/m)
    const block = end === -1 ? rest : rest.slice(0, end)
    expect(block).not.toContain('DEBUG_ERRORS')
  })
})
