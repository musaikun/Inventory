// 手で入れた手順をチェック表として残す（User 2026-11-19）
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick, ref } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('./useStore.js', async (orig) => ({ ...(await orig()), loadTemplatesFromD1: vi.fn(async () => null), saveTemplateToD1: vi.fn(async () => ({ ok: true })) }))

let M, T, A
beforeEach(async () => {
  localStorage.clear(); vi.resetModules(); localStorage.setItem('_device_name', '高木')
  M = await import('./stepsToChecklist.js')
  T = await import('./useTemplates.js')
  A = await import('./askConfirm.js')
})
const steps = texts => texts.map((text, i) => ({ id: `s${i}`, text, done: i === 0 }))

describe('stepsToChecklist', () => {
  it('名前を訊き（初めは業務の名前）、手順をチェック表に入れる。✓の有無は持ち込まない', async () => {
    const p = M.saveStepsAsChecklist(steps(['業者に電話', '見積もり', '修理の立ち会い']), '製氷機の修理')
    expect(A.confirmState.value.value).toBe('製氷機の修理')
    expect(A.confirmState.value.ok).toBe('チェック表に入れる')
    A.answerConfirm(true)
    expect(await p).toBe('製氷機の修理')
    const t = T.checklistTemplates.value.find(x => x.name === '製氷機の修理')
    expect(t.data.items.map(x => x.text)).toEqual(['業者に電話', '見積もり', '修理の立ち会い'])
    expect(t.data.items.every(x => !('done' in x))).toBe(true)
  })

  it('同じ名前のチェック表があれば、閉じずにその場で伝える', async () => {
    await T.saveChecklistTemplate(null, '開店準備', [{ text: '鍵' }])
    const p = M.saveStepsAsChecklist(steps(['A', 'B']), '開店準備')
    A.answerConfirm(true)
    expect(A.confirmState.value.error).toBe('同じ名前のチェック表があります')
    A.confirmState.value.value = '開店準備（新）'
    A.answerConfirm(true)
    expect(await p).toBe('開店準備（新）')
  })

  it('取りやめたら何も作らない', async () => {
    const p = M.saveStepsAsChecklist(steps(['A']), 'x')
    A.answerConfirm(false)
    expect(await p).toBeNull()
    expect(T.checklistTemplates.value).toHaveLength(0)
  })

  it('同じ項目（同じ順）のチェック表から付けた手順には「残す」を出さない。手で足したら出す', async () => {
    await T.saveChecklistTemplate(null, '閉店', [{ text: '火の元' }, { text: '施錠' }])
    const s = ref(steps(['火の元', '施錠']))
    const show = M.useStepsToChecklist(s)
    expect(show.value).toBe(false)
    s.value = steps(['火の元', '施錠', 'ゴミ出し'])
    await nextTick()
    expect(show.value).toBe(true)
    s.value = []
    await nextTick()
    expect(show.value).toBe(false)                         // 手順が無ければ出さない
  })
})
