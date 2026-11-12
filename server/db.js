// The database tables. They are created automatically on the first request, so a new
// Cloudflare D1 database only has to be bound to the Pages project as DB.
//
// To change the tables later: add the new statements to a new step in MIGRATIONS
// (never edit a step that has already run) and the next request applies it.

const MIGRATIONS = [
  // Step 1: the first version of the app.
  [
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,

    // One row per member. Passwords are never stored: see server/auth.js.
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      nick TEXT NOT NULL,
      nick_key TEXT NOT NULL UNIQUE,
      pass_salt TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      recovery_hash TEXT NOT NULL,
      industry TEXT NOT NULL,
      country TEXT NOT NULL,
      start_date TEXT NOT NULL,
      public_board INTEGER NOT NULL DEFAULT 0,
      calm INTEGER NOT NULL DEFAULT 0,
      mentor INTEGER NOT NULL DEFAULT 0,
      escaped INTEGER NOT NULL DEFAULT 0,
      sequel INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      last_checkin TEXT,
      game TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS users_legends ON users (public_board, escaped, start_date)',

    // Signed-in devices. Only a hash of each session token is kept.
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)',

    // Daily mood, one per member per day.
    `CREATE TABLE IF NOT EXISTS checkins (
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      mood TEXT NOT NULL,
      PRIMARY KEY (user_id, day)
    )`,

    // Logged moves (applied, interview, ...), counted per member, day and kind.
    `CREATE TABLE IF NOT EXISTS moves (
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      kind TEXT NOT NULL,
      n INTEGER NOT NULL,
      PRIMARY KEY (user_id, day, kind)
    )`,
    'CREATE INDEX IF NOT EXISTS moves_day ON moves (day)',

    // Every "I escaped". The id is the Escapee number.
    `CREATE TABLE IF NOT EXISTS escapes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      days INTEGER NOT NULL,
      role TEXT NOT NULL,
      wall INTEGER NOT NULL,
      day TEXT NOT NULL,
      post_id INTEGER,
      created_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS escapes_user ON escapes (user_id)',

    // The feed. kind is post, escape or hiring. hidden is set after several reports.
    `CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      cat TEXT NOT NULL,
      body TEXT NOT NULL,
      anon INTEGER NOT NULL,
      days INTEGER NOT NULL,
      escapee INTEGER NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS posts_user ON posts (user_id)',
    'CREATE INDEX IF NOT EXISTS posts_cat ON posts (cat, id)',

    `CREATE TABLE IF NOT EXISTS reactions (
      post_id INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      PRIMARY KEY (post_id, user_id, kind)
    )`,
    'CREATE INDEX IF NOT EXISTS reactions_user ON reactions (user_id)',

    `CREATE TABLE IF NOT EXISTS reports (
      post_id INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, user_id)
    )`,
    'CREATE INDEX IF NOT EXISTS reports_user ON reports (user_id)',

    // Unicorn of the Week: one vote per member per week (week = its Monday).
    `CREATE TABLE IF NOT EXISTS votes (
      week TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      ad INTEGER NOT NULL,
      PRIMARY KEY (week, user_id)
    )`,
    'CREATE INDEX IF NOT EXISTS votes_user ON votes (user_id)',

    // Counters for rate limits (sign-ups, log-in attempts, posts).
    `CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      hits INTEGER NOT NULL
    )`
  ],

  // Step 2: a weekly application goal each member can set for themselves (0 = no goal).
  [
    'ALTER TABLE users ADD COLUMN week_goal INTEGER NOT NULL DEFAULT 0'
  ]
];

export const SCHEMA_VERSION = MIGRATIONS.length;

let ready = null;

// Runs the migrations once per server instance. Concurrent first requests share one run.
export function ensureSchema(db) {
  if (!ready) {
    ready = migrate(db).catch(err => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

// Tests that open a fresh database in the same process call this first.
export function forgetSchema() {
  ready = null;
}

async function migrate(db) {
  let version = 0;
  try {
    const row = await db.prepare("SELECT value FROM meta WHERE key = 'schema'").first();
    version = row ? Number(row.value) || 0 : 0;
  } catch (err) {
    version = 0; // no meta table yet: a brand-new database
  }
  for (let step = version; step < MIGRATIONS.length; step++) {
    await db.batch([
      ...MIGRATIONS[step].map(sql => db.prepare(sql)),
      db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
        .bind(String(step + 1))
    ]);
  }
}
