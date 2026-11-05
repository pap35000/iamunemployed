// Helpers the API shares: JSON responses, errors, local dates, input checks, and the
// fixed lists (moods, moves, categories) that requests are checked against.
// The app keeps its own copy of these lists in site/app/app.js. Keep the two in step.

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function fail(status, code, message) {
  throw new HttpError(status, code, message);
}

export function json(data, status = 200, cookies = []) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

/* Dates are plain YYYY-MM-DD strings in the member's own time zone. */

const DAY_MS = 86400000;

export function isYmd(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

const dayNumber = ymd => Math.round(Date.parse(ymd + 'T00:00:00Z') / DAY_MS);
const fromDayNumber = n => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (ymd, n) => fromDayNumber(dayNumber(ymd) + n);
export const diffDays = (from, to) => dayNumber(to) - dayNumber(from);

// The Monday of the week that contains the date.
export function weekStart(ymd) {
  const n = dayNumber(ymd);
  const weekday = new Date(n * DAY_MS).getUTCDay(); // 0 is Sunday
  return fromDayNumber(n - ((weekday + 6) % 7));
}

// The app sends the member's local date. It is trusted only within a day of the
// UTC date, which covers every time zone.
export function localToday(request, now) {
  const utc = new Date(now).toISOString().slice(0, 10);
  const claimed = request.headers.get('X-Local-Date');
  return isYmd(claimed) && Math.abs(diffDays(utc, claimed)) <= 1 ? claimed : utc;
}

/* Input */

// One line of text: no control characters, single spaces, at most `max` characters.
export function oneLine(value, max) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(clean).slice(0, max).join('').trim();
}

// A post keeps its line breaks (at most one empty line in a row) and loses other control characters.
export function postText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function flag(value) {
  if (typeof value !== 'boolean') fail(400, 'bad_input', 'Expected true or false.');
  return value ? 1 : 0;
}

/* Nicknames: 3 to 20 letters, numbers, dots, dashes or underscores. Unique regardless of case. */

export const NICK_PATTERN = /^[\p{L}\p{N}_.\-]{3,20}$/u;
export const readNick = value => (typeof value === 'string' ? value.normalize('NFC').trim() : '');
export const nickKeyOf = nick => nick.normalize('NFC').toLowerCase();
export const RESERVED_NICKS = new Set([
  'anonymous', 'admin', 'administrator', 'moderator', 'mod', 'support', 'system', 'you',
  'iamunemployed', 'iwasunemployed'
]);

/* Fixed lists */

export const INDUSTRIES = ['Tech', 'Design', 'Marketing', 'Hospitality', 'Retail', 'Healthcare', 'Education', 'Finance', 'Other'];
export const COUNTRIES = ['US', 'UK', 'IE', 'CA', 'AU', 'GR', 'XX'];
export const CATEGORIES = ['Mental Health', 'Interviews', 'CVs & Résumés', 'Rejections', 'Benefits & Paperwork', 'Career Change', 'Wins', 'Memes'];
export const MOVES = ['applied', 'interview', 'course', 'coffee', 'workout', 'helped', 'rejected', 'ghosted'];
export const MOODS = ['awful', 'low', 'meh', 'okay', 'good'];
export const REACTIONS = { post: ['same', 'hug', 'haha'], escape: ['congrats', 'hug'], hiring: ['useful', 'congrats'] };
export const CLAIMABLE_BADGES = ['boss', 'speedrun', 'exposure'];
export const UNICORN_ADS = 3;
