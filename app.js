/* 영어 단어장 — Obsidian 노트로 만든 개인용 단어장 PWA
   저장소는 전부 localStorage. 서버도 계정도 없다. */
'use strict';

const DATA_URL = 'data/cards.json';
const KEY = {
  progress: 'ewb.progress',
  settings: 'ewb.settings',
  stats:    'ewb.stats',
  star:     'ewb.star',
  theme:    'ewb.theme',
};
const DAY = 86400000;
const GRADES = ['again', 'hard', 'good', 'easy'];

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ── 저장소 ────────────────────────────────────────── */
const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const DEFAULTS = { newPerDay: 20, dir: 'en2ko', autoTts: false, rate: 0.95 };

const S = {
  cards: [], decks: [], byId: new Map(),
  progress: store.get(KEY.progress, {}),
  settings: { ...DEFAULTS, ...store.get(KEY.settings, {}) },
  stats: store.get(KEY.stats, { streak: 0, last: null, history: {} }),
  starred: new Set(store.get(KEY.star, [])),
  deckMap: new Map(),
  queue: [], current: null, flipped: false, curDir: 'en2ko',
  session: { done: 0, total: 0, deck: null },
  quiz: null,
  view: 'home',
};

const saveProgress = debounce(() => store.set(KEY.progress, S.progress), 300);
const saveStats    = () => store.set(KEY.stats, S.stats);
const saveSettings = () => store.set(KEY.settings, S.settings);
const saveStars    = () => store.set(KEY.star, [...S.starred]);

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ── 날짜 ──────────────────────────────────────────── */
const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function dayStart(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime();
}

/* ── SRS (SM-2 축약판) ─────────────────────────────── */
function stateOf(id) { return S.progress[id]; }

function isDue(id, now = Date.now()) {
  const st = stateOf(id);
  return !!st && st.due <= now;
}

/** 등급(0~3)에 따른 다음 간격(일). 미리보기 라벨에도 쓴다. */
function nextInterval(st, g) {
  const ease = st ? st.ease : 2.5;
  const iv = st ? st.interval : 0;
  if (g === 0) return 0;                                  // 오늘 안에 다시
  if (!st || st.reps === 0) return [0, 0.02, 1, 4][g];     // 첫 학습
  if (g === 1) return Math.max(1, Math.round(iv * 1.2));
  if (g === 2) return Math.max(1, Math.round(Math.max(iv, 1) * ease));
  return Math.max(2, Math.round(Math.max(iv, 1) * ease * 1.35));
}

function fmtInterval(days) {
  if (days === 0) return '지금';
  if (days < 1) return '30분';
  if (days < 30) return `${Math.round(days)}일`;
  if (days < 365) return `${(days / 30).toFixed(days < 60 ? 1 : 0)}달`;
  return `${(days / 365).toFixed(1)}년`;
}

function grade(id, g) {
  const prev = stateOf(id);
  const st = prev
    ? { ...prev }
    : { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: 0, seen: 0 };

  const iv = nextInterval(prev, g);
  st.ease = Math.min(2.9, Math.max(1.3, st.ease + [-0.2, -0.15, 0, 0.15][g]));
  st.interval = iv;
  st.seen = Date.now();

  if (g === 0) { st.reps = 0; st.lapses++; st.due = Date.now() + 6e5; }   // 10분 뒤
  else { st.reps++; st.due = Date.now() + iv * DAY; }

  S.progress[id] = st;
  saveProgress();
  return st;
}

/** 0~1. 카드 하나가 얼마나 익었는지. 간격 21일이면 완전 암기로 본다. */
function maturity(id) {
  const st = stateOf(id);
  if (!st || !st.reps) return 0;
  return Math.min(1, st.interval / 21);
}

function overallPct() {
  if (!S.cards.length) return 0;
  let sum = 0;
  for (const c of S.cards) sum += maturity(c.id);
  return Math.round((sum / S.cards.length) * 100);
}

/* ── 학습 큐 ───────────────────────────────────────── */
function pool(deckId) {
  return deckId ? S.cards.filter(c => c.deck === deckId) : S.cards;
}

function countDue(deckId) {
  const now = Date.now();
  return pool(deckId).filter(c => isDue(c.id, now)).length;
}

