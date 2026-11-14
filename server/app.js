// The iAmUnemployed API. Cloudflare Pages sends every request for /api/* here
// (see functions/api/[[path]].js). The data lives in a Cloudflare D1 database bound as DB.
//
//   GET    /api/health                    is the database connected?
//   POST   /api/auth/signup               new account      {nick, key, industry, country, startDate, publicBoard}
//   POST   /api/auth/login                log in           {nick, key}
//   POST   /api/auth/reset                new password     {nick, code, key}
//   POST   /api/auth/logout
//   GET    /api/me                        the signed-in member
//   PATCH  /api/me                        settings         {publicBoard, calm, mentor, country, industry, weekGoal}
//   DELETE /api/me                        delete account   {nick}
//   PUT    /api/me/game                   bingo and badges {bingo, claimed}
//   GET    /api/me/export                 everything stored about the member, as a file
//   POST   /api/checkin                   today's mood     {mood}
//   POST   /api/moves                     log a move       {kind}
//   POST   /api/escape                    landed a job     {role, wall}
//   POST   /api/back                      back in the queue
//   GET    /api/boards/legends|grind|escapees
//   GET    /api/posts?cat=&before=        the feed, newest first
//   POST   /api/posts                     new post         {cat, text, anon} or {kind: 'hiring', role}
//   DELETE /api/posts/:id                 own post, or any post for admins
//   POST   /api/posts/:id/react           {r, on}
//   POST   /api/posts/:id/report
//   GET    /api/unicorn                   this week's Unicorn of the Week votes
//   POST   /api/unicorn                   vote             {ad}
//
// Requests that change something must be JSON sent from this same site. Together with
// the SameSite session cookie, that blocks other sites from acting for a signed-in member.
//
// Admins: list nicknames in the ADMIN_NICKS environment variable (comma-separated).
// Admins can remove any post from the feed.

import { ensureSchema, SCHEMA_VERSION } from './db.js';
import * as auth from './auth.js';
import {
  HttpError, fail, json, isYmd, addDays, diffDays, weekStart, localToday, oneLine, postText, flag,
  NICK_PATTERN, readNick, nickKeyOf, RESERVED_NICKS,
  INDUSTRIES, COUNTRIES, CATEGORIES, MOVES, MOODS, REACTIONS, CLAIMABLE_BADGES, UNICORN_ADS
} from './util.js';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const MAX_BODY = 8192;     // bytes of JSON per request
const PAGE_SIZE = 30;      // posts per page of the feed
const BOARD_SIZE = 50;     // rows per leaderboard
const HIDE_AFTER = 3;      // reports from different members that hide a post
const MOVE_CAP_KIND = 25;  // moves of one kind per day
const MOVE_CAP_DAY = 60;   // moves of all kinds per day
const POST_MAX = 500;      // characters per post
const FREE_CELL = 5;       // the bingo card's free square
const GOAL_MAX = 50;       // highest weekly application goal
const MOOD_DAYS = 14;      // days of mood history on the Me tab

const ROUTES = [
  ['GET', /^\/api\/health$/, health, false],
  ['POST', /^\/api\/auth\/signup$/, signup, false],
  ['POST', /^\/api\/auth\/login$/, login, false],
  ['POST', /^\/api\/auth\/reset$/, resetPassword, false],
  ['POST', /^\/api\/auth\/logout$/, logout, false],
  ['GET', /^\/api\/me$/, getMe, true],
  ['PATCH', /^\/api\/me$/, updateMe, true],
  ['DELETE', /^\/api\/me$/, deleteMe, true],
  ['PUT', /^\/api\/me\/game$/, saveGame, true],
  ['GET', /^\/api\/me\/export$/, exportMe, true],
  ['POST', /^\/api\/checkin$/, checkIn, true],
  ['POST', /^\/api\/moves$/, logMove, true],
  ['POST', /^\/api\/escape$/, escape, true],
  ['POST', /^\/api\/back$/, backInQueue, true],
  ['GET', /^\/api\/boards\/(legends|grind|escapees)$/, board, true],
  ['GET', /^\/api\/posts$/, listPosts, true],
  ['POST', /^\/api\/posts$/, createPost, true],
  ['DELETE', /^\/api\/posts\/(\d{1,15})$/, deletePost, true],
  ['POST', /^\/api\/posts\/(\d{1,15})\/react$/, react, true],
  ['POST', /^\/api\/posts\/(\d{1,15})\/report$/, report, true],
  ['GET', /^\/api\/unicorn$/, unicorn, true],
  ['POST', /^\/api\/unicorn$/, voteUnicorn, true]
];

