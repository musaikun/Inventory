import { ref, onUnmounted } from 'vue'

// メディアクエリの一致状態を reactive に返す。
// jsdom や matchMedia 非対応環境では常に false（= モバイル表示）を返すため、
// 既存のモバイル前提テストの挙動は変わらない。
export function useMediaQuery(query) {
  const matches = ref(false)

  const mql = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null

  if (!mql) return matches

  matches.value = mql.matches
  const onChange = e => { matches.value = e.matches }

  // Safari 13 以前は addEventListener を持たず addListener のみ
  if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange)
  else if (typeof mql.addListener === 'function') mql.addListener(onChange)

  onUnmounted(() => {
    if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange)
    else if (typeof mql.removeListener === 'function') mql.removeListener(onChange)
  })

  return matches
}

// デスクトップシェル（サイドナビ + 広いコンテンツ）を出す閾値。
// style.css の --dt-bp と同じ値を保つこと。
export const DESKTOP_QUERY = '(min-width: 1024px)'
