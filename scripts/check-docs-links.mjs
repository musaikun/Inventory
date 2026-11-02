#!/usr/bin/env node
// docs/・ルートの Markdown にある相対リンク（ファイル）の切れを検出する。
// 外部URL・アンカーのみのリンク・docs/export/（履歴）は対象外。
// あわせて AGENTS.md「主要ファイル」のツリーに載ったファイルが実在するかを見る。
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(new URL(import.meta.url).pathname), '..')
const files = ['CLAUDE.md', 'AGENTS.md', 'README.md']
const walk = (d) => {
  for (const n of readdirSync(join(root, d))) {
    const p = join(d, n)
    if (p.startsWith('docs/export')) continue
    if (statSync(join(root, p)).isDirectory()) walk(p)
    else if (p.endsWith('.md')) files.push(p)
  }
}
walk('docs')

const broken = []
for (const f of files) {
  const text = readFileSync(join(root, f), 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1].split('#')[0]
    if (!target || /^[a-z]+:/i.test(target)) continue
    if (!existsSync(resolve(root, dirname(f), decodeURI(target)))) broken.push(`${f}: ${m[1]}`)
  }
}
// AGENTS.md の主要ファイル一覧（```ツリー```）
const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8')
const tree = agents.match(/## 主要ファイル[\s\S]*?```\n([\s\S]*?)```/)
if (!tree) broken.push('AGENTS.md: 「主要ファイル」のツリーが見つからない')
else {
  const stack = []
  for (const line of tree[1].split('\n')) {
    const m = line.match(/^( *)(\S+)/)
    if (!m) continue
    const depth = m[1].length / 2
    const name = m[2]
    stack.length = depth
    const path = [...stack, name].join('').replace(/\/$/, '')
    if (name.endsWith('/')) { stack[depth] = name; continue }
    if (!existsSync(join(root, path))) broken.push(`AGENTS.md 主要ファイル: ${path} が無い`)
  }
}

if (broken.length) {
  console.error(`リンク切れ ${broken.length}件:\n` + broken.join('\n'))
  process.exit(1)
}
console.log(`リンク切れ 0件（${files.length} files）`)
