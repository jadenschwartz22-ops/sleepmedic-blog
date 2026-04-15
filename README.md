# SleepMedic Blog

Blog-first site at [sleepmedic.co](https://sleepmedic.co). The blog is the main destination; the iOS app is promoted via a tracked "Download App" smokescreen so we can measure real interest before launch.

## Architecture

Two independent systems:

```
                    sleepmedic.co (GitHub Pages)
                              |
         +--------------------+---------------------+
         |                                          |
         v                                          v
  GitHub Actions                               Raspberry Pi
  (content pipeline)                       (pi-service/server.mjs)
  - Weekly blog generation                 - Newsletter signup + send (Resend)
  - Gemini + image gen                     - RSS polling + distribution
  - Commits posts to repo                  - App-interest tracker (smokescreen)
  - Triggers GitHub Pages deploy           - Discord notifications
```

**GitHub Actions = writes posts. Pi = distributes + tracks interactions.**
These do not depend on each other at runtime. If the Pi is offline the blog still ships new posts; they just won't be emailed until the Pi catches up.

## Autoblog: GitHub Actions

Runs every Monday at 9am MT (`.github/workflows/weekly-blog-draft-auto.yml`).

**10-stage multi-agent pipeline** (`scripts/generate-blog-post.mjs`):

1. **Topic Selector** - 50/50 split: predefined buckets from `topics.yaml` or LLM-generated topics via search grounding.
2. **Researcher** (Gemini + Google Search) - Real studies, stats, mechanisms. Identifies SEO angles.
3. **Planner** (Gemini 2.5 Flash) - Outline with varied formats (Story-First, Myth-Busting, Q&A, etc.)
4. **Section Writers** - One call per section, varied temperature.
5. **Assembler** - Join + inline image slot selection.
6. **Editor** - Polish, enforce 60+ banned AI-isms.
7. **Humanizer** - Conversational pass.
8. **Cross-Linker** - Reads `posts-index.json`, inserts 1-3 internal links.
9. **Image Generation** (gemini-2.5-flash-image) - Cover + 1-2 inline images.
10. **HTML Builder** - Template assembly + metadata + GA4.

Workflow creates a PR, auto-merges, commits history, and posts a summary issue.

## Pi Distribution Service

Runs 24/7 on a Raspberry Pi via pm2. See `pi-service/server.mjs`.

### Endpoints

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /subscribe` | public | Newsletter signup |
| `POST /unsubscribe` | public | Unsubscribe by email |
| `POST /app-interest` | public | Records smokescreen click or email submit |
| `GET /health` | public | Liveness check |
| `GET /subscribers?key=ADMIN_KEY` | admin | List newsletter subscribers |
| `GET /app-interest/stats?key=ADMIN_KEY` | admin | Click count, emails, last 50 events |
| `GET /stats?key=ADMIN_KEY` | admin | Unified snapshot of everything |
| `POST /trigger-send?key=ADMIN_KEY` | admin | Manual newsletter trigger |

### Env vars

```
PORT=3847
RESEND_API_KEY=...               # newsletter sending
FROM_EMAIL="SleepMedic <blog@sleepmedic.co>"
ADMIN_KEY=...                    # gates /subscribers, /stats
DISCORD_WEBHOOK_URL=...          # optional; enables Discord pings
TWITTER_*                        # optional; posts to X on new post
```

### Install / run

```bash
cd pi-service
npm install
cp .env.example .env    # fill in keys
pm2 start server.mjs --name sleepmedic
pm2 save
```

## Download App Smokescreen

The app isn't shipped yet (for a few posts it links to a real App Store URL, but the iOS build is pre-launch). Every "Download App" button on the site is a tracked smokescreen.

### How it works

1. User clicks any `[data-app-interest]` element.
2. Browser fires **GA4 `app_interest_click`** event with a `location` param (e.g. `nav`, `footer`, `post-nav`, `post-cta`).
3. Browser POSTs to Pi `/app-interest` with `{ type: 'click', location, path, referrer }`. Pi increments `clicks` in `app-interest.json` and fires a **Discord webhook**.
4. Modal opens: "iOS app launching 2026. Drop your email and we'll let you know." (`assets/app-interest.js`)
5. If user submits email:
   - **GA4 `app_interest_email`** event with `email_domain`.
   - POST to Pi again with `{ type: 'email', email, location }`. Email is stored (deduped) in `app-interest.json` and fires a **second Discord webhook**.

### Discord notifications

Set `DISCORD_WEBHOOK_URL` on the Pi. You'll get two distinct message types:

```
[APP-INTEREST] Click from /blog/posts/xyz — location: post-nav — total clicks: 47
[APP-INTEREST] Email captured foo@bar.com — location: nav — total emails: 12
[NEWSLETTER] New subscriber foo@bar.com — total: 89
```

To create the webhook: Discord channel → Edit Channel → Integrations → Webhooks → New Webhook → copy URL.

### Adding a new CTA

Just add `data-app-interest="location-name"` to any button or link. The shared script (`/assets/app-interest.js`) binds it automatically.

```html
<button data-app-interest="sidebar">Download App</button>
<a href="#" data-app-interest="inline-cta">Get the app</a>
```

## Analytics & Tracking

Three layers, each useful for a different question:

| Layer | What it answers | Where to look |
|-------|-----------------|---------------|
| **GoatCounter** | Per-URL pageviews. Simple, cookie-free, visible on blog pages. | [jschwartz9.goatcounter.com](https://jschwartz9.goatcounter.com) |
| **GA4** (G-5H4073EG26) | Funnel: landing → blog card click → post view → scroll depth → app interest → newsletter. | [analytics.google.com](https://analytics.google.com) → Reports → Realtime / Engagement → Events |
| **Pi `/stats`** | Ground truth for conversions (actual emails captured, actual click counts). | `curl https://pi.sleepmedic.co/stats?key=ADMIN_KEY` |

### GA4 custom events fired site-wide

All events get standard GA4 params (`page_location`, `page_title`) automatically. Our custom ones:

| Event | Where | Params | Answers |
|-------|-------|--------|---------|
| `blog_post_view` | Every post page load | `slug`, `category`, `read_time`, `word_count` | Which posts are read? |
| `scroll_depth` | On post pages | `depth` (25/50/75/100), `slug` | Did readers finish? |
| `blog_card_click` | Landing + blog index | `link_url`, `location` | Which cards attract clicks? |
| `blog_filter` | Blog index | `category` | Which categories are explored? |
| `app_interest_click` | Any Download App button | `location`, `path` | How many want the app? |
| `app_interest_email` | Smokescreen modal submit | `location`, `email_domain` | How many convert click → email? |
| `newsletter_subscribe` | Follow.it form submit | `source`, `email_domain`, `slug` (if post) | Newsletter conversion rate |

### Reading the numbers

**"How many people want the app?"**
- GA4 → Realtime → Event count by name → `app_interest_click` (last 30 days)
- Or: `curl https://pi.sleepmedic.co/stats?key=$ADMIN_KEY` → `appInterest.clicks`

**"How many gave us an email?"**
- GA4 `app_interest_email` event count
- Or Pi `/stats` → `appInterest.emails`
- Full list: `curl https://pi.sleepmedic.co/app-interest/stats?key=$ADMIN_KEY`

**"Which blog posts convert best to app interest?"**
- GA4 → Explore → free-form → Dimension: Event name + page_location, Metric: Event count, filter event = `app_interest_click`.

**"What's my click-to-email conversion?"**
- GA4: `app_interest_email` count / `app_interest_click` count.

**"Which posts are actually being read vs just clicked?"**
- GA4 `blog_post_view` count vs `scroll_depth` (depth=75) count per `slug`.

### GA4 setup checklist

In GA4, mark these as **key events** (formerly "conversions"):
- `app_interest_click`
- `app_interest_email`
- `newsletter_subscribe`

Admin → Events → toggle "Mark as key event" for each.
Register custom dimensions for `location`, `slug`, `category` under Admin → Custom definitions → Custom dimensions (Event-scoped) so they appear in Explore reports.

## Site Structure

```
sleepmedic.co/                -> Landing page (blog-first, recent posts grid)
sleepmedic.co/blog/           -> Blog index (category filters, all posts, newsletter)
sleepmedic.co/blog/posts/     -> Individual posts (smokescreen nav + inline CTA)
sleepmedic.co/app/            -> Legacy; to be retired
sleepmedic.co/privacy/        -> Privacy policy
sleepmedic.co/assets/         -> Shared JS (app-interest smokescreen)
```

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Landing page (blog-first) |
| `blog/index.html` | Blog homepage |
| `blog/_template.html` | Post template (GA4 events, smokescreen, Follow.it) |
| `blog/_shared-styles.css` | Shared CSS |
| `assets/app-interest.js` | Shared smokescreen modal + tracking |
| `pi-service/server.mjs` | Pi service: newsletter + app-interest + RSS + Discord |
| `scripts/generate-blog-post.mjs` | Main 10-stage pipeline |
| `scripts/migrate-smokescreen.mjs` | One-off migrator for legacy posts |
| `scripts/editorial/topics.yaml` | 6 topic buckets (~83 seed topics) |
| `scripts/editorial/style_guidelines.md` | Editorial voice, rules |
| `scripts/content-memory-system.mjs` | Novelty scoring, phrase dedup |
| `scripts/generate-posts-index.mjs` | Regenerates `blog/posts-index.json` |
| `scripts/generate-rss-feed.mjs` | Regenerates `blog/feed.xml` |
| `scripts/check-duplicate-titles.mjs` | Jaccard similarity (70% threshold) |
| `scripts/monitor-blog-health.mjs` | Post frequency health check |
| `scripts/cleanup-posts.mjs` | Batch update nav, footer, og:image |
| `.github/workflows/weekly-blog-draft-auto.yml` | Weekly automation |

## Image Backfill (AI-QA loop)

Some posts launched without cover images, and some early AI-generated covers had logical defects (clock showing 3am with bright daylight outside, etc.). To fix this we run `scripts/backfill-images.mjs` with a **two-model QA loop**:

1. `gemini-2.5-flash-image` generates an image from a scene prompt + hard rules (no clocks, lighting must match time-of-day, no text, no faces).
2. `gemini-2.5-flash` (vision) reviews the output against a strict rubric and returns `{approved, issues, retry_hint}`.
3. If rejected, regenerate with the hint appended to the prompt.
4. **Hard cap: `MAX_ATTEMPTS=3`** (configurable). After that, keep the last image and log a warning — prevents runaway cost.

**Trigger via GitHub Actions** (uses the repo secret — no local key needed):

1. GitHub -> Actions -> **Backfill Cover Images** -> Run workflow.
2. Options:
   - `force` = `true` to regenerate ALL covers (use when cleaning up legacy AI-garbage covers).
   - `max_attempts` default 3.
3. The workflow generates images, commits them, regenerates `posts-index.json` + RSS, and pushes. GitHub Pages auto-deploys.

**Trigger locally** (if you have the key):

```bash
GEMINI_API_KEY=xxx node scripts/backfill-images.mjs            # only missing/broken
GEMINI_API_KEY=xxx node scripts/backfill-images.mjs --force    # regenerate everything
node scripts/backfill-images.mjs --dry-run                     # list targets, no API calls
```

**Cost ceiling**: ~$0.04 per image gen + ~$0.002 per QA call. Worst case for all 18 posts with 3 attempts each ~$2.30.

## Running Locally

```bash
npm install
GEMINI_API_KEY=xxx node scripts/generate-blog-post.mjs
node scripts/generate-posts-index.mjs
node scripts/generate-rss-feed.mjs
node scripts/monitor-blog-health.mjs
```

## Secrets

| Secret | Location | Used by |
|--------|----------|---------|
| `GEMINI_API_KEY` | GitHub repo secrets | Content pipeline |
| `RESEND_API_KEY` | Pi `.env` | Newsletter sending |
| `ADMIN_KEY` | Pi `.env` | Gates admin endpoints |
| `DISCORD_WEBHOOK_URL` | Pi `.env` | Realtime notifications |
| `TWITTER_*` | Pi `.env` | X posting (optional) |

## Cost

- Blog generation: ~$0.01-0.03 per post (Gemini 2.5 Flash + image gen)
- Pi hosting: $0 (self-hosted)
- Resend: free tier (3k emails/month)
- GA4 + GoatCounter: free
