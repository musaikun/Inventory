<script setup>
// フィードバックの受け口：管理タブから開く「フィードバックを送る」と、3回目の完了後に出るレビュー促進。
// 同じシートの見た目を使うので1つにまとめる。状態は composables/appPrompts.js。
import {
  showFeedback, feedbackText, feedbackSent, submitFeedback,
  showReview, reviewRating, reviewStep, reviewFeedback, onReviewRate, submitReviewFeedback, dismissReview,
} from '../composables/appPrompts.js'
</script>

<template>
  <!-- フィードバックモーダル -->
  <div v-if="showFeedback" class="feedback-overlay" @click.self="showFeedback = false">
    <div class="feedback-sheet">
      <div class="sheet-handle"></div>
      <div class="feedback-title">フィードバック</div>
      <template v-if="!feedbackSent">
        <p class="feedback-desc">ご意見・ご要望・不具合などをお聞かせください</p>
        <textarea
          v-model="feedbackText"
          class="feedback-textarea"
          placeholder="例：〇〇の操作がわかりにくかった、△△の機能が欲しい"
          rows="5"
          autofocus
        ></textarea>
        <div class="feedback-actions">
          <button class="btn btn-secondary" @click="showFeedback = false">キャンセル</button>
          <button class="btn btn-primary" :disabled="!feedbackText.trim()" @click="submitFeedback">送信</button>
        </div>
      </template>
      <div v-else class="feedback-thanks">
        <div class="feedback-thanks-icon">✓</div>
        <div class="feedback-thanks-text">ありがとうございます！</div>
      </div>
    </div>
  </div>

  <!-- レビュー促進モーダル -->
  <div v-if="showReview" class="feedback-overlay" @click.self="dismissReview">
    <div class="feedback-sheet">
      <div class="sheet-handle"></div>

      <!-- 評価ステップ -->
      <template v-if="reviewStep === 'rating'">
        <div class="feedback-title">タナオロはいかがですか？</div>
        <p class="feedback-desc">3回目の棚卸が完了しました。使い心地を教えてください。</p>
        <div class="review-stars">
          <button
            v-for="s in 5"
            :key="s"
            class="review-star"
            :class="{ filled: s <= reviewRating }"
            @click="onReviewRate(s)"
          >★</button>
        </div>
        <button class="feedback-skip" @click="dismissReview">あとで</button>
      </template>

      <!-- 高評価 ありがとう -->
      <template v-else-if="reviewStep === 'thanks'">
        <div class="feedback-title">ありがとうございます！</div>
        <div class="review-thanks-stars">
          <span v-for="s in reviewRating" :key="s" class="review-star-filled">★</span>
        </div>
        <p class="feedback-desc">ご愛用いただき、誠にありがとうございます。</p>
        <div class="feedback-actions">
          <button class="btn btn-primary" @click="showReview = false">閉じる</button>
        </div>
      </template>

      <!-- 低評価 → フィードバック -->
      <template v-else>
        <div class="feedback-title">改善点を教えてください</div>
        <p class="feedback-desc">より良いアプリにするために、ご意見をお聞かせください。</p>
        <textarea
          v-model="reviewFeedback"
          class="feedback-textarea"
          placeholder="使いにくかった点、欲しい機能など"
          rows="4"
        ></textarea>
        <div class="feedback-actions">
          <button class="btn btn-secondary" @click="dismissReview">スキップ</button>
          <button class="btn btn-primary" @click="submitReviewFeedback">送信</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ── フィードバック / レビュー モーダル ── */
.feedback-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 3500;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.feedback-sheet {
  background: #fff;
  border-radius: 20px 20px 0 0;
  padding: 20px 20px calc(32px + env(safe-area-inset-bottom, 0px));
  width: 100%;
  max-width: 480px;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.15);
  animation: slideUp 0.25s ease;
}

.feedback-title {
  font-size: 17px;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 6px;
  text-align: center;
}

.feedback-desc {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  margin: 0 0 16px;
  line-height: 1.5;
}

.feedback-textarea {
  width: 100%;
  padding: 12px 14px;
  font-size: 15px;
  border: 2px solid var(--border);
  border-radius: 12px;
  outline: none;
  resize: none;
  font-family: inherit;
  color: var(--text);
  background: var(--bg);
  box-sizing: border-box;
  margin-bottom: 14px;
  -webkit-appearance: none;
  line-height: 1.5;
}
.feedback-textarea:focus { border-color: var(--primary); }

.feedback-actions {
  display: flex;
  gap: 10px;
}
.feedback-actions .btn { flex: 1; padding: 14px; font-size: 15px; }

.feedback-skip {
  display: block;
  margin: 12px auto 0;
  background: none;
  border: none;
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 6px 12px;
  -webkit-tap-highlight-color: transparent;
}

.feedback-thanks {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0 8px;
  gap: 10px;
}
.feedback-thanks-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #d1fae5;
  color: #065f46;
  font-size: 26px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}
.feedback-thanks-text {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

/* ── レビュー星 ── */
.review-stars {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin: 8px 0 20px;
}
.review-star {
  font-size: 38px;
  background: none;
  border: none;
  cursor: pointer;
  color: #d1d5db;
  transition: color 0.15s, transform 0.1s;
  -webkit-tap-highlight-color: transparent;
  line-height: 1;
  padding: 4px;
}
.review-star.filled { color: #f59e0b; }
.review-star:active  { transform: scale(1.2); }

.review-thanks-stars {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin: 8px 0 12px;
}
.review-star-filled {
  font-size: 28px;
  color: #f59e0b;
}
</style>
