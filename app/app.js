'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  inventory: {},       // { "正式品目名": { qty: number, unit: string } }
  pendingMatch: null,  // { name, quantity, unit } — 確認待ち
};

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const voiceBtn       = $('voice-btn');
const voiceBtnLabel  = $('voice-btn-label');
const transcriptBox  = $('transcript');
const confirmModal   = $('confirm-modal');
const confirmName    = $('confirm-name');
const confirmQty     = $('confirm-qty');
const confirmUnit    = $('confirm-unit');
const dupWarning     = $('dup-warning');
const dupCurrent     = $('dup-current');
const confirmActions = $('confirm-actions');
const btnOverwrite   = $('btn-overwrite');
const btnAdd         = $('btn-add');
const btnCancel      = $('btn-cancel');
const candidateModal = $('candidate-modal');
const candidateList  = $('candidate-list');
const candidateCancel= $('candidate-cancel');
const inventoryBody  = $('inventory-body');
const progressText   = $('progress-text');
const resetBtn       = $('reset-btn');
const exportBtn      = $('export-btn');
const toastEl        = $('toast');

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  $('date-display').textContent = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });

  loadState();
  renderTable();

  voiceBtn.addEventListener('click', toggleVoice);

  // 確認モーダル
  btnOverwrite.addEventListener('click', () => commitEntry(false));
  btnAdd.addEventListener('click',       () => commitEntry(true));
  btnCancel.addEventListener('click',    closeConfirm);

  // 候補モーダル
  candidateCancel.addEventListener('click', closeCandidates);

  // リセット
  resetBtn.addEventListener('click', () => {
    if (!confirm('棚卸データをすべてリセットしますか？')) return;
    state.inventory = {};
    saveState();
    renderTable();
    showToast('リセットしました');
  });

  // CSV出力
  exportBtn.addEventListener('click', exportCSV);
}

// ─── Voice ────────────────────────────────────────────────────────────────────
let recognition = null;
let isListening  = false;

function toggleVoice() {
  isListening ? stopVoice() : startVoice();
}

function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast('このブラウザは音声入力に対応していません');
    return;
  }

  recognition = new SR();
  recognition.lang            = 'ja-JP';
  recognition.continuous      = false;
  recognition.interimResults  = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    voiceBtn.classList.add('listening');
    voiceBtnLabel.textContent = '聞いています…';
    setTranscript('話してください', 'active');
  };

  recognition.onresult = e => {
    let text = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
    }
    setTranscript(text, 'active');
    if (e.results[e.results.length - 1].isFinal) {
      stopVoice();
      processText(text.trim());
    }
  };

  recognition.onerror = e => {
    stopVoice();
    if (e.error !== 'no-speech') showToast(`音声エラー: ${e.error}`);
    else setTranscript('（音声なし）', '');
  };

  recognition.onend = () => { if (isListening) stopVoice(); };

  recognition.start();
}

function stopVoice() {
  isListening = false;
  voiceBtn.classList.remove('listening');
  voiceBtnLabel.textContent = 'タップして話す';
  recognition?.stop();
  recognition = null;
}

// ─── Text Parsing ─────────────────────────────────────────────────────────────
const UNIT_LIST = [
  'ポーション', 'パック', 'ボトル', 'ケース', 'グラム', 'ミリリットル',
  'リットル', 'キログラム', 'キロ',
  '袋', '個', '本', '玉', '枚', '樽', '箱', '缶',
  'kg', 'ml', 'g', 'L',
];

function parseText(raw) {
  // 全角数字→半角
  const text = raw.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

  // 数量を抽出
  const numMatch = text.match(/(\d+(?:[.,．]\d+)?)/);
  if (!numMatch) return { name: text.trim(), qty: null, unit: '' };

  const qty = parseFloat(numMatch[1].replace(/[,，]/g, '.'));
  let rest   = text.slice(0, numMatch.index) + text.slice(numMatch.index + numMatch[0].length);

  // 単位を抽出（長い単位から優先）
  let unit = '';
  const sorted = [...UNIT_LIST].sort((a, b) => b.length - a.length);
  for (const u of sorted) {
    const idx = rest.indexOf(u);
    if (idx !== -1) {
      unit = u;
      rest = rest.slice(0, idx) + rest.slice(idx + u.length);
      break;
    }
  }

  const name = rest.replace(/\s+/g, '').trim();
  return { name, qty, unit };
}

