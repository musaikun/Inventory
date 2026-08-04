import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

// PLAY-002 のアクセシビリティ回帰（画面レベル）。
// 目的:
//  1. フォーカスがモーダル内に閉じ込められ、背後の画面へ Tab で抜けない
//  2. 閉じたときに開く前の要素へフォーカスが戻る
//  3. 処理中は ESC / オーバーレイで閉じない（削除の二重実行・中断の防止）
//  4. 局面が変わったときにフォーカスが迷子にならない
//
// 公開削除ページごとマウントするのは、モーダルを開く前の「元のフォーカス位置」を
// 実際の導線どおりに作るため（フォーカス復帰の検証に必要）。
vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(),
}))
vi.mock('../utils/analytics.js', () => ({
  initAnalytics: vi.fn(),
  track: vi.fn(),
  resetAnalytics: vi.fn(),
}))
import { apiFetch } from '../utils/api.js'

let app = null
let host = null

async function mountPage() {
  const { default: DeleteAccountPage } = await import('./DeleteAccountPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(DeleteAccountPage)
  app.mount(host)
  await nextTick()
  return host
}

async function type(el, value) {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  await nextTick()
}

function button(root, label) {
  return [...root.querySelectorAll('button')].find(b => b.textContent.includes(label))
}

// 実際に Tab で辿れる要素だけを並び順で取る（disabled は対象外）。
// トラップ側の判定と揃えないと、期待値が「押せないボタン」を指してしまう。
function tabbable(root) {
  return [...root.querySelectorAll('input:not([disabled]), button:not([disabled])')]
}

// finalize() は Push 解除などの await を挟むため、1 tick では 'done' まで進まない
async function flush(n = 8) {
  for (let i = 0; i < n; i++) await nextTick()
}

function pressTab({ shift = false } = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true }))
}

function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

function loginOk() {
  return { token: 'tok-1', shopCode: 'STOREA', storeName: 'A店' }
}

// ログイン → 「アカウント削除に進む」にフォーカスを当ててから開く。
// トリガー要素へフォーカスを置くことで、閉じたときの復帰先を実際の導線と同じにする。
async function openModal(el) {
  await type(el.querySelector('#dap-code'), 'STOREA')
  await type(el.querySelector('#dap-pin'), '1234')
  await click(button(el, 'ログイン'))

  const trigger = button(el, 'アカウント削除に進む')
  trigger.focus()
  await click(trigger)
  await nextTick()
  return { dialog: el.querySelector('[role="dialog"]'), trigger }
}

// PIN・店舗コードを入れて最終確認まで進める
async function toConfirm(dialog) {
  await type(dialog.querySelector('#da-pin'), '1234')
  await type(dialog.querySelector('#da-confirm'), 'STOREA')
  await click(button(dialog, '削除に進む'))
}

beforeEach(() => {
  localStorage.clear()
  apiFetch.mockImplementation(async (path) => {
    if (path === '/auth/login') return loginOk()
    throw new Error(`unexpected call: ${path}`)
  })
})

