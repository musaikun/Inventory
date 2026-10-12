// 役割と権限の表は App（画面の出し分け）と Worker（認可の正）に1つずつある。
// 両ファイルの冒頭に「同じ中身にする。テストで突き合わせる」とあるので、ここで突き合わせる。
// 片方だけ変えると、画面では押せるのにサーバーが拒む（または逆に、押せないのに通る）ずれになる。
import { describe, it, expect } from 'vitest'
import * as worker from '../src/permissions.js'
import * as app from '../../app/src/services/permissions.js'

// 足し引き（grants）の全部の組み合わせ（2^5 = 32 通り）
function allGrantSets(keys) {
  const out = []
  for (let mask = 0; mask < 1 << keys.length; mask++) out.push(keys.filter((_, i) => mask & (1 << i)))
  return out
}

describe('権限表: App と Worker が同じ', () => {
  it('公開している定数が同じ', () => {
    expect(Object.keys(app).sort()).toEqual(Object.keys(worker).sort())
    expect(app.ROLES).toEqual(worker.ROLES)
    expect(app.GRANT_KEYS).toEqual(worker.GRANT_KEYS)
    expect(app.PERMS).toEqual(worker.PERMS)
    expect(app.GRANT_PERMS).toEqual(worker.GRANT_PERMS)
  })

  it('どの役割 × 足し引き × 権限でも can() の答えが同じ', () => {
    const roles = [...worker.ROLES, 'owner', 'unknown', undefined]
    const perms = [...Object.keys(worker.PERMS), 'no.such.perm']
    const grantSets = [...allGrantSets(worker.GRANT_KEYS), null, ['bogus', 'stock']]
    let checked = 0
    for (const role of roles) for (const grants of grantSets) for (const perm of perms) {
      expect(app.can(role, grants, perm), `${role} ${JSON.stringify(grants)} ${perm}`)
        .toBe(worker.can(role, grants, perm))
      checked++
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it('normalizeGrants・extraGrants の答えが同じ', () => {
    const inputs = [null, 'stock', [], ['stock', 'stock', 'bogus'], ...allGrantSets(worker.GRANT_KEYS)]
    for (const g of inputs) expect(app.normalizeGrants(g)).toEqual(worker.normalizeGrants(g))
    for (const role of [...worker.ROLES, 'owner', 'unknown']) for (const g of inputs) {
      expect(app.extraGrants(role, g)).toEqual(worker.extraGrants(role, g))
    }
  })
})

// 表の要点（User決定 2026-10-07）。一致していても、両方そろって崩れたら気づけるように最低限を置く
describe('権限表: 要点', () => {
  it('アルバイトは数える・発注数・入出庫・品目を足す・やることの完了だけ', () => {
    const allowed = Object.keys(worker.PERMS).filter(p => worker.can('arbeit', [], p))
    expect(allowed.sort()).toEqual(['count', 'item.add', 'move', 'order.draft', 'task.complete'])
  })
  it('金額・スタッフ管理はアルバイトに無く、足し引きでも増えない', () => {
    const everything = worker.GRANT_KEYS
    for (const perm of ['money', 'staff', 'monitor', 'item.admin']) {
      expect(worker.can('arbeit', everything, perm)).toBe(false)
    }
    expect(worker.can('shain', [], 'money')).toBe(true)
    expect(worker.can('shain', everything, 'staff')).toBe(false)
  })
  it('管理者とオーナーはすべての権限を持つ', () => {
    for (const perm of Object.keys(worker.PERMS)) {
      expect(worker.can('admin', [], perm)).toBe(true)
      expect(worker.can('owner', [], perm)).toBe(true)
    }
  })
})
