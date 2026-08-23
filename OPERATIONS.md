# SleepMedic Operations

The single runbook. North star and strategy: `docs/2026-08-22-north-star-free-value-engine.md`.

## Runs automatically

| What | Where | When |
|---|---|---|
| Blog post generated + published | `.github/workflows/weekly-blog-draft-auto.yml` | Mondays 16:00 UTC |
| Site deploy | GitHub Pages | every push to `main` |
| RSS poll -> new-post newsletter | Pi | every 30 min |
| Subscriber-list backup email | Pi -> `ADMIN_EMAIL` | daily |
| Discord notifications (subs, plan leads, new posts, briefs) | Pi | on event |

The pipeline is 12 stages (Gemini). It **hard-fails** on grounding failure and on any paragraph
with a numeric/research claim and no inline citation — a failed run publishes nothing and opens
a GitHub issue.

## Weekly human rhythm

1. **Monday** — pipeline post lands on its own. Confirm the run was green.
2. **Weekly brief** — draft it, propose it, tap approve in Discord (see below).
3. **Every ~2 weeks** — one pillar guide (`/guides/`, `/schedules/`).
4. **Ongoing** — log practitioner tips into `docs/field-tips.md` as Jaden hands them over.

## Deploy

**Site** (any HTML, script, or doc change):
```bash
git push origin main          # GitHub Pages picks it up
```

**Pi service** (anything under `pi-service/`):
```bash
ssh pi@raspberrypi.local 'cd ~/sleepmedic-blog && git pull && pm2 restart sleepmedic'
```

## The weekly brief

Never send blind — Discord's link crawler fetches URLs, so the service **never sends on GET**.

```bash
curl -X POST "https://pi.sleepmedic.co/brief-propose?key=$ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"subject":"...","html":"<p>...</p>"}'
```

Drops an approval card in Discord -> tap the link -> confirm page with a **Send it** / **Reject**
button (POST only). Drafts live in `docs/briefs/`.

Direct send, no approval: `POST /send-brief?key=$ADMIN_KEY` with the same body.
Test a brief: add `&test=1` — delivers ONLY to ADMIN_EMAIL with a [TEST] subject prefix, never the list.

## Where things live

| Path | What |
|---|---|
| `index.html`, `blog/`, `manual/`, `plan/`, `schedule/`, `schedules/`, `tools/`, `guides/`, `about/`, `privacy/` | the site |
| `pi-service/server.mjs` | subscribe, plan-lead, unsubscribe, briefs, RSS poll, backups, Discord |
| `scripts/generate-blog-post.mjs` | the 12-stage pipeline |
| `scripts/editorial/topics.yaml` | topic buckets (shift-worker only) |
| `VOICE.md` + `scripts/editorial/style_guidelines.md` | how it's written |
| `scripts/generate-sitemap.mjs` | sitemap — **static page list is inside the script** |
| `scripts/covers/make-cover.mjs` | deterministic SVG cover -> JPG (qlmanage + sips) |
| `scripts/research/` | transcript fetcher; output lands in `research/` (**gitignored, never commit or republish**) |
| `docs/briefs/`, `docs/field-tips.md` | brief drafts, tip inventory |

## SEO

- **New page? Add it to `STATIC_PAGES` in `scripts/generate-sitemap.mjs`** — it does not autodiscover.
  Then `node scripts/generate-sitemap.mjs`.
- Google Search Console: domain property, verified by Cloudflare DNS TXT.
- IndexNow key file: `c19c753ee9ad44ea99bf10b202e9f242.txt` at repo root. After a big content push,
  ping it with **curl** (this Mac's system Python has no CA bundle — urllib will fail).
- `llms.txt` at root for LLM crawlers.

## Emergency

```bash
curl https://pi.sleepmedic.co/health                      # {"status":"ok","subscribers":N}
ssh pi@raspberrypi.local 'pm2 restart sleepmedic'         # service wedged
ssh pi@raspberrypi.local 'pm2 logs sleepmedic --lines 50' # why
sudo systemctl restart cloudflared                        # pi.sleepmedic.co unreachable
```

**Lost subscribers?** The daily backup email to `ADMIN_EMAIL` is the off-device copy — search the
inbox for `[backup] SleepMedic subscribers`. `pi-service/subscribers.json` is gitignored and exists
only on the Pi.

**Pipeline failed?** It opens a GitHub issue with the run link. Grounding and citation failures are
by design — fix the source, rerun:
```bash
gh workflow run weekly-blog-draft-auto.yml
```

## Config

Pi `.env` (mode 600, never committed): `RESEND_API_KEY`, `FROM_EMAIL`, `ADMIN_KEY`, `ADMIN_EMAIL`,
`DISCORD_WEBHOOK_URL`, `PORT=3847`.
GitHub repo secret: `GEMINI_API_KEY`.
Analytics: GA4 `G-717M9L2RTM` (see ANALYTICS.md).
