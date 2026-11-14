import { describe, it, expect, afterEach } from 'vitest'
import { askConfirm, answerConfirm, confirmState } from './askConfirm.js'

afterEach(() => answerConfirm(false))

describe('askConfirm', () => {
  it('答えが返るまで待ち、OK で true・取りやめで false', async () => {
    const a = askConfirm({ title: '完了しますか？', ok: '完了する' })
    expect(confirmState.value.title).toBe('完了しますか？')
    expect(confirmState.value.ok).toBe('完了する')
    expect(confirmState.value.cancel).toBe('キャンセル')
    answerConfirm(true)
    expect(await a).toBe(true)
    expect(confirmState.value).toBeNull()

    const b = askConfirm({ title: 'もう一度' })
    answerConfirm(false)
    expect(await b).toBe(false)
  })

  it('訊いている間の2つ目は重ねず false（連打で2回進まない）', async () => {
    const a = askConfirm({ title: '1つ目' })
    expect(await askConfirm({ title: '2つ目' })).toBe(false)
    expect(confirmState.value.title).toBe('1つ目')
    answerConfirm(true)
    expect(await a).toBe(true)
  })

  it('何も訊いていないときの answerConfirm は何もしない', () => {
    expect(() => answerConfirm(true)).not.toThrow()
  })
})
