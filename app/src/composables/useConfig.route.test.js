// 棚卸の導線（並び替えとは別の3つ目の枠・User決定 2026-10-30）
import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig, applyRemoteConfig, ROUTE } from './useConfig.js'

const cfg = useConfig()

describe('棚卸の導線', () => {
  beforeEach(() => {
    localStorage.clear()
    cfg.clearAxis(ROUTE)
    cfg.config.order = ['トマト', 'レタス', 'バター']
    cfg.config.axisNames = ['', '']
    cfg.config.tagsA = {}; cfg.config.axisGroupsA = []; cfg.config.axisItemOrderA = []; cfg.config.tagsArchiveA = {}
  })

  it('場所・振り分け・場所の中の並びは並び替えと同じ操作で、並び替えには影響しない', () => {
    cfg.addAxisGroup(ROUTE, '冷蔵庫')
    cfg.addAxisGroup(ROUTE, '冷凍庫')
    cfg.addItemToGroup(ROUTE, 'トマト', '冷蔵庫')
    cfg.addItemToGroup(ROUTE, 'レタス', '冷蔵庫')
    expect(cfg.config.axisGroupsR).toEqual(['冷蔵庫', '冷凍庫'])
    expect(cfg.config.tagsR).toEqual({ トマト: ['冷蔵庫'], レタス: ['冷蔵庫'] })
    expect(cfg.config.tagsA).toEqual({})
    expect(cfg.reorderAxisItems(ROUTE, ['レタス', 'トマト'])).toBe(true)
    expect(cfg.axisItemSequence(ROUTE).slice(0, 2)).toEqual(['レタス', 'トマト'])
    expect(cfg.config.axisItemOrderA).toEqual([])
  })

  it('「まだ他にある」は付け外しでき、どの場所にも無くなったら外れる', () => {
    cfg.addItemToGroup(ROUTE, 'バター', '冷蔵庫')
    cfg.setRouteMore('バター', true)
    expect(cfg.config.routeMore).toEqual(['バター'])
    cfg.setRouteMore('バター', false)
    expect(cfg.config.routeMore).toEqual([])
    cfg.setRouteMore('バター', true)
    cfg.removeItemFromGroup(ROUTE, 'バター', '冷蔵庫')
    expect(cfg.config.routeMore).toEqual([])
  })

  it('品目の名前を変えると導線も付いていく・消すと外れる', () => {
    cfg.addItemToGroup(ROUTE, 'トマト', '冷蔵庫')
    cfg.setRouteMore('トマト', true)
    cfg.updateConfigItem('トマト', 'ミニトマト', null, '', undefined)
    expect(cfg.config.tagsR['ミニトマト']).toEqual(['冷蔵庫'])
    expect(cfg.config.routeMore).toEqual(['ミニトマト'])
    cfg.removeConfigItem('ミニトマト')
    expect(cfg.config.tagsR['ミニトマト']).toBeUndefined()
    expect(cfg.config.routeMore).toEqual([])
  })

  it('並び替え（保管場所）を導線へ移すと、場所・振り分け・並びがそのまま移り、並び替えからは消える', () => {
    cfg.setAxisName(0, '保管場所')
    cfg.addAxisGroup(0, '冷蔵庫'); cfg.addAxisGroup(0, '乾物棚')
    cfg.addItemToGroup(0, 'トマト', '冷蔵庫')
    cfg.setAxisItemOrder(0, ['レタス', 'トマト'])
    expect(cfg.moveAxisToRoute(0)).toBe(true)
    expect(cfg.config.axisGroupsR).toEqual(['冷蔵庫', '乾物棚'])
    expect(cfg.config.tagsR).toEqual({ トマト: ['冷蔵庫'] })
    expect(cfg.axisItemSequence(ROUTE).slice(0, 2)).toEqual(['レタス', 'トマト'])
    expect(cfg.config.axisNames[0]).toBe('')
    expect(cfg.config.tagsA).toEqual({})
    expect(cfg.moveAxisToRoute(0), '導線が既にあれば移さない').toBe(false)
  })

  it('導線を知らない古い端末の config を受けても、手元の導線を消さない', () => {
    cfg.addAxisGroup(ROUTE, '冷蔵庫')
    cfg.addItemToGroup(ROUTE, 'トマト', '冷蔵庫')
    applyRemoteConfig({ order: ['トマト', 'レタス', 'バター'], images: {} })
    expect(cfg.config.axisGroupsR).toEqual(['冷蔵庫'])
    expect(cfg.config.tagsR).toEqual({ トマト: ['冷蔵庫'] })
    applyRemoteConfig({ order: ['トマト', 'レタス', 'バター'], images: {}, axisGroupsR: [], tagsR: {} })
    expect(cfg.config.axisGroupsR).toEqual([])
  })
})
