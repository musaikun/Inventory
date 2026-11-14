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
  }
}
