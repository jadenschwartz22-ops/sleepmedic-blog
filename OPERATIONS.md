# SleepMedic Operations Runbook

## Stack at a glance

| Layer | What | Where | How it runs |
|---|---|---|---|
| Blog site | Static HTML + GA4 | `sleepmedic.co` via GitHub Pages | Push to `main` deploys |
| Weekly pipeline | 12-stage Gemini blog generator | GitHub Actions | `weekly-blog-draft-auto.yml` cron Mon+Thu 9am MT |
| Pi service | Newsletter + app-interest + RSS watcher + Discord | `raspberrypi.local:3847` | pm2 + systemd |
| Public API | Cloudflare Tunnel | `pi.sleepmedic.co` | cloudflared systemd service |
| Email | Resend | `blog@sleepmedic.co` | API, domain verified |
| Analytics | GA4 | Property `sleepmedic-90416`, ID `G-717M9L2RTM` | gtag.js in all pages |

## Pi: common operations

SSH: `ssh pi@raspberrypi.local` (password: `rasberry`).

```bash
pm2 list                                # show status
pm2 logs sleepmedic --lines 50          # tail logs
pm2 restart sleepmedic                  # restart after config change
pm2 save                                # persist restart list across reboot
systemctl status cloudflared            # tunnel status
sudo systemctl restart cloudflared      # restart tunnel
```

Config lives in `~/sleepmedic-blog/pi-service/.env` (mode 600). Keys: `RESEND_API_KEY`, `FROM_EMAIL`, `ADMIN_KEY`, `DISCORD_WEBHOOK_URL`, `PORT=3847`.

To pull latest changes and restart:

```bash
cd ~/sleepmedic-blog && git pull && pm2 restart sleepmedic
```

## Pi: admin endpoints

Replace `<KEY>` with `ADMIN_KEY` from `.env`.

```bash
curl https://pi.sleepmedic.co/health
curl "https://pi.sleepmedic.co/subscribers?key=<KEY>"
curl "https://pi.sleepmedic.co/app-interest/stats?key=<KEY>"
curl "https://pi.sleepmedic.co/stats?key=<KEY>"
```

## Blog pipeline: common operations

Trigger a run manually:

```bash
gh workflow run weekly-blog-draft-auto.yml -R jadenschwartz22-ops/sleepmedic-blog
```

Tail the latest run:

```bash
gh run list -R jadenschwartz22-ops/sleepmedic-blog --workflow=weekly-blog-draft-auto.yml --limit 1
gh run watch <run-id> -R jadenschwartz22-ops/sleepmedic-blog
```

Failure path: pipeline opens a GitHub issue titled `Blog FAILED - <date>` which emails you. Check the workflow run link in the issue body.

## Secrets inventory

| Secret | Location | What it does |
|---|---|---|
| `GEMINI_API_KEY` | GH repo secret | Blog generation + image gen |
| `RESEND_API_KEY` | Pi `.env` | Outbound email |
| `ADMIN_KEY` | Pi `.env` | Auth for `/subscribers`, `/stats`, `/app-interest/stats` |
| `DISCORD_WEBHOOK_URL` | Pi `.env` | Notifications for new posts + subscribers + app interest |
| Cloudflare tunnel creds | `/home/pi/.cloudflared/*.json` | Tunnel identity |

## Routine checks (weekly)

1. `pm2 list` on Pi -- sleepmedic `online`, uptime > 0.
2. `curl https://pi.sleepmedic.co/health` -- `{"status":"ok"}`.
3. Last GitHub Actions run on weekly pipeline is green.
4. GA4 Realtime shows hits on any recent blog post.
5. Discord channel has a "New post detected" message within the last 7 days.

## SEO: pillar posts, category pages, and the generator

### Adding a new pillar post

1. Write or generate the post and save it to `blog/posts/<slug>.html`.
2. In `blog/posts-index.json`, find the entry for that slug (or add one manually) and set `"pillar": true` and `"audience": "<category-slug>"`.
3. `generate-posts-index.mjs` preserves these fields across regenerations -- they will not be overwritten on the next pipeline run.
4. Link to the pillar from the relevant category page's `.pillar-card` `href`.

### Adding a new category page

1. Copy an existing page, e.g. `cp blog/shift-workers/index.html blog/firefighters/index.html`.
2. Update: directory name, `<title>`, `<meta name="description">`, `<h1>`, hero `<p>`, JSON-LD `name`/`description`/`url`, pillar card copy, app banner copy, newsletter source string in `gtag` call, and the audience filter value in `loadPosts()` (`p.audience === 'firefighters'`).
3. Add `blog/firefighters/` to the sitemap by editing `scripts/generate-sitemap.mjs` if it doesn't auto-pick up new dirs.

### How the generator preserves pillar/audience on regen

`scripts/generate-posts-index.mjs` loads the existing `posts-index.json` before scanning HTML files. It builds a slug-keyed lookup and copies `pillar` and `audience` from the old entry onto the freshly-extracted metadata. It also preserves entries with no matching HTML file (e.g., pillar post placeholders not yet generated). Manual edits to these fields in `posts-index.json` are therefore safe and persist through pipeline runs.

### FAQ/HowTo schema

The pipeline auto-injects these; no manual steps needed. See ANALYTICS.md for how to verify.

## Disaster recovery

**Pi dies / SD card corrupts.** New Pi: install Node 20+, pm2, cloudflared. Clone `sleepmedic-blog`. Copy `.env` from 1Password (or rebuild: new Resend key, new Cloudflare tunnel). `pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`. Transfer tunnel creds from old Pi or create fresh tunnel and re-route DNS.

**Cloudflare tunnel drops.** `sudo systemctl restart cloudflared`. If DNS route lost: `cloudflared tunnel route dns sleepmedic-pi pi.sleepmedic.co`.

**Resend domain unverified.** Log into Resend, re-run verify. Until fixed, newsletter sends queue silently.

**GA4 not tracking.** Confirm `G-717M9L2RTM` is live at `view-source:sleepmedic.co`. Check property sleepmedic-90416 > Data streams > SleepMedic Blog is receiving hits in DebugView.
