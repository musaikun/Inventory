<script setup>
// 初回オンボーディング（はじめて棚卸画面に入ったときの使い方）。状態は composables/appPrompts.js。
import { showOnboarding, dismissOnboarding } from '../composables/appPrompts.js'
</script>

<template>
  <Transition name="onboard">
    <div v-if="showOnboarding" class="onboard-overlay" @click.self="dismissOnboarding">
      <div class="onboard-card">
        <div class="onboard-title">タナオロの使い方</div>
        <ol class="onboard-steps">
          <li class="onboard-step">
            <span class="onboard-icon">🎤</span>
            <div>
              <strong>音声ボタンをタップ</strong>
              <p>「豚バラ 3キロ」「卵 2パック」と話すだけ</p>
            </div>
          </li>
          <li class="onboard-step">
            <span class="onboard-icon">✓</span>
            <div>
              <strong>数量を確認して登録</strong>
              <p>品目が自動で認識されます。数値を確認してタップ</p>
            </div>
          </li>
          <li class="onboard-step">
            <span class="onboard-icon">📋</span>
            <div>
              <strong>品目がない場合は追加</strong>
              <p>「＋ 品目を追加」フォームからその場で登録できます</p>
            </div>
          </li>
          <li class="onboard-step">
            <span class="onboard-icon">🔗</span>
            <div>
              <strong>複数端末で同時入力</strong>
              <p>🔗ボタンからルームを作成、QRコードで仲間を招待</p>
            </div>
          </li>
        </ol>
        <button class="onboard-btn" @click="dismissOnboarding">はじめる</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* ── 初回オンボーディング ── */
.onboard-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.72);
  backdrop-filter: blur(4px);
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.onboard-card {
  background: #fff;
  border-radius: 20px;
  padding: 28px 24px 24px;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  animation: onboardIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes onboardIn {
  from { transform: scale(0.88) translateY(20px); opacity: 0; }
  to   { transform: scale(1)    translateY(0);    opacity: 1; }
}

.onboard-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
  text-align: center;
  margin-bottom: 22px;
  letter-spacing: -0.02em;
}

.onboard-steps {
  list-style: none;
  padding: 0;
  margin: 0 0 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.onboard-step {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.onboard-icon {
  font-size: 22px;
  width: 38px;
  height: 38px;
  background: #f0f6ff;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
}

.onboard-step strong {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 2px;
}

.onboard-step p {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
}

.onboard-btn {
  width: 100%;
  padding: 15px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  letter-spacing: 0.02em;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s;
}
.onboard-btn:active { opacity: 0.85; }

.onboard-enter-active { transition: opacity 0.2s ease; }
.onboard-leave-active { transition: opacity 0.25s ease; }
.onboard-enter-from,
.onboard-leave-to     { opacity: 0; }
</style>
