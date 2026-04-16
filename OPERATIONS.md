# SleepMedic Operations Runbook

## Stack at a glance

| Layer | What | Where | How it runs |
|---|---|---|---|
| Blog site | Static HTML + GA4 | `sleepmedic.co` via GitHub Pages | Push to `main` deploys |
| Weekly pipeline | 10-stage Gemini blog generator | GitHub Actions | `weekly-blog-draft-auto.yml` cron Mon+Thu 9am MT |
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

## Disaster recovery

**Pi dies / SD card corrupts.** New Pi: install Node 20+, pm2, cloudflared. Clone `sleepmedic-blog`. Copy `.env` from 1Password (or rebuild: new Resend key, new Cloudflare tunnel). `pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`. Transfer tunnel creds from old Pi or create fresh tunnel and re-route DNS.

**Cloudflare tunnel drops.** `sudo systemctl restart cloudflared`. If DNS route lost: `cloudflared tunnel route dns sleepmedic-pi pi.sleepmedic.co`.

**Resend domain unverified.** Log into Resend, re-run verify. Until fixed, newsletter sends queue silently.

**GA4 not tracking.** Confirm `G-717M9L2RTM` is live at `view-source:sleepmedic.co`. Check property sleepmedic-90416 > Data streams > SleepMedic Blog is receiving hits in DebugView.
