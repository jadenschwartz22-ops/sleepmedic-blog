# SleepMedic

[sleepmedic.co](https://sleepmedic.co) — free, practical sleep resources for people who work
against the clock. Written by Jaden Schwartz, paramedic.

**The only metric that counts is email subscribers.** Strategy:
[docs/2026-08-22-north-star-free-value-engine.md](docs/2026-08-22-north-star-free-value-engine.md).

**Start here:** [OPERATIONS.md](OPERATIONS.md) — the runbook (what runs automatically, deploys,
the brief flow, emergencies). Other docs: [VOICE.md](VOICE.md) · [PRODUCT.md](PRODUCT.md) ·
[DESIGN.md](DESIGN.md) · [ANALYTICS.md](ANALYTICS.md).

## Pages

| Path | What |
|---|---|
| `/` | Landing |
| `/blog/` | Essays (weekly automated post + category pages) |
| `/manual/` | The field manual |
| `/plan/` | Quiz -> personalized plan, emailed free |
| `/schedule/` | Schedule Manager |
| `/schedules/` | 9 rotation pages (24-48, 48-96, Kelly, Dupont, Panama, 24-72, 3x12 days/nights, rotating) |
| `/tools/` | Caffeine cutoff, nap calculator |
| `/guides/` | Pillar guides (24-48, nights-3x12) |
| `/about/`, `/privacy/` | Author / policy |

`/app/` still exists but is retired — nothing in the funnel links to it.

## Architecture

Two independent systems. If the Pi is down the site still ships posts; they just aren't emailed yet.

```
sleepmedic.co (GitHub Pages, deploys on push to main)
        |
        +-- GitHub Actions -- writes posts (weekly Gemini pipeline, commits to repo)
        |
        +-- Raspberry Pi ---- distributes (newsletter, plan emails, RSS->email, Discord)
                              pi-service/server.mjs, pm2 `sleepmedic`, port 3847
                              public at pi.sleepmedic.co via Cloudflare Tunnel
```

## Commands

```bash
npm install

# Content
node scripts/generate-blog-post.mjs      # needs GEMINI_API_KEY (normally CI-only)
node scripts/generate-posts-index.mjs
node scripts/generate-rss-feed.mjs
node scripts/generate-sitemap.mjs        # add new pages to STATIC_PAGES inside the script first
node scripts/covers/make-cover.mjs

# Pipeline
gh workflow run weekly-blog-draft-auto.yml

# Deploy
git push origin main
ssh pi@raspberrypi.local 'cd ~/sleepmedic-blog && git pull && pm2 restart sleepmedic'
```

## Secrets

| Secret | Location | Used by |
|---|---|---|
| `GEMINI_API_KEY` | GitHub repo secret | Content pipeline |
| `RESEND_API_KEY` | Pi `.env` | Outbound email |
| `ADMIN_KEY` | Pi `.env` | Gates admin + brief endpoints |
| `ADMIN_EMAIL` | Pi `.env` | Daily subscriber backup |
| `DISCORD_WEBHOOK_URL` | Pi `.env` | Notifications + brief approval |

Never commit: `pi-service/.env`, subscriber/plan-lead JSON, or `research/` (transcript corpus —
local only, never republished).

## Cost

Gemini ~$0.01-0.03/post · Pi $0 (self-hosted) · Resend free tier (3k/mo) · GA4 free.