// ─── Dictionary Matching ──────────────────────────────────────────────────────
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/\s/g, '')
    // 全角英数→半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    // カタカナ→ひらがな
    .replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function findCandidates(name) {
  if (!name) return [];
  const nInput = normalize(name);
  const seen   = new Map(); // canonical → best score

  for (const [alias, canonical] of Object.entries(DICTIONARY)) {
    const nAlias = normalize(alias);
    let score = 0;

    if (nAlias === nInput)                  score = 1000;
    else if (nAlias.startsWith(nInput))     score = 500 + nInput.length;
    else if (nInput.startsWith(nAlias))     score = 400 + nAlias.length;
    else if (nAlias.includes(nInput))       score = 300 + nInput.length;
    else if (nInput.includes(nAlias))       score = 200 + nAlias.length;

    if (score > 0) {
      const prev = seen.get(canonical) ?? 0;
      if (score > prev) seen.set(canonical, score);
    }
  }

  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([canonical]) => canonical);
}

// ─── Process Input ────────────────────────────────────────────────────────────
function processText(raw) {
  setTranscript(`"${raw}"`, '');
  const parsed = parseText(raw);

  if (!parsed.name) {
    showToast('食材名が聞き取れませんでした');
    return;
  }

  const candidates = findCandidates(parsed.name);

  if (candidates.length === 0) {
    // 辞書に無い → そのまま確認
    showConfirm(parsed.name, parsed.qty, parsed.unit);
  } else if (candidates.length === 1) {
    // 一意に決定
    showConfirm(candidates[0], parsed.qty, parsed.unit);
  } else {
    // 複数候補
    showCandidates(candidates, parsed.qty, parsed.unit);
  }
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────
function showConfirm(ingredient, qty, unit) {
  state.pendingMatch = { ingredient };

  confirmName.textContent = ingredient;
  confirmQty.value  = qty !== null ? qty : '';
  confirmUnit.value = unit ?? '';
  confirmQty.classList.remove('error');

  // 重複チェック
  const existing = state.inventory[ingredient];
  if (existing !== undefined) {
    dupCurrent.textContent = `現在: ${existing.qty}${existing.unit}`;
    dupWarning.classList.remove('hidden');
    // 3ボタン表示
    confirmActions.classList.add('three-col');
    btnOverwrite.textContent = '上書き';
    btnAdd.classList.remove('hidden');
    btnAdd.textContent = `追加 (${existing.qty}+?)`;
  } else {
    dupWarning.classList.add('hidden');
    confirmActions.classList.remove('three-col');
    btnOverwrite.textContent = '確定';
    btnAdd.classList.add('hidden');
  }

  confirmModal.classList.remove('hidden');
  setTimeout(() => confirmQty.focus(), 80);
}

function commitEntry(isAdd) {
  const ingredient = state.pendingMatch?.ingredient;
  if (!ingredient) return;

  const qty = parseFloat(confirmQty.value);
  if (isNaN(qty) || qty < 0) {
    confirmQty.classList.add('error');
    confirmQty.focus();
    return;
  }

  const unit = confirmUnit.value.trim();
  const existing = state.inventory[ingredient];

  const finalQty = isAdd && existing ? existing.qty + qty : qty;

  state.inventory[ingredient] = { qty: finalQty, unit };
  saveState();
  renderTable();
  closeConfirm();

  const label = isAdd ? `追加 → 合計 ${finalQty}${unit}` : `${finalQty}${unit}`;
  setTranscript(`✓ ${ingredient}　${label}`, 'confirmed');
  showToast(isAdd ? `${ingredient} に追加しました` : `${ingredient} を更新しました`);
}

function closeConfirm() {
  confirmModal.classList.add('hidden');
  state.pendingMatch = null;
}

// ─── Candidate Modal ──────────────────────────────────────────────────────────
function showCandidates(candidates, qty, unit) {
  candidateList.innerHTML = '';
  candidates.slice(0, 6).forEach(canonical => {
    const div = document.createElement('div');
    div.className   = 'candidate-item';
    div.textContent = canonical;
    div.addEventListener('click', () => {
      closeCandidates();
      showConfirm(canonical, qty, unit);
    });
    candidateList.appendChild(div);
  });
  candidateModal.classList.remove('hidden');
}

function closeCandidates() {
  candidateModal.classList.add('hidden');
}

// ─── Inventory Table ──────────────────────────────────────────────────────────
function renderTable() {
  inventoryBody.innerHTML = '';
  let filled = 0;

  // 定義順の品目
  INVENTORY_ORDER.forEach((item, i) => {
    const entry    = state.inventory[item];
    const hasValue = entry !== undefined;
    if (hasValue) filled++;

    const tr = document.createElement('tr');
    if (hasValue) tr.classList.add('filled');

    // 品目名セル
    const tdName = document.createElement('td');
    tdName.className = 'td-name';
    tdName.innerHTML = `<span class="row-num">${i + 1}.</span>${item}`;

    // 数量入力セル
    const tdQty = document.createElement('td');
    tdQty.className = 'td-qty';
    const input = makeQtyInput(item, entry);
    tdQty.appendChild(input);

    tr.appendChild(tdName);
    tr.appendChild(tdQty);
    inventoryBody.appendChild(tr);
  });

  // 辞書外のカスタム品目
  for (const [item, entry] of Object.entries(state.inventory)) {
    if (INVENTORY_ORDER.includes(item)) continue;
    filled++;

    const tr = document.createElement('tr');
    tr.classList.add('filled');

    const tdName = document.createElement('td');
    tdName.className = 'td-name';
    tdName.innerHTML = `<span class="row-num">*</span>${item}<span class="custom-badge">追加</span>`;

    const tdQty = document.createElement('td');
    tdQty.className = 'td-qty';
    tdQty.appendChild(makeQtyInput(item, entry));

    tr.appendChild(tdName);
    tr.appendChild(tdQty);
    inventoryBody.appendChild(tr);
  }

  // 進捗表示
  const total = INVENTORY_ORDER.length + Object.keys(state.inventory).filter(k => !INVENTORY_ORDER.includes(k)).length;
  progressText.innerHTML = `<span>${filled}</span> / ${total} 件入力済み`;
}

function makeQtyInput(item, entry) {
  const input = document.createElement('input');
  input.type        = 'number';
  input.min         = '0';
  input.step        = '0.5';
  input.placeholder = '—';
  input.className   = 'qty-input' + (entry ? ' filled' : '');
  input.value       = entry ? entry.qty : '';

  input.addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    if (e.target.value === '') {
      delete state.inventory[item];
      input.classList.remove('filled');
      e.target.closest('tr').classList.remove('filled');
    } else if (!isNaN(v) && v >= 0) {
      const existing = state.inventory[item] ?? {};
      state.inventory[item] = { qty: v, unit: existing.unit ?? '' };
      input.classList.add('filled');
      e.target.closest('tr').classList.add('filled');
    }
    saveState();
    updateProgress();
  });

  return input;
}

