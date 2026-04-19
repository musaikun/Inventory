import { STORAGE_KEYS } from '../utils/storageKeys.js'

const LEARNING_KEY    = STORAGE_KEYS.learningSessions
const MAX_SESSIONS    = 5
const SESSION_WEIGHTS = [0.5, 0.25, 0.13, 0.08, 0.04]
const LATE_RECOUNT_MS = 15 * 60 * 1000

function _loadSessions() {
  try {
    const raw = localStorage.getItem(LEARNING_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function _saveSessions(sessions) {
  try { localStorage.setItem(LEARNING_KEY, JSON.stringify(sessions)) } catch {}
}

/**
 * 棚卸完了時に学習セッションを保存する。
 * auditLog の action:'new' エントリからデバイス別クラスターを構築する。
 */
export function saveLearningSession(auditLog, configOrder, participantCount) {
  // デバイスごとに品目の初回登録タイムスタンプを収集
  const deviceFirstSeen = new Map() // deviceId -> Map<ingredient, timestamp>

  for (const entry of auditLog) {
    if (entry.action !== 'new') continue
    const did = entry.enteredById || '__solo__'
    if (!deviceFirstSeen.has(did)) deviceFirstSeen.set(did, new Map())
    const devMap = deviceFirstSeen.get(did)
    if (!devMap.has(entry.ingredient)) devMap.set(entry.ingredient, entry.timestamp)
  }

  const clusters = []
  for (const [did, itemMap] of deviceFirstSeen) {
    const items = [...itemMap.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([ingredient, firstSeenAt]) => ({ ingredient, firstSeenAt }))
    if (items.length > 0) clusters.push({ deviceId: did, items })
  }

  if (clusters.length === 0) return

  let sessions = _loadSessions()
  sessions.unshift({
    sessionId:        `sess_${Date.now()}`,
    completedAt:      Date.now(),
    participantCount: participantCount ?? 1,
    configItemCount:  configOrder.length,
    clusters,
  })
  if (sessions.length > MAX_SESSIONS) sessions = sessions.slice(0, MAX_SESSIONS)
  _saveSessions(sessions)
}

/**
 * 保存済みセッション履歴から学習順を計算する。
 * 重み付きスコアが高い品目ほど早く入力される傾向があるとみなす。
 * @returns {string[]|null} 品目名の配列（スコア順）、履歴なしなら null
 */
export function computeLearnedOrder(configOrder) {
  const sessions = _loadSessions()
  if (sessions.length === 0) return null

  const configSet  = new Set(configOrder)
  const itemScores = new Map()

  sessions.forEach((session, idx) => {
    const sessionWeight  = SESSION_WEIGHTS[idx] ?? 0
    if (sessionWeight === 0) return

    const qualityFactor  = (session.participantCount ?? 1) > 1 ? 0.8 : 1.0
    const currentCount   = configOrder.length
    const sessionCount   = session.configItemCount ?? currentCount
    const changePct      = sessionCount > 0
      ? Math.abs(currentCount - sessionCount) / sessionCount
      : 0
    const changePenalty  = changePct < 0.1 ? 1.0 : changePct < 0.3 ? 0.7 : 0.3
    const w              = sessionWeight * qualityFactor * changePenalty
    if (w === 0) return

    // 全クラスターをタイムスタンプでフラット化してグローバル順位を算出
    const allItems = []
    for (const cluster of session.clusters) {
      for (const { ingredient, firstSeenAt } of cluster.items) {
        if (configSet.has(ingredient)) allItems.push({ ingredient, firstSeenAt })
      }
    }
    allItems.sort((a, b) => a.firstSeenAt - b.firstSeenAt)

    const n = allItems.length
    allItems.forEach(({ ingredient }, pos) => {
      const posScore = n > 1 ? (n - pos) / n : 1
      itemScores.set(ingredient, (itemScores.get(ingredient) ?? 0) + w * posScore)
    })
  })

  if (itemScores.size === 0) return null

  const scored   = [...itemScores.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i)
  const unscored = configOrder.filter(i => !itemScores.has(i))
  return [...scored, ...unscored]
}

/**
 * 現セッションの auditLog から「後から再入力された品目」を返す（⚠ 表示用）。
 * 初回登録から15分以上後に更新された品目をセットで返す。
 * @returns {Set<string>}
 */
export function getLateRecountItems(auditLog) {
  const firstSeen = new Map()
  const latest    = new Map()

  for (const entry of auditLog) {
    if (entry.action === 'new' && !firstSeen.has(entry.ingredient)) {
      firstSeen.set(entry.ingredient, entry.timestamp)
    }
    const cur = latest.get(entry.ingredient) ?? 0
    if (entry.timestamp > cur) latest.set(entry.ingredient, entry.timestamp)
  }

  const result = new Set()
  for (const [ing, first] of firstSeen) {
    if ((latest.get(ing) ?? first) - first > LATE_RECOUNT_MS) result.add(ing)
  }
  return result
}
