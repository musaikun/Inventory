/**
 * 書き出す中身（表）を組み立てる（User決定 2026-10-17・モック docs/mocks/export-v2.html）。
 * ここは表（行の配列）を返すだけ。ファイル（CSV / Excel）にするのは utils/exportFile.js。
 *
 * - 品目リスト: このアプリの形。そのまま「取り込む › 品目リスト」に入れると問いなしで読める
 *   （見出しの名前で列を決める。utils/itemImport.js の ownItemMapping）。非表示の品目は選んだときだけ（「非表示」の列に ○）
 * - 棚卸結果: 選んだ回。2回以上は「横に並べて1枚（品目×日付）」か「回ごと」。
 *   数えていない品目も、いま非表示でなければ空欄で出す
 * - 発注の記録・入出庫の記録: 期間の1行＝1品目
 * 金額は money=false なら列ごと出さない（金額を見る権限が無い人は、呼び出し側でいつも false）
 */

export const HIDDEN_MARK = '○'

const _axis = (config, i) => config.axisNames?.[i] || (i === 0 ? '並び替え①' : '並び替え②')

/** 品目リストの見出し（このアプリの形）。取り込みはこの名前で列を当てる */
export function itemHeaders(config, { money = true, includeHidden = false } = {}) {
  return [
    '品目名', '単位', ...(money ? ['単価'] : []), 'カテゴリ', 'エイリアス', '商品コード', '分類コード',
    '前月実績', '入数', _axis(config, 0), _axis(config, 1), '発注点', ...(includeHidden ? ['非表示'] : []),
  ]
}

const _num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? '' : Number(v))

/** 品目リスト（並びはいまの品目の並び） */
export function buildItemRows(config, { money = true, includeHidden = false } = {}) {
  const hidden = new Set(config.hiddenItems ?? [])
  const aliases = new Map()
  for (const [alias, target] of Object.entries(config.dictionary ?? {})) {
    if (!aliases.has(target)) aliases.set(target, [])
    aliases.get(target).push(alias)
  }
  const rows = [itemHeaders(config, { money, includeHidden })]
  for (const item of config.order ?? []) {
    const isHidden = hidden.has(item)
    if (isHidden && !includeHidden) continue
    const cat = config.categories?.[item] ?? ''
    rows.push([
      item,
      config.units?.[item] ?? '',
      ...(money ? [_num(config.prices?.[item])] : []),
      cat,
      (aliases.get(item) ?? []).join(','),
      config.codes?.[item] ?? '',
      _num(config.categoryCodes?.[cat]),
      config.prevMonths?.[item] ?? '',
      config.lotSizes?.[item] ?? '',
      (config.tagsA?.[item] ?? []).join('|'),
      (config.tagsB?.[item] ?? []).join('|'),
      _num(config.reorderPoints?.[item]),
      ...(includeHidden ? [isHidden ? HIDDEN_MARK : ''] : []),
    ])
  }
  return rows
}

// ── 棚卸結果 ─────────────────────────────────────────────────

const _md = date => { const [, m, d] = String(date).split('-').map(Number); return m && d ? `${m}/${d}` : String(date) }

/**
 * 出す品目の並び: いまの品目の並び → 棚卸にだけある品目（棚卸の並び）。
 * いま非表示の品目は、選んだ回のどれかで数えていたときだけ出す
 */
function _stockNames(snaps, config) {
  const hidden = new Set(config.hiddenItems ?? [])
  const counted = new Set()
  const inSnap = []
  for (const s of snaps) {
    for (const it of s.items ?? []) {
      if (!it?.item) continue
      if (it.qty !== null && it.qty !== undefined && it.qty !== '') counted.add(it.item)
      inSnap.push(it.item)
    }
  }
  const seen = new Set(), out = []
  const add = n => { if (!seen.has(n) && (!hidden.has(n) || counted.has(n))) { seen.add(n); out.push(n) } }
  for (const n of config.order ?? []) add(n)
  for (const n of inSnap) add(n)
  return out
}
const _itemMap = snap => {
  const m = new Map()
  for (const it of snap.items ?? []) if (it?.item && !m.has(it.item)) m.set(it.item, it)
  return m
}
const _qty = it => (it && it.qty !== null && it.qty !== undefined && it.qty !== '' ? Number(it.qty) : '')

/**
 * @param {object[]} snaps 選んだ回（並びは問わない。古い順に並べ直す）
 * @param {'wide'|'each'} layout wide=品目×日付で1枚 / each=回ごとに1枚（今までと同じ形・過去の棚卸として取り込み直せる）
 * @returns {{ name: string, rows: any[][] }[]}
 */
