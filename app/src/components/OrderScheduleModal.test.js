// 発注スケジュールを「仕入先ごとに最大5件・名前つき」で持てるようにしたことの回帰。
// あわせて「発注数の決め方」（auto / manual の選択）は廃止し、常に自分で入力に統一した。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null
let cfg

async function mount() {
  const { default: Modal } = await import('./OrderScheduleModal.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Modal) })
  app.mount(host)
  await nextTick()
  return host
}

const cards = () => [...host.querySelectorAll('.os-card')]
const nameInputs = () => [...host.querySelectorAll('.os-name')]
const addButton = () => host.querySelector('.os-add')
const saveButton = () => host.querySelector('.os-save')

// index 番目のカードの曜日ボタン（月火水木金土日 の並び）
function dow(cardIndex, label) {
  return [...cards()[cardIndex].querySelectorAll('.os-dow')].find(b => b.textContent.trim() === label)
}
async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}
async function typeName(cardIndex, value) {
  const input = nameInputs()[cardIndex]
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('OrderScheduleModal — 複数スケジュール', () => {
  it('未設定なら空の1行から始まる', async () => {
    await mount()
    expect(cards()).toHaveLength(1)
    expect(nameInputs()[0].value).toBe('')
  })

  it('名前つきで複数登録できる', async () => {
    await mount()
    await typeName(0, '青果')
    await click(dow(0, '火'))
    await click(dow(0, '金'))

    await click(addButton())
    await typeName(1, '肉')
    await click(dow(1, '月'))

    await click(saveButton())
    expect(cfg.config.orderSchedules.map(s => [s.name, s.days]))
      .toEqual([['青果', [2, 5]], ['肉', [1]]])
  })

  it('既存の設定を読み込んで編集できる', async () => {
    cfg.setOrderSchedules([{ name: '青果', days: [2], deadline: '15:00' }])
    await mount()
    expect(cards()).toHaveLength(1)
    expect(nameInputs()[0].value).toBe('青果')

    await click(dow(0, '金'))     // 金を足す
    await click(saveButton())
    expect(cfg.config.orderSchedules[0].days).toEqual([2, 5])
    expect(cfg.config.orderSchedules[0].deadline).toBe('15:00')
  })

  it('曜日はもう一度押すと外れる', async () => {
    await mount()
    await click(dow(0, '火'))
    await click(dow(0, '火'))
    await click(saveButton())
    expect(cfg.config.orderSchedules).toEqual([])   // 曜日ゼロの行は保存しない
  })

  it('5件で追加ボタンが消える', async () => {
    cfg.setOrderSchedules([
      { name: 'A', days: [1] }, { name: 'B', days: [2] }, { name: 'C', days: [3] },
      { name: 'D', days: [4] }, { name: 'E', days: [5] },
    ])
    await mount()
    expect(cards()).toHaveLength(5)
    expect(addButton()).toBe(null)
    expect(host.querySelector('.os-max').textContent).toContain('5件まで')
  })

  it('削除できる。最後の1件を消すと空行が残る', async () => {
    cfg.setOrderSchedules([{ name: 'A', days: [1] }, { name: 'B', days: [2] }])
    await mount()
    await click(cards()[0].querySelector('.os-remove'))
    expect(nameInputs().map(i => i.value)).toEqual(['B'])

    await click(cards()[0].querySelector('.os-remove'))
    expect(cards()).toHaveLength(1)
    expect(nameInputs()[0].value).toBe('')

    await click(saveButton())
    expect(cfg.config.orderSchedules).toEqual([])
  })

  it('発注数の決め方の選択項目を持たない', async () => {
    await mount()
    expect(host.textContent).not.toContain('発注数の決め方')
    expect(host.textContent).not.toContain('不足分を自動で入れる')
    expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(0)
  })
})
