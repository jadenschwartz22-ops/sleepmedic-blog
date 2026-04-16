# SleepMedic A/B — Voice and Style Testing

Publish across a wide range of tones, lengths, vehicles, and literary devices. Tag every post against a fixed taxonomy. Join against GA4 metrics. Let the data tell us which combinations earn attention.

Nothing in this system modifies the existing blog pipeline. It sits alongside it.

---

## Where to look (the TL;DR)

**The dashboard** — a static HTML page that renders tag distributions and (when GA4 is wired) pivot tables ranking every tag dimension against every metric.

- File: `blog/ab-dashboard.html`
- Live URL once pushed: `https://sleepmedic.co/blog/ab-dashboard.html` (marked `noindex`)
- Regenerated every Monday at 10 AM MT by [`.github/workflows/ab-weekly-report.yml`](.github/workflows/ab-weekly-report.yml)
- Also printed as a Markdown summary on the workflow run page itself — GitHub > Actions > A/B Weekly Report > latest run > Summary

**The Actions summary** — every run of a tag/report workflow prints a concise pivot table to GitHub's workflow summary. No local tooling needed; read it in your browser.

**Raw data** — `blog/ab-tags.json` (what got classified) and `blog/ab-analytics.json` (join of tags × GA4 metrics). Both committed to the repo.

---

## What runs automatically

1. **Every blog publish** → `A/B Tag Posts` workflow auto-triggers after `Weekly Blog - Fully Automated` finishes. It tags the new post and commits `blog/ab-tags.json`.
2. **Every Monday 10am MT** → `A/B Weekly Report` fetches the last 90 days of GA4 data, joins it with tags, rebuilds `blog/ab-dashboard.html`, commits it.
3. **Manual trigger any time** → GitHub > Actions > A/B Weekly Report > Run workflow. Gives you an immediate refresh.

---

## One-time setup

### 1. Backfill tags for every existing post

Go to GitHub > Actions > **A/B Tag Posts** > Run workflow. Runs `backfill-tags.mjs` against every post in `posts-index.json`, classifies each via Gemini (~2s/post, ~45s total for ~20 posts). Commits `blog/ab-tags.json`.

Leave "force" off unless you want to re-tag already-tagged posts.

### 2. Wire GA4 (required for real A/B insight — otherwise you only see tag distributions, not which tags win)

Add three GitHub repo secrets: Settings > Secrets and variables > Actions > New repository secret.

| Secret | Value |
|---|---|
| `GA4_PROPERTY_ID` | The numeric property ID, not the `G-` stream ID. Find at GA4 > Admin > Property details. Looks like `532856345`. |
| `GA4_CLIENT_EMAIL` | Service account email from a Google Cloud JSON key. See below. |
| `GA4_PRIVATE_KEY` | Private key from the same JSON, with newlines literal. See below. |

#### Creating the service account (5 min)

1. Google Cloud Console > IAM & Admin > Service Accounts > Create
2. Name it `sleepmedic-ga4-reader`, skip the optional permission steps
3. Click the created account > Keys tab > Add Key > Create new key > JSON. Download it.
4. In GA4: Admin > Property Access Management > + > Add user. Paste the service account email (from JSON `client_email`). Grant **Viewer** role.
5. Add GitHub secrets:
   - `GA4_PROPERTY_ID`: the numeric ID
   - `GA4_CLIENT_EMAIL`: from JSON `client_email`
   - `GA4_PRIVATE_KEY`: from JSON `private_key`, **keep the `\n` escape sequences as literal `\n`** (GitHub Actions preserves them and `fetch-ga4.mjs` unescapes)

6. Actions > A/B Weekly Report > Run workflow. Dashboard now includes pivots.

### 3. (Optional) Mark GA4 events as "Key events"

Per `ANALYTICS.md`, after the first traffic hits the new stream, mark these events as Key events in GA4 > Admin > Events so they show up in Reports > Conversions:

- `blog_post_view`
- `newsletter_subscribe`
- `app_interest_click`
- `app_interest_email`

`fetch-ga4.mjs` pulls these events regardless of the Key event toggle, so this is cosmetic — but it unlocks GA4's own funnel tooling.

---

## Manual workflow (if you ever need it locally)

