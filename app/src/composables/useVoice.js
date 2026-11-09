import { ref } from 'vue'

const UNIT_LIST = [
  'ポーション', 'パック', 'ボトル', 'ケース', 'グラム', 'ミリリットル',
  'リットル', 'キログラム', 'キロ',
  '袋', '個', '本', '玉', '枚', '樽', '箱', '缶',
  'kg', 'ml', 'g', 'L',
]

const _UNIT_RE = [...UNIT_LIST].sort((a, b) => b.length - a.length).map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
// 末尾の「数（＋単位）」だけを数量として読む。途中の数字・単位の文字は名前の一部として残す（User 2026-11-09 の触診で
// 「コーラ500ml」が名前コーラに、英字の g・L が名前から消えていた）
const _TAIL_ATTACHED = new RegExp(`(\\d+(?:[.,．]\\d+)?)\\s*(${_UNIT_RE})?\\s*$`)
const _TAIL_SPACED = new RegExp(`\\s(\\d+(?:[.,．]\\d+)?)\\s*(${_UNIT_RE})?\\s*$`)
// 日本語どうしの間の空白だけ詰める（音声は「トマト 缶」のように区切りを入れる）。英字の単語の間の空白は残す
const _CJK = '[\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef]'
const _tidy = s => s.replace(new RegExp(`(${_CJK})\\s+(?=${_CJK})`, 'g'), '$1').replace(/\s+/g, ' ').trim()

/**
 * 検索・音声の文字を { name, qty, unit } に分ける。
 * - 数量は末尾の数だけ（続く単位も1つだけ取る）。名前の途中の数字・単位の文字はそのまま
 * - typed（手で打った文字）は、数の前に空白があるときだけ数量とみなす（「トマト 3」「トマト 3個」）。
 *   「コーラ500ml」「A001」は名前のまま。声（typed=false）は「トマト3個」のようにくっついていても読む
 */
export function parseText(raw, { typed = false } = {}) {
  // 全角数字 → 半角
  const text = String(raw ?? '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).trim()
  const m = text.match(typed ? _TAIL_SPACED : _TAIL_ATTACHED)
  // 数だけ（名前が空になる）なら数量にしない
  if (!m || !text.slice(0, m.index).trim()) return { name: _tidy(text), qty: null, unit: '' }
  const qty = parseFloat(m[1].replace(/[,，．]/g, '.'))
  return { name: _tidy(text.slice(0, m.index)), qty, unit: m[2] || '' }
}

// 喋りはじめてから、この時間で打ち切る（雑音を拾い続けない・張り続けなくていい）
const BURST_MS = 2000

export function useVoice(onResult, { maxListenMs = BURST_MS } = {}) {
  const isListening  = ref(false)
  const liveText     = ref('')
  let   recognition  = null
  let   burstTimer   = null
  let   lastText     = ''
  let   emitted      = false

  // 発話開始から maxListenMs で1回だけ確定する
  function _armBurst() {
    if (burstTimer) return
    burstTimer = setTimeout(() => _finish(lastText), maxListenMs)
  }

  function _finish(text) {
    if (emitted) return
    emitted = true
    const t = (text ?? '').trim()
    stop()
    if (t) onResult(t)
  }

  function start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return false

    emitted  = false
    lastText = ''
    recognition = new SR()
    recognition.lang           = 'ja-JP'
    recognition.continuous     = false
    recognition.interimResults = true

    recognition.onstart = () => {
      isListening.value = true
      liveText.value    = '話してください…'
    }

    // 発話を検知した瞬間からバーストのカウントを開始
    recognition.onspeechstart = () => _armBurst()

    recognition.onresult = e => {
      let text = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript
      }
      lastText       = text
      liveText.value = text
      _armBurst()   // onspeechstart が来ない環境向けの保険
      if (e.results[e.results.length - 1].isFinal) _finish(text)
    }

    recognition.onerror = e => {
      stop()
      if (e.error !== 'no-speech') liveText.value = `エラー: ${e.error}`
    }

    recognition.onend = () => { if (isListening.value) stop() }
    recognition.start()
    return true
  }

  function stop() {
    isListening.value = false
    if (burstTimer) { clearTimeout(burstTimer); burstTimer = null }
    try { recognition?.stop() } catch (_) {}
    recognition = null
  }

  function toggle() {
    isListening.value ? stop() : start()
  }

  return { isListening, liveText, toggle, start, stop }
}
