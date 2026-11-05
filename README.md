# iAmUnemployed

**Unemployed? Take a number.**

A community for people between jobs. Count your days, collect ridiculous titles, and celebrate when someone escapes.

### 👉 [Try the app: iamunemployed.pages.dev/app](https://iamunemployed.pages.dev/app/)

Pick a nickname and a password and you're in. No email, no real name.

This repository holds the waitlist website, the app with its server and database, and the early design work.

## What's inside

| Path | What it is |
|---|---|
| `site/` | Everything visitors load: the waitlist page, the privacy page, and the app. This is the folder Cloudflare Pages publishes. |
| `site/app/` | The app: account, daily check-in, leaderboards, feed, games. It saves everything through the API. |
| `functions/` | Tells Cloudflare Pages to send every `/api/*` request to the server code. |
| `server/` | The API (`app.js`), accounts and sessions (`auth.js`) and the database tables (`db.js`). |
| `dev/` | A local server and automated checks, for working on a computer without a Cloudflare account. |
| `docs/proposal.html` | The full concept: the meme leaderboard, shareable cards, the "I Escaped" moment, the feed, humor rules, business model and rollout. |
| `docs/odigos-dimosieusis.md` | Step-by-step publishing guide, in Greek. |
| `prototype/app.html` | The clickable prototype in a phone frame. It saves only in the browser and stays as the design reference. |
| `prototype/landing-preview.html` | The waitlist page as built for the claude.ai preview. The live version is `site/index.html`. |

Everything is plain HTML, CSS and JavaScript. There is nothing to install or build.

## How the app works

- The app at `/app/` talks to the API at `/api/*`, which runs on Cloudflare Pages Functions.
- Data lives in a Cloudflare D1 (SQLite) database bound to the project as `DB`. The tables are created on the first request, and new steps added to `server/db.js` run the same way.
- Members sign up with a nickname and a password. The browser stretches the password with PBKDF2-SHA256 (600,000 rounds, salted with the nickname) and sends only the result, so the server never receives the password. The server stores a salted SHA-256 of that key.
- A one-time recovery code, shown at sign-up, resets a forgotten password. There is no email anywhere in the app.
- Sessions are `HttpOnly`, `Secure`, `SameSite=Lax` cookies. Only a hash of each session token is stored.
- Requests that change data must be JSON from the same site. Sign-ups, log-ins, password resets, posts and reports are rate-limited, and moves are capped per day.
- Anonymous posts carry no nickname, day count or escapee flag in any API response.
- Three reports from different members hide a post. Nicknames listed in the `ADMIN_NICKS` environment variable (comma-separated) can remove any post.
- Members can download everything stored about them and delete their account from the Me tab.

The API routes are listed at the top of `server/app.js`.

## Before launch

- `site/index.html`: put the Google Form link in `WAITLIST_URL`, and replace `YOUR-DOMAIN` in the `og:image` tag.
- `site/privacy.html`: fill in the highlighted placeholders (name, city, contact email).

## Publishing

Connect this repository to Cloudflare Pages with these build settings:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `site` |

Then give the app its database:

1. Create a D1 database, for example `iamunemployed`.
2. In the Pages project, add a D1 binding with the variable name `DB` that points to it (Settings → Bindings).
3. Deploy again. `https://your-domain/api/health` should answer `{"ok":true,"schema":1}`.
4. Optional: add an `ADMIN_NICKS` environment variable with your nickname.

Every push to `main` then updates the live site. Uploading the `site` folder by hand publishes only the pages, without the API or the database.

The full walkthrough, including the domain and the waitlist form, is in [`docs/odigos-dimosieusis.md`](docs/odigos-dimosieusis.md).

## Working on it locally

You need Node.js 22.13 or newer, which has SQLite built in. There is nothing else to install.

```bash
node dev/local-server.mjs
```

This serves the whole site at http://localhost:8788 (the app is at `/app/`), with a SQLite file in `.data/` standing in for D1. Add `--fresh` to start with an empty database.

```bash
node dev/api-test.mjs
```

This runs the automated checks of the API against a fresh database in memory.