```bash
# Backfill or retag
node scripts/ab/backfill-tags.mjs
node scripts/ab/tag-post.mjs <slug>

# Join GA4 — either via the API (preferred) or CSV exports
node scripts/ab/fetch-ga4.mjs --days 90          # API path
node scripts/ab/join-ga4.mjs pages.csv events.csv # CSV path

# Build dashboard (HTML) or print pivots to terminal
node scripts/ab/build-dashboard.mjs
node scripts/ab/pivot.mjs --metric subscribe_rate
node scripts/ab/pivot.mjs --metric avg_engagement_seconds --dim energy,length_bucket,devices
```

Metrics: `views`, `avg_engagement_seconds`, `newsletter_subscribes`, `app_interest_clicks`, `subscribe_rate`, `app_click_rate`.

---

## The taxonomy

Every post gets classified against these dimensions.

| Field | Values |
|---|---|
| `energy` | scientist, monk, warrior, princess, hybrid |
| `voice_intensity` | 0.5, 0.7, 1.0 |
| `opening_vehicle` | scene, claim, image, question, quote, data, confession, literary_ref |
| `closing_vehicle` | question, imperative, reframe, quiet_stop, callback, self_aware, checklist |
| `length_bucket` | flash (<350), short (<600), medium (<1000), long (<1800), epic (1800+) |
| `devices` | anaphora, catalog, self_interrupt, braided_register, extended_metaphor, literary_ref, first_person_scene, list_structure, numbered_protocol, one_sentence_paragraph, colon_reveal, em_dash_pivot |
| `topic_cluster` | circadian, hygiene, parenting, shift_work, philosophy, biology, nutrition, environment, tech, supplements, conditions, mental_health |
| `hook_type` | pain, curiosity, permission, challenge, mystery, validation |
| `cta_type` | download, email, share, none |
| `format` | Story-First, Science-First, Myth-Busting, Field Manual, Q&A, History/Philosophy Lens |

Add values only when real data shows something doesn't fit. Edit `SCHEMA` in `scripts/ab/tag-schema.mjs`.

---

## How to read the dashboard

For each dimension, you see the ranked values with `n` (sample size), `mean`, and `total`.

- **Rate metrics** (`subscribe_rate`, `avg_engagement_seconds`): sort by `mean`.
- **Count metrics** (`views`, `newsletter_subscribes`): sort by `total`.
- **Ignore any bucket with `n < 5`** — not enough signal.
- Winners compound. If `monk × long × literary_ref` wins on three metrics, write more of those.

The **tag distributions** section shows which buckets you've under-shipped. An empty bucket means zero data — go fill it.

---

## What counts as a real finding

Not "this post did well." N=1 is noise.

Real findings look like:
- *"Monk posts (n=8) average 2.3× the engagement time of warrior posts (n=11)."*
- *"Confession openings (n=6) subscribe at 3.1% vs 1.2% for data openings (n=9)."*
- *"Long-bucket posts get more views; medium-bucket posts get more subscribes."*
- *"Posts with `braided_register` in their devices outperform posts without, holding topic constant."*

You need ~15–25 tagged posts across varied buckets before pivots are meaningful. Until then, the dashboard shows distributions — useful for coverage, not yet for conclusions.

---

## Parking lot (not yet wired)

- Per-post share counts (needs a share-count API integration)
- Headline A/B within a post (URL params + two-arm redirector)
- Reader-segment slicing (shift worker vs new parent) — needs on-site segmentation
- Generator steering toward under-represented buckets (read `ab-tags.json`, nudge topic selector)

Add when basic pivots surface obvious wins and you want sharper cuts.

---

## Files shipped

| File | Purpose |
|---|---|
| `scripts/ab/tag-schema.mjs` | Taxonomy, validators, length buckets |
| `scripts/ab/tag-post.mjs` | Classify one post by slug |
| `scripts/ab/backfill-tags.mjs` | Classify every untagged post |
| `scripts/ab/fetch-ga4.mjs` | Pull metrics from GA4 Data API |
| `scripts/ab/join-ga4.mjs` | Join CSV exports against tags (manual fallback) |
| `scripts/ab/build-dashboard.mjs` | Render `blog/ab-dashboard.html` |
| `scripts/ab/pivot.mjs` | CLI pivot tables (terminal output) |
| `.github/workflows/ab-tag-posts.yml` | Auto-tag after publish, manual trigger |
| `.github/workflows/ab-weekly-report.yml` | Weekly: fetch GA4, rebuild dashboard |
| `blog/ab-tags.json` | Tag store, keyed by slug |
| `blog/ab-analytics.json` | Joined metrics + tags |
| `blog/ab-dashboard.html` | The page you actually look at |
