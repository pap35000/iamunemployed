/* iAmUnemployed app. Everything a member does is saved on the server through /api.
   The browser itself only remembers which tab was open. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = n => (Number(n) || 0).toLocaleString('en-US');
const pad = (n, w = 4) => String(Math.max(0, Math.min(9999, Number(n) || 0))).padStart(w, '0');

/* dates in local time */
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);

/* content (keep the lists in step with server/util.js) */
const TITLES = [[0, 30, 'On Vacation (Allegedly)'], [31, 90, 'LinkedIn Ambassador'], [91, 180, 'PhD in Iced Coffee'], [181, 365, 'Couch Sage'], [366, Infinity, 'Living Legend']];
const tierOf = d => Math.max(0, TITLES.findIndex(t => d >= t[0] && d <= t[1]));
const titleFor = d => TITLES[tierOf(d)][2];

const COUNTRIES = [['US', 'United States'], ['UK', 'United Kingdom'], ['IE', 'Ireland'], ['CA', 'Canada'], ['AU', 'Australia'], ['GR', 'Greece'], ['XX', 'Somewhere else']];
const countryName = c => (COUNTRIES.find(x => x[0] === c) || COUNTRIES[6])[1];
const HELP = {
  US: [['988', 'Suicide & Crisis Lifeline. Call or text, 24/7.']],
  UK: [['116 123', 'Samaritans. Free, 24/7.']],
  IE: [['116 123', 'Samaritans. Free, 24/7.']],
  CA: [['988', 'Suicide Crisis Helpline. Call or text, 24/7.']],
  AU: [['13 11 14', 'Lifeline. 24/7.']],
  GR: [['1018', 'Klimaka suicide prevention line.'], ['10306', 'Mental health support line.']],
  XX: []
};
const INDUSTRIES = ['Tech', 'Design', 'Marketing', 'Hospitality', 'Retail', 'Healthcare', 'Education', 'Finance', 'Other'];
const CATS = ['Mental Health', 'Interviews', 'CVs & Résumés', 'Rejections', 'Benefits & Paperwork', 'Career Change', 'Wins', 'Memes'];
const MOVES = [['applied', 'Applied'], ['interview', 'Interview'], ['course', 'Course'], ['coffee', 'Coffee chat'], ['workout', 'Workout'], ['helped', 'Helped someone'], ['rejected', 'Got rejected'], ['ghosted', 'Got ghosted']];
const moveLabel = k => (MOVES.find(m => m[0] === k) || [k, k])[1];
const MOVE_TOAST = {
  applied: 'Application logged. The ATS has been notified.',
  interview: 'Interview logged. Go get them.',
  course: 'Course logged. Big brain energy.',
  coffee: 'Coffee chat logged. Networking unlocked.',
  workout: 'Workout logged. Body and mind.',
  helped: 'Thanks for helping someone in the queue.',
  rejected: 'Rejection logged. It still counts as effort.'
};
const MOODS = [['awful', '😫', 'Awful'], ['low', '😕', 'Low'], ['meh', '😐', 'Meh'], ['okay', '🙂', 'Okay'], ['good', '😄', 'Good']];
const MOOD_TOAST = {
  awful: 'Rough day. Be gentle with yourself. The Feed is here if you want to talk.',
  low: 'Noted. Small steps count today.',
  meh: 'Meh is allowed. You showed up.',
  okay: 'Okay is good. Keep going.',
  good: 'Love that. Ride the wave.'
};
const REACTS = {post: ['same', 'hug', 'haha'], escape: ['congrats', 'hug'], hiring: ['useful', 'congrats']};
const REACT_LABEL = {same: 'Same', hug: 'Hug', haha: 'Haha', congrats: 'Congrats', useful: 'Useful'};

const ADS = [
  {co: 'Example Media Ltd', when: 'posted 2 days ago', text: 'Entry-level marketing assistant. 5+ years of experience required. Must be fluent in 4 languages. Salary: competitive.'},
  {co: 'Sample Labs Inc', when: 'posted 3 days ago', text: 'Junior developer. Expert in 9 frameworks, including 2 that haven’t been released yet. Unpaid 6-month trial.'},
  {co: 'Placeholder & Co', when: 'posted 4 days ago', text: 'Social media manager. Reachable 24/7 because “we’re a family here”. Pay: exposure, plus free coffee on Fridays.'}
];

const PHRASES = ['We’ll keep your CV on file', 'You’re over­qualified', 'Went with an internal candidate', 'Looking for someone with passion', 'Ghosted after the final round', 'Unpaid trial day', 'Entry level, 5+ years', 'Salary: compet­itive', 'We’re like a family', 'Fast-paced environ­ment', 'What’s your biggest weakness?', 'Rejected by auto-email', 'Re­scheduled 3 times', 'Free “test project”', 'Not a culture fit'];
const FREE = -1, FREE_AT = 5;
const LINES = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15], [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15], [0, 5, 10, 15], [3, 6, 9, 12]];
function bingoOrder(shuffle) {
  const idx = PHRASES.map((_, i) => i);
  if (shuffle) for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  idx.splice(FREE_AT, 0, FREE);
  return idx;
}

const JOKES = [
  () => 'The ATS rejected me before a human could. Honestly, respect the efficiency.',
  () => 'My CV has more versions than my phone’s operating system.',
  () => `Applied to ${S.totals.applied} jobs. Heard back from my mum.`,
  d => `Current title: ${titleFor(d)}. Salary: vibes.`,
  () => `Ghosted ${S.totals.ghosted} times. Starting to think I’m the ghost.`,
  () => 'Still here. Still sending CVs at 3am.',
  () => 'Entry-level role, they said. Only 5 years of experience required.',
  () => 'The job ad says “fast-paced, family culture”. The interview process says “see you in six weeks”.'
];
const NICKS = ['CoverLetterPoet', 'InterviewSurvivor', 'RejectionCollector', 'PortfolioPending', 'OpenToWorkOwl', 'CVsAtMidnight', 'FrappeFanatic', 'Ghosted_Twice'];
const CRISIS = /\b(hopeless|worthless|give up on (life|everything)|giving up on (life|everything)|end it all|end my life|can[’']?t go on|kill myself|suicid\w*|want to die|no reason to live|better off dead)\b/i;

/* talking to the server */
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
async function api(path, method = 'GET', body) {
  const init = {method, headers: {'X-Local-Date': todayStr()}, credentials: 'same-origin', cache: 'no-store'};
  if (method !== 'GET') { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body || {}); }
  let res;
  try { res = await fetch('/api' + path, init); }
  catch (e) { throw new ApiError(0, 'offline', 'Can’t reach iAmUnemployed right now. Check your connection and try again.'); }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const err = new ApiError(res.status, (data && data.error) || 'error', (data && data.message) || 'Something went wrong. Please try again.');
    if (res.status === 401 && S && !path.startsWith('/auth/')) signedOut();
    throw err;
  }
  return data;
}

// Changes run one after another, so answers from the server arrive in the order of the taps.
let chain = Promise.resolve();
function queued(fn) { const run = chain.then(fn); chain = run.catch(() => {}); return run; }

/* passwords: stretched on this device, so the server never receives them */
const ROUNDS = 600000;
const encoder = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cleanNick = v => Array.from(String(v || '').normalize('NFC').trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_.\-]/gu, '')).slice(0, 20).join('');
async function passwordKey(nick, password) {
  if (!window.crypto || !crypto.subtle) throw new Error('This browser can’t log in securely. Please use an up-to-date browser.');
  const base = await crypto.subtle.importKey('raw', encoder.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode('iamunemployed/v1/' + nick.normalize('NFC').toLowerCase()), iterations: ROUNDS}, base, 256);
  return b64url(new Uint8Array(bits));
}

/* state */
const TAB_KEY = 'iamunemployed-tab';
let S = null; // the signed-in member, as the server sees them
const UI = {tab: 'home', board: 'legends', cat: 'All', joke: 0, backConfirm: false, goalEdit: false, pending: null, armed: null, code: null, codeIsNew: false, refreshedFor: null};
let DATA = {boards: {}, feed: null, unicorn: null, feedSeq: 0};
let meAt = 0;

