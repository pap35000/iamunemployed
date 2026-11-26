// Automated checks for the API, run against a fresh database in memory:
//   node dev/api-test.mjs
// Needs Node.js 22.13 or newer. Nothing is sent over the network.

import assert from 'node:assert/strict';
import { handle } from '../server/app.js';
import { forgetSchema } from '../server/db.js';
import { openD1 } from './d1-local.mjs';

const ORIGIN = 'https://iamunemployed.test';
const DAY = 86400000;
const START = Date.now();
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const TODAY = ymd(START);

forgetSchema();
const db = openD1();
const env = { DB: db, ADMIN_NICKS: 'Carol_3' };
const count = (sql, ...params) => db.query(sql, ...params)[0].n;

// Stands in for the key the app derives from a password in the browser.
const fakeKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

let nextIp = 1;

// One member's browser: keeps its session cookie, local date and clock.
class Member {
  constructor(ip) {
    this.ip = ip || `10.0.0.${nextIp++}`;
    this.cookie = '';
    this.now = START;
  }

  async call(method, path, body, headers = {}) {
    const h = new Headers({ 'CF-Connecting-IP': this.ip, 'X-Local-Date': ymd(this.now), ...headers });
    if (method !== 'GET' && !('Origin' in headers)) h.set('Origin', ORIGIN);
    if (this.cookie) h.set('Cookie', this.cookie);
    let payload;
    if (body !== undefined) {
      if (!h.has('Content-Type')) h.set('Content-Type', 'application/json');
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await handle(new Request(ORIGIN + '/api' + path, { method, headers: h, body: payload }), env, { now: this.now });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0];
      this.cookie = pair.slice(pair.indexOf('=') + 1) ? pair : '';
      this.lastCookie = c;
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (err) { data = text; }
    return { status: res.status, data, headers: res.headers };
  }

  get(path, headers) { return this.call('GET', path, undefined, headers); }
  post(path, body = {}, headers) { return this.call('POST', path, body, headers); }
  put(path, body = {}) { return this.call('PUT', path, body); }
  patch(path, body = {}) { return this.call('PATCH', path, body); }
  del(path, body = {}) { return this.call('DELETE', path, body); }
}

async function join(member, nick, extra = {}) {
  member.key = fakeKey();
  const r = await member.post('/auth/signup', {
    nick, key: member.key, industry: 'Tech', country: 'GR', startDate: ymd(member.now - 30 * DAY), publicBoard: true, ...extra
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  member.code = r.data.recoveryCode;
  return r;
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log('  ok    ' + name);
  } catch (err) {
    results.push(false);
    console.log('  FAIL  ' + name + '\n        ' + String((err && err.message) || err).split('\n').join('\n        '));
  }
}

console.log('API checks');

await test('without a database: a clear 503', async () => {
  const res = await handle(new Request(ORIGIN + '/api/health'), {});
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'no_database');
});