afterEach(() => {
  if (app) { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  vi.clearAllMocks()
  vi.resetModules()
})

describe('削除モーダル: フォーカス管理', () => {
  it('開いた直後は PIN 入力にフォーカスがある', async () => {
    const el = await mountPage()
    const { dialog } = await openModal(el)

    expect(document.activeElement).toBe(dialog.querySelector('#da-pin'))
  })

  it('Tab が最後の要素から先頭へ循環し、モーダルの外へ出ない', async () => {
    const el = await mountPage()
    const { dialog } = await openModal(el)

    const focusable = tabbable(dialog)
    expect(focusable.length).toBeGreaterThan(1)

    focusable[focusable.length - 1].focus()
    pressTab()

    expect(document.activeElement).toBe(focusable[0])
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('Shift+Tab が先頭の要素から末尾へ循環する', async () => {
    const el = await mountPage()
    const { dialog } = await openModal(el)

    const focusable = tabbable(dialog)
    focusable[0].focus()
    pressTab({ shift: true })

    expect(document.activeElement).toBe(focusable[focusable.length - 1])
  })

  it('背後の画面へフォーカスが逃げた場合はモーダル内へ引き戻す', async () => {
    const el = await mountPage()
    const { dialog, trigger } = await openModal(el)

    // 背後の要素へ強制的にフォーカスを移した状態から Tab
    trigger.focus()
    expect(dialog.contains(document.activeElement)).toBe(false)

    pressTab()

    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('閉じるとモーダルを開く前の要素へフォーカスが戻る', async () => {
    const el = await mountPage()
    const { dialog, trigger } = await openModal(el)

    await click(button(dialog, 'キャンセル'))
    await nextTick()

    expect(el.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('局面が変わるとフォーカスが新しい局面の中へ移る', async () => {
    const el = await mountPage()
    const { dialog } = await openModal(el)

    await toConfirm(dialog)
    await nextTick()

    // 最終確認へ進んだ時点で、入力フォームの要素は DOM から消えている
    expect(dialog.querySelector('#da-pin')).toBeNull()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
})

describe('削除モーダル: 処理中の誤操作防止', () => {
  // DELETE を解決させずに「処理中」で止める
  function stubPendingDelete() {
    apiFetch.mockImplementation(async (path, opts = {}) => {
      if (path === '/auth/login') return loginOk()
      if (path === '/auth/account' && opts.method === 'DELETE') return new Promise(() => {})
      throw new Error(`unexpected call: ${path}`)
    })
  }

  async function toDeleting(el) {
    const { dialog } = await openModal(el)
    await toConfirm(dialog)
    await click(button(dialog, '完全に削除する'))
    await nextTick()
    return dialog
  }

  it('処理中は ESC で閉じない', async () => {
    stubPendingDelete()
    const el = await mountPage()
    const dialog = await toDeleting(el)
    expect(dialog.textContent).toContain('削除しています')

    pressEscape()
    await nextTick()

    expect(el.querySelector('[role="dialog"]')).not.toBeNull()
    expect(el.querySelector('[role="dialog"]').textContent).toContain('削除しています')
  })

  it('処理中はオーバーレイのクリックで閉じない', async () => {
    stubPendingDelete()
    const el = await mountPage()
    await toDeleting(el)

    const overlay = el.querySelector('.modal-overlay')
    await click(overlay)

    expect(el.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('処理中は操作対象が無いためダイアログ自身がフォーカスを保持する', async () => {
    stubPendingDelete()
    const el = await mountPage()
    const dialog = await toDeleting(el)

    // 処理中はボタンが1つも無い＝Tab で外へ出られる状態にしない
    expect(dialog.querySelectorAll('button, input')).toHaveLength(0)
    expect(document.activeElement).toBe(dialog)

    pressTab()
    expect(document.activeElement).toBe(dialog)
  })

  it('完了表示では ESC で閉じない（明示的に閉じる操作だけを受け付ける）', async () => {
    apiFetch.mockImplementation(async (path, opts = {}) => {
      if (path === '/auth/login') return loginOk()
      if (path === '/auth/account' && opts.method === 'DELETE') {
        return { ok: true, status: 'deleted', deletedAt: '2026-08-04T00:00:00Z', alreadyDeleted: false }
      }
      throw new Error(`unexpected call: ${path}`)
    })
    const el = await mountPage()
    const { dialog } = await openModal(el)
    await toConfirm(dialog)
    await click(button(dialog, '完全に削除する'))
    await flush()
    expect(dialog.textContent).toContain('アカウントを削除しました')

    pressEscape()
    await nextTick()

    expect(el.querySelector('[role="dialog"]')).not.toBeNull()
  })
})

describe('削除モーダル: dialog セマンティクス', () => {
  it('role・aria-modal・見出しの関連付けと、フォーカス受け入れ属性を持つ', async () => {
    const el = await mountPage()
    const { dialog } = await openModal(el)

    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('tabindex')).toBe('-1')

    const labelledby = dialog.getAttribute('aria-labelledby')
    expect(labelledby).toBeTruthy()
    const title = dialog.querySelector(`#${labelledby}`)
    expect(title).not.toBeNull()
    expect(title.textContent.trim()).not.toBe('')
  })

  it('入力欄に label が関連付けられている', async () => {
    const el = await mountPage()
    const { dialog } = await openModal(el)

    for (const id of ['da-pin', 'da-confirm']) {
      const input = dialog.querySelector(`#${id}`)
      const label = dialog.querySelector(`label[for="${id}"]`)
      expect(input, `${id} の入力欄`).not.toBeNull()
      expect(label, `${id} の label`).not.toBeNull()
      expect(label.textContent.trim()).not.toBe('')
    }
  })
})