function setMe(me) {
  // The bingo card lives in this tab while it is open; the server keeps a copy for next time.
  const card = S ? S.bingo : null;
  S = me;
  if (card) S.bingo = card;
  else if (!S.bingo) S.bingo = {order: bingoOrder(true), marks: [FREE_AT], won: false};
  meAt = Date.now();
}
function forget() {
  S = null;
  DATA = {boards: {}, feed: null, unicorn: null, feedSeq: 0};
  Object.assign(UI, {backConfirm: false, goalEdit: false, pending: null, armed: null});
}
function loadTab() { try { const t = localStorage.getItem(TAB_KEY); if (t) UI.tab = t; } catch (e) { /* storage unavailable */ } }
function saveTab() { try { localStorage.setItem(TAB_KEY, UI.tab); } catch (e) { /* storage unavailable */ } }
const days = () => S.escaped ? (S.escapedDays || 0) : Math.max(0, diffDays(S.startDate, todayStr()));

/* badges */
const peakDays = () => Math.max(days(), S.escapedDays || 0, S.peak || 0);
const BADGES = [
  {id: 'centurion', name: 'Centurion', desc: '100 days in the queue', prog: () => [Math.min(peakDays(), 100), 100]},
  {id: 'ghost', name: 'Ghost Whisperer', desc: 'Ghosted by 10 companies', prog: () => [Math.min(S.totals.ghosted || 0, 10), 10]},
  {id: 'thick', name: 'Thick Skin', desc: '50 rejections logged', prog: () => [Math.min(S.totals.rejected || 0, 50), 50]},
  {id: 'helper', name: 'Helping Hand', desc: 'Helped someone 15 times', prog: () => [Math.min(S.totals.helped || 0, 15), 15]},
  {id: 'boss', name: 'Final Boss Survivor', desc: 'Five interview rounds for one job', claim: true},
  {id: 'speedrun', name: 'Speedrun Rejection', desc: 'Rejected within 3 minutes of applying', claim: true},
  {id: 'exposure', name: 'Paid in Exposure', desc: 'Offered an unpaid “opportunity”', claim: true},
  {id: 'unicorn', name: 'Unicorn Spotter', desc: 'Voted for Unicorn of the Week', earned: () => !!S.unicornEver},
  {id: 'bingo', name: 'Bingo!', desc: 'A full line in Rejection Bingo', earned: () => !!(S.bingo && S.bingo.won)},
  {id: 'escapee', name: 'Escapee', desc: 'Landed a job', earned: () => !!S.escapeNo},
  {id: 'sequel', name: 'The Sequel', desc: 'Came back after an escape, with zero shame', earned: () => !!S.sequel},
  {id: 'liberator', name: 'Liberator', desc: 'Someone got hired through your referral', soon: true}
];
function isEarned(b) {
  if (b.claim) return !!(S.claimed && S.claimed[b.id]);
  if (b.prog) { const [n, m] = b.prog(); return n >= m; }
  if (b.earned) return b.earned();
  return false;
}
const earnedIds = () => new Set(BADGES.filter(isEarned).map(b => b.id));
async function withBadges(fn) {
  const before = earnedIds();
  await fn();
  const after = earnedIds();
  return BADGES.filter(b => after.has(b.id) && !before.has(b.id)).map(b => b.name);
}
function unlockedMsg(names) {
  if (!names.length) return '';
  const list = names.join(', ');
  return ` Badge unlocked: ${list}${/[.!?]$/.test(list) ? '' : '.'}`;
}

/* small helpers */
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; return h; };
const avClass = n => 'abcd'[hash(n) % 4];
function initials(n) {
  const s = String(n || '');
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (!letters) return '?';
  const cap = s.slice(1).match(/\p{Lu}/u);
  return (letters[0] + (cap ? cap[0] : (letters[1] || ''))).toUpperCase();
}
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
function whenText(dateStr) {
  if (!dateStr) return '';
  const n = diffDays(dateStr, todayStr());
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}
function guessCountry() {
  const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']).map(l => String(l).toLowerCase());
  for (const l of langs) {
    if (l === 'el' || l.startsWith('el-') || l.endsWith('-gr')) return 'GR';
    if (l.endsWith('-us')) return 'US';
    if (l.endsWith('-gb')) return 'UK';
    if (l.endsWith('-ie')) return 'IE';
    if (l.endsWith('-ca')) return 'CA';
    if (l.endsWith('-au')) return 'AU';
  }
  return 'XX';
}
const winningLines = () => LINES.filter(l => l.every(i => S.bingo.marks.includes(i)));
const memeCard = (top, big, left, right) => `<div class="meme-card"><span class="top">${esc(top)}</span><span class="big">${esc(big)}</span><span class="foot"><span>${esc(left)}</span><span>${esc(right)}</span></span></div>`;
function cheersText() {
  if (S.cheers > 0) return `${fmt(S.cheers)} ${S.cheers === 1 ? 'person has' : 'people have'} congratulated you`;
  return S.escapeWall ? 'Your escape is on the Wall. The congratulations will roll in.' : 'You kept this escape private. Congratulations from us!';
}
const calmBox = what => `<div class="calm-box"><h2>Calm mode is on</h2><p class="hint">${what} are hidden for today. Take it easy. You can turn this off whenever you like.</p><button class="btn ghost small" data-action="calm-off" data-k="calm-off">Turn off calm mode</button></div>`;
const emptyBox = msg => `<div class="empty"><p class="hint">${msg}</p></div>`;
const errorBox = (msg, action) => `<div class="empty"><p class="hint">${esc(msg)}</p><button class="btn ghost small" data-action="${action}" data-k="${action}">Try again</button></div>`;
const loadingLine = '<p class="hint">Loading…</p>';
function helpHTML() {
  const lines = HELP[S ? S.country : 'XX'] || [];
  return `<div class="helpbox">${lines.map(([n, t]) => `<div class="line"><b>${n}</b><span>${t}</span></div>`).join('')}<div class="line"><b><a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer">findahelpline.com</a></b><span>${lines.length ? 'Free, confidential lines in other countries.' : 'Free, confidential lines in your country.'}</span></div></div>`;
}

/* weekly application goal */
const GOAL_MAX = 50;
function goalHTML() {
  const g = S.weekGoal || 0, n = S.weekApplied || 0;
  if (UI.goalEdit) {
    return `<form class="block" id="goal-form" novalidate>
    <h2>This week’s goal</h2>
    <div class="field"><label for="goal-n">Applications to send this week</label>
      <div class="row"><input id="goal-n" type="number" inputmode="numeric" min="1" max="${GOAL_MAX}" step="1" value="${g || 5}" aria-describedby="goal-help" data-k="goal-n"><button class="btn small" type="submit" data-k="goal-save">Save goal</button></div>
      <small id="goal-help">From 1 to ${GOAL_MAX}. Only you see it, and the count starts over every Monday.</small></div>
    <p class="err" role="alert" hidden></p>
    <div class="row">${g ? '<button class="btn ghost small" type="button" data-action="goal-clear" data-k="goal-clear">Remove goal</button>' : ''}<button class="btn ghost small" type="button" data-action="goal-cancel" data-k="goal-cancel">Cancel</button></div>
  </form>`;
  }
  if (!g) {
    return `<div class="block">
    <h2>This week’s goal</h2>
    <p class="hint">Pick how many applications you want to send this week. A number you choose beats an inbox that chooses for you.</p>
    <button class="btn ghost small" data-action="goal-edit" data-k="goal-edit">Set a weekly goal</button>
  </div>`;
  }
  const done = n >= g, left = g - n, label = `${n} of ${g} ${g === 1 ? 'application' : 'applications'}`;
  const msg = done
    ? (n > g ? `Goal smashed: ${n - g} extra. The hiring process should take notes.` : 'Goal reached. Anything more this week is a bonus.')
    : `${left} more to go. The count starts over on Monday.`;
  return `<div class="block">
    <h2>This week’s goal</h2>
    <div class="progress goal">
      <div class="bar${done ? ' done' : ''}" role="progressbar" aria-label="Weekly application goal" aria-valuemin="0" aria-valuemax="${g}" aria-valuenow="${Math.min(n, g)}" aria-valuetext="${label}"><i style="width:${Math.min(100, Math.round((n / g) * 100))}%"></i></div>
      <span>${label}</span>
    </div>
    <p class="hint">${esc(msg)}</p>
    <button class="btn ghost small" data-action="goal-edit" data-k="goal-edit">Change goal</button>
  </div>`;
}

