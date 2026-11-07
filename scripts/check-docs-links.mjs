#!/usr/bin/env node
// docs/・ルートの Markdown にある相対リンク（ファイル）の切れを検出する。
// 外部URL・アンカーのみのリンク・docs/export/（履歴）は対象外。
// あわせて AGENTS.md「主要ファイル」のツリーに載ったファイルが実在するか、
// セッション記録（docs/quality-foundation/sessions/）のファイル名が決まった形か（D-033）を見る。
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

// セッション記録のファイル名: YYYY-MM-DD-HHMM-<slug>.md（UTC・slugは英小文字・数字・ハイフン）
const SESSIONS = 'docs/quality-foundation/sessions'
if (existsSync(join(root, SESSIONS))) {
  for (const n of readdirSync(join(root, SESSIONS))) {
    if (n === 'README.md') continue
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-([01]\d|2[0-3])[0-5]\d-[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(n)) {
      broken.push(`${SESSIONS}/${n}: ファイル名は YYYY-MM-DD-HHMM-<slug>.md（sessions/README.md）`)
    }
  }
}

if (broken.length) {
  console.error(`docs検査で ${broken.length}件:\n` + broken.join('\n'))
  process.exit(1)
}
console.log(`docs検査 OK（リンク切れ0件・${files.length} files）`)