// `options.now` lets tests pretend it is another time.
export async function handle(request, env, options = {}) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const forPath = ROUTES.filter(r => r[1].test(path));
    if (!forPath.length) fail(404, 'not_found', 'There’s nothing here.');
    const route = forPath.find(r => r[0] === request.method);
    if (!route) fail(405, 'method', 'That isn’t allowed here.');
    const [method, pattern, action, needsMember] = route;

    if (method !== 'GET') sameSiteOnly(request, url);
    const db = env && env.DB;
    if (!db) {
      fail(503, 'no_database', 'The database isn’t connected yet. In Cloudflare, bind a D1 database to this Pages project with the variable name DB, then deploy again.');
    }
    await ensureSchema(db);

    const now = options.now ?? Date.now();
    const ctx = {
      request, url, env, db, now,
      today: localToday(request, now),
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      params: path.match(pattern).slice(1),
      body: method === 'GET' ? {} : await readJson(request),
      session: await auth.findSession(db, request, now),
      cookies: [],
      status: 200
    };
    if (needsMember) {
      if (!ctx.session) fail(401, 'signed_out', 'Please log in again.');
      ctx.user = await db.prepare('SELECT * FROM users WHERE id = ?1').bind(ctx.session.userId).first();
      if (!ctx.user) fail(401, 'signed_out', 'Please log in again.');
      const renewed = await auth.renewIfOld(db, ctx.session, now);
      if (renewed) ctx.cookies.push(renewed);
    }

    const result = await action(ctx);
    if (result instanceof Response) {
      for (const cookie of ctx.cookies) result.headers.append('Set-Cookie', cookie);
      return result;
    }
    return json(result, ctx.status, ctx.cookies);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code, message: err.message }, err.status);
    console.error(err);
    return json({ error: 'server', message: 'Something went wrong on our side. Please try again.' }, 500);
  }
}

function sameSiteOnly(request, url) {
  const blocked = () => fail(403, 'cross_site', 'Requests from other sites aren’t allowed.');
  const origin = request.headers.get('Origin');
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (err) { /* not a URL, for example "null" */ }
    if (host !== url.host) blocked();
    return;
  }
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') blocked();
}

async function readJson(request) {
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') || '')) {
    fail(415, 'bad_type', 'Send the request as JSON.');
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) fail(413, 'too_big', 'That’s too much text for one request.');
  if (!raw.trim()) return {};
  let body;
  try { body = JSON.parse(raw); } catch (err) { body = null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'bad_json', 'That request didn’t make sense.');
  return body;
}