/* views */
function homeHTML() {
  const d = days(), ti = tierOf(d), cur = TITLES[ti], next = TITLES[ti + 1];
  const pct = next ? Math.min(100, Math.round(((d - cur[0]) / (cur[1] - cur[0] + 1)) * 100)) : 100;
  const toNext = next ? next[0] - d : 0;
  const logged = MOVES.filter(([k]) => S.today.moves[k]);
  const logLine = logged.length ? 'Today: ' + logged.map(([k, l]) => l + (S.today.moves[k] > 1 ? ' ×' + S.today.moves[k] : '')).join(' · ') : 'Nothing logged yet today.';
  return `
  <div class="calm-only calm-note">Calm mode is on. Memes, titles and leaderboards are hidden. One step at a time.</div>
  <div class="tk">
    <div class="tk-label">Your number</div>
    <span class="led big">${pad(d)}</span>
    <div class="tk-sub">days in the queue</div>
    <div class="tk-pills joke"><span class="pill on-tk">${titleFor(d)}</span>${S.escapeNo ? '<span class="pill on-tk">Escapee</span>' : ''}</div>
    <div class="progress joke">
      <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <span>${next ? `${toNext} ${toNext === 1 ? 'day' : 'days'} until ${next[2]}` : 'Top rank. Nothing ranks above Living Legend.'}</span>
    </div>
  </div>
  <div class="stats">
    <div><b>${S.streak}</b><span>day streak</span></div>
    <div><b>${S.weekMoves}</b><span>moves this week</span></div>
    <div class="joke"><b>#${S.grindRank}</b><span>Grind of the Week</span></div>
  </div>
  <div class="block">
    <h2>Today’s check-in</h2>
    <p class="hint">How are you feeling?</p>
    <div class="moods">${MOODS.map(([k, e, l]) => `<button class="mood" data-action="mood" data-mood="${k}" data-k="mood-${k}" aria-pressed="${S.today.mood === k}" aria-label="${l}" title="${l}">${e}</button>`).join('')}</div>
    <p class="hint">Log a move. Rejections count too.</p>
    <div class="chips">${MOVES.map(([k, l]) => `<button class="chip" data-action="move" data-move="${k}" data-k="move-${k}">${l}${S.today.moves[k] ? `<span class="n">${S.today.moves[k]}</span>` : ''}</button>`).join('')}</div>
    <p class="log">${esc(logLine)}</p>
  </div>
  ${goalHTML()}
  <div class="block joke">
    <h2>Share my day</h2>
    <p class="hint">Turn today into a meme card for TikTok or Instagram.</p>
    <button class="btn ticket" data-action="open-share" data-k="open-share">Make my card</button>
  </div>
  <div class="block">
    <h2>Got a job?</h2>
    <p class="hint">Leave the queue in style. Everyone gets to celebrate with you.</p>
    <button class="btn escape" data-action="open-escape" data-k="open-escape">I escaped!</button>
  </div>`;
}

function escapedHomeHTML() {
  return `
  <div class="tk escaped">
    <div class="tk-label">iWasUnemployed</div>
    <span class="led big ok">${pad(S.escapedDays)}</span>
    <div class="tk-sub">days in the queue</div>
    <div class="tk-pills"><span class="pill on-esc">Escapee #${fmt(S.escapeNo)}</span>${S.escapeRole ? `<span class="pill on-esc">${esc(S.escapeRole)}</span>` : ''}</div>
    <p class="cheers" data-cheers-home>${esc(cheersText())}</p>
  </div>
  <div class="block">
    <h2>Mentor mode</h2>
    <p class="hint">You know the queue from the inside. Help the people still in it.</p>
    <label class="set" for="set-mentor"><span><b>Available as a mentor</b><small>Shows a Mentor badge on your profile, so members know they can ask you for CV tips.</small></span><input type="checkbox" class="switch" role="switch" id="set-mentor" data-k="set-mentor" ${S.mentor ? 'checked' : ''}></label>
    <form class="field" id="hire-form" novalidate>
      <label for="hire-role">Is your company hiring?</label>
      <div class="row"><input id="hire-role" maxlength="40" placeholder="e.g. Junior Designer" autocomplete="off"><button class="btn small" type="submit">Post</button></div>
      <small>Your post gets a Referral tag in the Feed.</small>
    </form>
  </div>
  <div class="block">
    <h2>Back in the queue?</h2>
    <p class="hint">Jobs don’t always work out. No shame. Your counter restarts and your Escapee badge stays.</p>
    ${UI.backConfirm
      ? `<div class="row fill"><button class="btn ghost" data-action="back-no" data-k="back-no">Cancel</button><button class="btn" data-action="back-yes" data-k="back-yes">Yes, I’m back</button></div>`
      : `<button class="btn ghost" data-action="back-ask" data-k="back-ask">I’m back</button>`}
  </div>`;
}

function rowHTML(rk, nick, pill, right, me, onlyYou, extra) {
  return `<li class="${me ? 'me' : ''} ${extra || ''}"><span class="rk">${rk}</span><span class="who"><b>${esc(nick)}${me ? ' <em>(you)</em>' : ''}</b>${pill}${onlyYou ? '<small>Only visible to you</small>' : ''}</span>${right}</li>`;
}
function boardsHTML() {
  if (S.calm) return calmBox('Leaderboards');
  const tabs = [['legends', 'Legends'], ['escapees', 'Escapees'], ['grind', 'Grind']];
  const seg = `<div class="seg" role="tablist" aria-label="Leaderboards">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${UI.board === k}" data-action="board" data-board="${k}" data-k="board-${k}">${l}</button>`).join('')}</div>`;
  const banner = S.publicBoard || S.escaped ? '' : `<div class="banner"><span>You’re private right now. Your row is only visible to you.</span><button class="btn small" data-action="join-board" data-k="join-board">Join under my nickname</button></div>`;
  const titles = {legends: 'Legends of the Queue', escapees: 'The Escapees', grind: 'Grind of the Week'};
  const box = DATA.boards[UI.board];
  let body;
  if (!box || !box.data) body = box && box.error ? errorBox(box.error, 'board-retry') : loadingLine;
  else if (UI.board === 'escapees') {
    const rows = box.data.rows;
    body = rows.length
      ? `<ol class="board">${rows.map(r => rowHTML('#' + fmt(r.no), r.nick, '<span class="pill esc">Escapee</span>', `<span class="right"><span class="led ok">${pad(r.days)}</span><small>${esc(whenText(r.day))}</small></span>`, r.me, false)).join('')}</ol>`
      : emptyBox('No escapes yet. The first member to land a job gets the party started.');
    body += '<p class="note">Days in the queue before escaping. Every escape is a party for everyone.</p>';
  } else if (UI.board === 'grind') {
    const {rows, me} = box.data;
    const right = (moves, streak) => `<span class="right"><span class="led">${pad(moves, 3)}</span><small>${streak}-day streak</small></span>`;
    let list = rows.map(r => rowHTML(String(r.rank), r.nick, '', right(r.moves, r.streak), r.me, false)).join('');
    if (me && !rows.some(r => r.me)) list += rowHTML(String(me.rank), S.nick, '', right(me.moves, me.streak), true, !S.publicBoard, 'gap');
    let lead = '';
    if (me && me.rank === 1 && me.moves > 0) lead = 'You’re #1 this week. ';
    else if (me && rows.length && !rows[0].me) { const need = rows[0].moves - me.moves + 1; lead = `${need} more ${need === 1 ? 'move' : 'moves'} to take #1. `; }
    body = (list ? `<ol class="board">${list}</ol>` : emptyBox('No moves logged this week yet. Log one on Queue and take #1.'))
      + `<p class="note">${lead}Every move counts, rejections included. Resets Monday, local time.</p>`;
  } else {
    const {rows, me} = box.data;
    const pill = d => `<span class="pill">${titleFor(d)}</span>`;
    let list = rows.map(r => rowHTML(String(r.rank), r.nick, pill(r.days), `<span class="led">${pad(r.days)}</span>`, r.me, false)).join('');
    if (me && !rows.some(r => r.me)) list += rowHTML(String(me.rank), S.nick, pill(me.days), `<span class="led">${pad(me.days)}</span>`, true, !S.publicBoard, 'gap');
    body = (list ? `<ol class="board">${list}</ol>` : emptyBox('Nobody is on the public board yet.'))
      + '<p class="note">The longer the wait, the more ridiculous the title. Only members who join the public boards are listed.</p>';
  }
  return `${seg}<h2>${titles[UI.board]}</h2>${banner}${body}`;
}