function countNew(deckId) {
  const cap = S.settings.newPerDay;
  const introducedToday = Object.values(S.progress)
    .filter(st => st.first && st.first >= dayStart()).length;
  const fresh = pool(deckId).filter(c => !stateOf(c.id)).length;
  return Math.max(0, Math.min(fresh, cap - introducedToday));
}

function buildQueue(deckId) {
  const now = Date.now();
  const src = pool(deckId);
  const due = src.filter(c => isDue(c.id, now));
  const fresh = src.filter(c => !stateOf(c.id)).slice(0, countNew(deckId));
  S.queue = shuffle([...due, ...fresh]);
  S.session = { done: 0, total: S.queue.length, deck: deckId };
}

function shuffle(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

/* ── 통계 ──────────────────────────────────────────── */
function logStudy() {
  const key = todayKey();
  S.stats.history[key] = (S.stats.history[key] || 0) + 1;
  if (S.stats.last !== key) {
    const y = todayKey(new Date(Date.now() - DAY));
    S.stats.streak = S.stats.last === y ? S.stats.streak + 1 : 1;
    S.stats.last = key;
  }
  saveStats();
}

/* ── 음성 ──────────────────────────────────────────── */
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
  voice = vs.find(v => /Samantha|Google US English|Microsoft (Aria|Jenny|Zira)/i.test(v.name))
       || vs.find(v => v.lang === 'en-US') || vs[0] || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = S.settings.rate;
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

/* ── 화면 전환 ─────────────────────────────────────── */
const VIEWS = ['home', 'study', 'browse', 'quiz', 'settings'];

function nav(view) {
  S.view = view;
  VIEWS.forEach(v => { $(`#view-${v}`).hidden = v !== view; });
  $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  window.scrollTo(0, 0);
  if (view === 'home') renderHome();
  if (view === 'browse') renderBrowse();
  if (view === 'quiz' && !S.quiz) renderQuizSetup();
  if (view === 'settings') renderSettings();
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ── 홈 ────────────────────────────────────────────── */
function renderHome() {
  const now = new Date();
  $('#home-date').textContent =
    now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

  const pct = overallPct();
  $('#hero-pct').textContent = pct + '%';
  $('#ring').style.strokeDashoffset = String(327 - (327 * pct) / 100);
  $('#stat-due').textContent = countDue(null);
  $('#stat-new').textContent = countNew(null);
  $('#stat-streak').textContent = S.stats.streak + '일';

  const list = $('#deck-list');
  list.innerHTML = '';
  for (const d of S.decks) {
    const cards = pool(d.id);
    const learned = cards.reduce((s, c) => s + maturity(c.id), 0);
    const p = cards.length ? Math.round((learned / cards.length) * 100) : 0;
    const due = countDue(d.id);

    const b = document.createElement('button');
    b.className = 'deck';
    b.innerHTML = `
      <span class="deck-dot" style="background:${d.color}"></span>
      <span class="deck-main">
        <span class="deck-name">${esc(d.name)}${due ? ` <span class="chip">${due}</span>` : ''}</span>
        <span class="deck-desc">${esc(d.desc)}</span>
        <span class="deck-bar"><i style="width:${p}%;background:${d.color}"></i></span>
      </span>
      <span class="deck-num">${p}%<br>${cards.length}장</span>`;
    b.onclick = () => startSession(d.id);
    list.appendChild(b);
  }

  renderHeatmap();
}

function renderHeatmap() {
  const box = $('#heatmap');
  box.innerHTML = '';
  const end = new Date(); end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + (6 - end.getDay()));      // 이번 주 토요일까지
  const cells = 12 * 7;
  const counts = [];

  for (let i = cells - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * DAY);
    const n = S.stats.history[todayKey(d)] || 0;
    counts.push(n);
    const level = n === 0 ? 0 : n < 5 ? 1 : n < 15 ? 2 : n < 35 ? 3 : 4;
    const cell = document.createElement('i');
    cell.dataset.l = level;
    cell.title = `${todayKey(d)} · ${n}회`;
    box.appendChild(cell);
  }

  const total = counts.reduce((a, b) => a + b, 0);
  const days = counts.filter(Boolean).length;
  $('#heatmap-hint').textContent = total
    ? `${days}일 동안 ${total}번 복습 · 최장 연속 ${S.stats.streak}일`
    : '아직 기록이 없습니다. 오늘 첫 카드를 넘겨보세요.';
}

