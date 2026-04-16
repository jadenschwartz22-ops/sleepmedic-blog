# SleepMedic A/B — Voice and Style Testing

Publish across a wide range of tones, lengths, vehicles, and literary devices. Tag every post against a fixed taxonomy. Join against GA4 metrics. Let the data tell us which combinations earn attention.

**Readers never see the voice labels.** All A/B data lives under `/private/` — noindex, disallowed in robots.txt, never linked from the public site. The blog shows one unified SleepMedic voice externally. Internally we track which of the four voices is pulling.

Nothing in this system modifies the existing blog pipeline. It sits alongside it.

---

## Where to look (the TL;DR)

**The dashboard:** `private/ab-dashboard.html`

Open it locally after a `git pull` — the file lives in the repo but is disallowed from search and not linked from the site. Regenerated every Monday at 10 AM MT by `ab-weekly-report.yml`. Shows tag distributions always, plus pivot tables once GA4 is wired.

**The Actions summary:** GitHub > Actions > A/B Weekly Report > latest run > Summary

A concise markdown block with the top 5 posts by engagement and an energy × engagement mean table. Read in your browser, no file download.

**Raw data:**
- `private/ab-tags.json` — what got classified
- `private/ab-analytics.json` — join of tags × GA4 metrics (created on first GA4 run)

---

## Privacy

Three layers keep voice labels off the public site:

1. **Not linked.** Nothing in the public HTML references the dashboard, the tag file, or the analytics file.
2. **Disallowed in robots.txt.** `/private/` and each A/B file path are explicitly blocked.
3. **Noindex on the HTML.** `<meta name="robots" content="noindex, nofollow">` at the top of the dashboard.

None of this makes the files cryptographically private — anyone who types `sleepmedic.co/private/ab-dashboard.html` could still load it. If that matters, the right next step is moving the dashboard out of the static site entirely (e.g., a password-gated Cloudflare Pages project or a local-only artifact). For now the files are de-indexed and unlinked, which is the bar you set.

---

## What runs automatically

1. **Every blog publish** → `A/B Backfill` workflow auto-triggers after `Weekly Blog - Fully Automated` finishes. It tags the new post and commits `private/ab-tags.json`.
2. **Every Monday 10 AM MT** → `A/B Weekly Report` fetches 90 days of GA4 data, joins with tags, rebuilds `private/ab-dashboard.html`, commits.
3. **Manual trigger any time** → GitHub > Actions > A/B Weekly Report > Run workflow.

---

## One-time setup

### 1. Backfill tags for every existing post

Already done. 18 posts tagged at initial backfill. Re-run only if you add many posts or want to retag with `force`.

Manual trigger: GitHub > Actions > **A/B Backfill** > Run workflow.

### 2. Wire GA4 (required for pivot tables)

Add three GitHub repo secrets: Settings > Secrets and variables > Actions.

| Secret | Value |
|---|---|
| `GA4_PROPERTY_ID` | Numeric property ID. GA4 > Admin > Property details. Looks like `532856345`. |
| `GA4_CLIENT_EMAIL` | From a service account JSON key. See below. |
| `GA4_PRIVATE_KEY` | From the same JSON, `private_key` field. Keep the `\n` escape sequences literal. |

#### Creating the service account (5 min)

1. Google Cloud Console > IAM & Admin > Service Accounts > Create
2. Name it `sleepmedic-ga4-reader`, skip the optional permission steps
3. Open the created account > Keys tab > Add Key > Create new key > JSON. Download.
4. In GA4: Admin > Property Access Management > + > Add user. Paste the service account email (JSON `client_email`). Grant **Viewer** role.
5. Add GitHub secrets with the three values from the JSON.
6. Actions > A/B Weekly Report > Run workflow. Dashboard now includes pivots.

### 3. (Optional) Mark GA4 events as Key events

Per `ANALYTICS.md`, after the new stream has traffic, mark these in GA4 > Admin > Events:

- `blog_post_view`
- `newsletter_subscribe`
- `app_interest_click`
- `app_interest_email`

`fetch-ga4.mjs` pulls these regardless of the Key event toggle — this is cosmetic but unlocks GA4's own funnel tooling.

