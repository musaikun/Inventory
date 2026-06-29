import { ref } from 'vue'

// 5分間操作が無ければ「一時停止」とみなし、稼働時間に算入しない。
// 営業中に手を止めた時間を棚卸の所要時間から除外するため。
export const PAUSE_THRESHOLD_MS = 5 * 60 * 1000

// 稼働時間と一時停止状態を計算する純粋関数（テスト容易化のため分離）。
//   state = { activeMs, lastActivityAt }
//   - activeMs       : 確定済みの稼働時間（操作間ギャップのうち閾値未満を加算したもの）
//   - lastActivityAt : 最後に操作した時刻
// 戻り値:
//   - elapsedMs : 表示用の稼働時間（停止中は確定分のみ、稼働中は現在までの尾を加算）
//   - paused    : 直近操作から閾値以上経過＝一時停止中
export function computeActive(state, now) {
  if (!state || !state.lastActivityAt) return { elapsedMs: state?.activeMs ?? 0, paused: false }
  const idle   = now - state.lastActivityAt
  const paused = idle >= PAUSE_THRESHOLD_MS
  const tail   = paused ? 0 : Math.max(0, idle)
  return { elapsedMs: (state.activeMs ?? 0) + tail, paused }
}

export function useActiveTimer() {
  const activeMs       = ref(0)
  const lastActivityAt = ref(0)

  // セッション開始時に呼ぶ
  function start(now = Date.now()) {
    activeMs.value       = 0
    lastActivityAt.value = now
  }

  // 既存セッションの再開時に、保存済みの稼働時間から継続する
  function resume(savedActiveMs = 0, now = Date.now()) {
    activeMs.value       = savedActiveMs
    lastActivityAt.value = now
  }

  // 操作が起きるたびに呼ぶ。閾値未満のギャップだけ稼働時間に加算（=アイドル除外）。
  function mark(now = Date.now()) {
    if (!lastActivityAt.value) { lastActivityAt.value = now; return }
    const gap = now - lastActivityAt.value
    if (gap > 0 && gap < PAUSE_THRESHOLD_MS) activeMs.value += gap
    lastActivityAt.value = now
  }

  // 現在の稼働時間（ms）
  function elapsedMs(now = Date.now()) {
    return computeActive({ activeMs: activeMs.value, lastActivityAt: lastActivityAt.value }, now).elapsedMs
  }

  // 一時停止中か
  function isPaused(now = Date.now()) {
    return computeActive({ activeMs: activeMs.value, lastActivityAt: lastActivityAt.value }, now).paused
  }

  return { activeMs, lastActivityAt, start, resume, mark, elapsedMs, isPaused }
}