/* ── 학습 세션 ─────────────────────────────────────── */
function startSession(deckId = null) {
  buildQueue(deckId);
  nav('study');
  if (!S.queue.length) return showDone();
  $('#study-done').hidden = true;
  $('#study-body').hidden = false;
  nextCard();
}

function pickDir() {
  const d = S.settings.dir;
  return d === 'mix' ? (Math.random() < 0.5 ? 'en2ko' : 'ko2en') : d;
}

function nextCard() {
  if (!S.queue.length) return showDone();
  S.current = S.queue.shift();
  S.flipped = false;
  // 뜻이 없는 카드는 한글 → 영어로 낼 수 없다.
  S.curDir = S.current.meaning ? pickDir() : 'en2ko';
  renderCard();
}

function renderCard() {
  const c = S.current;
  const deck = S.deckMap.get(c.deck);
  const total = S.session.total || 1;

  $('#study-progress').style.width = `${(S.session.done / total) * 100}%`;
  $('#study-count').textContent = `${S.session.done} / ${total}`;

  $('#flash-deck').textContent = deck ? deck.short : c.deck;
  $('#flash-deck').style.background = deck ? deck.color + '22' : '';
  $('#flash-deck').style.color = deck ? deck.color : '';
  $('#flash-type').textContent = { word: '단어', phrase: '표현', sentence: '문장' }[c.type] || '';
  $('#flash-star').textContent = S.starred.has(c.id) ? '★' : '☆';
  $('#flash-star').classList.toggle('on', S.starred.has(c.id));

  const frontKo = S.curDir === 'ko2en';
  const front = $('#flash-front');
  front.textContent = frontKo ? c.meaning : c.term;
  front.classList.toggle('ko', frontKo);
  $('#flash-speak').hidden = frontKo;

  $('#flash-back').hidden = true;
  $('#grade-row').hidden = true;
  $('#tap-hint').hidden = false;
  $('#tap-hint').textContent = frontKo ? '탭해서 영어 보기' : '탭해서 뜻 보기';

  if (S.settings.autoTts && !frontKo) speak(c.term);
}

function flip() {
  if (S.flipped || !S.current) return;
  S.flipped = true;
  const c = S.current;
  const backEn = S.curDir === 'ko2en';

  const meaning = $('#flash-meaning');
  meaning.textContent = backEn ? c.term : (c.meaning || '— 뜻 없이 표현 그대로 외우는 카드 —');
  meaning.classList.toggle('en', backEn);

  fillList($('#flash-examples'), c.examples, true);
  fillList($('#flash-notes'), c.notes, false);

  $('#flash-back').hidden = false;
  $('#tap-hint').hidden = true;

  const st = stateOf(c.id);
  GRADES.forEach((_, g) => { $('#lbl-' + g).textContent = fmtInterval(nextInterval(st, g)); });
  $('#grade-row').hidden = false;

  if (S.settings.autoTts && backEn) speak(c.term);
}

function fillList(ul, items, speakable) {
  ul.innerHTML = '';
  for (const t of items || []) {
    const li = document.createElement('li');
    li.textContent = t;
    if (speakable) li.onclick = e => { e.stopPropagation(); speak(t); };
    ul.appendChild(li);
  }
}

function doGrade(g) {
  if (!S.current || !S.flipped) return;
  const c = S.current;
  if (!stateOf(c.id)) S.progress[c.id] = { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: 0, first: Date.now() };
  const first = S.progress[c.id].first;
  grade(c.id, g);
  S.progress[c.id].first = first || Date.now();
  saveProgress();
  logStudy();

  if (g === 0) S.queue.push(c);      // 오늘 안에 다시 본다
  else S.session.done++;
  nextCard();
}

function showDone() {
  $('#study-body').hidden = true;
  $('#study-done').hidden = false;
  const n = S.session.done;
  const deck = S.session.deck ? S.deckMap.get(S.session.deck) : null;
  $('#done-summary').textContent = n
    ? `${deck ? deck.name + ' · ' : ''}${n}장을 마쳤습니다. 연속 ${S.stats.streak}일째!`
    : '지금 복습할 카드가 없습니다. 새 카드를 더 꺼내볼까요?';
  $('#study-progress').style.width = '100%';
}

