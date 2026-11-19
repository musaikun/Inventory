/**
 * 手で入れた手順（子タスク）を、チェック表（ひな形）として残す（User 2026-11-19）。
 * チェック表を選んで付けた手順はそのまま使えるが、手で打った手順は次に同じ業務を足すときに打ち直しだった。
 * 名前は業務の名前を初めに入れて訊く。同じ名前のチェック表があれば、その場で伝える。
 */
import { computed } from 'vue'
import { askText, notify } from './askConfirm.js'
import { checklistTemplates, canAddTemplate, findTemplate, saveChecklistTemplate, TEMPLATE_NAME_MAX } from './useTemplates.js'

const _texts = steps => (steps ?? []).map(s => String(s?.text ?? '').trim()).filter(Boolean)

/** 同じ項目（同じ順）のチェック表がもうあるか。チェック表から付けた手順には「残す」を出さない */
export function checklistWithSameSteps(steps) {
  const key = _texts(steps).join('\n')
  if (!key) return null
  return checklistTemplates.value.find(t => _texts(t.data?.items).join('\n') === key) ?? null
}

/** 「チェック表として残す」を出すか */
export function useStepsToChecklist(stepsRef) {
  return computed(() => canAddTemplate.value && _texts(stepsRef.value).length > 0 && !checklistWithSameSteps(stepsRef.value))
}

/**
 * 名前を訊いて、手順をチェック表として保存する。
 * @returns {Promise<string|null>} 保存したチェック表の名前。取りやめ・失敗は null
 */
export async function saveStepsAsChecklist(steps, defaultName = '') {
  const items = _texts(steps).map(text => ({ text }))
  if (!items.length) return null
  const name = await askText({
    title: 'チェック表の名前',
    body: `この手順（${items.length}項目）をチェック表に入れます。次に業務を足すとき「チェック表」から選べます。`,
    initial: String(defaultName ?? '').slice(0, TEMPLATE_NAME_MAX),
    maxLength: TEMPLATE_NAME_MAX,
    ok: 'チェック表に入れる',
    validate: v => (findTemplate('checklist', v) ? '同じ名前のチェック表があります' : ''),
  })
  if (!name) return null
  try {
    await saveChecklistTemplate(null, name, items)
    return name
  } catch (e) {
    notify({ title: 'チェック表に入れられませんでした', body: e?.message || '' })
    return null
  }
}
