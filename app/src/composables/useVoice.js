import { ref } from 'vue'

const UNIT_LIST = [
  'ポーション', 'パック', 'ボトル', 'ケース', 'グラム', 'ミリリットル',
  'リットル', 'キログラム', 'キロ',
  '袋', '個', '本', '玉', '枚', '樽', '箱', '缶',
  'kg', 'ml', 'g', 'L',
]

// 音声テキストを { name, qty, unit } に分解
export function parseText(raw) {
  // 全角数字 → 半角
  const text = raw.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))

  const numMatch = text.match(/(\d+(?:[.,．]\d+)?)/)
  if (!numMatch) return { name: text.trim(), qty: null, unit: '' }

  const qty = parseFloat(numMatch[1].replace(/[,，]/g, '.'))
  let rest = text.slice(0, numMatch.index) + text.slice(numMatch.index + numMatch[0].length)

  // 長い単位から優先してマッチ
  let unit = ''
  for (const u of [...UNIT_LIST].sort((a, b) => b.length - a.length)) {
    const idx = rest.indexOf(u)
    if (idx !== -1) {
      unit = u
      rest = rest.slice(0, idx) + rest.slice(idx + u.length)
      break
    }
  }

  return { name: rest.replace(/\s+/g, '').trim(), qty, unit }
}

export function useVoice(onResult) {
  const isListening  = ref(false)
  const liveText     = ref('')
  let   recognition  = null

  function start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return false

    recognition = new SR()
    recognition.lang           = 'ja-JP'
    recognition.continuous     = false
    recognition.interimResults = true

    recognition.onstart = () => {
      isListening.value = true
      liveText.value    = '話してください…'
    }

    recognition.onresult = e => {
      let text = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript
      }
      liveText.value = text
      if (e.results[e.results.length - 1].isFinal) {
        stop()
        onResult(text.trim())
      }
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
    recognition?.stop()
    recognition = null
  }

  function toggle() {
    isListening.value ? stop() : start()
  }

  return { isListening, liveText, toggle, start, stop }
}