await test('the first request creates the tables', async () => {
  const r = await new Member().get('/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true, schema: 3 });
  const tables = db.query("SELECT name AS n FROM sqlite_master WHERE type = 'table'").map(t => t.n);
  for (const t of ['meta', 'users', 'sessions', 'checkins', 'moves', 'escapes', 'posts', 'reactions', 'reports', 'votes', 'rate_limits']) {
    assert.ok(tables.includes(t), t);
  }
});

await test('unknown paths and methods', async () => {
  const m = new Member();
  assert.equal((await m.get('/nope')).status, 404);
  assert.equal((await m.put('/me', {})).status, 405);
});

const alice = new Member();
const bob = new Member();
const carol = new Member();
const dave = new Member();
let alicePost;
let bobPost;

await test('sign-up rejects bad input', async () => {
  const m = new Member();
  const base = { nick: 'Valid_Nick', key: fakeKey(), industry: 'Tech', country: 'GR', startDate: TODAY, publicBoard: false };
  assert.equal((await m.post('/auth/signup', { ...base, nick: 'ab' })).data.error, 'bad_nick');
  assert.equal((await m.post('/auth/signup', { ...base, nick: 'no spaces' })).data.error, 'bad_nick');
  assert.equal((await m.post('/auth/signup', { ...base, nick: 'Anonymous' })).status, 409);
  assert.equal((await m.post('/auth/signup', { ...base, key: 'my password' })).data.error, 'bad_key');
  assert.equal((await m.post('/auth/signup', { ...base, startDate: ymd(START + 3 * DAY) })).data.error, 'bad_date');
  assert.equal((await m.post('/auth/signup', { ...base, startDate: '2026-02-30' })).data.error, 'bad_date');
  assert.equal((await m.post('/auth/signup', 'nick=x', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await m.post('/auth/signup', base, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await m.post('/auth/signup', base, { Origin: 'null' })).status, 403);
  assert.equal((await m.post('/auth/signup', '[1,2]')).status, 400);
  assert.equal(count('SELECT COUNT(*) AS n FROM users'), 0);
});

await test('sign-up creates the account and a session', async () => {
  const r = await join(alice, 'Alice_1');
  assert.match(alice.code, /^[A-HJKMNP-TV-Z2-9]{4}(-[A-HJKMNP-TV-Z2-9]{4}){3}$/);
  assert.match(alice.lastCookie, /^__Host-sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=5184000$/);
  const me = r.data.me;
  assert.equal(me.nick, 'Alice_1');
  assert.equal(me.startDate, ymd(START - 30 * DAY));
  assert.equal(me.publicBoard, true);
  assert.equal(me.streak, 0);
  assert.equal(me.escaped, false);
  assert.equal(me.grindRank, 1);
  assert.equal(me.admin, false);
  assert.deepEqual(me.totals, { applied: 0, interview: 0, course: 0, coffee: 0, workout: 0, helped: 0, rejected: 0, ghosted: 0 });
  const row = JSON.stringify(db.query("SELECT * FROM users WHERE nick_key = 'alice_1'"));
  assert.ok(!row.includes(alice.key), 'the password key is not stored as it is');
  assert.ok(!row.includes(alice.code.replace(/-/g, '')), 'the recovery code is not stored as it is');
});

await test('nicknames are unique whatever the case', async () => {
  const r = await new Member().post('/auth/signup', { nick: 'alice_1', key: fakeKey(), industry: 'Tech', country: 'GR', startDate: TODAY, publicBoard: false });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'nick_taken');
});

await test('signed-out and forged sessions get 401', async () => {
  assert.equal((await new Member().get('/me')).status, 401);
  const forged = new Member();
  forged.cookie = '__Host-sid=' + 'A'.repeat(43);
  assert.equal((await forged.get('/me')).status, 401);
});

await test('a mood check-in starts the streak', async () => {
  let r = await alice.post('/checkin', { mood: 'good' });
  assert.equal(r.data.me.today.mood, 'good');
  assert.equal(r.data.me.streak, 1);
  r = await alice.post('/checkin', { mood: 'okay' });
  assert.equal(r.data.me.today.mood, 'okay', 'the mood can change during the day');
  assert.equal(r.data.me.streak, 1);
  assert.equal((await alice.post('/checkin', { mood: 'ecstatic' })).status, 400);
});

await test('the mood history holds only the last 14 days, oldest first', async () => {
  const m = new Member();
  await join(m, 'Moody_7', { publicBoard: false, startDate: ymd(START - 30 * DAY) });
  for (const [ago, mood] of [[20, 'awful'], [13, 'low'], [3, 'good'], [1, 'meh']]) {
    m.now = START - ago * DAY;
    assert.equal((await m.post('/checkin', { mood })).status, 200);
  }
  m.now = START;
  let me = (await m.get('/me')).data.me;
  assert.deepEqual(me.moodDays, [
    { day: ymd(START - 13 * DAY), mood: 'low' },
    { day: ymd(START - 3 * DAY), mood: 'good' },
    { day: ymd(START - DAY), mood: 'meh' }
  ], 'day 14 ago and older are left out');
  me = (await m.post('/checkin', { mood: 'okay' })).data.me;
  assert.deepEqual(me.moodDays.at(-1), { day: TODAY, mood: 'okay' }, 'today appears right after checking in');
  assert.equal(me.moodDays.length, 4);
  assert.deepEqual((await new Member().post('/auth/signup', {
    nick: 'Fresh_8', key: fakeKey(), industry: 'Tech', country: 'GR', startDate: TODAY, publicBoard: false
  })).data.me.moodDays, [], 'a new member starts with an empty history');
});

await test('the move history holds the last 14 days of moves, privately', async () => {
  const m = new Member();
  await join(m, 'Mover_9', { publicBoard: false, startDate: ymd(START - 30 * DAY) });
  for (const [ago, kind] of [[15, 'applied'], [13, 'interview'], [2, 'applied'], [2, 'applied'], [2, 'ghosted'], [0, 'course']]) {
    m.now = START - ago * DAY;
    assert.equal((await m.post('/moves', { kind })).status, 200);
  }
  m.now = START;
  const me = (await m.get('/me')).data.me;
  assert.deepEqual(me.moveDays, [
    { day: ymd(START - 13 * DAY), kind: 'interview', n: 1 },
    { day: ymd(START - 2 * DAY), kind: 'applied', n: 2 },
    { day: ymd(START - 2 * DAY), kind: 'ghosted', n: 1 },
    { day: TODAY, kind: 'course', n: 1 }
  ], 'oldest first, older than 14 days left out, counts added up');
  const other = new Member();
  await join(other, 'Peeker_9', { publicBoard: false });
  assert.ok(!JSON.stringify((await other.get('/boards/grind')).data).includes('moveDays'), 'boards never carry the move history');
  assert.deepEqual((await other.get('/me')).data.me.moveDays, [], 'another member sees only their own (empty) history');
});

await test('moves add up for today, this week and in total', async () => {
  for (let i = 0; i < 3; i++) await alice.post('/moves', { kind: 'applied' });
  const me = (await alice.post('/moves', { kind: 'rejected' })).data.me;
  assert.equal(me.totals.applied, 3);
  assert.equal(me.totals.rejected, 1);
  assert.deepEqual(me.today.moves, { applied: 3, rejected: 1 });
  assert.equal(me.weekMoves, 4);
  assert.equal((await alice.post('/moves', { kind: 'napped' })).status, 400);
});

await test('a weekly application goal is saved, checked and counted', async () => {
  let me = (await alice.get('/me')).data.me;
  assert.equal(me.weekGoal, 0, 'no goal until the member sets one');
  assert.equal(me.weekApplied, 3, 'only applications count toward the goal');
  me = (await alice.patch('/me', { weekGoal: 10 })).data.me;
  assert.equal(me.weekGoal, 10);
  assert.equal(me.weekApplied, 3);
  for (const bad of [-1, 51, 2.5, '10', true, null]) {
    assert.equal((await alice.patch('/me', { weekGoal: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await alice.get('/me')).data.me.weekGoal, 10, 'bad values change nothing');
  assert.equal((await alice.get('/me/export')).data.profile.weeklyApplicationGoal, 10);
  assert.equal((await alice.patch('/me', { weekGoal: 0 })).data.me.weekGoal, 0, 'the goal can be cleared');
});

await test('the last interview day is tracked for the member', async () => {
  const m = new Member();
  await join(m, 'Interviewee_4', { publicBoard: false, startDate: ymd(START - 60 * DAY) });
  assert.equal((await m.get('/me')).data.me.lastInterview, null, 'no interview logged yet');
  m.now = START - 12 * DAY;
  await m.post('/moves', { kind: 'interview' });
  m.now = START - 5 * DAY;
  await m.post('/moves', { kind: 'interview' });
  m.now = START - 2 * DAY;
  await m.post('/moves', { kind: 'applied' });
  m.now = START;
  assert.equal((await m.get('/me')).data.me.lastInterview, ymd(START - 5 * DAY), 'the latest interview, not other moves');
  assert.equal((await m.post('/moves', { kind: 'interview' })).data.me.lastInterview, TODAY, 'updates right after logging one');
  assert.equal((await alice.get('/me')).data.me.lastInterview, null, 'other members’ interviews don’t count');
});

await test('one of today’s moves can be undone, and only today’s', async () => {
  const m = new Member();
  await join(m, 'Oops_7', { publicBoard: false, startDate: ymd(START - 10 * DAY) });
  m.now = START - DAY;
  await m.post('/moves', { kind: 'applied' });
  m.now = START;
  await m.post('/moves', { kind: 'applied' });
  await m.post('/moves', { kind: 'applied' });
  let me = (await m.post('/moves', { kind: 'ghosted' })).data.me;
  assert.equal(me.streak, 2);
  const appliedWeek = me.weekApplied;
  let r = await m.del('/moves', { kind: 'applied' });
  assert.equal(r.status, 200);
  me = r.data.me;
  assert.deepEqual(me.today.moves, { applied: 1, ghosted: 1 });
  assert.equal(me.totals.applied, 2, 'yesterday’s move stays');
  assert.equal(me.weekApplied, appliedWeek - 1, 'the weekly goal count follows');
  assert.equal(me.streak, 2, 'the streak stays');
  me = (await m.del('/moves', { kind: 'ghosted' })).data.me;
  assert.deepEqual(me.today.moves, { applied: 1 }, 'a kind at zero disappears');
  assert.equal(count("SELECT COUNT(*) AS n FROM moves WHERE kind = 'ghosted' AND user_id = (SELECT id FROM users WHERE nick = 'Oops_7')"), 0, 'no empty rows are kept');
  r = await m.del('/moves', { kind: 'ghosted' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'nothing_to_undo');
  assert.equal((await m.del('/moves', { kind: 'interview' })).status, 409, 'nothing of that kind today');
  assert.equal((await m.del('/moves', { kind: 'napped' })).status, 400);
  assert.equal((await m.del('/moves', {})).status, 400);
  assert.equal((await m.del('/moves', { kind: 'applied' })).data.me.totals.applied, 1);
  assert.equal((await m.del('/moves', { kind: 'applied' })).status, 409, 'yesterday’s move can’t be undone');
  assert.equal((await m.call('DELETE', '/moves', { kind: 'applied' }, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await new Member().del('/moves', { kind: 'applied' })).status, 401);
});

await test('moves per day are capped', async () => {
  const m = new Member();
  await join(m, 'Capped_9', { publicBoard: false });
  for (let i = 0; i < 25; i++) assert.equal((await m.post('/moves', { kind: 'coffee' })).status, 200);
  const r = await m.post('/moves', { kind: 'coffee' });
  assert.equal(r.status, 429);
  assert.equal(r.data.error, 'move_cap');
});

await test('the streak grows day by day and resets after a missed day', async () => {
  const m = new Member();
  await join(m, 'Streaky', { publicBoard: false });
  m.now = START - DAY;
  assert.equal((await m.post('/checkin', { mood: 'meh' })).data.me.streak, 1);
  m.now = START;
  assert.equal((await m.post('/moves', { kind: 'course' })).data.me.streak, 2);
  m.now = START + 2 * DAY;
  assert.equal((await m.get('/me')).data.me.streak, 0, 'a missed day shows 0');
  assert.equal((await m.post('/checkin', { mood: 'okay' })).data.me.streak, 1);
});

await test('the best streak ever is remembered after the streak resets', async () => {
  const m = new Member();
  await join(m, 'BestStreaky', { publicBoard: false });
  let me = (await m.get('/me')).data.me;
  assert.equal(me.bestStreak, 0);
  assert.equal(me.bestStreakDay, null);
  for (let i = 3; i >= 1; i--) {
    m.now = START - i * DAY;
    me = (await m.post('/checkin', { mood: 'okay' })).data.me;
  }
  assert.equal(me.streak, 3);
  assert.equal(me.bestStreak, 3);
  assert.equal(me.bestStreakDay, ymd(START - DAY));
  me = (await m.post('/moves', { kind: 'applied' })).data.me;
  assert.equal(me.bestStreak, 3, 'a second action on the same day changes nothing');
  m.now = START + DAY;
  me = (await m.post('/checkin', { mood: 'low' })).data.me;
  assert.equal(me.streak, 1, 'the streak reset after a missed day');
  assert.equal(me.bestStreak, 3, 'the best stays');
  assert.equal(me.bestStreakDay, ymd(START - DAY));
  m.now = START + 2 * DAY;
  me = (await m.post('/moves', { kind: 'course' })).data.me;
  assert.equal(me.bestStreak, 3, 'a shorter streak does not replace it');
  const ex = (await m.get('/me/export')).data;
  assert.equal(ex.profile.bestStreak, 3, 'part of the data export');
});

await test('tying the best streak keeps the old record day, and beating it moves it', async () => {
  // The app's "new personal best" note relies on this: a run that only ties the record
  // leaves bestStreakDay on the earlier run, and the next day of the run replaces it.
  const m = new Member();
  await join(m, 'RecordBreaker', { publicBoard: false });
  let me;
  for (const d of [-9, -8]) { m.now = START + d * DAY; me = (await m.post('/checkin', { mood: 'okay' })).data.me; }
  assert.equal(me.bestStreak, 2);
  assert.equal(me.bestStreakDay, ymd(START - 8 * DAY));
  for (const d of [-2, -1]) { m.now = START + d * DAY; me = (await m.post('/moves', { kind: 'course' })).data.me; }
  assert.equal(me.streak, 2, 'a second run ties the record');
  assert.equal(me.bestStreakDay, ymd(START - 8 * DAY), 'a tie keeps the old day');
  m.now = START;
  me = (await m.get('/me')).data.me;
  assert.equal(me.lastCheckin, ymd(START - DAY), 'today is not counted yet');
  me = (await m.post('/checkin', { mood: 'good' })).data.me;
  assert.equal(me.streak, 3);
  assert.equal(me.bestStreak, 3, 'the record falls');
  assert.equal(me.bestStreakDay, ymd(START));
});

await test('the best-streak step fills in existing members from their last streak', async () => {
  const id = db.query("SELECT id FROM users WHERE nick_key = 'streaky'")[0].id;
  db.query('ALTER TABLE users DROP COLUMN best_streak_day');
  db.query('ALTER TABLE users DROP COLUMN best_streak');
  db.query("UPDATE meta SET value = '2' WHERE key = 'schema'");
  forgetSchema();
  assert.deepEqual((await new Member().get('/health')).data, { ok: true, schema: 3 });
  const row = db.query('SELECT streak, last_checkin, best_streak, best_streak_day FROM users WHERE id = ?1', id)[0];
  assert.equal(row.best_streak, row.streak);
  assert.equal(row.best_streak_day, row.last_checkin);
  assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE best_streak < streak'), 0);
});

await test('more members join; ADMIN_NICKS makes an admin', async () => {
  await join(bob, 'Bob_2', { publicBoard: false, startDate: ymd(START - 200 * DAY) });
  await join(carol, 'Carol_3', { startDate: ymd(START - 100 * DAY) });
  await join(dave, 'Dave_4', { startDate: ymd(START - 10 * DAY) });
  assert.equal((await carol.get('/me')).data.me.admin, true);
});

await test('Legends: public members by days in the queue; private members see only their own place', async () => {
  const a = (await alice.get('/boards/legends')).data;
  assert.deepEqual(a.rows.map(r => [r.rank, r.nick, r.days, r.me]), [[1, 'Carol_3', 100, false], [2, 'Alice_1', 30, true], [3, 'Dave_4', 10, false]]);
  assert.deepEqual(a.me, { rank: 2, days: 30 });
  const b = (await bob.get('/boards/legends')).data;
  assert.ok(!b.rows.some(r => r.nick === 'Bob_2'));
  assert.deepEqual(b.me, { rank: 1, days: 200 });
});

await test('Grind of the Week: public members by moves this week', async () => {
  for (let i = 0; i < 6; i++) await dave.post('/moves', { kind: 'applied' });
  for (let i = 0; i < 4; i++) await carol.post('/moves', { kind: 'interview' });
  const g = (await alice.get('/boards/grind')).data;
  assert.deepEqual(g.rows.map(r => [r.rank, r.nick, r.moves, r.me]), [[1, 'Dave_4', 6, false], [2, 'Alice_1', 4, true], [3, 'Carol_3', 4, false]]);
  assert.deepEqual(g.me, { rank: 2, moves: 4, streak: 1 });
  assert.equal((await alice.get('/me')).data.me.grindRank, 2, 'home and board agree');
  assert.equal((await carol.get('/me')).data.me.grindRank, 3);
  const b = (await bob.get('/boards/grind')).data;
  assert.deepEqual(b.me, { rank: 4, moves: 0, streak: 0 });
});

await test('posts, and anonymous posts never reveal the author', async () => {
  let r = await alice.post('/posts', { cat: 'Wins', text: 'Hello queue!\n\n\n\nSecond line  ', anon: false });
  assert.equal(r.status, 201);
  alicePost = r.data.post;
  assert.equal(alicePost.text, 'Hello queue!\n\nSecond line');
  assert.equal(alicePost.nick, 'Alice_1');
  assert.equal(alicePost.days, 30);
  r = await bob.post('/posts', { cat: 'Rejections', text: 'Rejected by an auto-email at 3am.', anon: true });
  bobPost = r.data.post;
  assert.equal(bobPost.nick, null);
  assert.equal(bobPost.days, null, 'no day count that could be matched to the boards');
  assert.equal(db.query('SELECT days FROM posts WHERE id = ?1', bobPost.id)[0].days, 200, 'still stored, for the author’s own export');
  const feed = (await alice.get('/posts')).data;
  assert.deepEqual(feed.posts.map(p => p.id), [bobPost.id, alicePost.id]);
  assert.equal(feed.more, false);
  assert.equal(feed.posts[0].mine, false);
  assert.ok(!JSON.stringify(feed).includes('Bob_2'), 'the anonymous author is nowhere in the response');
  const own = (await bob.get('/posts')).data.posts[0];
  assert.equal(own.mine, true);
  assert.equal(own.canDelete, true);
  const wins = (await alice.get('/posts?cat=' + encodeURIComponent('Wins'))).data.posts;
  assert.deepEqual(wins.map(p => p.id), [alicePost.id]);
});

await test('the feed can show only my own posts, anonymous ones included', async () => {
  const bobMine = (await bob.get('/posts?mine=1')).data.posts;
  assert.deepEqual(bobMine.map(p => p.id), [bobPost.id], 'the anonymous post shows up for its author');
  assert.equal(bobMine[0].mine, true);
  assert.equal(bobMine[0].nick, null, 'still anonymous in the response');
  assert.equal(bobMine[0].days, null);
  assert.deepEqual((await alice.get('/posts?mine=1')).data.posts.map(p => p.id), [alicePost.id], 'nobody else’s posts');
  assert.deepEqual((await alice.get('/posts?mine=0')).data.posts.map(p => p.id), [bobPost.id, alicePost.id], 'mine=0 is the whole feed');
  assert.deepEqual((await alice.get('/posts?mine=1&cat=Rejections')).data.posts, [], 'combines with a category');
  assert.equal((await carol.get('/posts?mine=1')).data.posts.length, 0);
  assert.equal((await alice.get('/posts?mine=yes')).status, 400);
});

await test('posts are checked', async () => {
  assert.equal((await alice.post('/posts', { cat: 'Wins', text: '   ' })).data.error, 'empty');
  assert.equal((await alice.post('/posts', { cat: 'Nope', text: 'hi' })).status, 400);
  assert.equal((await alice.post('/posts', { cat: 'Wins', text: 'x'.repeat(501) })).data.error, 'too_long');
  assert.equal((await alice.post('/posts', { cat: 'Wins', text: '🎉'.repeat(500) })).status, 201, '500 emoji fit');
  assert.equal((await alice.post('/posts', { kind: 'hiring', role: 'Dev' })).status, 400, 'hiring posts are for escapees');
});

await test('reactions toggle and count once per member', async () => {
  let r = await alice.post(`/posts/${bobPost.id}/react`, { r: 'hug', on: true });
  assert.deepEqual(r.data, { on: true, count: 1 });
  r = await alice.post(`/posts/${bobPost.id}/react`, { r: 'hug', on: true });
  assert.deepEqual(r.data, { on: true, count: 1 });
  r = await carol.post(`/posts/${bobPost.id}/react`, { r: 'hug', on: true });
  assert.equal(r.data.count, 2);
  r = await alice.post(`/posts/${bobPost.id}/react`, { r: 'hug', on: false });
  assert.deepEqual(r.data, { on: false, count: 1 });
  assert.equal((await alice.post(`/posts/${bobPost.id}/react`, { r: 'congrats', on: true })).status, 400);
  const p = (await carol.get('/posts')).data.posts.find(x => x.id === bobPost.id);
  assert.deepEqual(p.r, { hug: 1 });
  assert.deepEqual(p.my, { hug: true });
});

await test('the Me tab counts support received on own posts, not own reactions', async () => {
  let me = (await bob.get('/me')).data.me;
  assert.deepEqual(me.received, { same: 0, hug: 1, haha: 0, congrats: 0, useful: 0 }, 'Carol’s hug on the anonymous post counts');
  assert.equal(me.postCount, count('SELECT COUNT(*) AS n FROM posts WHERE user_id = (SELECT id FROM users WHERE nick = ?1) AND hidden = 0', 'Bob_2'));
  assert.ok(me.postCount >= 1);
  await bob.post(`/posts/${bobPost.id}/react`, { r: 'same', on: true });
  me = (await bob.get('/me')).data.me;
  assert.equal(me.received.same, 0, 'reacting to your own post is not support received');
  await bob.post(`/posts/${bobPost.id}/react`, { r: 'same', on: false });
  me = (await alice.get('/me')).data.me;
  assert.equal(me.received.hug, 0, 'reactions Alice gave are not hers');
  const p = (await carol.get('/posts')).data.posts.find(x => x.id === bobPost.id);
  assert.equal(p.received, undefined, 'nothing new leaks into the feed');
  assert.equal(p.nick, null, 'the anonymous post stays anonymous');
});

await test('members delete only their own posts; admins can remove any', async () => {
  const extra = (await dave.post('/posts', { cat: 'Memes', text: 'delete me' })).data.post;
  assert.equal((await alice.del(`/posts/${extra.id}`)).status, 403);
  assert.equal((await carol.get('/posts')).data.posts.find(p => p.id === extra.id).canDelete, true);
  assert.equal((await carol.del(`/posts/${extra.id}`)).status, 200);
  const own = (await alice.post('/posts', { cat: 'Wins', text: 'temporary' })).data.post;
  assert.equal((await alice.del(`/posts/${own.id}`)).status, 200);
  assert.equal((await alice.del(`/posts/${own.id}`)).status, 404);
});

await test('three reports hide a post', async () => {
  const p = (await dave.post('/posts', { cat: 'Interviews', text: 'something rude' })).data.post;
  assert.equal((await dave.post(`/posts/${p.id}/report`)).status, 400, 'no reporting yourself');
  for (const m of [alice, bob]) assert.equal((await m.post(`/posts/${p.id}/report`)).status, 200);
  assert.ok(!(await alice.get('/posts')).data.posts.some(x => x.id === p.id), 'gone from the feed of whoever reported it');
  assert.ok((await carol.get('/posts')).data.posts.some(x => x.id === p.id), 'two reports: others still see it');
  assert.equal((await carol.post(`/posts/${p.id}/report`)).status, 200);
  assert.ok(!(await dave.get('/posts')).data.posts.some(x => x.id === p.id), 'three reports: hidden for everyone');
});

await test('escaping posts to the wall, and congratulations count as cheers', async () => {
  const me = (await alice.post('/escape', { role: '  Junior   Data Analyst ', wall: true })).data.me;
  assert.equal(me.escaped, true);
  assert.equal(me.escapeNo, 1);
  assert.equal(me.escapedDays, 30);
  assert.equal(me.escapeRole, 'Junior Data Analyst');
  assert.equal(me.cheers, 0);
  const post = (await bob.get('/posts')).data.posts[0];
  assert.equal(post.kind, 'escape');
  assert.equal(post.escapee, true);
  assert.match(post.text, /^ESCAPED after 30 days · Junior Data Analyst\./);
  await bob.post(`/posts/${post.id}/react`, { r: 'congrats', on: true });
  await carol.post(`/posts/${post.id}/react`, { r: 'congrats', on: true });
  assert.equal((await alice.get('/me')).data.me.cheers, 2);
  const wall = (await bob.get('/boards/escapees')).data.rows;
  assert.deepEqual(wall.map(w => [w.no, w.nick, w.days, w.me]), [[1, 'Alice_1', 30, false]]);
  assert.ok(!(await bob.get('/boards/legends')).data.rows.some(x => x.nick === 'Alice_1'), 'escapees leave Legends');
  assert.equal((await alice.post('/escape', { role: '', wall: true })).status, 409);
});

await test('hiring posts from escapees', async () => {
  const r = await alice.post('/posts', { kind: 'hiring', role: 'Junior Designer' });
  assert.equal(r.status, 201);
  assert.equal(r.data.post.kind, 'hiring');
  assert.equal(r.data.post.days, 30);
  assert.equal((await bob.post(`/posts/${r.data.post.id}/react`, { r: 'useful', on: true })).data.count, 1);
});

await test('a private escape stays off the wall and the feed', async () => {
  const me = (await dave.post('/escape', { role: '', wall: false })).data.me;
  assert.equal(me.escapeNo, 2);
  assert.equal(me.escapeWall, false);
  assert.ok(!(await bob.get('/boards/escapees')).data.rows.some(w => w.nick === 'Dave_4'));
  assert.equal(count("SELECT COUNT(*) AS n FROM posts WHERE kind = 'escape'"), 1);
});

await test('back in the queue keeps the escapee number', async () => {
  const me = (await alice.post('/back')).data.me;
  assert.equal(me.escaped, false);
  assert.equal(me.sequel, true);
  assert.equal(me.startDate, TODAY);
  assert.equal(me.escapeNo, 1);
  assert.equal(me.peak, 30);
  assert.equal((await alice.post('/back')).status, 409);
});

await test('the bingo card and claimed badges are saved', async () => {
  const order = [0, 1, 2, 3, 4, -1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  let r = await bob.put('/me/game', { bingo: { order, marks: [5, 0, 1], won: false } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.me.bingo, { order, marks: [5, 0, 1], won: false });
  assert.equal((await bob.put('/me/game', { bingo: { order: order.slice(1), marks: [], won: false } })).status, 400);
  assert.equal((await bob.put('/me/game', { bingo: { order: [...order.slice(0, 15), 0], marks: [], won: false } })).status, 400);
  r = await bob.put('/me/game', { claimed: { boss: true } });
  assert.deepEqual(r.data.me.claimed, { boss: true });
  assert.deepEqual(r.data.me.bingo.marks, [5, 0, 1], 'the card is kept');
  assert.equal((await bob.put('/me/game', { claimed: { centurion: true } })).status, 400);
});

await test('Unicorn of the Week: one vote per member per week', async () => {
  assert.deepEqual((await bob.get('/unicorn')).data.counts, [0, 0, 0]);
  let r = await bob.post('/unicorn', { ad: 1 });
  assert.deepEqual(r.data.counts, [0, 1, 0]);
  assert.equal(r.data.mine, 1);
  r = await bob.post('/unicorn', { ad: 2 });
  assert.equal(r.data.mine, 1, 'the first vote stays');
  r = await carol.post('/unicorn', { ad: 2 });
  assert.deepEqual(r.data.counts, [0, 1, 1]);
  assert.equal((await bob.get('/me')).data.me.unicornEver, true);
  assert.equal((await bob.post('/unicorn', { ad: 3 })).status, 400);
});

await test('settings are saved and checked', async () => {
  const r = await bob.patch('/me', { publicBoard: true, calm: true, country: 'IE' });
  assert.equal(r.data.me.publicBoard, true);
  assert.equal(r.data.me.calm, true);
  assert.equal(r.data.me.country, 'IE');
  assert.equal((await bob.patch('/me', { country: 'FR' })).status, 400);
  assert.equal((await bob.patch('/me', { calm: 'yes' })).status, 400);
  assert.equal((await bob.patch('/me', {})).status, 400);
  assert.equal((await bob.get('/boards/legends')).data.rows[0].nick, 'Bob_2', 'public now, and longest in the queue');
});

await test('the export has the member’s data and no secrets', async () => {
  const r = await bob.get('/me/export');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Disposition'), 'attachment; filename="iamunemployed-bob_2.json"');
  assert.equal(r.data.profile.nick, 'Bob_2');
  assert.equal(r.data.posts.length, 1);
  assert.equal(r.data.posts[0].anonymous, true);
  assert.deepEqual(r.data.unicornVotes, [{ week: r.data.unicornVotes[0].week, ad: 1 }]);
  const raw = JSON.stringify(r.data);
  for (const secret of ['pass_hash', 'pass_salt', 'recovery_hash', bob.key]) assert.ok(!raw.includes(secret), secret);
});

await test('log in and log out', async () => {
  const phone = new Member();
  assert.equal((await phone.post('/auth/login', { nick: 'BOB_2', key: fakeKey() })).status, 401);
  assert.equal((await phone.post('/auth/login', { nick: 'nobody_here', key: fakeKey() })).data.error, 'wrong_login');
  const r = await phone.post('/auth/login', { nick: 'bob_2', key: bob.key });
  assert.equal(r.status, 200);
  assert.equal(r.data.me.nick, 'Bob_2');
  const session = phone.cookie;
  assert.equal((await phone.post('/auth/logout')).status, 200);
  assert.equal(phone.cookie, '', 'the cookie is cleared');
  phone.cookie = session;
  assert.equal((await phone.get('/me')).status, 401, 'the old session no longer works');
  assert.equal((await bob.get('/me')).status, 200, 'other devices stay signed in');
});

await test('repeated log-in attempts are slowed down', async () => {
  const m = new Member();
  let last;
  for (let i = 0; i < 11; i++) last = await m.post('/auth/login', { nick: 'Carol_3', key: fakeKey() });
  assert.equal(last.status, 429);
  const later = new Member();
  later.now = START + 16 * 60000;
  assert.equal((await later.post('/auth/login', { nick: 'Carol_3', key: carol.key })).status, 200, 'fine again after 15 minutes');
});

await test('the recovery code resets the password and signs out other devices', async () => {
  const lost = new Member();
  assert.equal((await lost.post('/auth/reset', { nick: 'Dave_4', code: 'AAAA-BBBB-CCCC-DDDD', key: fakeKey() })).status, 401);
  const newKey = fakeKey();
  const r = await lost.post('/auth/reset', { nick: 'dave_4', code: dave.code.toLowerCase().replace(/-/g, ' '), key: newKey });
  assert.equal(r.status, 200);
  assert.notEqual(r.data.recoveryCode, dave.code);
  assert.equal((await dave.get('/me')).status, 401, 'old sessions are signed out');
  assert.equal((await new Member().post('/auth/login', { nick: 'Dave_4', key: dave.key })).status, 401, 'the old password fails');
  assert.equal((await new Member().post('/auth/login', { nick: 'Dave_4', key: newKey })).status, 200, 'the new password works');
  assert.equal((await new Member().post('/auth/reset', { nick: 'Dave_4', code: dave.code, key: fakeKey() })).status, 401, 'the old code is used up');
});

await test('sessions renew after a week and expire after 60 days', async () => {
  const m = new Member();
  await join(m, 'Sleepy_5', { publicBoard: false });
  m.now = START + 3 * DAY;
  assert.equal((await m.get('/me')).headers.getSetCookie().length, 0, 'no renewal in the first week');
  m.now = START + 8 * DAY;
  assert.equal((await m.get('/me')).headers.getSetCookie().length, 1, 'renewed after a week');
  m.now = START + 69 * DAY;
  assert.equal((await m.get('/me')).status, 401);
});

await test('sign-ups per network are limited', async () => {
  let last;
  for (let i = 0; i < 6; i++) {
    last = await new Member('10.9.9.9').post('/auth/signup', {
      nick: 'Flood_' + i, key: fakeKey(), industry: 'Tech', country: 'GR', startDate: TODAY, publicBoard: false
    });
  }
  assert.equal(last.status, 429);
  assert.equal(count("SELECT COUNT(*) AS n FROM users WHERE nick LIKE 'Flood%'"), 5);
});

await test('deleting an account removes all of its data', async () => {
  const id = db.query("SELECT id FROM users WHERE nick_key = 'bob_2'")[0].id;
  assert.equal((await bob.del('/me', { nick: 'Bobby' })).data.error, 'confirm');
  const r = await bob.del('/me', { nick: 'bob_2' });
  assert.equal(r.status, 200);
  assert.equal(bob.cookie, '');
  for (const t of ['sessions', 'checkins', 'moves', 'escapes', 'posts', 'reactions', 'reports', 'votes']) {
    assert.equal(count(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?1`, id), 0, t);
  }
  assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE id = ?1', id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM reactions WHERE post_id = ?1', bobPost.id), 0, 'reactions to their posts are gone too');
  const again = await new Member().post('/auth/signup', { nick: 'Bob_2', key: fakeKey(), industry: 'Tech', country: 'GR', startDate: TODAY, publicBoard: false });
  assert.equal(again.status, 201, 'the nickname is free again');
});

const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
process.exitCode = failed ? 1 : 0;
