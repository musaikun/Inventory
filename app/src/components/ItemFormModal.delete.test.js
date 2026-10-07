// 品目の1件削除（User決定 2026-10-07）。どの品目でも消せる。取り込んだ品目は次の取込で聞くことと、
// 非表示も選べることを添える。棚卸・発注の途中で数が入っている品目は消させない。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: 'https://worker.test', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))

let app = null, host = null, cfg, events
const tick = async () => { for (let i = 0; i < 3; i++) await nextTick() }
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
async function mount(item) {
  const { default: Modal } = await import('./ItemFormModal.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  events = []
  const on = n => (...a) => events.push([n, ...a])
  app = createApp({ render: () => h(Modal, { mode: 'edit', item, onDeleted: on('deleted'), onSaved: on('saved') }) })
  app.mount(host); await tick()
}
const click = async el => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }

beforeEach(async () => {
  localStorage.clear(); vi.resetModules()
  ;({ useConfig: cfg } = await import('../composables/useConfig.js')); cfg = cfg()
  cfg.loadFromCSV('品目名,単位\nキャベツ,玉\nにんじん,本')   // 取り込んだ品目
  cfg.addItem('自家製ソース', 0, '', 'L')                       // 手で足した品目
  cfg.registerAlias?.('きゃべつ', 'キャベツ')
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('品目の1件削除', () => {
  it('手で足した品目は確認して消せる。過去の記録は残る旨を出す', async () => {
    await mount('自家製ソース')
    await click(btn('この品目を削除…'))
    expect(host.textContent).toContain('過去の棚卸・発注の記録はそのまま残ります')
    expect(btn('非表示にする')).toBeUndefined()
    await click(btn('削除する'))
    expect(cfg.config.order).not.toContain('自家製ソース')
    expect(cfg.config.deletedItems[0]).toBe('自家製ソース')
    expect(events).toContainEqual(['deleted', '自家製ソース'])
  })

  it('取り込んだ品目は、次の取込で聞くことと非表示も選べることを添える', async () => {
    await mount('キャベツ')
    await click(btn('この品目を削除…'))
    expect(host.textContent).toContain('取り込んだ品目です')
    await click(btn('非表示にする'))
    expect(cfg.config.hiddenItems).toContain('キャベツ')
    expect(cfg.config.order).toContain('キャベツ')
  })

  it('棚卸・発注の途中で数が入っている品目は消させない', async () => {
    const { useInventory } = await import('../composables/useInventory.js')
    useInventory().inventory['にんじん'] = { qty: 3, unit: '本' }
    await mount('にんじん')
    await click(btn('この品目を削除…'))
    expect(host.textContent).toContain('終えてから削除してください')
    expect(btn('削除する')).toBeUndefined()
    delete useInventory().inventory['にんじん']
  })
})

describe('削除した品目と次の取込', () => {
  it('前に削除した品目は入れない。選び直せば入れ、削除の記録からも外す', () => {
    cfg.removeConfigItem('にんじん')
    const plan = cfg.planCSVImport('品目名,単位\nキャベツ,玉\nにんじん,本\nたまねぎ,個')
    expect(plan.summary.deletedSkipped).toEqual(['にんじん'])
    expect(plan.order).not.toContain('にんじん')
    expect(plan.order).toContain('たまねぎ')
    const again = cfg.planCSVImport('品目名,単位\nにんじん,本', { restoreDeleted: true })
    cfg.applyImportPlan(again)
    expect(cfg.config.order).toContain('にんじん')
    expect(cfg.config.deletedItems).not.toContain('にんじん')
  })

  it('手で同じ名前を登録し直したら、削除の記録から外す', () => {
    cfg.removeConfigItem('にんじん')
    cfg.addItem('にんじん', 0, '', '本')
    expect(cfg.config.deletedItems).not.toContain('にんじん')
  })
})
