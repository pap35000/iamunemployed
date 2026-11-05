# iAmUnemployed

**Unemployed? Take a number.**

A community for people between jobs. Count your days, collect ridiculous titles, and celebrate when someone escapes.

This repository holds the waitlist website and the early design work.

## What's inside

| Path | What it is |
|---|---|
| `site/` | The waitlist website. This is the only folder that gets published. |
| `docs/proposal.html` | The full concept: the meme leaderboard, shareable cards, the "I Escaped" moment, the feed, humor rules, business model and rollout. |
| `docs/odigos-dimosieusis.md` | Step-by-step publishing guide, in Greek. |
| `prototype/app.html` | Clickable prototype of the app in a phone frame. |
| `prototype/landing-preview.html` | The waitlist page as built for the claude.ai preview. The live version is `site/index.html`. |

Everything is plain HTML, CSS and JavaScript, so there is nothing to install or build. Open any `.html` file in a browser to see it.

## Before launch

- `site/index.html`: put the Google Form link in `WAITLIST_URL`, and replace `YOUR-DOMAIN` in the `og:image` tag.
- `site/privacy.html`: fill in the highlighted placeholders (name, city, contact email, host).

## Publishing

Connect this repository to Cloudflare Pages with these build settings:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `site` |

Every push to `main` then updates the live site. The full walkthrough, including the domain and the waitlist form, is in [`docs/odigos-dimosieusis.md`](docs/odigos-dimosieusis.md).
