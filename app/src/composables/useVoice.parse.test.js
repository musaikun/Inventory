// 検索・音声の文字の分け方（2026-11-09 触診: 名前の途中の数字・単位の文字・空白が消えていた）
import { describe, it, expect } from 'vitest'
import { parseText } from './useVoice.js'

describe('parseText', () => {
  it('手で打った文字: 数の前に空白があるときだけ末尾を数量に。名前の途中の数字・単位の文字・英字の空白は残す', () => {
    const t = r => parseText(r, { typed: true })
    expect(t('コーラ500ml')).toEqual({ name: 'コーラ500ml', qty: null, unit: '' })
    expect(t('<img src=x onerror=alert(1)>')).toEqual({ name: '<img src=x onerror=alert(1)>', qty: null, unit: '' })
    expect(t('LATTE')).toEqual({ name: 'LATTE', qty: null, unit: '' })
    expect(t('Egg Tart')).toEqual({ name: 'Egg Tart', qty: null, unit: '' })
    expect(t('A001')).toEqual({ name: 'A001', qty: null, unit: '' })
    expect(t('トマト 3')).toEqual({ name: 'トマト', qty: 3, unit: '' })
    expect(t('トマト 3個')).toEqual({ name: 'トマト', qty: 3, unit: '個' })
    expect(t('牛乳 1.5L')).toEqual({ name: '牛乳', qty: 1.5, unit: 'L' })
    expect(t('5')).toEqual({ name: '5', qty: null, unit: '' })
  })
  it('声: くっついた末尾の数量も読む。日本語どうしの空白は詰める。全角数字は半角に', () => {
    expect(parseText('トマト3個')).toEqual({ name: 'トマト', qty: 3, unit: '個' })
    expect(parseText('トマト 缶 2本')).toEqual({ name: 'トマト缶', qty: 2, unit: '本' })
    expect(parseText('牛乳１２本')).toEqual({ name: '牛乳', qty: 12, unit: '本' })
    expect(parseText('グラム数の多い豚バラ 3')).toEqual({ name: 'グラム数の多い豚バラ', qty: 3, unit: '' })
  })
})