function isAdmin(env, nickKey) {
  return String((env && env.ADMIN_NICKS) || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .some(s => nickKeyOf(s) === nickKey);
}

/* Health */

async function health() {
  return { ok: true, schema: SCHEMA_VERSION };
}

/* Accounts */

async function signup(ctx) {
  const { db, body, now, today } = ctx;
  const nick = readNick(body.nick);
  if (!NICK_PATTERN.test(nick)) {
    fail(400, 'bad_nick', 'Nicknames are 3 to 20 letters or numbers. Dots, dashes and underscores are fine too.');
  }
  if (!auth.isPasswordKey(body.key)) fail(400, 'bad_key', 'Choose a password.');
  if (!isYmd(body.startDate) || body.startDate > today || body.startDate < '1970-01-01') {
    fail(400, 'bad_date', 'Pick the day your job search started. It can’t be in the future.');
  }
  const nickKey = nickKeyOf(nick);
  const taken = () => fail(409, 'nick_taken', 'That nickname is taken. Try another one.');
  if (RESERVED_NICKS.has(nickKey)) taken();
  if (await db.prepare('SELECT 1 AS x FROM users WHERE nick_key = ?1').bind(nickKey).first()) taken();
  if (!(await auth.allow(db, 'signup:' + ctx.ip, 5, HOUR, now))) {
    fail(429, 'slow_down', 'Too many new accounts from this network. Try again in an hour.');
  }

  const pass = await auth.newPassword(body.key);
  const recoveryCode = auth.newRecoveryCode();
  let created;
  try {
    created = await db.prepare(
      `INSERT INTO users (nick, nick_key, pass_salt, pass_hash, recovery_hash, industry, country, start_date, public_board, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`
    ).bind(
      nick, nickKey, pass.salt, pass.hash, await auth.hashRecoveryCode(recoveryCode),
      INDUSTRIES.includes(body.industry) ? body.industry : 'Other',
      COUNTRIES.includes(body.country) ? body.country : 'XX',
      body.startDate, body.publicBoard === true ? 1 : 0, now
    ).first();
  } catch (err) {
    if (/unique/i.test(String(err && err.message))) taken(); // two sign-ups for one nickname at the same moment
    throw err;
  }
  await auth.sweep(db, now);
  ctx.cookies.push(await auth.createSession(db, created.id, now));
  ctx.status = 201;
  return { me: await loadMe(ctx, created.id), recoveryCode };
}

async function login(ctx) {
  const { db, body, now } = ctx;
  if (!(await auth.allow(db, 'login-ip:' + ctx.ip, 30, 15 * MINUTE, now))) {
    fail(429, 'slow_down', 'Too many log-in attempts from this network. Wait 15 minutes and try again.');
  }
  const wrong = () => fail(401, 'wrong_login', 'That nickname and password don’t match.');
  const nick = readNick(body.nick);
  if (!NICK_PATTERN.test(nick) || !auth.isPasswordKey(body.key)) wrong();
  const nickKey = nickKeyOf(nick);
  if (!(await auth.allow(db, 'login:' + nickKey, 10, 15 * MINUTE, now))) {
    fail(429, 'slow_down', 'Too many log-in attempts for this nickname. Wait 15 minutes and try again.');
  }
  const user = await db.prepare('SELECT id, pass_salt, pass_hash FROM users WHERE nick_key = ?1').bind(nickKey).first();
  if (!user || !(await auth.checkPassword(user, body.key))) wrong();
  await auth.sweep(db, now);
  ctx.cookies.push(await auth.createSession(db, user.id, now));
  return { me: await loadMe(ctx, user.id) };
}

async function resetPassword(ctx) {
  const { db, body, now } = ctx;
  if (!(await auth.allow(db, 'reset-ip:' + ctx.ip, 10, HOUR, now))) {
    fail(429, 'slow_down', 'Too many tries from this network. Try again in an hour.');
  }
  if (!auth.isPasswordKey(body.key)) fail(400, 'bad_key', 'Choose a new password.');
  const wrong = () => fail(401, 'wrong_code', 'That nickname and recovery code don’t match.');
  const nick = readNick(body.nick);
  if (!NICK_PATTERN.test(nick) || auth.normalizeCode(body.code).length !== 16) wrong();
  const nickKey = nickKeyOf(nick);
  if (!(await auth.allow(db, 'reset:' + nickKey, 5, HOUR, now))) {
    fail(429, 'slow_down', 'Too many tries for this nickname. Try again in an hour.');
  }
  const user = await db.prepare('SELECT id, recovery_hash FROM users WHERE nick_key = ?1').bind(nickKey).first();
  if (!user || !auth.sameString(await auth.hashRecoveryCode(body.code), user.recovery_hash)) wrong();

  const pass = await auth.newPassword(body.key);
  const recoveryCode = auth.newRecoveryCode();
  await db.batch([
    db.prepare('UPDATE users SET pass_salt = ?2, pass_hash = ?3, recovery_hash = ?4 WHERE id = ?1')
      .bind(user.id, pass.salt, pass.hash, await auth.hashRecoveryCode(recoveryCode)),
    db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(user.id) // signs out every other device
  ]);
  ctx.cookies.push(await auth.createSession(db, user.id, now));
  return { me: await loadMe(ctx, user.id), recoveryCode };
}

async function logout(ctx) {
  if (ctx.session) {
    await ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(ctx.session.tokenHash).run();
  }
  ctx.cookies.push(auth.clearedCookie);
  return { ok: true };
}

/* The member */

const MY_WEEK = 'SELECT COALESCE(SUM(n), 0) FROM moves WHERE user_id = ?1 AND day >= ?2';

// How many public members still in the queue rank above member ?1 this week: more moves,
// or as many moves and an earlier account (the same order the board itself uses).
const GRIND_AHEAD = `SELECT COUNT(*) AS n FROM (
    SELECT m.user_id, SUM(m.n) AS total FROM moves m JOIN users x ON x.id = m.user_id
    WHERE m.day >= ?2 AND x.public_board = 1 AND x.escaped = 0 AND x.id <> ?1
    GROUP BY m.user_id
  ) AS t
  WHERE t.total > 0 AND (t.total > (${MY_WEEK}) OR (t.total = (${MY_WEEK}) AND t.user_id < ?1))`;

// A streak counts while the last check-in was today or yesterday.
const liveStreak = (row, today) => (row.last_checkin && row.last_checkin >= addDays(today, -1) ? row.streak : 0);

async function loadMe(ctx, userId) {
  const { db, today } = ctx;
  const week = weekStart(today);
  const r = await db.batch([
    db.prepare('SELECT * FROM users WHERE id = ?1').bind(userId),
    db.prepare('SELECT kind, n FROM moves WHERE user_id = ?1 AND day = ?2').bind(userId, today),
    db.prepare('SELECT kind, SUM(n) AS n FROM moves WHERE user_id = ?1 GROUP BY kind').bind(userId),
    db.prepare(`SELECT (${MY_WEEK}) AS n`).bind(userId, week),
    db.prepare('SELECT mood FROM checkins WHERE user_id = ?1 AND day = ?2').bind(userId, today),
    db.prepare('SELECT id, days, role, wall, day FROM escapes WHERE user_id = ?1 ORDER BY id DESC LIMIT 1').bind(userId),
    db.prepare('SELECT COALESCE(MAX(days), 0) AS n FROM escapes WHERE user_id = ?1').bind(userId),
    db.prepare('SELECT ad FROM votes WHERE user_id = ?1 AND week = ?2').bind(userId, week),
    db.prepare('SELECT COUNT(*) AS n FROM votes WHERE user_id = ?1').bind(userId),
    db.prepare(GRIND_AHEAD).bind(userId, week),
    db.prepare(`SELECT COUNT(*) AS n FROM reactions WHERE kind = 'congrats' AND post_id =
      (SELECT post_id FROM escapes WHERE user_id = ?1 ORDER BY id DESC LIMIT 1)`).bind(userId),
    db.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM moves WHERE user_id = ?1 AND day >= ?2 AND kind = 'applied'").bind(userId, week),
    db.prepare('SELECT day, mood FROM checkins WHERE user_id = ?1 AND day >= ?2 AND day <= ?3 ORDER BY day')
      .bind(userId, addDays(today, 1 - MOOD_DAYS), today),
    db.prepare("SELECT MAX(day) AS day FROM moves WHERE user_id = ?1 AND kind = 'interview' AND day <= ?2").bind(userId, today)
  ]);
  const rows = i => r[i].results;
  const u = rows(0)[0];
  if (!u) fail(401, 'signed_out', 'Please log in again.');

  const todayMoves = {};
  for (const m of rows(1)) todayMoves[m.kind] = m.n;
  const totals = Object.fromEntries(MOVES.map(k => [k, 0]));
  for (const m of rows(2)) if (m.kind in totals) totals[m.kind] = m.n;
  const esc = rows(5)[0] || null;
  const game = readGame(u.game);
  const queueDays = Math.max(0, diffDays(u.start_date, today));

  return {
    nick: u.nick,
    industry: u.industry,
    country: u.country,
    startDate: u.start_date,
    publicBoard: !!u.public_board,
    calm: !!u.calm,
    mentor: !!u.mentor,
    escaped: !!u.escaped,
    sequel: !!u.sequel,
    escapeNo: esc ? esc.id : null,
    escapedDays: esc ? esc.days : null,
    escapeRole: esc ? esc.role : '',
    escapeWall: esc ? !!esc.wall : true,
    escapeDate: esc ? esc.day : null,
    streak: liveStreak(u, today),
    lastCheckin: u.last_checkin,
    weekMoves: rows(3)[0].n,
    weekGoal: u.week_goal || 0,
    weekApplied: rows(11)[0].n,
    // Private to the member: never part of a board, post or other member's response.
    moodDays: rows(12).filter(c => MOODS.includes(c.mood)).map(c => ({ day: c.day, mood: c.mood })),
    lastInterview: rows(13)[0] ? rows(13)[0].day || null : null,
    today: { date: today, mood: rows(4)[0] ? rows(4)[0].mood : null, moves: todayMoves },
    totals,
    claimed: game.claimed,
    bingo: game.bingo,
    unicornVote: rows(7)[0] ? rows(7)[0].ad : null,
    unicornEver: rows(8)[0].n > 0,
    peak: Math.max(u.escaped ? 0 : queueDays, rows(6)[0].n),
    cheers: rows(10)[0].n,
    grindRank: rows(9)[0].n + 1,
    admin: isAdmin(ctx.env, u.nick_key)
  };
}

async function getMe(ctx) {
  return { me: await loadMe(ctx, ctx.user.id) };
}

async function updateMe(ctx) {
  const { db, body, user } = ctx;
  const sets = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    sets.push(`${column} = ?${values.length + 1}`);
  };
  if ('publicBoard' in body) set('public_board', flag(body.publicBoard));
  if ('calm' in body) set('calm', flag(body.calm));
  if ('mentor' in body) set('mentor', flag(body.mentor));
  if ('country' in body) {
    if (!COUNTRIES.includes(body.country)) fail(400, 'bad_input', 'Unknown country.');
    set('country', body.country);
  }
  if ('industry' in body) {
    if (!INDUSTRIES.includes(body.industry)) fail(400, 'bad_input', 'Unknown industry.');
    set('industry', body.industry);
  }
  if ('weekGoal' in body) {
    const goal = body.weekGoal;
    if (!Number.isInteger(goal) || goal < 0 || goal > GOAL_MAX) fail(400, 'bad_input', `Pick a goal from 0 to ${GOAL_MAX}.`);
    set('week_goal', goal);
  }
  if (!sets.length) fail(400, 'bad_input', 'Nothing to change.');
  await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?1`).bind(user.id, ...values).run();
  return { me: await loadMe(ctx, user.id) };
}

function validBingo(card) {
  if (!card || typeof card !== 'object') return false;
  const { order, marks, won } = card;
  if (!Array.isArray(order) || order.length !== 16 || order[FREE_CELL] !== -1) return false;
  const phrases = order.filter((_, i) => i !== FREE_CELL);
  if (!phrases.every(n => Number.isInteger(n) && n >= 0 && n <= 14) || new Set(phrases).size !== 15) return false;
  if (!Array.isArray(marks) || marks.length > 16) return false;
  if (!marks.every(n => Number.isInteger(n) && n >= 0 && n <= 15) || new Set(marks).size !== marks.length) return false;
  return typeof won === 'boolean';
}

function readGame(raw) {
  let game = {};
  try { game = JSON.parse(raw || '{}') || {}; } catch (err) { game = {}; }
  const claimed = {};
  if (game.claimed && typeof game.claimed === 'object') {
    for (const id of CLAIMABLE_BADGES) if (game.claimed[id] === true) claimed[id] = true;
  }
  return { bingo: validBingo(game.bingo) ? game.bingo : null, claimed };
}

async function saveGame(ctx) {
  const { db, body, user } = ctx;
  const game = readGame(user.game);
  if ('bingo' in body) {
    if (!validBingo(body.bingo)) fail(400, 'bad_input', 'That bingo card isn’t valid.');
    game.bingo = { order: body.bingo.order, marks: body.bingo.marks, won: body.bingo.won };
  }
  if ('claimed' in body) {
    const claimed = body.claimed;
    if (!claimed || typeof claimed !== 'object' || Array.isArray(claimed)) fail(400, 'bad_input', 'Unknown badge.');
    for (const id of Object.keys(claimed)) {
      if (!CLAIMABLE_BADGES.includes(id) || claimed[id] !== true) fail(400, 'bad_input', 'Unknown badge.');
      game.claimed[id] = true;
    }
  }
  await db.prepare('UPDATE users SET game = ?2 WHERE id = ?1').bind(user.id, JSON.stringify(game)).run();
  return { me: await loadMe(ctx, user.id) };
}

async function exportMe(ctx) {
  const { db, user, now } = ctx;
  const id = user.id;
  const [checkins, moves, posts, reactions, escapes, votes] = await db.batch([
    db.prepare('SELECT day, mood FROM checkins WHERE user_id = ?1 ORDER BY day').bind(id),
    db.prepare('SELECT day, kind, n FROM moves WHERE user_id = ?1 ORDER BY day, kind').bind(id),
    db.prepare('SELECT id, kind, cat, body, anon, days, hidden, created_at FROM posts WHERE user_id = ?1 ORDER BY id').bind(id),
    db.prepare('SELECT post_id, kind FROM reactions WHERE user_id = ?1 ORDER BY post_id').bind(id),
    db.prepare('SELECT id, days, role, wall, day FROM escapes WHERE user_id = ?1 ORDER BY id').bind(id),
    db.prepare('SELECT week, ad FROM votes WHERE user_id = ?1 ORDER BY week').bind(id)
  ]);
  const iso = ms => new Date(ms).toISOString();
  const data = {
    about: 'Everything iAmUnemployed stores about your account. Your password is not in here: the server never receives it.',
    exportedAt: iso(now),
    profile: {
      nick: user.nick,
      industry: user.industry,
      country: user.country,
      jobSearchStarted: user.start_date,
      onPublicLeaderboards: !!user.public_board,
      calmMode: !!user.calm,
      mentor: !!user.mentor,
      weeklyApplicationGoal: user.week_goal || 0,
      escaped: !!user.escaped,
      cameBackAfterEscaping: !!user.sequel,
      streak: user.streak,
      lastCheckin: user.last_checkin,
      joined: iso(user.created_at),
      game: readGame(user.game)
    },
    checkins: checkins.results,
    moves: moves.results,
    posts: posts.results.map(p => ({
      id: p.id, kind: p.kind, category: p.cat, text: p.body, anonymous: !!p.anon,
      daysInQueue: p.days, hiddenAfterReports: !!p.hidden, posted: iso(p.created_at)
    })),
    reactions: reactions.results.map(x => ({ post: x.post_id, reaction: x.kind })),
    escapes: escapes.results.map(e => ({ escapeeNumber: e.id, daysInQueue: e.days, role: e.role, onTheWall: !!e.wall, day: e.day })),
    unicornVotes: votes.results
  };
  const fileName = 'iamunemployed-' + (user.nick_key.replace(/[^a-z0-9_.-]/g, '') || 'account') + '.json';
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function deleteMe(ctx) {
  const { db, body, user } = ctx;
  if (nickKeyOf(readNick(body.nick)) !== user.nick_key) fail(400, 'confirm', 'Type your nickname exactly to confirm.');
  const id = user.id;
  const myPosts = 'SELECT id FROM posts WHERE user_id = ?1';
  await db.batch([
    db.prepare(`DELETE FROM reactions WHERE user_id = ?1 OR post_id IN (${myPosts})`).bind(id),
    db.prepare(`DELETE FROM reports WHERE user_id = ?1 OR post_id IN (${myPosts})`).bind(id),
    db.prepare('DELETE FROM posts WHERE user_id = ?1').bind(id),
    db.prepare('DELETE FROM checkins WHERE user_id = ?1').bind(id),
    db.prepare('DELETE FROM moves WHERE user_id = ?1').bind(id),
    db.prepare('DELETE FROM escapes WHERE user_id = ?1').bind(id),
    db.prepare('DELETE FROM votes WHERE user_id = ?1').bind(id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id),
    db.prepare('DELETE FROM users WHERE id = ?1').bind(id)
  ]);
  ctx.cookies.push(auth.clearedCookie);
  return { ok: true };
}

/* Check-ins and moves */

// Any check-in or move keeps the streak going.
function touchStreak(db, userId, today) {
  return db.prepare(
    `UPDATE users SET
       streak = CASE WHEN last_checkin >= ?2 THEN streak WHEN last_checkin = ?3 THEN streak + 1 ELSE 1 END,
       last_checkin = CASE WHEN last_checkin >= ?2 THEN last_checkin ELSE ?2 END
     WHERE id = ?1`
  ).bind(userId, today, addDays(today, -1));
}

async function checkIn(ctx) {
  const { db, body, user, today } = ctx;
  if (!MOODS.includes(body.mood)) fail(400, 'bad_input', 'Pick a mood.');
  await db.batch([
    db.prepare('INSERT INTO checkins (user_id, day, mood) VALUES (?1, ?2, ?3) ON CONFLICT (user_id, day) DO UPDATE SET mood = excluded.mood')
      .bind(user.id, today, body.mood),
    touchStreak(db, user.id, today)
  ]);
  return { me: await loadMe(ctx, user.id) };
}

async function logMove(ctx) {
  const { db, body, user, today } = ctx;
  if (!MOVES.includes(body.kind)) fail(400, 'bad_input', 'Unknown move.');
  const done = await db.prepare(
    'SELECT COALESCE(SUM(n), 0) AS total, COALESCE(SUM(CASE WHEN kind = ?3 THEN n END), 0) AS same FROM moves WHERE user_id = ?1 AND day = ?2'
  ).bind(user.id, today, body.kind).first();
  if (done.total >= MOVE_CAP_DAY || done.same >= MOVE_CAP_KIND) {
    fail(429, 'move_cap', 'That’s a lot of moves for one day. Take a break, you’ve earned it.');
  }
  await db.batch([
    db.prepare('INSERT INTO moves (user_id, day, kind, n) VALUES (?1, ?2, ?3, 1) ON CONFLICT (user_id, day, kind) DO UPDATE SET n = n + 1')
      .bind(user.id, today, body.kind),
    touchStreak(db, user.id, today)
  ]);
  return { me: await loadMe(ctx, user.id) };
}

/* Escaping the queue */

async function escape(ctx) {
  const { db, body, user, today, now } = ctx;
  const role = oneLine(body.role, 40);
  const wall = body.wall === false ? 0 : 1;
  // Flipping the flag first means two taps can never record two escapes.
  const flipped = await db.prepare('UPDATE users SET escaped = 1, mentor = 0 WHERE id = ?1 AND escaped = 0').bind(user.id).run();
  if (!flipped.meta || !flipped.meta.changes) fail(409, 'already_out', 'You’ve already escaped. Congratulations again!');

  const days = Math.max(0, diffDays(user.start_date, today));
  const esc = await db.prepare('INSERT INTO escapes (user_id, days, role, wall, day, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id')
    .bind(user.id, days, role, wall, today, now).first();
  if (wall) {
    const text = `ESCAPED after ${days} days${role ? ` · ${role}` : ''}. Thank you, queue. I’ll be back as a mentor.`;
    const post = await db.prepare(
      `INSERT INTO posts (user_id, kind, cat, body, anon, days, escapee, created_at) VALUES (?1, 'escape', 'Wins', ?2, 0, ?3, 1, ?4) RETURNING id`
    ).bind(user.id, text, days, now).first();
    await db.prepare('UPDATE escapes SET post_id = ?2 WHERE id = ?1').bind(esc.id, post.id).run();
  }
  return { me: await loadMe(ctx, user.id) };
}

async function backInQueue(ctx) {
  const { db, user, today } = ctx;
  const res = await db.prepare('UPDATE users SET escaped = 0, sequel = 1, mentor = 0, start_date = ?2 WHERE id = ?1 AND escaped = 1')
    .bind(user.id, today).run();
  if (!res.meta || !res.meta.changes) fail(409, 'not_out', 'You’re already in the queue.');
  return { me: await loadMe(ctx, user.id) };
}

/* Leaderboards. Only members who turned on public leaderboards appear, except on the
   Escapees wall, where each escape is shown only if its member chose to post it. */

async function board(ctx) {
  const { db, user, today } = ctx;
  const kind = ctx.params[0];

  if (kind === 'legends') {
    const [list, ahead] = await db.batch([
      db.prepare(`SELECT id, nick, start_date FROM users WHERE public_board = 1 AND escaped = 0 ORDER BY start_date, id LIMIT ${BOARD_SIZE}`),
      db.prepare(
        `SELECT COUNT(*) AS n FROM users WHERE public_board = 1 AND escaped = 0 AND id <> ?1
         AND (start_date < ?2 OR (start_date = ?2 AND id < ?1))`
      ).bind(user.id, user.start_date)
    ]);
    return {
      rows: list.results.map((r, i) => ({ rank: i + 1, nick: r.nick, days: Math.max(0, diffDays(r.start_date, today)), me: r.id === user.id })),
      me: user.escaped ? null : { rank: ahead.results[0].n + 1, days: Math.max(0, diffDays(user.start_date, today)) }
    };
  }

  if (kind === 'grind') {
    const week = weekStart(today);
    const [list, mine, ahead] = await db.batch([
      db.prepare(
        `SELECT u.id, u.nick, u.streak, u.last_checkin, SUM(m.n) AS total
         FROM moves m JOIN users u ON u.id = m.user_id
         WHERE m.day >= ?1 AND u.public_board = 1 AND u.escaped = 0
         GROUP BY u.id ORDER BY total DESC, u.id LIMIT ${BOARD_SIZE}`
      ).bind(week),
      db.prepare(`SELECT (${MY_WEEK}) AS n`).bind(user.id, week),
      db.prepare(GRIND_AHEAD).bind(user.id, week)
    ]);
    return {
      rows: list.results.map((r, i) => ({ rank: i + 1, nick: r.nick, moves: r.total, streak: liveStreak(r, today), me: r.id === user.id })),
      me: user.escaped ? null : { rank: ahead.results[0].n + 1, moves: mine.results[0].n, streak: liveStreak(user, today) }
    };
  }

  const list = await db.prepare(
    `SELECT e.id, e.days, e.day, e.user_id, u.nick FROM escapes e JOIN users u ON u.id = e.user_id
     WHERE e.wall = 1 ORDER BY e.id DESC LIMIT ${BOARD_SIZE}`
  ).all();
  return { rows: list.results.map(r => ({ no: r.id, nick: r.nick, days: r.days, day: r.day, me: r.user_id === user.id })) };
}

/* The feed */

function postOut(p, user, admin, counts, mine) {
  const own = p.user_id === user.id;
  // Anonymous posts carry nothing that could point back to the author: no nickname, and no
  // day count or escapee flag, which could be matched against the leaderboards.
  const anon = !!p.anon;
  return {
    id: p.id,
    kind: p.kind,
    cat: p.cat,
    text: p.body,
    anon,
    nick: anon ? null : p.nick,
    days: anon ? null : p.days,
    escapee: anon ? false : !!p.escapee,
    ts: p.created_at,
    mine: own,
    r: counts[p.id] || {},
    my: mine[p.id] || {},
    canDelete: own || admin
  };
}

async function listPosts(ctx) {
  const { db, user, url } = ctx;
  const cat = url.searchParams.get('cat');
  const before = Number(url.searchParams.get('before')) || 0;
  if (cat && !CATEGORIES.includes(cat)) fail(400, 'bad_input', 'Unknown category.');
  // Hidden posts and posts this member reported stay out of their feed.
  const values = [user.id];
  const where = ['p.hidden = 0', 'NOT EXISTS (SELECT 1 FROM reports x WHERE x.post_id = p.id AND x.user_id = ?1)'];
  if (cat) { values.push(cat); where.push(`p.cat = ?${values.length}`); }
  if (before > 0) { values.push(before); where.push(`p.id < ?${values.length}`); }
  const found = await db.prepare(
    `SELECT p.id, p.user_id, p.kind, p.cat, p.body, p.anon, p.days, p.escapee, p.created_at, u.nick
     FROM posts p JOIN users u ON u.id = p.user_id
     WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT ${PAGE_SIZE + 1}`
  ).bind(...values).all();
  const page = found.results.slice(0, PAGE_SIZE);

  const counts = {};
  const mine = {};
  if (page.length) {
    const ids = page.map(p => p.id);
    const [all, own] = await db.batch([
      db.prepare(`SELECT post_id, kind, COUNT(*) AS n FROM reactions WHERE post_id IN (${ids.map((_, i) => `?${i + 1}`).join(', ')}) GROUP BY post_id, kind`)
        .bind(...ids),
      db.prepare(`SELECT post_id, kind FROM reactions WHERE user_id = ?1 AND post_id IN (${ids.map((_, i) => `?${i + 2}`).join(', ')})`)
        .bind(user.id, ...ids)
    ]);
    for (const x of all.results) (counts[x.post_id] = counts[x.post_id] || {})[x.kind] = x.n;
    for (const x of own.results) (mine[x.post_id] = mine[x.post_id] || {})[x.kind] = true;
  }
  const admin = isAdmin(ctx.env, user.nick_key);
  return { posts: page.map(p => postOut(p, user, admin, counts, mine)), more: found.results.length > PAGE_SIZE };
}

async function createPost(ctx) {
  const { db, body, user, today, now } = ctx;
  let kind = 'post';
  let cat;
  let text;
  let anon = 0;
  if (body.kind === 'hiring') {
    if (!user.escaped) fail(400, 'bad_input', 'Hiring posts are for members who have escaped.');
    const role = oneLine(body.role, 40);
    if (!role) fail(400, 'empty', 'Add the role first.');
    kind = 'hiring';
    cat = 'Career Change';
    text = `My company is hiring: ${role}. Happy to refer people from the queue.`;
  } else {
    text = postText(body.text);
    if (!text) fail(400, 'empty', 'Write something first.');
    if (Array.from(text).length > POST_MAX) fail(400, 'too_long', `Posts can be up to ${POST_MAX} characters.`);
    if (!CATEGORIES.includes(body.cat)) fail(400, 'bad_input', 'Pick a category.');
    cat = body.cat;
    anon = body.anon === true ? 1 : 0;
  }
  if (!(await auth.allow(db, 'post:' + user.id, 10, HOUR, now))) {
    fail(429, 'slow_down', 'You’ve posted a lot in the last hour. Take a breather and try again later.');
  }

  let days = Math.max(0, diffDays(user.start_date, today));
  if (user.escaped) {
    const last = await db.prepare('SELECT days FROM escapes WHERE user_id = ?1 ORDER BY id DESC LIMIT 1').bind(user.id).first();
    if (last) days = last.days;
  }
  const row = await db.prepare(
    'INSERT INTO posts (user_id, kind, cat, body, anon, days, escapee, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id'
  ).bind(user.id, kind, cat, text, anon, days, user.escaped ? 1 : 0, now).first();
  ctx.status = 201;
  const post = { id: row.id, user_id: user.id, kind, cat, body: text, anon, days, escapee: user.escaped, created_at: now, nick: user.nick };
  return { post: postOut(post, user, isAdmin(ctx.env, user.nick_key), {}, {}) };
}

async function deletePost(ctx) {
  const { db, user } = ctx;
  const post = await db.prepare('SELECT id, user_id FROM posts WHERE id = ?1').bind(Number(ctx.params[0])).first();
  if (!post) fail(404, 'not_found', 'That post is already gone.');
  if (post.user_id !== user.id && !isAdmin(ctx.env, user.nick_key)) fail(403, 'not_yours', 'You can only delete your own posts.');
  await db.batch([
    db.prepare('DELETE FROM reactions WHERE post_id = ?1').bind(post.id),
    db.prepare('DELETE FROM reports WHERE post_id = ?1').bind(post.id),
    db.prepare('UPDATE escapes SET post_id = NULL WHERE post_id = ?1').bind(post.id),
    db.prepare('DELETE FROM posts WHERE id = ?1').bind(post.id)
  ]);
  return { ok: true };
}

async function react(ctx) {
  const { db, body, user } = ctx;
  const post = await db.prepare('SELECT id, kind FROM posts WHERE id = ?1 AND hidden = 0').bind(Number(ctx.params[0])).first();
  if (!post) fail(404, 'not_found', 'That post is gone.');
  if (!(REACTIONS[post.kind] || REACTIONS.post).includes(body.r)) fail(400, 'bad_input', 'Unknown reaction.');
  const on = flag(body.on);
  const [, count] = await db.batch([
    on
      ? db.prepare('INSERT OR IGNORE INTO reactions (post_id, user_id, kind) VALUES (?1, ?2, ?3)').bind(post.id, user.id, body.r)
      : db.prepare('DELETE FROM reactions WHERE post_id = ?1 AND user_id = ?2 AND kind = ?3').bind(post.id, user.id, body.r),
    db.prepare('SELECT COUNT(*) AS n FROM reactions WHERE post_id = ?1 AND kind = ?2').bind(post.id, body.r)
  ]);
  return { on: !!on, count: count.results[0].n };
}

async function report(ctx) {
  const { db, user, now } = ctx;
  const post = await db.prepare('SELECT id, user_id FROM posts WHERE id = ?1 AND hidden = 0').bind(Number(ctx.params[0])).first();
  if (!post) fail(404, 'not_found', 'That post is already gone.');
  if (post.user_id === user.id) fail(400, 'own_post', 'You can delete your own post instead.');
  if (!(await auth.allow(db, 'report:' + user.id, 20, HOUR, now))) {
    fail(429, 'slow_down', 'You’ve reported a lot of posts in the last hour. Try again later.');
  }
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO reports (post_id, user_id, created_at) VALUES (?1, ?2, ?3)').bind(post.id, user.id, now),
    db.prepare(`UPDATE posts SET hidden = 1 WHERE id = ?1 AND (SELECT COUNT(*) FROM reports WHERE post_id = ?1) >= ${HIDE_AFTER}`).bind(post.id)
  ]);
  return { ok: true };
}

/* Unicorn of the Week */

async function unicornState(ctx) {
  const { db, user, today } = ctx;
  const week = weekStart(today);
  const [all, mine] = await db.batch([
    db.prepare('SELECT ad, COUNT(*) AS n FROM votes WHERE week = ?1 GROUP BY ad').bind(week),
    db.prepare('SELECT ad FROM votes WHERE week = ?1 AND user_id = ?2').bind(week, user.id)
  ]);
  const counts = Array(UNICORN_ADS).fill(0);
  for (const x of all.results) if (x.ad >= 0 && x.ad < UNICORN_ADS) counts[x.ad] = x.n;
  return { week, counts, mine: mine.results[0] ? mine.results[0].ad : null };
}

async function unicorn(ctx) {
  return unicornState(ctx);
}

async function voteUnicorn(ctx) {
  const { db, body, user, today } = ctx;
  if (!Number.isInteger(body.ad) || body.ad < 0 || body.ad >= UNICORN_ADS) fail(400, 'bad_input', 'Unknown ad.');
  // One vote per member per week: a second vote in the same week changes nothing.
  await db.prepare('INSERT OR IGNORE INTO votes (week, user_id, ad) VALUES (?1, ?2, ?3)').bind(weekStart(today), user.id, body.ad).run();
  return unicornState(ctx);
}