const reactHTML = (p, r) => `<button class="react" data-action="react" data-post="${p.id}" data-r="${r}" data-k="react-${p.id}-${r}" aria-pressed="${!!p.my[r]}">${REACT_LABEL[r]}<span>${fmt(p.r[r] || 0)}</span></button>`;
function toolHTML(p, action, label, armedLabel) {
  const key = `${action}-${p.id}`;
  const armed = UI.armed === key;
  return `<button class="tool${armed ? ' armed' : ''}" data-action="${action}" data-post="${p.id}" data-k="${key}">${armed ? armedLabel : label}</button>`;
}
function postHTML(p) {
  const nick = p.anon ? 'Anonymous' : p.nick;
  // Anonymous posts come without a day count, so nobody can match them to the boards.
  const pill = p.anon ? '' : p.escapee ? '<span class="pill esc">Escapee</span>' : `<span class="pill joke">${titleFor(p.days)}</span>`;
  const tag = p.kind === 'hiring' ? '<span class="tag">Referral</span>' : '';
  const when = p.anon ? '' : `${p.escapee ? `Escaped after ${p.days} days` : `Day ${p.days}`} · `;
  const sub = `${when}${esc(p.cat)} · ${ago(p.ts)}`;
  const tools = (p.mine ? '' : toolHTML(p, 'report', 'Report', 'Tap again to report'))
    + (p.canDelete ? toolHTML(p, 'del-post', p.mine ? 'Delete' : 'Remove', p.mine ? 'Tap again to delete' : 'Tap again to remove') : '');
  return `<article class="post ${p.kind === 'escape' ? 'escape' : ''}">
    <header><span class="av ${p.anon ? 'x' : avClass(nick)}" aria-hidden="true">${p.anon ? '?' : esc(initials(nick))}</span>
      <div class="meta"><div class="name">${esc(nick)}${p.mine ? ' <span class="you">(you)</span>' : ''} ${pill} ${tag}</div><div class="sub">${sub}</div></div></header>
    <p>${esc(p.text)}</p>
    <div class="reacts">${(REACTS[p.kind] || REACTS.post).map(r => reactHTML(p, r)).join('')}<span class="tools">${tools}</span></div>
  </article>`;
}
function feedHTML() {
  if (S.calm && UI.cat === 'Memes') UI.cat = 'All';
  const cats = ['All', ...CATS].filter(c => !(S.calm && c === 'Memes'));
  const chips = cats.map(c => `<button class="chip" data-action="cat" data-cat="${esc(c)}" data-k="cat-${esc(c)}" aria-pressed="${UI.cat === c}">${esc(c)}</button>`).join('');
  const f = DATA.feed;
  let body;
  if (!f || f.cat !== UI.cat || !f.posts) body = f && f.cat === UI.cat && f.error ? errorBox(f.error, 'feed-retry') : loadingLine;
  else {
    const posts = f.posts.filter(p => !(S.calm && p.cat === 'Memes'));
    body = posts.length
      ? posts.map(postHTML).join('')
      : emptyBox(UI.cat === 'All' ? 'No posts yet. Be the first to share something with the queue.' : `Nothing in ${esc(UI.cat)} yet. Be the first to post.`);
    if (f.more) body += `<button class="btn ghost small more" data-action="more-posts" data-k="more-posts"${f.loadingMore ? ' disabled' : ''}>${f.loadingMore ? 'Loading…' : 'Show older posts'}</button>`;
  }
  return `<button class="compose-btn" data-action="open-compose" data-k="open-compose"><span class="av ${avClass(S.nick)}" aria-hidden="true">${esc(initials(S.nick))}</span><span>Share something with the queue…</span></button>
  <div class="chips scroll" role="group" aria-label="Categories">${chips}</div>
  ${body}`;
}

function funHTML() {
  if (S.calm) return calmBox('Games');
  const month = new Date().toLocaleString('en-US', {month: 'long'});
  const u = DATA.unicorn;
  let ads;
  if (!u || !u.data) ads = u && u.error ? errorBox(u.error, 'unicorn-retry') : loadingLine;
  else {
    const {counts, mine} = u.data;
    const total = counts.reduce((s, n) => s + n, 0);
    ads = `<div class="stack">${ADS.map((a, i) => {
      const v = counts[i] || 0;
      const pct = total ? Math.round((v / total) * 100) : 0;
      return `<article class="ad ${mine === i ? 'voted' : ''}">
        <div class="co"><span class="blur" aria-hidden="true">${esc(a.co)}</span><span class="sr">Company name hidden</span> · ${a.when}</div>
        <p class="ad-text">“${esc(a.text)}”</p>
        ${mine === null
          ? `<button class="btn small ticket" data-action="vote" data-ad="${i}" data-k="vote-${i}">Vote for this one</button>`
          : `<div class="votes"><div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div><span>${pct}% · ${fmt(v)} ${v === 1 ? 'vote' : 'votes'}${mine === i ? ' · your vote' : ''}</span></div>`}
      </article>`;
    }).join('')}</div>`;
  }
  const win = winningLines();
  const winCells = new Set(win.flat());
  const cells = S.bingo.order.map((pi, idx) => {
    const free = pi === FREE;
    const on = free || S.bingo.marks.includes(idx);
    return `<button class="cell ${free ? 'free' : ''} ${winCells.has(idx) ? 'win' : ''}" data-action="cell" data-cell="${idx}" data-k="cell-${idx}" aria-pressed="${on}" ${free ? 'disabled' : ''}>${free ? 'STILL HERE' : esc(PHRASES[pi])}</button>`;
  }).join('');
  return `
  <h2>Unicorn of the Week</h2>
  <p class="hint">Vote for the most absurd job ad. The winner becomes Friday’s meme. Company names are hidden automatically. Example ads.</p>
  ${ads}
  <h2>Rejection Bingo · ${month}</h2>
  <p class="hint">Tap everything that happened to you this month. Get a full line to win.</p>
  <div class="bingo">${cells}</div>
  ${win.length ? `<div class="block win-banner"><strong>BINGO!</strong><p class="hint">A full line of corporate nonsense. Share it with the queue.</p><button class="btn" data-action="copy-bingo" data-k="copy-bingo">Copy caption</button></div>` : ''}
  <button class="btn ghost" data-action="bingo-new" data-k="bingo-new">New card</button>`;
}

