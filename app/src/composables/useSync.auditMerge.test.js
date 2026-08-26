// 変更履歴（監査ログ）が退室・再入室・ルーム作成で消えないこと。
//
// 報告: ルームを作らず一人で「品目入力 → 退室 → 別の品目を入力 → 完了」としたら、
// 再入室後に入れた分しか変更履歴に残っていなかった。
// auditLog はメモリにしか無く、下書きにも入っていなかったのが原因。
// 取り込みも splice の置き換えだったため、途中でルームへ入ると端末側の分が消えていた。
import { describe, it, expect, beforeEach, vi } from 'vitest'

let sync
let auditLog

const entry = (id, timestamp, ingredient = 'トマト') => ({
  id, timestamp, ingredient, action: 'update', delta: 1, totalQty: 1, unit: '個',
  enteredBy: '端末A', enteredById: 'dev-a',
})

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  sync = await import('./useSync.js')
  sync.clearAuditLog()
  auditLog = sync.useSync().auditLog
})

describe('mergeAuditLog', () => {
  it('既存を残したまま取り込む（置き換えない）', () => {
    sync.addLocalAuditEntry(entry('local-1', 100))
    sync.mergeAuditLog([entry('srv-1', 200)])
    expect(auditLog.map(e => e.id)).toEqual(['local-1', 'srv-1'])
  })

  it('同じ id は重複させない', () => {
    sync.addLocalAuditEntry(entry('local-1', 100))
    sync.mergeAuditLog([entry('local-1', 100), entry('srv-1', 200)])
    expect(auditLog.map(e => e.id)).toEqual(['local-1', 'srv-1'])
  })

  it('時刻順に並べ直す', () => {
    sync.addLocalAuditEntry(entry('local-2', 300))
    sync.mergeAuditLog([entry('srv-1', 100), entry('srv-2', 200)])
    expect(auditLog.map(e => e.id)).toEqual(['srv-1', 'srv-2', 'local-2'])
  })

  it('空・非配列は何もしない', () => {
    sync.addLocalAuditEntry(entry('local-1', 100))
    sync.mergeAuditLog([])
    sync.mergeAuditLog(undefined)
    sync.mergeAuditLog('nope')
    expect(auditLog.map(e => e.id)).toEqual(['local-1'])
  })

  it('id が無い要素は捨てる', () => {
    sync.mergeAuditLog([{ timestamp: 100 }, entry('srv-1', 200)])
    expect(auditLog.map(e => e.id)).toEqual(['srv-1'])
  })

  it('200件を超えたら古い方から切る', () => {
    sync.mergeAuditLog(Array.from({ length: 250 }, (_, i) => entry(`e-${i}`, i)))
    expect(auditLog).toHaveLength(200)
    expect(auditLog[0].id).toBe('e-50')
    expect(auditLog[199].id).toBe('e-249')
  })
})