/* ── 목록 ──────────────────────────────────────────── */
const CHUNK = 80;
const browse = {
  q: '', deck: null, type: null, flag: null,
  sort: 'default', dense: false, mask: false,
  hits: [], groupCounts: new Map(), rendered: 0,
};

function renderFilters() {
  const dk = $('#filter-deck'); dk.innerHTML = '';
  const mk = (label, on, fn) => {
    const b = document.createElement('button');
    b.className = 'pill' + (on ? ' on' : '');
    b.textContent = label;
    b.onclick = fn;
    return b;
  };
  dk.appendChild(mk('전체', !browse.deck, () => { browse.deck = null; renderBrowse(); }));
  for (const d of S.decks) {
    dk.appendChild(mk(d.short, browse.deck === d.id,
      () => { browse.deck = d.id; renderBrowse(); }));
  }

  const ms = $('#filter-misc'); ms.innerHTML = '';
  const types = [['word', '단어'], ['phrase', '표현'], ['sentence', '문장']];
  for (const [v, l] of types) {
    ms.appendChild(mk(l, browse.type === v,
      () => { browse.type = browse.type === v ? null : v; renderBrowse(); }));
  }
  const flags = [['star', '★ 즐겨찾기'], ['new', '안 본 카드'], ['weak', '어려운 카드'], ['due', '복습 예정']];
  for (const [v, l] of flags) {
    ms.appendChild(mk(l, browse.flag === v,
      () => { browse.flag = browse.flag === v ? null : v; renderBrowse(); }));
  }
}

