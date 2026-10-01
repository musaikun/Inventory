<script setup>
/**
 * 完了した棚卸のレポート（中身）。履歴から開く詳細画面と、共有URLの閲覧画面で同じものを出す
 * （User指示 2026-09-30：閲覧用のレポートを履歴のレポートと同等に）。
 *
 * 品目を1行ずつ追う前に「この棚卸が信用できるか」を判断するための面。
 * 合計金額だけを大きく出すと、単価未設定で一部しか計上されていない数字を
 * 正しい在庫金額だと誤読させるため、金額に入っていない件数を必ず並べて出す。
 *
 * @prop report services/sessionReport.buildSessionReport の戻り値
 */
import { computed } from 'vue'

const props = defineProps({ report: { type: Object, required: true } })

// 前回と数量で比べた3つの一覧。該当の無いものは出さない
const qtyGroups = computed(() => {
  const q = props.report.prev?.qty
  if (!q) return []
  return [
    { key: 'zero',   title: '前回は入力、今回0の品目',       cls: 'diff-down', data: q.zeroNow },
    { key: 'much',   title: '前回より多すぎる品目（2倍以上）', cls: 'diff-up',   data: q.tooMuch },
    { key: 'little', title: '前回より少なすぎる品目（半分以下）', cls: 'diff-down', data: q.tooLittle },
  ].filter(g => g.data.count > 0)
})

