// Accounts: password keys, recovery codes, sessions and rate limits.
//
// Passwords never reach the server. The app stretches each password in the browser
// with PBKDF2-SHA256 (600,000 rounds, salted with the nickname) into a 256-bit key
// and sends only that key. The server keeps a salted SHA-256 of the key. Because the
// key is long and random, one fast hash is enough here, and sign-in stays well within
// the CPU limits of Cloudflare's free plan. Someone who copied the database would still
// have to run the full 600,000 rounds for every password they wanted to guess.

const encoder = new TextEncoder();
const DAY_MS = 86400000;
const SESSION_DAYS = 60;
const COOKIE = '__Host-sid';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes in base64url (sessions and password keys)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no 0/O, 1/I/L or U, so codes are easy to copy

const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const toBase64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));

export async function sha256(text) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

// Compares two strings in time that does not depend on where they differ.
export function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Password keys */

export const isPasswordKey = key => typeof key === 'string' && TOKEN_PATTERN.test(key);

export async function newPassword(key) {
  const salt = toHex(randomBytes(16));
  return { salt, hash: await sha256(`pass:${salt}:${key}`) };
}

export async function checkPassword(user, key) {
  return sameString(await sha256(`pass:${user.pass_salt}:${key}`), user.pass_hash);
}

/* Recovery codes: 16 characters, shown once, the only way back in without the password. */

export function newRecoveryCode() {
  const chars = [];
  while (chars.length < 16) {
    for (const b of randomBytes(24)) {
      // 240 is the largest multiple of 30 below 256, so every character is equally likely.
      if (b < 240 && chars.length < 16) chars.push(CODE_ALPHABET[b % 30]);
    }
  }
  return chars.join('').match(/.{4}/g).join('-');
}

export const normalizeCode = code => (typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');
export const hashRecoveryCode = code => sha256('recovery:' + normalizeCode(code));

/* Sessions: a random token in an HttpOnly cookie, stored as a hash. */

export async function createSession(db, userId, now) {
  const token = toBase64url(randomBytes(32));
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)')
    .bind(await sha256('session:' + token), userId, now + SESSION_DAYS * DAY_MS)
    .run();
  return sessionCookie(token);
}

export const sessionCookie = token =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;

export const clearedCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function readToken(request) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === COOKIE) {
      const value = part.slice(at + 1).trim();
      return TOKEN_PATTERN.test(value) ? value : null;
    }
  }
  return null;
}

export async function findSession(db, request, now) {
  const token = readToken(request);
  if (!token) return null;
  const tokenHash = await sha256('session:' + token);
  const row = await db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?1').bind(tokenHash).first();
  if (!row || row.expires_at <= now) return null;
  return { token, tokenHash, userId: row.user_id, expiresAt: row.expires_at };
}

// Keeps active members signed in: after a week, the session gets a fresh 60 days.
export async function renewIfOld(db, session, now) {
  if (session.expiresAt - now > (SESSION_DAYS - 7) * DAY_MS) return null;
  await db.prepare('UPDATE sessions SET expires_at = ?2 WHERE token_hash = ?1')
    .bind(session.tokenHash, now + SESSION_DAYS * DAY_MS)
    .run();
  return sessionCookie(session.token);
}

/* Rate limits: at most `limit` hits per key within a window. */

export async function allow(db, key, limit, windowMs, now) {
  const row = await db.prepare(
    `INSERT INTO rate_limits (key, window_start, hits) VALUES (?1, ?2, 1)
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE hits + 1 END,
       window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END
     RETURNING hits`
  ).bind(key, now, windowMs).first();
  return !row || row.hits <= limit;
}

// Removes expired sessions and old rate-limit counters. Cheap; runs on sign-up and log-in.
export async function sweep(db, now) {
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now),
    db.prepare('DELETE FROM rate_limits WHERE window_start <= ?1').bind(now - DAY_MS)
  ]);
}