---

## Manual commands (local)

```bash
# Backfill or retag
node scripts/ab/backfill.mjs
node scripts/ab/classify.mjs <slug>

# Join GA4 — API path or CSV fallback
node scripts/ab/fetch-ga4.mjs --days 90
node scripts/ab/join-ga4.mjs pages.csv events.csv

# Dashboard or terminal pivots
node scripts/ab/build-dashboard.mjs
node scripts/ab/pivot.mjs --metric subscribe_rate
node scripts/ab/pivot.mjs --metric avg_engagement_seconds --dim energy,length_bucket,devices
```

Metrics: `views`, `avg_engagement_seconds`, `newsletter_subscribes`, `app_interest_clicks`, `subscribe_rate`, `app_click_rate`.

---

## The taxonomy

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

For each dimension, you see ranked values with `n`, `mean`, `total`.

- Rate metrics (`subscribe_rate`, `avg_engagement_seconds`): sort by `mean`.
- Count metrics (`views`, `newsletter_subscribes`): sort by `total`.
- Ignore any bucket with `n < 5`. Not enough signal.
- Winners compound. If `monk × long × literary_ref` wins on three metrics, write more of those.

---

## Current state (as of first backfill)

18 posts tagged. Heavy imbalance, which is the whole point — the taxonomy surfaced it:

- **Energy:** 16 scientist / 1 monk / 1 warrior / 0 princess / 0 hybrid
- **Voice intensity:** 17 at 0.7, 1 at 1.0, 0 at 0.5
- **Topic cluster:** 11 shift_work / 3 biology / 1 philosophy / 1 circadian
- **Opening vehicle:** 11 claim / 3 question / 3 scene / 1 data
- **Closing vehicle:** 13 checklist / 2 quiet_stop / 2 imperative / 1 reframe
- **Hook type:** 15 pain / 1 challenge
- **Format:** 7 Field Manual / 4 Science-First / 3 Myth-Busting / 1 History/Philosophy Lens

The blog is a scientist writing pain-hook checklists to shift workers. Fill the empty buckets to get A/B coverage.

---

## What counts as a real finding

- *"Monk posts (n=8) average 2.3× the engagement time of warrior posts (n=11)."*
- *"Confession openings (n=6) subscribe at 3.1% vs 1.2% for data openings (n=9)."*
- *"Posts with `braided_register` in their devices outperform posts without, holding topic constant."*

Not "this post did well." N=1 is noise. Need ~15–25 posts per bucket before pivots are meaningful.

---

## Parking lot (not wired)

- Per-post share counts (share-count API)
- Headline A/B within a post (URL params + two-arm redirector)
- Reader-segment slicing (shift worker vs new parent) — on-site segmentation
- Generator steering toward under-represented buckets

Add when basic pivots surface obvious wins.

---

## Files shipped

| File | Purpose |
|---|---|
| `scripts/ab/paths.mjs` | Central path constants (TAGS_PATH, ANALYTICS_PATH, DASHBOARD_PATH) |
| `scripts/ab/tag-schema.mjs` | Taxonomy, validators, length buckets |
| `scripts/ab/classify.mjs` | Classify one post by slug |
| `scripts/ab/backfill.mjs` | Classify every untagged post |
| `scripts/ab/fetch-ga4.mjs` | Pull metrics via GA4 Data API |
| `scripts/ab/join-ga4.mjs` | Join GA4 CSV exports (fallback) |
| `scripts/ab/build-dashboard.mjs` | Render `private/ab-dashboard.html` |
| `scripts/ab/pivot.mjs` | CLI pivot (terminal output) |
| `.github/workflows/ab-backfill.yml` | Auto-tag after publish |
| `.github/workflows/ab-weekly-report.yml` | Weekly GA4 fetch + dashboard rebuild |
| `private/ab-tags.json` | Tag store |
| `private/ab-analytics.json` | Joined metrics (after first GA4 run) |
| `private/ab-dashboard.html` | Internal dashboard |
| `private/README.md` | Purpose of this directory |
| `robots.txt` | Disallows `/private/` and each A/B file |