function matches(c) {
  if (browse.deck && c.deck !== browse.deck) return false;
  if (browse.type && c.type !== browse.type) return false;
  if (browse.flag === 'star' && !S.starred.has(c.id)) return false;
  if (browse.flag === 'new' && stateOf(c.id)) return false;
  if (browse.flag === 'due' && !isDue(c.id)) return false;
  if (browse.flag === 'weak') {
    const st = stateOf(c.id);
    if (!st || (st.lapses < 1 && st.ease > 2.2)) return false;
  }
  if (browse.q) {
    const q = browse.q.toLowerCase();
    const hay = [c.term, c.meaning, ...(c.examples || []), ...(c.notes || []), c.topic || '']
      .join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** 정렬 기준별 그룹 이름. null 이면 구분 머리글을 넣지 않는다. */
function groupOf(c) {
  if (browse.sort === 'deck') return S.deckMap.get(c.deck)?.name || c.deck;
  if (browse.sort.startsWith('date')) return c.date || '날짜 없음';
  return null;
}

function collectHits() {
  const hits = S.cards.filter(matches);
  const s = browse.sort;

  if (s === 'alpha') {
    // 앞에 붙은 ~, a/an, 따옴표 따위는 정렬에서 무시한다.
    const key = c => c.term.toLowerCase().replace(/^[^a-z0-9가-힣]+/, '');
    hits.sort((a, b) => key(a).localeCompare(key(b), 'en'));
  } else if (s === 'deck') {
    const rank = new Map(S.decks.map((d, i) => [d.id, i]));
    hits.sort((a, b) => (rank.get(a.deck) ?? 99) - (rank.get(b.deck) ?? 99));
  } else if (s.startsWith('date')) {
    const dir = s === 'date-desc' ? -1 : 1;
    hits.sort((a, b) => {
      const x = a.date, y = b.date;
      if (!x && !y) return 0;
      if (!x) return 1;                     // 날짜 없는 카드는 늘 맨 뒤
      if (!y) return -1;
      return x < y ? -dir : x > y ? dir : 0;
    });
  }

  browse.hits = hits;
  browse.groupCounts = new Map();
  for (const c of hits) {
    const g = groupOf(c);
    if (g) browse.groupCounts.set(g, (browse.groupCounts.get(g) || 0) + 1);
  }
}

/** 빽빽하게·가리기는 이미 그려진 목록에 클래스만 갈아끼운다. */
function applyListStyle() {
  const list = $('#browse-list');
  list.classList.toggle('dense', browse.dense);
  list.classList.toggle('mask', browse.mask);
  $('#toggle-dense').classList.toggle('on', browse.dense);
  $('#toggle-mask').classList.toggle('on', browse.mask);
}

/** 검색어·필터·정렬이 바뀌면 처음부터 다시 그린다. */
function renderBrowse() {
  renderFilters();
  applyListStyle();
  $('#sort-by').value = browse.sort;

  collectHits();
  browse.rendered = 0;
  $('#browse-list').innerHTML = '';
  $('#browse-count').textContent = `${browse.hits.length}장`;
  appendChunk();
}

function appendChunk() {
  const list = $('#browse-list');
  const slice = browse.hits.slice(browse.rendered, browse.rendered + CHUNK);
  let last = browse.rendered ? groupOf(browse.hits[browse.rendered - 1]) : null;

  const frag = document.createDocumentFragment();
  for (const c of slice) {
    const g = groupOf(c);
    if (g && g !== last) {
      const h = document.createElement('div');
      h.className = 'group-head';
      h.innerHTML = `<b>${esc(g)}</b><span>${browse.groupCounts.get(g)}장</span>`;
      frag.appendChild(h);
      last = g;
    }
    frag.appendChild(entryEl(c));
  }
  list.appendChild(frag);
  browse.rendered += slice.length;

  $('#browse-end').hidden = !browse.hits.length || browse.rendered < browse.hits.length;
}

function entryEl(c) {
  const deck = S.deckMap.get(c.deck);
  const el = document.createElement('div');
  el.className = 'entry';
  el.innerHTML = `
    <div class="entry-head">
      <span class="entry-dot" style="background:${deck ? deck.color : 'var(--muted)'}"></span>
      ${S.starred.has(c.id) ? '<span class="entry-star">★</span>' : ''}
      <span class="entry-term">${hl(c.term)}</span>
      <span class="entry-meaning">${c.meaning ? hl(c.meaning) : '<i>뜻 없음</i>'}</span>
    </div>`;

  el.onclick = () => {
    // 가리기 모드에선 첫 탭이 뜻을 열고, 그 다음 탭부터 상세가 펼쳐진다.
    if (browse.mask && el.closest('#browse-list') && !el.classList.contains('revealed')) {
      el.classList.add('revealed');
      return;
    }
    const open = el.querySelector('.entry-detail');
    if (open) { open.remove(); return; }
    const d = document.createElement('div');
    d.className = 'entry-detail';
    const ex = (c.examples || []).map(t => `<li>${hl(t)}</li>`).join('');
    const nt = (c.notes || []).map(t => `<li>${hl(t)}</li>`).join('');
    const st = stateOf(c.id);
    d.innerHTML =
      (ex ? `<ul class="ex-list">${ex}</ul>` : '') +
      (nt ? `<ul class="note-list">${nt}</ul>` : '') +
      `<p class="hint">${c.topic ? esc(c.topic) + ' · ' : ''}${c.date ? c.date + ' · ' : ''}` +
      `${st ? `다음 복습 ${fmtInterval(Math.max(0, (st.due - Date.now()) / DAY))} 후` : '아직 학습 전'}</p>` +
      `<div class="entry-actions">
         <button class="icon-btn" data-a="speak">🔊</button>
         <button class="icon-btn star ${S.starred.has(c.id) ? 'on' : ''}" data-a="star">
           ${S.starred.has(c.id) ? '★' : '☆'}</button>
       </div>`;
    d.onclick = e => {
      const a = e.target.dataset.a;
      if (!a) return;
      e.stopPropagation();
      if (a === 'speak') speak(c.term);
      if (a === 'star') {
        toggleStar(c.id);
        const on = S.starred.has(c.id);
        e.target.classList.toggle('on', on);
        e.target.textContent = on ? '★' : '☆';
        // 목록 줄의 ★ 표시도 같이 맞춰준다 (전체 재렌더 없이).
        const head = el.querySelector('.entry-head');
        const mark = head.querySelector('.entry-star');
        if (on && !mark) {
          const s = document.createElement('span');
          s.className = 'entry-star'; s.textContent = '★';
          head.insertBefore(s, head.querySelector('.entry-term'));
        } else if (!on && mark) mark.remove();
      }
    };
    el.appendChild(d);
  };
  return el;
}

function toggleStar(id) {
  S.starred.has(id) ? S.starred.delete(id) : S.starred.add(id);
  saveStars();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

/** 검색어를 <mark>로 강조 (이스케이프 후 적용) */
function hl(s) {
  const safe = esc(s);
  if (!browse.q) return safe;
  const re = new RegExp(browse.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  return safe.replace(re, m => `<mark>${m}</mark>`);
}

/* ── 퀴즈 ──────────────────────────────────────────── */
const quizCfg = { deck: null, dir: 'en2ko', len: 10 };

function renderQuizSetup() {
  $('#quiz-setup').hidden = false;
  $('#quiz-play').hidden = true;
  $('#quiz-result').hidden = true;
  $('#quiz-count').textContent = '';

  const mk = (label, on, fn) => {
    const b = document.createElement('button');
    b.className = 'pill' + (on ? ' on' : '');
    b.textContent = label; b.onclick = fn;
    return b;
  };

  const dk = $('#quiz-deck'); dk.innerHTML = '';
  dk.appendChild(mk('전체', !quizCfg.deck, () => { quizCfg.deck = null; renderQuizSetup(); }));
  for (const d of S.decks) {
    dk.appendChild(mk(d.short, quizCfg.deck === d.id, () => { quizCfg.deck = d.id; renderQuizSetup(); }));
  }

  const dir = $('#quiz-dir'); dir.innerHTML = '';
  for (const [v, l] of [['en2ko', '영어 → 한글'], ['ko2en', '한글 → 영어']]) {
    dir.appendChild(mk(l, quizCfg.dir === v, () => { quizCfg.dir = v; renderQuizSetup(); }));
  }

  const len = $('#quiz-len'); len.innerHTML = '';
  for (const n of [10, 20, 30]) {
    len.appendChild(mk(n + '문항', quizCfg.len === n, () => { quizCfg.len = n; renderQuizSetup(); }));
  }

  $('#quiz-pool').textContent = `출제 가능 ${quizPool().length}장 (뜻이 있는 카드만)`;
}

function quizPool() {
  return pool(quizCfg.deck).filter(c => c.meaning && c.meaning.length > 1);
}

function startQuiz() {
  const src = quizPool();
  if (src.length < 4) return toast('카드가 4장 이상 있어야 퀴즈를 낼 수 있어요.');

  const picked = shuffle(src).slice(0, Math.min(quizCfg.len, src.length));
  S.quiz = {
    items: picked.map(c => makeQuestion(c, src)),
    i: 0, correct: 0, wrong: [], answered: false,
  };
  $('#quiz-setup').hidden = true;
  $('#quiz-result').hidden = true;
  $('#quiz-play').hidden = false;
  renderQuestion();
}

function makeQuestion(card, src) {
  const key = quizCfg.dir === 'en2ko' ? 'meaning' : 'term';
  // 같은 덱·같은 종류에서 먼저 오답을 고른다 (헷갈리게).
  const near = src.filter(c => c.id !== card.id && c.type === card.type);
  const rest = src.filter(c => c.id !== card.id && c.type !== card.type);
  const seen = new Set([card[key]]);
  const distractors = [];
  for (const c of [...shuffle(near), ...shuffle(rest)]) {
    if (distractors.length === 3) break;
    if (seen.has(c[key])) continue;
    seen.add(c[key]);
    distractors.push(c);
  }
  return { card, choices: shuffle([card, ...distractors]) };
}

function renderQuestion() {
  const q = S.quiz.items[S.quiz.i];
  const en2ko = quizCfg.dir === 'en2ko';
  S.quiz.answered = false;

  $('#quiz-count').textContent = `${S.quiz.i + 1} / ${S.quiz.items.length}`;
  $('#quiz-progress').style.width = `${(S.quiz.i / S.quiz.items.length) * 100}%`;

  const prompt = $('#quiz-prompt');
  prompt.textContent = en2ko ? q.card.term : q.card.meaning;
  prompt.classList.toggle('ko', !en2ko);
  $('#quiz-speak').hidden = !en2ko;

  const box = $('#quiz-choices');
  box.innerHTML = '';
  q.choices.forEach(c => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.textContent = en2ko ? c.meaning : c.term;
    b.onclick = () => answer(b, c, q);
    box.appendChild(b);
  });
  $('#quiz-next').hidden = true;
}

function answer(btn, chosen, q) {
  if (S.quiz.answered) return;
  S.quiz.answered = true;
  const ok = chosen.id === q.card.id;
  const en2ko = quizCfg.dir === 'en2ko';

  $$('#quiz-choices .choice').forEach(b => {
    b.disabled = true;
    const label = b.textContent;
    if (label === (en2ko ? q.card.meaning : q.card.term)) b.classList.add('correct');
  });
  if (!ok) btn.classList.add('wrong');

  if (ok) S.quiz.correct++;
  else S.quiz.wrong.push(q.card);

  // 퀴즈 결과도 복습 이력에 반영한다 (맞으면 '알맞음', 틀리면 '다시').
  if (!stateOf(q.card.id)) S.progress[q.card.id] = { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: 0, first: Date.now() };
  grade(q.card.id, ok ? 2 : 0);
  logStudy();

  if (en2ko) speak(q.card.term);
  $('#quiz-next').hidden = false;
  $('#quiz-next').textContent = S.quiz.i + 1 < S.quiz.items.length ? '다음' : '결과 보기';
}

function nextQuestion() {
  S.quiz.i++;
  if (S.quiz.i < S.quiz.items.length) renderQuestion();
  else showQuizResult();
}

function showQuizResult() {
  const { correct, items, wrong } = S.quiz;
  const pct = Math.round((correct / items.length) * 100);
  $('#quiz-play').hidden = true;
  $('#quiz-result').hidden = false;
  $('#quiz-progress').style.width = '100%';
  $('#quiz-emoji').textContent = pct === 100 ? '🏆' : pct >= 70 ? '👏' : '💪';
  $('#quiz-score').textContent = `${items.length}문제 중 ${correct}개 정답 (${pct}%)`;
  $('#quiz-count').textContent = '';

  const box = $('#quiz-wrong');
  box.innerHTML = '';
  if (wrong.length) {
    const h = document.createElement('p');
    h.className = 'hint';
    h.textContent = '틀린 카드';
    box.appendChild(h);
    wrong.forEach(c => box.appendChild(entryEl(c)));
  }
}

/* ── 설정 ──────────────────────────────────────────── */
function renderSettings() {
  $('#set-new').value = S.settings.newPerDay;
  $('#set-dir').value = S.settings.dir;
  $('#set-autotts').checked = S.settings.autoTts;
  $('#set-rate').value = S.settings.rate;

  const studied = Object.keys(S.progress).length;
  $('#set-info').textContent =
    `카드 ${S.cards.length}장 · 학습 시작한 카드 ${studied}장 · 즐겨찾기 ${S.starred.size}장`;
}

function exportProgress() {
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    progress: S.progress, stats: S.stats, starred: [...S.starred], settings: S.settings,
  }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wordbook-progress-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importProgress(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (d.progress) S.progress = d.progress;
      if (d.stats) S.stats = d.stats;
      if (d.starred) S.starred = new Set(d.starred);
      if (d.settings) S.settings = { ...DEFAULTS, ...d.settings };
      store.set(KEY.progress, S.progress); saveStats(); saveStars(); saveSettings();
      toast('진도를 가져왔습니다.');
      renderSettings();
    } catch { toast('파일을 읽을 수 없습니다.'); }
  };
  r.readAsText(file);
}

/* ── 테마 ──────────────────────────────────────────── */
function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
  store.set(KEY.theme, t);
}