function meHTML() {
  const d = days();
  const since = parseYmd(S.startDate).toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'});
  const status = S.escaped ? `Escaped after ${S.escapedDays} days` : `In the queue since ${since}`;
  const base = S.escaped ? S.escapedDays : d;
  const tiles = [[S.totals.applied, 'applications'], [S.totals.interview, 'interviews'], [S.totals.rejected, 'rejections'], [S.totals.ghosted, 'ghostings'], [S.totals.course, 'courses'], [Math.round(base * 0.95), 'iced coffees (est.)']];
  const earned = earnedIds();
  const badges = BADGES.map(b => {
    const got = earned.has(b.id);
    let state;
    if (got) state = '<span class="state">Earned</span>';
    else if (b.claim) state = `<button class="btn small ghost" data-action="claim" data-badge="${b.id}" data-k="claim-${b.id}">It happened to me</button>`;
    else if (b.prog) { const [n, m] = b.prog(); state = `<div class="bar" aria-hidden="true"><i style="width:${Math.round((n / m) * 100)}%"></i></div><span class="state">${n} / ${m}</span>`; }
    else if (b.soon) state = '<span class="state">Comes with referrals</span>';
    else state = '<span class="state">Locked</span>';
    return `<div class="badge ${got ? 'earned' : ''}"><b>${b.name}</b><small>${esc(b.desc)}</small>${state}</div>`;
  }).join('');
  const countryOpts = COUNTRIES.map(([c, n]) => `<option value="${c}"${S.country === c ? ' selected' : ''}>${n}</option>`).join('');
  return `
  <div class="profile"><span class="av big ${avClass(S.nick)}" aria-hidden="true">${esc(initials(S.nick))}</span>
    <div class="pmeta"><h2>${esc(S.nick)}</h2><p class="hint">${status} · ${esc(S.industry)} · ${countryName(S.country)}</p>
      <div class="pills">${S.escaped ? '' : `<span class="pill joke">${titleFor(d)}</span>`}${S.escapeNo ? '<span class="pill esc">Escapee</span>' : ''}${S.escaped && S.mentor ? '<span class="pill">Mentor</span>' : ''}${S.admin ? '<span class="pill">Admin</span>' : ''}</div></div></div>
  <h3>Your Wrapped so far</h3>
  <div class="wrapped">${tiles.map(([n, l]) => `<div><b>${fmt(n)}</b><span>${l}</span></div>`).join('')}</div>
  <h3>Badges</h3>
  <div class="badges">${badges}</div>
  <h3>Settings</h3>
  <div class="settings">
    <label class="set" for="set-public"><span><b>Show me on public leaderboards</b><small>Always under your nickname. When off, only you see your row.</small></span><input type="checkbox" class="switch" role="switch" id="set-public" data-k="set-public"${S.publicBoard ? ' checked' : ''}></label>
    <label class="set" for="set-calm"><span><b>Not in the mood for jokes today</b><small>Hides memes, titles, leaderboards and games.</small></span><input type="checkbox" class="switch" role="switch" id="set-calm" data-k="set-calm"${S.calm ? ' checked' : ''}></label>
    <div class="set"><span><b><label for="set-country">Country</label></b><small>Sets your helplines and resources.</small></span><select id="set-country" data-k="set-country">${countryOpts}</select></div>
  </div>
  <h3>Need to talk to someone?</h3>
  ${helpHTML()}
  <h3>Try this</h3>
  <ul class="tips"><li>Log moves on Queue and climb Grind of the Week.</li><li>Make a meme card with Share my day.</li><li>Post in the Feed, anonymously if you like.</li><li>Get a full line in Rejection Bingo.</li><li>Turn on calm mode above on heavy days.</li></ul>
  <h3>Account</h3>
  <div class="settings">
    <a class="set" href="/api/me/export" download data-k="export"><span><b>Download my data</b><small>Everything iAmUnemployed stores about you, in one file.</small></span></a>
    <button class="set" type="button" data-action="logout" data-k="logout"><span><b>Log out</b><small>Log back in on any device with your nickname and password.</small></span></button>
    <button class="set danger" type="button" data-action="open-delete" data-k="open-delete"><span><b>Delete my account</b><small>Removes your profile, check-ins and posts for good.</small></span></button>
  </div>
  <p class="note">Your account is saved on our server, so it works on any device. <a href="/privacy" target="_blank" rel="noopener">How we handle your data</a></p>`;
}

const VIEWS = {home: () => (S.escaped ? escapedHomeHTML() : homeHTML()), boards: boardsHTML, feed: feedHTML, fun: funHTML, me: meHTML};

/* rendering */
function renderChrome() {
  const dev = $('#device');
  dev.dataset.calm = String(!!S.calm);
  dev.dataset.escaped = String(!!S.escaped);
  $('#logo-word').textContent = S.escaped ? 'WasUnemployed' : 'AmUnemployed';
  $('#logo-sr').textContent = S.escaped ? 'iWasUnemployed' : 'iAmUnemployed';
  $('#streak').textContent = S.streak;
  $$('.tab').forEach(t => { if (t.dataset.tab === UI.tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== UI.tab; });
}
function render() {
  if (!S) return;
  if (!VIEWS[UI.tab]) UI.tab = 'home';
  // A new day began while the app was open: fetch today's numbers once.
  const t = todayStr();
  if (S.today.date !== t && UI.refreshedFor !== t) { UI.refreshedFor = t; refreshMe(); }
  renderChrome();
  const a = document.activeElement;
  const key = a && a.dataset ? a.dataset.k : null;
  const v = $('#view-' + UI.tab);
  const typed = {};
  $$('input[id]:not([type="checkbox"])', v).forEach(i => { typed[i.id] = i.value; });
  v.innerHTML = VIEWS[UI.tab]();
  for (const [id, value] of Object.entries(typed)) { const i = v.querySelector('#' + id); if (i) i.value = value; }
  if (key) { const el = $$('[data-k]', v).find(e => e.dataset.k === key); if (el) el.focus({preventScroll: true}); }
  load(UI.tab);
}
function go(tab) { UI.tab = tab; UI.armed = null; saveTab(); render(); $('#views').scrollTop = 0; }

/* loading data for each tab */
const STALE = 30000;
function load(tab) {
  if (tab === 'boards' && !S.calm) loadBoard(UI.board);
  else if (tab === 'feed') loadFeed();
  else if (tab === 'fun' && !S.calm) loadUnicorn();
  else if (tab === 'home' && Date.now() - meAt > 60000) refreshMe();
}
async function fetchInto(holder, key, path, stillShown) {
  const box = holder[key];
  if (box && (box.loading || Date.now() - box.at < STALE)) return;
  holder[key] = {data: box && box.data, loading: true, at: Date.now()};
  try { holder[key] = {data: await api(path), at: Date.now()}; }
  catch (err) { holder[key] = {data: box && box.data, error: err.message, at: Date.now()}; }
  if (S && stillShown()) render();
}
function loadBoard(kind, force) {
  if (force) delete DATA.boards[kind];
  return fetchInto(DATA.boards, kind, '/boards/' + kind, () => UI.tab === 'boards' && UI.board === kind);
}
function loadUnicorn(force) {
  if (force) DATA.unicorn = null;
  return fetchInto(DATA, 'unicorn', '/unicorn', () => UI.tab === 'fun');
}
function loadFeed(force) {
  const cat = UI.cat;
  const f = DATA.feed;
  if (!force && f && f.cat === cat && (f.loading || Date.now() - f.at < STALE)) return;
  const seq = ++DATA.feedSeq;
  const keep = f && f.cat === cat ? f : null;
  DATA.feed = {cat, posts: keep ? keep.posts : null, more: keep ? keep.more : false, loading: true, at: Date.now()};
  const data = DATA;
  api('/posts' + (cat === 'All' ? '' : '?cat=' + encodeURIComponent(cat))).then(r => {
    if (data.feedSeq === seq) data.feed = {cat, posts: r.posts, more: r.more, at: Date.now()};
  }, err => {
    if (data.feedSeq === seq) data.feed = {cat, posts: data.feed.posts, more: data.feed.more, error: err.message, at: Date.now()};
  }).then(() => { if (S && UI.tab === 'feed') render(); });
}
let refreshing = null;
function refreshMe() {
  if (refreshing || !S) return refreshing;
  refreshing = queued(() => api('/me'))
    .then(r => { if (S) { setMe(r.me); render(); } }, () => { /* keep what is on screen */ })
    .finally(() => { refreshing = null; });
  return refreshing;
}
const findPost = id => (DATA.feed && DATA.feed.posts ? DATA.feed.posts.find(p => p.id === id) : null);
function dropPost(id) { if (DATA.feed && DATA.feed.posts) DATA.feed.posts = DATA.feed.posts.filter(p => p.id !== id); }

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.hidden = true; void el.offsetWidth;
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3400);
}

function openOv(id) {
  const o = $('#' + id);
  o._ret = document.activeElement;
  o.hidden = false;
  const f = o.querySelector('textarea:not([readonly]), input:not([type="checkbox"]), button:not(.x)');
  if (f) f.focus({preventScroll: true});
}
function closeOv(o) {
  o.hidden = true;
  const r = o._ret;
  if (r && document.contains(r) && r.offsetParent !== null) r.focus({preventScroll: true});
}
function closeAll() { $$('.overlay').forEach(o => { o.hidden = true; }); $('#scr-ceremony').hidden = true; }

