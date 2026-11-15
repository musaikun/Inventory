import { describe, it, expect, afterEach } from 'vitest'
import { askConfirm, answerConfirm, confirmState, notify, askText } from './askConfirm.js'

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

  it('notify: ボタンは1つ（取りやめを出さない）。文字列は1行目を題、残りを本文にする', async () => {
    const n = notify('取り込めませんでした\n通信を確認してください')
    expect(confirmState.value.title).toBe('取り込めませんでした')
    expect(confirmState.value.body).toBe('通信を確認してください')
    expect(confirmState.value.cancel).toBe('')
    answerConfirm(true)
    await n
    expect(confirmState.value).toBeNull()
  })

  it('notify: 確認を出している最中なら、閉じてから出す（知らせを落とさない）', async () => {
    const a = askConfirm({ title: '完了しますか？' })
    notify('あとのお知らせ')
    expect(confirmState.value.title).toBe('完了しますか？')
    answerConfirm(true)
    await a
    expect(confirmState.value.title).toBe('あとのお知らせ')
  })

  it('askText: 入れた文字を返す（前後の空白は除く）。取りやめは null', async () => {
    const a = askText({ title: '並び替えの名前', initial: '保管場所' })
    expect(confirmState.value.value).toBe('保管場所')
    confirmState.value.value = '  仕入先 '
    answerConfirm(true)
    expect(await a).toBe('仕入先')

    const b = askText({ title: '並び替えの名前' })
    answerConfirm(false)
    expect(await b).toBeNull()
  })

  it('askText: 空・だめな名前では閉じず、理由を出す。直せばそのまま通る', async () => {
    const a = askText({ title: '並び替えの名前', validate: v => (v === '仕入先' ? 'その名前は既に使われています' : '') })
    answerConfirm(true)
    expect(confirmState.value.error).toBe('入力してください')
    confirmState.value.value = '仕入先'
    answerConfirm(true)
    expect(confirmState.value.error).toBe('その名前は既に使われています')
    confirmState.value.value = '温度帯'
    answerConfirm(true)
    expect(await a).toBe('温度帯')
    expect(confirmState.value).toBeNull()
  })
})
