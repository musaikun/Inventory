// 棚卸の検索は非表示中の品目にも当たる。表には居ない品目なので、候補に「非表示」の印を付ける。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: '', WS_BASE: '',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))

let app = null
let host = null

async function mount(Comp, props) {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Comp, props) })
  app.mount(host)
  await nextTick()
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  const cfg = useConfig()
  cfg.setEmptyList()
  for (const n of ['トマト', 'トマト缶', 'なす']) cfg.addItem(n, 100, '野菜', '個')
  cfg.hideItem('トマト缶')
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

const markOf = name => [...host.querySelectorAll('.item-name')]
  .find(e => e.firstChild?.textContent === name)?.querySelector('.hidden-mark')

describe('検索候補の非表示マーク', () => {
  it('一致した候補のうち非表示中のものだけに印が付く', async () => {
    const { default: CandidateModal } = await import('./CandidateModal.vue')
    await mount(CandidateModal, { searchTerm: 'トマト', matched: ['トマト', 'トマト缶'], qty: null })
    expect(markOf('トマト缶')?.textContent).toBe('非表示')
    expect(markOf('トマト')).toBeFalsy()
  })

  it('その他の品目にも付く', async () => {
    const { default: CandidateModal } = await import('./CandidateModal.vue')
    await mount(CandidateModal, { searchTerm: 'なす', matched: ['なす'], qty: null })
    expect(markOf('トマト缶')?.textContent).toBe('非表示')
    expect(markOf('なす')).toBeFalsy()
  })

  it('数量入力でも品目名に印が付く', async () => {
    const { default: ConfirmModal } = await import('./ConfirmModal.vue')
    await mount(ConfirmModal, { ingredient: 'トマト缶', qty: null, unit: '' })
    expect(host.querySelector('.name-text .hidden-mark')?.textContent).toBe('非表示')
  })

  it('非表示でない品目には付かない', async () => {
    const { default: ConfirmModal } = await import('./ConfirmModal.vue')
    await mount(ConfirmModal, { ingredient: 'なす', qty: null, unit: '' })
    expect(host.querySelector('.name-text .hidden-mark')).toBeNull()
  })
})
