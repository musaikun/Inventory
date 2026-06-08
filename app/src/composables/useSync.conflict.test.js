import { describe, it, expect } from 'vitest'
import { classifyIncomingUpdate, CONFLICT_WINDOW_MS } from './useSync.js'

const NOW = 1_000_000_000_000

describe('classifyIncomingUpdate（同時入力の競合判定）', () => {
  // C-06 自分が未入力の品目への更新は競合にならない
  it('自分が未入力（local無し）なら remote-new', () => {
    expect(classifyIncomingUpdate(undefined, NOW)).toBe('remote-new')
    expect(classifyIncomingUpdate(null, NOW)).toBe('remote-new')
  })

  // C-01 自分の入力直後（3秒以内）に他者更新 → 競合
  it('自分の入力(localEntry)から3秒以内なら conflict', () => {
    const local = { qty: 5, localEntry: true, updatedAt: NOW - 1000 }
    expect(classifyIncomingUpdate(local, NOW)).toBe('conflict')
  })

  // 境界値: ちょうど窓未満は競合、窓以上は overwrite
  it('窓の直前(2999ms)は conflict、窓ちょうど(3000ms)は overwrite', () => {
    const at2999 = { qty: 5, localEntry: true, updatedAt: NOW - (CONFLICT_WINDOW_MS - 1) }
    const at3000 = { qty: 5, localEntry: true, updatedAt: NOW - CONFLICT_WINDOW_MS }
    expect(classifyIncomingUpdate(at2999, NOW)).toBe('conflict')
    expect(classifyIncomingUpdate(at3000, NOW)).toBe('overwrite')
  })

  // C-05 時間差入力（3秒超）は競合扱いにしない
  it('自分の入力から3秒超なら overwrite', () => {
    const local = { qty: 5, localEntry: true, updatedAt: NOW - 5000 }
    expect(classifyIncomingUpdate(local, NOW)).toBe('overwrite')
  })

  // 誤検知防止: リモート受信値（localEntry無し）は3秒以内でも競合にしない
  it('localEntryが無い値は3秒以内でも overwrite（誤競合を防ぐ）', () => {
    const remote = { qty: 5, updatedAt: NOW - 500 }
    expect(classifyIncomingUpdate(remote, NOW)).toBe('overwrite')
  })

  it('updatedAt欠落時も例外なく overwrite 扱い', () => {
    const local = { qty: 5, localEntry: true }
    expect(classifyIncomingUpdate(local, NOW)).toBe('overwrite')
  })
})