function cycleTheme() {
  const now = store.get(KEY.theme, 'auto');
  const next = now === 'auto' ? 'light' : now === 'light' ? 'dark' : 'auto';
  applyTheme(next);
  toast({ auto: '시스템 설정 따름', light: '밝은 테마', dark: '어두운 테마' }[next]);
}

/* ── 이벤트 ────────────────────────────────────────── */
function bind() {
  $$('.tabbar button').forEach(b => {
    b.onclick = () => {
      if (b.dataset.view === 'study' && !S.queue.length && !S.current) startSession(null);
      else nav(b.dataset.view);
    };
  });

  $('#btn-start').onclick = () => startSession(null);
  $('#theme-toggle').onclick = cycleTheme;

  $('#flash').onclick = flip;
  $('#flash-speak').onclick = e => { e.stopPropagation(); speak(S.current.term); };
  $('#flash-star').onclick = e => {
    e.stopPropagation();
    toggleStar(S.current.id);
    $('#flash-star').textContent = S.starred.has(S.current.id) ? '★' : '☆';
    $('#flash-star').classList.toggle('on', S.starred.has(S.current.id));
  };
  $$('.grade').forEach(b => { b.onclick = () => doGrade(+b.dataset.g); });
  $('#study-back').onclick = () => nav('home');
  $('#done-home').onclick = () => nav('home');
  $('#done-more').onclick = () => {
    // 예정에 없던 카드까지 앞당겨 복습한다.
    const src = pool(S.session.deck).filter(c => !S.queue.includes(c));
    S.queue = shuffle(src).slice(0, 20);
    S.session = { done: 0, total: S.queue.length, deck: S.session.deck };
    if (!S.queue.length) return toast('더 볼 카드가 없습니다.');
    $('#study-done').hidden = true;
    $('#study-body').hidden = false;
    nextCard();
  };

  $('#search').oninput = debounce(e => {
    browse.q = e.target.value.trim();
    renderBrowse();
  }, 180);
  $('#sort-by').onchange = e => { browse.sort = e.target.value; renderBrowse(); };
  $('#toggle-dense').onclick = () => { browse.dense = !browse.dense; applyListStyle(); };
  $('#toggle-mask').onclick = () => {
    browse.mask = !browse.mask;
    $$('#browse-list .revealed').forEach(el => el.classList.remove('revealed'));
    applyListStyle();
  };

  // 바닥에 닿으면 다음 묶음을 이어붙인다 (쭉 내리면 끝까지).
  const sentinel = $('#browse-sentinel');
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && S.view === 'browse'
          && browse.rendered < browse.hits.length) appendChunk();
    }, { rootMargin: '600px' }).observe(sentinel);
  } else {
    window.addEventListener('scroll', () => {
      if (S.view !== 'browse' || browse.rendered >= browse.hits.length) return;
      if (sentinel.getBoundingClientRect().top < innerHeight + 600) appendChunk();
    }, { passive: true });
  }

  $('#quiz-start').onclick = startQuiz;
  $('#quiz-next').onclick = nextQuestion;
  $('#quiz-again').onclick = startQuiz;
  $('#quiz-back').onclick = () => { S.quiz = null; renderQuizSetup(); };
  $('#quiz-speak').onclick = () => speak(S.quiz.items[S.quiz.i].card.term);

  $('#set-new').onchange = e => { S.settings.newPerDay = Math.max(0, +e.target.value || 0); saveSettings(); };
  $('#set-dir').onchange = e => { S.settings.dir = e.target.value; saveSettings(); };
  $('#set-autotts').onchange = e => { S.settings.autoTts = e.target.checked; saveSettings(); };
  $('#set-rate').onchange = e => { S.settings.rate = +e.target.value; saveSettings(); speak('This is the speed'); };
  $('#set-export').onclick = exportProgress;
  $('#set-import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = e => { if (e.target.files[0]) importProgress(e.target.files[0]); };
  $('#set-reset').onclick = () => {
    if (!confirm('학습 진도·통계·즐겨찾기를 모두 지웁니다. 계속할까요?')) return;
    S.progress = {}; S.stats = { streak: 0, last: null, history: {} }; S.starred = new Set();
    store.set(KEY.progress, S.progress); saveStats(); saveStars();
    toast('초기화했습니다.'); renderSettings();
  };

  // 데스크톱 단축키: 스페이스로 뒤집고 1~4로 채점
  document.addEventListener('keydown', e => {
    if (S.view !== 'study' || e.target.matches('input, select, textarea')) return;
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); S.flipped ? doGrade(2) : flip(); }
    else if (/^Digit[1-4]$/.test(e.code)) doGrade(+e.code.slice(5) - 1);
  });
}

/* ── 시작 ──────────────────────────────────────────── */
async function main() {
  applyTheme(store.get(KEY.theme, 'auto'));
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    S.cards = data.cards;
    S.decks = data.decks;
    S.decks.forEach(d => S.deckMap.set(d.id, d));
    S.cards.forEach(c => S.byId.set(c.id, c));
    $('#set-version').textContent = `데이터 ${data.version}`;
  } catch (err) {
    $('#boot').innerHTML = `<p>단어 데이터를 불러오지 못했습니다.<br><small>${esc(err.message)}</small></p>`;
    return;
  }

  bind();
  $('#boot').remove();
  $('#app').hidden = false;
  nav('home');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();