let armTimer = 0;
function arm(key) {
  UI.armed = key;
  clearTimeout(armTimer);
  armTimer = setTimeout(() => { if (UI.armed === key) { UI.armed = null; if (S && UI.tab === 'feed') render(); } }, 3500);
  render();
}

function copyText(text, okMsg) {
  const fallback = () => { const t = $('#copy-text'); t.value = text; openOv('ov-copy'); t.focus(); t.select(); };
  try {
    const p = navigator.clipboard && navigator.clipboard.writeText(text);
    if (!p) { fallback(); return; }
    p.then(() => toast(okMsg || 'Caption copied. Paste it with your card.'), fallback);
  } catch (e) { fallback(); }
}

/* forms */
function formError(form, msg, focusSel) {
  const box = form && $('.err', form);
  if (box) { box.textContent = msg || ''; box.hidden = !msg; }
  if (focusSel) { const f = $(focusSel); if (f) f.focus(); }
}
async function submitting(form, fn) {
  if (form.dataset.busy) return;
  form.dataset.busy = '1';
  const btn = $('button[type="submit"]', form);
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'One moment…'; }
  formError(form, '');
  try { await fn(); }
  catch (err) { formError(form, err.message || 'Something went wrong. Please try again.'); }
  finally {
    delete form.dataset.busy;
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

/* share card */
const shareJoke = () => JOKES[UI.joke % JOKES.length](days());
function renderShare() { const d = days(); $('#share-card').innerHTML = memeCard(`iAmUnemployed · DAY ${d}`, shareJoke(), titleFor(d), '#iAmUnemployed'); }
const shareCaption = () => `Day ${days()} of being unemployed. ${shareJoke()} #iAmUnemployed #dayXunemployed`;
function bingoCaption() {
  const month = new Date().toLocaleString('en-US', {month: 'long'});
  const line = winningLines()[0] || [];
  const items = line.map(i => S.bingo.order[i]).filter(pi => pi !== FREE).map(pi => PHRASES[pi].replace(/­/g, ''));
  return `BINGO! Rejection Bingo, ${month} edition: ${items.join(' / ')}. #iAmUnemployed`;
}
const escapeCaption = () => `I’m out. ${S.escapedDays} days in the queue, ${S.totals.applied} applications, ${S.totals.interview} interviews. Escapee #${fmt(S.escapeNo)}. #iAmUnemployed #iescaped`;

/* escape ceremony */
function updateCheers() { $$('[data-cheers-home]').forEach(el => { el.textContent = cheersText(); }); }
function confetti() {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('#confetti');
  const r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cs = getComputedStyle(document.documentElement);
  const cols = ['--ticket', '--escape', '--led', '--av-a-ink'].map(v => cs.getPropertyValue(v).trim() || '#F2C230');
  const P = Array.from({length: 150}, (_, i) => ({x: Math.random() * r.width, y: -Math.random() * r.height * 0.6 - 10, vx: (Math.random() - 0.5) * 1.6, vy: 1.6 + Math.random() * 2.6, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.25, w: 5 + Math.random() * 5, h: 8 + Math.random() * 7, col: cols[i % cols.length]}));
  const t0 = performance.now();
  const frame = t => {
    ctx.clearRect(0, 0, r.width, r.height);
    let alive = false;
    for (const p of P) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.02; p.a += p.va;
      if (p.y < r.height + 20) alive = true;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    if (alive && t - t0 < 7000 && !$('#scr-ceremony').hidden) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, r.width, r.height);
  };
  requestAnimationFrame(frame);
}

/* posting and escaping */
function publishPost(p, msg) {
  return submitting($('#compose-form'), () => queued(async () => {
    await api('/posts', 'POST', p);
    $('#composer-text').value = '';
    $('#composer-anon').checked = false;
    closeOv($('#ov-compose'));
    UI.cat = 'All';
    DATA.feed = null;
    go('feed');
    toast(msg);
  }));
}
function onCompose(form) {
  const text = $('#composer-text').value.trim();
  if (!text) return formError(form, 'Write something first.', '#composer-text');
  const p = {cat: $('#composer-cat').value, text, anon: $('#composer-anon').checked};
  if (CRISIS.test(text)) { UI.pending = p; $('#crisis-help').innerHTML = helpHTML(); openOv('ov-crisis'); return; }
  return publishPost(p, 'Posted to the queue.');
}
function onEscape(form) {
  const role = $('#esc-role').value.trim().slice(0, 40);
  const wall = $('#esc-wall').checked;
  return submitting(form, () => queued(async () => {
    const names = await withBadges(async () => setMe((await api('/escape', 'POST', {role, wall})).me));
    UI.backConfirm = false;
    DATA.boards = {};
    DATA.feed = null;
    closeOv($('#ov-escape'));
    const d = S.escapedDays;
    $('#cer-ticket').innerHTML = `<div class="tk-label">iWasUnemployed</div><span class="led big ok">${pad(d)}</span><div class="tk-sub">days in the queue</div><div class="tk-pills"><span class="pill on-esc">Escapee #${fmt(S.escapeNo)}</span>${S.escapeRole ? `<span class="pill on-esc">${esc(S.escapeRole)}</span>` : ''}</div>`;
    $('#cer-stats').innerHTML = [[S.totals.applied, 'applications'], [S.totals.interview, 'interviews'], [S.totals.rejected, 'rejections survived'], [Math.round(d * 0.95), 'iced coffees (est.)']].map(([n, l]) => `<div><b>${fmt(n)}</b><span>${l}</span></div>`).join('');
    $('#cer-badges').textContent = names.length ? `Badge unlocked: ${names.join(', ')}. Your profile now says iWasUnemployed.` : 'Your profile now says iWasUnemployed.';
    UI.tab = 'home'; saveTab(); render();
    const scr = $('#scr-ceremony');
    scr.hidden = false; scr.scrollTop = 0;
    updateCheers();
    $('#cer-done').focus({preventScroll: true});
    confetti();
  }));
}
function onHire() {
  const input = $('#hire-role');
  const role = input.value.trim().slice(0, 40);
  if (!role) { toast('Add the role first.'); input.focus(); return; }
  return queued(async () => {
    await api('/posts', 'POST', {kind: 'hiring', role});
    const field = $('#hire-role');
    if (field) field.value = '';
    DATA.feed = null;
    toast('Posted to the Feed. Referrals make the queue shorter.');
  });
}
function saveSettings(change, okMsg) {
  return queued(async () => {
    try { setMe((await api('/me', 'PATCH', change)).me); DATA.boards = {}; toast(okMsg()); }
    catch (err) { toast(err.message); }
    render();
  });
}
function focusKey(k) { const el = $(`#view-${UI.tab} [data-k="${k}"]`); if (el) el.focus({preventScroll: true}); }
function saveGoal(n, okMsg) {
  return queued(async () => {
    setMe((await api('/me', 'PATCH', {weekGoal: n})).me);
    UI.goalEdit = false;
    toast(okMsg);
    render();
    focusKey('goal-edit');
  });
}
function onGoal(form) {
  const raw = $('#goal-n').value.trim();
  const n = Number(raw);
  if (!/^\d{1,2}$/.test(raw) || n < 1 || n > GOAL_MAX) return formError(form, `Pick a number from 1 to ${GOAL_MAX}.`, '#goal-n');
  return submitting(form, () => saveGoal(n, `Goal set: ${n} ${n === 1 ? 'application' : 'applications'} this week. You’ve got this.`));
}
function saveBingo() {
  const card = JSON.parse(JSON.stringify(S.bingo));
  queued(() => api('/me/game', 'PUT', {bingo: card})).catch(err => toast(err.status ? err.message : 'Couldn’t save your bingo card. Check your connection.'));
}

