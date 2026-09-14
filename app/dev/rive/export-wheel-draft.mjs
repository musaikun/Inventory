import { mkdirSync, writeFileSync } from 'node:fs'
import { wheelSvg } from './wheelDraft.mjs'

const output = new URL('./public/assets/', import.meta.url)
mkdirSync(output, { recursive: true })
for (const [name, progress] of [['wheel-open', 1], ['wheel-closed', 0]]) {
  writeFileSync(new URL(`${name}.svg`, output), wheelSvg(progress).replace(/[ \t]+$/gm, '') + '\n', 'utf8')
}
console.log('Exported wheel-open.svg and wheel-closed.svg')
