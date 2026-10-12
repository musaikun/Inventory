// アプリから使い手へ向ける問いかけ（初回の使い方・フィードバック・レビュー促進）の状態。
//
// 表示は OnboardingGuide.vue / FeedbackPrompts.vue が受け持つ。App は「いつ出すか」
// （棚卸画面に入ったとき・完了したとき）と、戻るボタンで閉じることだけを扱う。
import { ref } from 'vue'
import { track } from '../utils/analytics.js'

// ── 初回オンボーディング ──────────────────────────────────────────────────────
const _ONBOARD_KEY = 'tanaoro_onboarded'
export const showOnboarding = ref(false)

// 棚卸画面に入ったときに呼ぶ。一度閉じた端末には二度と出さない
export function offerOnboarding() {
  if (!localStorage.getItem(_ONBOARD_KEY)) showOnboarding.value = true
}

export function dismissOnboarding() {
  showOnboarding.value = false
  localStorage.setItem(_ONBOARD_KEY, '1')
}

// ── フィードバック ─────────────────────────────────────────────────────────────
export const showFeedback = ref(false)
export const feedbackText = ref('')
export const feedbackSent = ref(false)

export function openFeedback() {
  feedbackText.value = ''
  feedbackSent.value = false
  showFeedback.value = true
  track('feedback_opened')
}

export function submitFeedback() {
  const text = feedbackText.value.trim()
  if (!text) return
  track('feedback_submitted', { text })
  feedbackSent.value = true
  setTimeout(() => { showFeedback.value = false }, 2000)
}

// ── レビュー促進（3回目完了後） ────────────────────────────────────────────────
const _COMPLETED_KEY = 'tanaoro_completed_count'
const _REVIEW_KEY    = 'tanaoro_review_prompted'
export const showReview     = ref(false)
export const reviewRating   = ref(0)
export const reviewStep     = ref('rating') // 'rating' | 'thanks' | 'feedback'
export const reviewFeedback = ref('')

// 棚卸を完了するたびに呼ぶ。3回目で一度だけ評価を訊く
export function checkReviewPrompt() {
  if (localStorage.getItem(_REVIEW_KEY)) return
  const count = parseInt(localStorage.getItem(_COMPLETED_KEY) || '0', 10) + 1
  localStorage.setItem(_COMPLETED_KEY, String(count))
  if (count >= 3) {
    reviewRating.value   = 0
    reviewStep.value     = 'rating'
    reviewFeedback.value = ''
    showReview.value     = true
    track('review_prompt_shown', { completed_count: count })
  }
}

export function onReviewRate(star) {
  reviewRating.value = star
  if (star >= 4) {
    reviewStep.value = 'thanks'
    track('review_rated', { stars: star, positive: true })
    localStorage.setItem(_REVIEW_KEY, '1')
  } else {
    reviewStep.value = 'feedback'
    track('review_rated', { stars: star, positive: false })
  }
}

export function submitReviewFeedback() {
  const text = reviewFeedback.value.trim()
  if (text) track('review_feedback_submitted', { stars: reviewRating.value, text })
  localStorage.setItem(_REVIEW_KEY, '1')
  showReview.value = false
}

export function dismissReview() {
  localStorage.setItem(_REVIEW_KEY, '1')
  showReview.value = false
  track('review_dismissed')
}