/* signing up, logging in, resetting the password */
const PANES = ['ob-1', 'ob-form', 'ob-login', 'ob-reset', 'ob-3'];
function showPane(id, focusSel) {
  $('#scr-splash').hidden = true;
  const scr = $('#scr-onboard');
  scr.hidden = false;
  for (const p of PANES) $('#' + p).hidden = p !== id;
  $$('#scr-onboard .err').forEach(e => { e.hidden = true; });
  scr.scrollTop = 0;
  const f = focusSel ? $(focusSel) : $('#' + id + ' .btn');
  if (f) f.focus({preventScroll: true});
}
function startSignup() {
  $('#ob-nick').value = '';
  $('#ob-pass').value = '';
  $('#ob-industry').value = 'Other';
  $('#ob-country').value = guessCountry();
  const t = todayStr(), st = $('#ob-start');
  st.max = t; st.value = addDays(t, -30);
  // reuse the start date picked on the homepage ticket, if there is one
  try { const v = localStorage.getItem('iamunemployed-landing-start'); if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= t) st.value = v; } catch (e) { /* storage unavailable */ }
  $('#ob-public').checked = false;
  showPane('ob-form', '#ob-nick');
}
function enterApp(me) {
  forget();
  setMe(me);
  UI.board = 'legends';
  UI.cat = 'All';
  $('#scr-splash').hidden = true;
  render();
}
function showCode(code, isNew) {
  const d = days();
  UI.code = code;
  UI.codeIsNew = isNew;
  $('#ob-3').innerHTML = `
    ${isNew
      ? `<div class="tk"><div class="tk-label">Your number</div><span class="led big">${pad(d)}</span><div class="tk-sub">days in the queue</div><div class="tk-pills"><span class="pill on-tk">${titleFor(d)}</span></div></div>
    <h1>You’re in, ${esc(S.nick)}.</h1>
    <p class="hint">Your title gets more ridiculous the longer you wait. The real goal is the Escapees board, and the whole queue is rooting for you.</p>`
      : `<h1>New password saved.</h1><p class="hint">You’re logged in here, and logged out everywhere else.</p>`}
    <div class="field"><b>Your recovery code</b>
      <div class="code-box">${esc(code)}</div>
      <small>Save it somewhere safe, like your password manager or a photo. If you forget your password, it’s the only way back in, and we can’t show it again.</small></div>
    <button class="btn ghost wide" type="button" data-action="copy-code">Copy the code</button>
    ${isNew ? `<button class="btn ticket wide" type="button" data-action="ob-share">Share my Day ${d}</button>` : ''}
    <button class="btn wide" type="button" data-action="ob-done">${isNew ? 'Enter the queue' : 'Back to the queue'}</button>`;
  showPane('ob-3');
}
function onSignup(form) {
  const nick = cleanNick($('#ob-nick').value);
  $('#ob-nick').value = nick;
  const pass = $('#ob-pass').value;
  const start = $('#ob-start').value;
  if (Array.from(nick).length < 3) return formError(form, 'Pick a nickname with at least 3 letters or numbers, or tap Suggest.', '#ob-nick');
  if (pass.length < 8) return formError(form, 'Use a password with at least 8 characters.', '#ob-pass');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return formError(form, 'Pick the day your job search started.', '#ob-start');
  if (start > todayStr()) return formError(form, 'Your start date can’t be in the future.', '#ob-start');
  return submitting(form, async () => {
    const key = await passwordKey(nick, pass);
    const r = await api('/auth/signup', 'POST', {nick, key, industry: $('#ob-industry').value, country: $('#ob-country').value, startDate: start, publicBoard: $('#ob-public').checked});
    $('#ob-pass').value = '';
    UI.tab = 'home';
    saveTab();
    enterApp(r.me);
    showCode(r.recoveryCode, true);
  });
}
function onLogin(form) {
  const nick = cleanNick($('#li-nick').value);
  const pass = $('#li-pass').value;
  if (!nick) return formError(form, 'Type your nickname.', '#li-nick');
  if (!pass) return formError(form, 'Type your password.', '#li-pass');
  return submitting(form, async () => {
    const r = await api('/auth/login', 'POST', {nick, key: await passwordKey(nick, pass)});
    $('#li-pass').value = '';
    enterApp(r.me);
    $('#scr-onboard').hidden = true;
    toast(`Welcome back, ${S.nick}.`);
  });
}
function onReset(form) {
  const nick = cleanNick($('#rs-nick').value);
  const code = $('#rs-code').value;
  const pass = $('#rs-pass').value;
  if (!nick) return formError(form, 'Type your nickname.', '#rs-nick');
  if (code.toUpperCase().replace(/[^A-Z0-9]/g, '').length !== 16) return formError(form, 'The recovery code has 16 letters and numbers.', '#rs-code');
  if (pass.length < 8) return formError(form, 'Use a new password with at least 8 characters.', '#rs-pass');
  return submitting(form, async () => {
    const r = await api('/auth/reset', 'POST', {nick, code, key: await passwordKey(nick, pass)});
    $('#rs-pass').value = '';
    $('#rs-code').value = '';
    enterApp(r.me);
    showCode(r.recoveryCode, false);
  });
}
function onDelete(form) {
  const typed = cleanNick($('#del-nick').value);
  if (typed.toLowerCase() !== S.nick.toLowerCase()) return formError(form, 'Type your nickname exactly to confirm.', '#del-nick');
  return submitting(form, () => queued(async () => {
    await api('/me', 'DELETE', {nick: typed});
    closeAll();
    forget();
    showPane('ob-1');
    toast('Your account and everything in it are deleted.');
  }));
}
function signedOut() {
  forget();
  closeAll();
  showPane('ob-login', '#li-nick');
  toast('Please log in again.');
}
async function boot() {
  $('#splash-msg').textContent = 'Getting your ticket…';
  $('#splash-retry').hidden = true;
  $('#scr-splash').hidden = false;
  try {
    enterApp((await api('/me')).me);
  } catch (err) {
    if (err.status === 401) {
      // the homepage links here with #login for members who already have an account
      if (location.hash === '#login') showPane('ob-login', '#li-nick'); else showPane('ob-1');
      return;
    }
    $('#splash-msg').textContent = err.message;
    $('#splash-retry').hidden = false;
  }
}