export function buildStocktakeSheets(snaps, config, { money = true, layout = 'wide' } = {}) {
  const list = [...snaps].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  if (!list.length) return []
  if (layout === 'each' || list.length === 1) {
    return list.map(s => ({ name: s.date, rows: _eachRows(s, config, money) }))
  }
  const names = _stockNames(list, config)
  const maps = list.map(_itemMap)
  const latest = list[list.length - 1]
  const latestMap = maps[maps.length - 1]
  const priceOf = n => {
    for (let i = maps.length - 1; i >= 0; i--) { const p = maps[i].get(n)?.unitPrice; if (p != null && p !== '') return Number(p) }
    return _num(config.prices?.[n])
  }
  const head = ['品目名', 'カテゴリ', '単位', ...(money ? ['単価'] : []), ...list.map(s => _md(s.date)), ...(money ? [`${_md(latest.date)} 在庫金額`] : [])]
  const rows = [head]
  for (const n of names) {
    const any = maps.map(m => m.get(n)).find(Boolean)
    const sub = latestMap.get(n)?.subtotal
    rows.push([
      n, any?.category ?? config.categories?.[n] ?? '', any?.unit ?? config.units?.[n] ?? '',
      ...(money ? [priceOf(n)] : []),
      ...maps.map(m => _qty(m.get(n))),
      ...(money ? [_num(sub)] : []),
    ])
  }
  if (money) {
    rows.push(['【合計金額】', '', '', '', ...list.map(s => _num(s.totalValue)), _num(latest.totalValue)])
  }
  return [{ name: '棚卸結果', rows }]
}

/** 1回分（今までの書き出しと同じ列。金額なしなら単価・在庫金額の列を外す） */
function _eachRows(snap, config, money) {
  const head = ['日付', '商品コード', '品目名', 'カテゴリ', '単位', '入数', '前月実績', '数量', ...(money ? ['単価', '在庫金額'] : [])]
  const rows = [head]
  const m = _itemMap(snap)
  for (const n of _stockNames([snap], config)) {
    const it = m.get(n)
    rows.push([
      snap.date, it?.code ?? config.codes?.[n] ?? '', n, it?.category ?? config.categories?.[n] ?? '',
      it?.unit ?? config.units?.[n] ?? '', it?.lotSize ?? config.lotSizes?.[n] ?? '', it?.prevMonth ?? config.prevMonths?.[n] ?? '',
      _qty(it),
      ...(money ? [it ? _num(it.unitPrice) : _num(config.prices?.[n]), it ? _num(it.subtotal) : ''] : []),
    ])
  }
  if (money && snap.totalValue != null) rows.push([snap.date, '', '【合計】', '', '', '', '', '', '', _num(snap.totalValue)])
  return rows
}

// ── 発注・入出庫の記録 ────────────────────────────────────────

const _inRange = (date, from, to) => (!from || date >= from) && (!to || date <= to)
const _byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.savedAt ?? '').localeCompare(String(b.savedAt ?? ''))
const _amount = (qty, price) => (qty !== '' && price !== '' ? Math.round(qty * price) : '')

/** 発注の記録（1行＝発注1回の品目1つ）。単価はいまの品目の単価 */
export function buildOrderRows(orders, config, { money = true, from = '', to = '' } = {}) {
  const rows = [['日付', '業者', '品目名', '数量', '単位', ...(money ? ['単価', '金額'] : []), '発注した人']]
  for (const o of [...(orders ?? [])].filter(o => !o.deletedAt && _inRange(o.date, from, to)).sort(_byDate)) {
    for (const l of o.lines ?? []) {
      const qty = _num(l.qty), price = _num(config.prices?.[l.item])
      rows.push([o.date, o.supplier || o.axis || '', l.item, qty, l.unit ?? config.units?.[l.item] ?? '',
        ...(money ? [price, _amount(qty, price)] : []), o.by ?? ''])
    }
  }
  return rows
}

/** 入出庫の記録（取り消したものは出さない） */
export function buildMovementRows(movements, config, { money = true, from = '', to = '' } = {}) {
  const rows = [['日付', '種別', '品目名', '数量', '単位', ...(money ? ['単価', '金額'] : []), 'メモ', '記録した人']]
  for (const m of [...(movements ?? [])].filter(m => !m.deletedAt && _inRange(m.date, from, to)).sort(_byDate)) {
    for (const l of m.lines ?? []) {
      const qty = _num(l.qty), price = _num(config.prices?.[l.item])
      rows.push([m.date, m.type === 'out' ? '出庫' : '入庫', l.item, qty, l.unit ?? config.units?.[l.item] ?? '',
        ...(money ? [price, _amount(qty, price)] : []), m.note ?? '', m.by ?? ''])
    }
  }
  return rows
}

/** 期間の選択肢（端末の日付） */
export function periodRange(kind, today = new Date()) {
  const p = n => String(n).padStart(2, '0')
  const key = d => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const y = today.getFullYear(), m = today.getMonth()
  if (kind === 'lastMonth') return { from: key(new Date(y, m - 1, 1)), to: key(new Date(y, m, 0)) }
  if (kind === '3months') return { from: key(new Date(y, m - 2, 1)), to: key(today) }
  return { from: key(new Date(y, m, 1)), to: key(today) }   // thisMonth
}