function fmtDuration(ms) {
  if (!ms || ms < 0) return '—'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}分`
  return `${Math.floor(min / 60)}時間${String(min % 60).padStart(2, '0')}分`
}

function fmtSignedYen(n) {
  if (n == null) return '—'
  return (n > 0 ? '+' : '') + fmtYen(n)
}

function fmtSignedPct(n) {
  if (n == null) return ''
  return `${n > 0 ? '+' : ''}${n}%`
}

function diffClass(n) {
  if (n == null || n === 0) return ''
  return n > 0 ? 'diff-up' : 'diff-down'
}

function fmtYen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP')
}
</script>

<template>
  <div class="rp">

    <!-- 在庫金額。信用できる数字かどうかを、金額のすぐ隣で分かるようにする -->
    <div class="rp-card rp-value">
      <div class="rp-value-label">在庫金額</div>
      <div class="rp-value-num">{{ report.value.total != null ? fmtYen(report.value.total) : '—' }}</div>
      <div v-if="report.value.partial" class="rp-warn">
        ⚠️ {{ report.value.unpricedCount }}品目は単価が未設定のため、この金額に含まれていません
      </div>
      <div v-else-if="report.value.total == null" class="rp-warn">
        単価が設定されていないため、金額を算出できません
      </div>
    </div>

    <!-- 概要 -->
    <div class="rp-card">
      <div class="rp-grid">
        <div class="rp-cell">
          <div class="rp-cell-num">{{ report.items.filled }}<span class="rp-cell-of">/{{ report.items.total }}</span></div>
          <div class="rp-cell-label">入力済み品目</div>
        </div>
        <div class="rp-cell" :class="{ 'rp-attn': report.items.missing > 0 }">
          <div class="rp-cell-num">{{ report.items.missing }}</div>
          <div class="rp-cell-label">未入力</div>
        </div>
        <div class="rp-cell" :class="{ 'rp-attn': report.items.flagged > 0 }">
          <div class="rp-cell-num">{{ report.items.flagged }}</div>
          <div class="rp-cell-label">要再確認</div>
        </div>
        <div class="rp-cell">
          <div class="rp-cell-num rp-cell-sm">{{ fmtDuration(report.durationMs) }}</div>
          <div class="rp-cell-label">所要時間</div>
        </div>
      </div>
    </div>

    <!-- 前回比 -->
    <div v-if="report.prev" class="rp-card">
      <div class="rp-card-title">前回（{{ report.prev.date }}）との比較</div>
      <div class="rp-diff-row">
        <span :class="['rp-diff-num', diffClass(report.prev.valueDiff)]">{{ fmtSignedYen(report.prev.valueDiff) }}</span>
        <span v-if="report.prev.valuePct != null" :class="['rp-diff-pct', diffClass(report.prev.valueDiff)]">
          {{ fmtSignedPct(report.prev.valuePct) }}
        </span>
      </div>
      <div class="rp-sub">
        前回 {{ report.prev.totalValue != null ? fmtYen(report.prev.totalValue) : '—' }}
        ／ 品目 {{ report.prev.addedItems }}件増・{{ report.prev.removedItems }}件減
      </div>

      <div v-if="report.prev.movers.length" class="rp-movers">
        <div class="rp-movers-title">金額の動きが大きい品目</div>
        <div v-for="m in report.prev.movers" :key="m.item" class="rp-mover">
          <span class="rp-mover-name">{{ m.item }}</span>
          <span :class="['rp-mover-diff', diffClass(m.diff)]">{{ fmtSignedYen(m.diff) }}</span>
        </div>
        <div v-if="report.prev.moversTruncated" class="rp-sub">
          ほか{{ report.prev.moversTruncated }}品目
        </div>
      </div>

      <!-- 数量で比べた一覧（単価が無くても出る）-->
      <div v-for="g in qtyGroups" :key="g.key" :class="['rp-qty', g.key]">
        <div class="rp-movers-title">{{ g.title }}（{{ g.data.count }}件）</div>
        <!-- 全件をこの枠の中で送って見る（以前は10件まで＋「ほかN品目」で残りが見られなかった） -->
        <div class="rp-qty-list">
          <div v-for="r in (g.data.all ?? g.data.list)" :key="r.item" class="rp-mover">
            <span class="rp-mover-name">{{ r.item }}</span>
            <span :class="['rp-mover-diff', g.cls]">
              {{ r.prev }} → {{ r.curr }}{{ r.unit }}<template v-if="r.ratio != null"> ×{{ r.ratio }}</template>
            </span>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="rp-card rp-empty">前回の棚卸が無いため、比較はありません</div>

    <!-- 担当者 -->
    <div v-if="report.people.count" class="rp-card">
      <div class="rp-card-title">担当者（{{ report.people.count }}名）</div>
      <div v-if="report.people.sharedItems" class="rp-sub">
        {{ report.people.sharedItems }}品目を複数人が入力しています
      </div>
      <div v-if="report.people.approximate" class="rp-warn">
        操作の記録が残っていないため、件数は品目単位の概算です
      </div>
      <div v-for="p in report.people.list" :key="p.name" class="rp-person">
        <span class="rp-person-name">{{ p.name }}</span>
        <span class="rp-person-meta">
          {{ p.count }}操作 / {{ p.itemCount }}品目<template v-if="p.sharedCount">（重複{{ p.sharedCount }}）</template>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rp { display: flex; flex-direction: column; gap: 10px; }
.rp-card {
  padding: 12px 14px; border: 1px solid var(--border, #e3e3e3);
  border-radius: 10px; background: var(--surface, #fff);
}
.rp-card-title { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
.rp-sub  { font-size: 12px; opacity: .75; margin-top: 4px; }
.rp-warn { font-size: 12px; margin-top: 6px; color: var(--danger, #c0392b); font-weight: 600; line-height: 1.5; }
.rp-empty { font-size: 13px; opacity: .7; text-align: center; }

.rp-value-label { font-size: 12px; opacity: .75; }
.rp-value-num   { font-size: 28px; font-weight: 700; letter-spacing: -.02em; }

.rp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.rp-cell { text-align: center; }
.rp-cell-num   { font-size: 20px; font-weight: 700; }
.rp-cell-sm    { font-size: 15px; }
.rp-cell-of    { font-size: 12px; font-weight: 400; opacity: .6; }
.rp-cell-label { font-size: 11px; opacity: .7; margin-top: 2px; }
.rp-attn .rp-cell-num { color: var(--danger, #c0392b); }

.rp-diff-row { display: flex; align-items: baseline; gap: 8px; }
.rp-diff-num { font-size: 22px; font-weight: 700; }
.rp-diff-pct { font-size: 14px; font-weight: 600; }
.diff-up   { color: var(--danger, #c0392b); }
.diff-down { color: var(--accent, #2d7d46); }

.rp-movers { margin-top: 10px; }
.rp-qty { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(148,163,184,.25); }
/* 件数が多いときは枠の中だけを縦に送る（見出しは残したまま全件を見られる） */
.rp-qty-list { max-height: 260px; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.rp-movers-title { font-size: 12px; font-weight: 600; opacity: .8; margin-bottom: 4px; }
.rp-mover {
  display: flex; justify-content: space-between; gap: 10px;
  padding: 5px 0; font-size: 13px; border-top: 1px solid var(--border, #eee);
}
.rp-mover-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-mover-diff { flex: none; font-weight: 600; }

.rp-person {
  display: flex; justify-content: space-between; gap: 10px;
  padding: 6px 0; font-size: 13px; border-top: 1px solid var(--border, #eee);
}
.rp-person-meta { flex: none; font-size: 12px; opacity: .75; }

</style>