/* actions */
const A = {
  tab: el => go(el.dataset.tab),
  mood(el) {
    const k = el.dataset.mood;
    return queued(async () => {
      const names = await withBadges(async () => setMe((await api('/checkin', 'POST', {mood: k})).me));
      toast(MOOD_TOAST[k] + unlockedMsg(names)); render();
    });
  },
  move(el) {
    const k = el.dataset.move;
    return queued(async () => {
      const before = S.grindRank, appliedBefore = S.weekApplied || 0;
      const names = await withBadges(async () => setMe((await api('/moves', 'POST', {kind: k})).me));
      let msg = k === 'ghosted' ? `Ghosting logged. Ghost Whisperer ${Math.min(S.totals.ghosted, 10)}/10.` : MOVE_TOAST[k];
      if (S.weekGoal && appliedBefore < S.weekGoal && S.weekApplied >= S.weekGoal) msg += ' Weekly goal reached!';
      if (!S.calm && S.grindRank < before) msg += ` You’re now #${S.grindRank} on Grind of the Week.`;
      delete DATA.boards.grind;
      toast(msg + unlockedMsg(names)); render();
    });
  },
  'goal-edit'() { UI.goalEdit = true; render(); const i = $('#goal-n'); if (i) { i.focus({preventScroll: true}); i.select(); } },
  'goal-cancel'() { UI.goalEdit = false; render(); focusKey('goal-edit'); },
  'goal-clear'() { return saveGoal(0, 'Goal removed. Set a new one whenever you like.'); },
  'open-share'() { UI.joke = days() % JOKES.length; renderShare(); openOv('ov-share'); },
  shuffle() { UI.joke = (UI.joke + 1) % JOKES.length; renderShare(); },
  'copy-share'() { copyText(shareCaption()); },
  'open-escape'() { $('#esc-role').value = ''; $('#esc-wall').checked = true; formError($('#escape-form'), ''); openOv('ov-escape'); },
  close(el) { const o = el.closest('.overlay'); if (o) closeOv(o); },
  'back-ask'() { UI.backConfirm = true; render(); const b = $('[data-k="back-no"]'); if (b) b.focus({preventScroll: true}); },
  'back-no'() { UI.backConfirm = false; render(); },
  'back-yes'() {
    return queued(async () => {
      const names = await withBadges(async () => setMe((await api('/back', 'POST')).me));
      UI.backConfirm = false;
      DATA.boards = {};
      toast('Welcome back. No shame, and your Escapee badge stays.' + unlockedMsg(names)); render();
    });
  },
  board(el) { UI.board = el.dataset.board; render(); },
  'board-retry'() { loadBoard(UI.board, true); render(); },
  'join-board'() { return saveSettings({publicBoard: true}, () => `You’re on the boards as ${S.nick}.`); },
  cat(el) { UI.cat = el.dataset.cat; render(); },
  'feed-retry'() { loadFeed(true); render(); },
  'more-posts'() {
    const f = DATA.feed;
    if (!f || !f.posts || !f.more || f.loadingMore || !f.posts.length) return;
    f.loadingMore = true; render();
    const q = new URLSearchParams({before: String(f.posts[f.posts.length - 1].id)});
    if (f.cat !== 'All') q.set('cat', f.cat);
    return api('/posts?' + q).then(r => { f.posts = f.posts.concat(r.posts.filter(p => !f.posts.some(x => x.id === p.id))); f.more = r.more; })
      .finally(() => { f.loadingMore = false; if (UI.tab === 'feed') render(); });
  },
  'open-compose'() { formError($('#compose-form'), ''); openOv('ov-compose'); },
  react(el) {
    const id = Number(el.dataset.post), r = el.dataset.r;
    const p = findPost(id);
    if (!p) return;
    const paint = () => {
      const b = $(`#view-feed [data-k="react-${id}-${r}"]`);
      if (b) { b.setAttribute('aria-pressed', String(!!p.my[r])); b.querySelector('span').textContent = fmt(p.r[r] || 0); }
    };
    const was = {on: !!p.my[r], n: p.r[r] || 0};
    const on = !was.on;
    p.my[r] = on; p.r[r] = Math.max(0, was.n + (on ? 1 : -1)); paint();
    return queued(async () => {
      try { const res = await api(`/posts/${id}/react`, 'POST', {r, on}); p.my[r] = res.on; p.r[r] = res.count; }
      catch (err) { p.my[r] = was.on; p.r[r] = was.n; toast(err.message); }
      paint();
    });
  },
  report(el) {
    const id = Number(el.dataset.post), key = 'report-' + id;
    if (UI.armed !== key) return arm(key);
    UI.armed = null;
    return queued(async () => {
      await api(`/posts/${id}/report`, 'POST');
      dropPost(id);
      toast('Thanks for telling us. A post reported by several members is hidden automatically.');
      render();
    });
  },
  'del-post'(el) {
    const id = Number(el.dataset.post), key = 'del-post-' + id;
    if (UI.armed !== key) return arm(key);
    UI.armed = null;
    return queued(async () => {
      await api(`/posts/${id}`, 'DELETE');
      dropPost(id);
      toast('Post deleted.');
      render();
    });
  },
  vote(el) {
    const ad = Number(el.dataset.ad);
    return queued(async () => {
      const names = await withBadges(async () => {
        const data = await api('/unicorn', 'POST', {ad});
        DATA.unicorn = {data, at: Date.now()};
        S.unicornVote = data.mine;
        S.unicornEver = true;
      });
      toast('Vote counted. The winner goes out on Friday.' + unlockedMsg(names)); render();
    });
  },
  'unicorn-retry'() { loadUnicorn(true); render(); },
  cell(el) {
    const i = Number(el.dataset.cell), m = S.bingo.marks;
    const before = winningLines().length;
    const at = m.indexOf(i);
    if (at >= 0) m.splice(at, 1); else m.push(i);
    const after = winningLines().length;
    const firstWin = after > 0 && !S.bingo.won;
    if (after > 0) S.bingo.won = true;
    if (after > before) toast('BINGO! A full line of corporate nonsense.' + (firstWin ? unlockedMsg(['Bingo!']) : ''));
    render();
    saveBingo();
  },
  'copy-bingo'() { copyText(bingoCaption()); },
  'bingo-new'() { S.bingo.order = bingoOrder(true); S.bingo.marks = [FREE_AT]; toast('Fresh card. Good luck out there.'); render(); saveBingo(); },
  claim(el) {
    const b = BADGES.find(x => x.id === el.dataset.badge);
    if (!b) return;
    return queued(async () => {
      setMe((await api('/me/game', 'PUT', {claimed: {[b.id]: true}})).me);
      toast(`Badge unlocked: ${b.name}. Sorry that happened.`); render();
    });
  },
  'calm-off'() { return saveSettings({calm: false}, () => 'Calm mode off.'); },
  logout() {
    return queued(async () => {
      await api('/auth/logout', 'POST');
      forget();
      closeAll();
      showPane('ob-login', '#li-nick');
      toast('Logged out. See you soon.');
    });
  },
  'open-delete'() { $('#del-nick').value = ''; formError($('#delete-form'), ''); openOv('ov-delete'); },
  'ob-next'() { startSignup(); },
  'ob-have'() { showPane('ob-login', '#li-nick'); },
  'ob-forgot'() { $('#rs-nick').value = $('#li-nick').value; showPane('ob-reset', $('#rs-nick').value ? '#rs-code' : '#rs-nick'); },
  'ob-suggest'() { $('#ob-nick').value = NICKS[Math.floor(Math.random() * NICKS.length)] + (10 + Math.floor(Math.random() * 90)); },
  peek(el) {
    const input = $('#' + el.dataset.for);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.textContent = show ? 'Hide' : 'Show';
    el.setAttribute('aria-pressed', String(show));
  },
  'copy-code'() { copyText(UI.code, 'Recovery code copied. Keep it somewhere safe.'); },
  'ob-share'() { UI.joke = 0; renderShare(); openOv('ov-share'); },
  'ob-done'() {
    const isNew = UI.codeIsNew;
    $('#scr-onboard').hidden = true;
    $('#ob-3').innerHTML = '';
    UI.code = null;
    go('home');
    toast(isNew ? 'Welcome to the queue. Log your first move.' : 'Password changed.');
  },
  'copy-escape'() { copyText(escapeCaption()); },
  'cer-done'() { $('#scr-ceremony').hidden = true; go('home'); },
  'crisis-edit'() { closeOv($('#ov-crisis')); $('#composer-text').focus(); },
  'crisis-post'() { const p = UI.pending; UI.pending = null; closeOv($('#ov-crisis')); if (p) return publishPost(p, 'Posted. You’re not alone in this.'); },
  retry() { return boot(); }
};

/* events */
const report = err => toast((err && err.message) || 'Something went wrong. Please try again.');
document.addEventListener('click', e => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.classList.contains('overlay')) { closeOv(t); return; }
  const el = t.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.action];
  if (fn) Promise.resolve().then(() => fn(el, e)).catch(report);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (!S) return;
  if (t.id === 'set-public') saveSettings({publicBoard: t.checked}, () => (S.publicBoard ? `You’re on the boards as ${S.nick}.` : 'You’re private. Only you see your row.'));
  else if (t.id === 'set-calm') saveSettings({calm: t.checked}, () => (S.calm ? 'Calm mode on. Take it easy today.' : 'Calm mode off.'));
  else if (t.id === 'set-country') saveSettings({country: t.value}, () => `Helplines updated for ${countryName(S.country)}.`);
  else if (t.id === 'set-mentor') saveSettings({mentor: t.checked}, () => (S.mentor ? 'You’re listed as a mentor. Thank you.' : 'Mentor mode off.'));
});
document.addEventListener('input', e => {
  const form = e.target instanceof Element ? e.target.closest('form') : null;
  const box = form && $('.err', form);
  if (box && !box.hidden) box.hidden = true;
});
const FORMS = {'goal-form': onGoal, 'compose-form': onCompose, 'escape-form': onEscape, 'hire-form': onHire, 'ob-form': onSignup, 'ob-login': onLogin, 'ob-reset': onReset, 'delete-form': onDelete};
document.addEventListener('submit', e => {
  e.preventDefault();
  const run = FORMS[e.target.id];
  if (run) Promise.resolve().then(() => run(e.target)).catch(report);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const open = $$('.overlay').filter(o => !o.hidden);
  if (open.length) closeOv(open[open.length - 1]);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S && Date.now() - meAt > 60000) refreshMe();
});

/* start */
$('#composer-cat').innerHTML = CATS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
$('#ob-industry').innerHTML = INDUSTRIES.map(c => `<option value="${c}">${c}</option>`).join('');
$('#ob-country').innerHTML = COUNTRIES.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
loadTab();
boot();
})();
