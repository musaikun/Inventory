/**
 * セキュリティ上の出来事を、Workers Logs で絞り込める1行の JSON にして残す（OPS-001）。
 *
 * 形: {"evt":"security","type":"login_failed","shop":"ABCDEF","ip":"203.0.113.x",...}
 * Workers Logs の検索で `evt = security` と `type` を指定すれば、警報の条件にできる
 * （条件の一覧は docs/quality-foundation/tasks/OPS-001.md）。
 *
 * 残してよい項目は下の ALLOWED だけ。トークン・PIN・本文・ヘッダは渡されても書かない。
 * IP は下位を伏せる（IPv4 は /24、IPv6 は /48）。同じ回線からの連続は追えるが、個人の端末までは特定しない。
 */
const ALLOWED = new Set(['shop', 'ip', 'kind', 'path', 'method', 'status', 'code', 'missing', 'role', 'reason'])

export function maskIp(ip) {
  const s = String(ip ?? '')
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return s.split('.').slice(0, 3).join('.') + '.x'
  if (s.includes(':')) {
    const head = s.split('::')[0].split(':').filter(Boolean).slice(0, 3)
    return head.length ? head.join(':') + '::x' : 'x'
  }
  return s ? 'x' : ''
}

function _clean(k, v) {
  if (k === 'ip') return maskIp(v)
  if (Array.isArray(v)) return v.slice(0, 10).map(x => String(x).slice(0, 40))
  if (typeof v === 'string') return v.slice(0, 80)
  if (typeof v === 'number' || typeof v === 'boolean') return v
  return undefined
}

export function securityEvent(type, fields = {}) {
  const out = { evt: 'security', type: String(type).slice(0, 40) }
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (!ALLOWED.has(k) || v == null || v === '') continue
    const c = _clean(k, v)
    if (c !== undefined) out[k] = c
  }
  try { console.warn(JSON.stringify(out)) } catch (_) { /* ログで本体を止めない */ }
}
