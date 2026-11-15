/**
 * テスト用: アプリの中の確認（composables/askConfirm.js）を、標準の confirm / alert の stub へ橋渡しする。
 * 多くのテストは「確認で OK／取りやめを選んだあと何が起きるか」を見たいだけなので、
 * 答えを `window.confirm` の stub（vi.stubGlobal / vi.spyOn）で決められるようにする。
 * シートそのものの動きは askConfirm.test.js で見る。
 *
 *   vi.mock('../composables/askConfirm.js', async (orig) =>
 *     (await import('../test-stubs/askConfirmBridge.js')).bridge(await orig()))
 */
const join = o => [o.title, o.body].filter(Boolean).join('\n')

export function bridge(actual) {
  return {
    ...actual,
    askConfirm: async (o) => !!globalThis.confirm(join(o)),
    notify: async (m) => { globalThis.alert?.(typeof m === 'string' ? m : join(m)) },
    // 文字を訊くのは prompt の stub へ。だめな名前は標準のときと同じく「お知らせ → 取りやめ」にする
    askText: async (o) => {
      const v = String(globalThis.prompt?.(join(o), o.initial ?? '') ?? '').trim()
      if (!v) return null
      const err = o.validate?.(v)
      if (err) { globalThis.alert?.(err); return null }
      return v
    },
  }
}
