import { describe, it, expect } from 'vitest'
import { resolveRequestId, mapDeletionError } from './accountDeletionFlow.js'

describe('resolveRequestId — 店舗スコープ', () => {
  const gen = () => 'NEW-ID'

  const UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

  it('同一店舗の保存済み requestId（有効UUID）は再利用する', () => {
    const raw = JSON.stringify({ shop: 'STOREA', id: UUID })
    const r = resolveRequestId(raw, 'STOREA', gen)
    expect(r.id).toBe(UUID)
    expect(r.record).toBe(raw)
  })

  it('別店舗の requestId は破棄し、新規生成して自店舗で保存する（越境replay誤認の防止）', () => {
    const raw = JSON.stringify({ shop: 'STOREA', id: UUID })
    const r = resolveRequestId(raw, 'STOREB', gen)
    expect(r.id).toBe('NEW-ID')
    expect(JSON.parse(r.record)).toEqual({ shop: 'STOREB', id: 'NEW-ID' })
  })

  it('非UUIDの保存値は破棄して新規生成する（改変/破損対策）', () => {
    const raw = JSON.stringify({ shop: 'STOREA', id: 'not-a-uuid' })
    const r = resolveRequestId(raw, 'STOREA', gen)
    expect(r.id).toBe('NEW-ID')
    expect(JSON.parse(r.record)).toEqual({ shop: 'STOREA', id: 'NEW-ID' })
  })

  it('保存が無ければ新規生成する', () => {
    const r = resolveRequestId(null, 'STOREA', gen)
    expect(r.id).toBe('NEW-ID')
    expect(JSON.parse(r.record)).toEqual({ shop: 'STOREA', id: 'NEW-ID' })
  })

  it('壊れた JSON は破棄して新規生成する', () => {
    const r = resolveRequestId('{not-json', 'STOREA', gen)
    expect(r.id).toBe('NEW-ID')
    expect(JSON.parse(r.record)).toEqual({ shop: 'STOREA', id: 'NEW-ID' })
  })

  it('id が空/欠落なら新規生成する', () => {
    expect(resolveRequestId(JSON.stringify({ shop: 'STOREA', id: '' }), 'STOREA', gen).id).toBe('NEW-ID')
    expect(resolveRequestId(JSON.stringify({ shop: 'STOREA' }), 'STOREA', gen).id).toBe('NEW-ID')
  })
})

describe('mapDeletionError — HTTP → UI 状態', () => {
  it('400 confirmation_mismatch は form へ戻し確認欄をリセット', () => {
    expect(mapDeletionError({ status: 400, code: 'confirmation_mismatch' }))
      .toMatchObject({ phase: 'form', resetConfirm: true })
  })

  it('400 その他は form（入力確認）', () => {
    const r = mapDeletionError({ status: 400, code: 'invalid_request' })
    expect(r.phase).toBe('form')
    expect(r.resetConfirm).toBeUndefined()
  })

  it('401 は form へ戻し PIN をリセット', () => {
    expect(mapDeletionError({ status: 401, code: 'reauthentication_failed' }))
      .toMatchObject({ phase: 'form', resetPin: true })
  })

  it('429 は error・再試行不可・ID保持', () => {
    expect(mapDeletionError({ status: 429, code: 'too_many_attempts' }))
      .toMatchObject({ phase: 'error', retryable: false, keepId: true })
  })

  it('409 は error・再試行不可・ID保持（別requestId競合）', () => {
    expect(mapDeletionError({ status: 409, code: 'deletion_in_progress' }))
      .toMatchObject({ phase: 'error', retryable: false, keepId: true })
  })

  it('503 は error・再試行可・ID保持', () => {
    expect(mapDeletionError({ status: 503, code: 'deletion_temporarily_unavailable' }))
      .toMatchObject({ phase: 'error', retryable: true, keepId: true })
  })

  it('status 無し（通信失敗）は error・再試行可・ID保持', () => {
    expect(mapDeletionError(new Error('network')))
      .toMatchObject({ phase: 'error', retryable: true, keepId: true })
  })
})