function updateProgress() {
  const filled = Object.keys(state.inventory).length;
  const total  = INVENTORY_ORDER.length;
  progressText.innerHTML = `<span>${filled}</span> / ${total} 件入力済み`;
}

// ─── CSV Export ───────────────────────────────────────────────────────────────
function exportCSV() {
  const date = new Date().toISOString().slice(0, 10);
  const rows = ['date,ingredient,quantity,unit'];

  // 棚卸順に出力
  INVENTORY_ORDER.forEach(item => {
    const e = state.inventory[item];
    if (e) rows.push(`${date},"${item}",${e.qty},"${e.unit}"`);
  });

  // カスタム品目
  for (const [item, e] of Object.entries(state.inventory)) {
    if (!INVENTORY_ORDER.includes(item)) {
      rows.push(`${date},"${item}",${e.qty},"${e.unit}"`);
    }
  }

  const csv = rows.join('\n');

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(csv)
      .then(() => showToast('CSVをクリップボードにコピーしました'))
      .catch(() => fallbackCopy(csv));
  } else {
    fallbackCopy(csv);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  showToast('CSVをコピーしました');
}

// ─── Persistence ──────────────────────────────────────────────────────────────
function saveState() {
  try {
    localStorage.setItem('inventory_v1', JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      inventory: state.inventory,
    }));
  } catch (_) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem('inventory_v1');
    if (!raw) return;
    const data  = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    if (data.date === today) state.inventory = data.inventory ?? {};
  } catch (_) {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setTranscript(text, state) {
  transcriptBox.textContent = text;
  transcriptBox.className   = 'transcript-box' + (state ? ` ${state}` : '');
}

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
