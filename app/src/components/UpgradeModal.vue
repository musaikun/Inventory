<script setup>
import { STRIPE_CHECKOUT_URL } from '../utils/planLimits.js'

defineProps({
  reason:  { type: String,  default: '' },
  // アプリ版（TWA）: Google Play 課金ポリシー対策で価格・外部決済導線を出さない
  twaMode: { type: Boolean, default: false },
})
defineEmits(['close'])
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-sheet upgrade-sheet">
      <div class="sheet-handle"></div>

      <div class="upgrade-badge">PRO</div>
      <div class="upgrade-title">タナオロ プロプラン</div>

      <div v-if="reason" class="upgrade-reason">{{ reason }}</div>

      <ul class="upgrade-features">
        <li><span class="uf-check">✓</span>品目登録 無制限（無料は150品目）</li>
        <li><span class="uf-check">✓</span>全期間の棚卸履歴を閲覧（無料は直近1回）</li>
        <li><span class="uf-check">✓</span>接続端末 無制限（無料は3台）</li>
        <li><span class="uf-check">✓</span>分析・レポート・PDF出力</li>
        <li><span class="uf-check">✓</span>優先サポート</li>
      </ul>

      <!-- アプリ版（TWA）: 価格・決済導線を出さず、契約済み案内のみ -->
      <template v-if="twaMode">
        <div class="upgrade-twa-note">
          これらの機能は<strong>タナオロPRO</strong>でご利用いただけます。<br>
          すでにご契約済みの場合は、ログインすると有効になります。
        </div>
      </template>

      <template v-else>
        <div class="upgrade-price-box">
          <span class="up-amount">¥1,980</span>
          <span class="up-period"> / 月</span>
          <div class="up-trial">最初の3ヶ月無料</div>
        </div>

        <a
          v-if="STRIPE_CHECKOUT_URL"
          :href="STRIPE_CHECKOUT_URL"
          class="upgrade-cta"
          target="_blank"
          rel="noopener noreferrer"
          @click="$emit('close')"
        >無料トライアルを開始 →</a>

        <div v-else class="upgrade-coming-wrap">
          <div class="upgrade-coming-badge">近日公開</div>
          <p class="upgrade-coming-hint">現在β版を無料公開中です。<br>料金プランは近日公開予定。</p>
        </div>
      </template>

      <button class="upgrade-dismiss" @click="$emit('close')">閉じる</button>
    </div>
  </div>
</template>

<style scoped>
.upgrade-sheet {
  text-align: center;
  padding-bottom: 24px;
}

.upgrade-badge {
  display: inline-block;
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: white;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  padding: 4px 12px;
  border-radius: 20px;
  margin: 8px auto 12px;
}

.upgrade-title {
  font-size: 22px;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 10px;
}

.upgrade-reason {
  font-size: 13px;
  color: var(--text-muted);
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 16px;
  line-height: 1.5;
}

.upgrade-features {
  list-style: none;
  padding: 0;
  margin: 0 0 20px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.upgrade-features li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.uf-check {
  color: var(--success);
  font-size: 16px;
  font-weight: 800;
  flex-shrink: 0;
}

.upgrade-price-box {
  background: linear-gradient(135deg, var(--primary-weak) 0%, var(--primary-soft) 100%);
  border: 1.5px solid var(--primary-mid);
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 20px;
}

.up-amount {
  font-size: 36px;
  font-weight: 900;
  color: var(--primary);
}

.up-period {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-muted);
}

.up-trial {
  font-size: 12px;
  font-weight: 700;
  color: var(--success);
  margin-top: 4px;
}

.upgrade-cta {
  display: block;
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-deep) 100%);
  color: white;
  font-size: 16px;
  font-weight: 800;
  padding: 16px;
  border-radius: 14px;
  text-decoration: none;
  margin-bottom: 12px;
  transition: opacity 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.upgrade-cta:active { opacity: 0.85; }

.upgrade-coming-wrap {
  padding: 16px;
  background: #f8fafc;
  border-radius: 12px;
  margin-bottom: 16px;
}

.upgrade-coming-badge {
  display: inline-block;
  background: #e2e8f0;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 20px;
  margin-bottom: 8px;
}

.upgrade-coming-hint {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.6;
  margin: 0;
}

.upgrade-twa-note {
  font-size: 14px;
  color: var(--text);
  line-height: 1.7;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}
.upgrade-twa-note strong { color: var(--primary); }

.upgrade-dismiss {
  width: 100%;
  padding: 12px;
  background: none;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.upgrade-dismiss:active { background: #f1f5f9; }
</style>
