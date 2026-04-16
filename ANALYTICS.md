# SleepMedic Analytics Guide

A non-technical guide to what's tracked and how to read it.

## Where to look

- Google Analytics: https://analytics.google.com/analytics/web/#/p532856345/reports/intelligenthome
- Property: `sleepmedic-90416` (SleepMedicAnalytics account)
- Measurement ID (web): `G-717M9L2RTM`
- Realtime (live hits): https://analytics.google.com/analytics/web/#/p532856345/reports/realtime

## The 4 events you care about

These are the events every page fires. All four should be marked as **Key events** in GA4 > Admin > Events (toggles at the right of each row). Once marked, they'll show up in Reports > Conversions.

| Event | Fires when | Useful params |
|---|---|---|
| `blog_post_view` | Someone lands on a blog post | `slug`, `category`, `read_time`, `word_count` |
| `newsletter_subscribe` | Subscribe form submitted successfully | `email_domain`, `source`, `slug` |
| `app_interest_click` | Any "Download / Get app" button clicked | `location`, `path` |
| `app_interest_email` | Email submitted in app-interest modal or /app/ form | `email_domain`, `location` |

### How to mark them (do this once, after the first traffic hits)

GA4 only shows events after it observes them. So wait 24 hours after shipping the new `G-717M9L2RTM` stream, then:

1. Go to Admin (gear icon, bottom-left) > **Events**.
2. Find the event in the list.
3. Toggle **Mark as key event** on the right.

Do this for all four.

## The 3 custom dimensions (already created)

| Name | Parameter | What it surfaces |
|---|---|---|
| Location | `location` | Which CTA variant was clicked (hero, sidebar, footer, etc.) |
| Slug | `slug` | Per-post breakdown of views and subscribes |
| Category | `category` | Blog category performance |

In any Explorations or Report Customization, add these as secondary dimensions. Example: "Which posts convert best to newsletter subscribers?" -> Explorations > Free form > rows: `Slug`, metric: `newsletter_subscribe` event count.

## Building the funnel

The conversion path: **post view -> newsletter subscribe** and **post view -> app interest click -> app interest email**.

1. Explore > New exploration > Technique: **Funnel exploration**.
2. Steps:
   - Step 1: Event `blog_post_view`
   - Step 2: Event `app_interest_click` (or `newsletter_subscribe` for a 2-step)
   - Step 3: Event `app_interest_email`
3. Breakdown: `Slug` (to see which posts convert).
4. Save as "SleepMedic conversion funnel".

## Monthly ritual

Once a month, open the saved funnel and answer:

1. Which post had the most views? (Reports > Pages and screens)
2. Which post had the best view-to-subscribe conversion? (Funnel + Slug breakdown)
3. Which CTA `location` had the best click-to-email rate? (Funnel + Location breakdown)
4. Double down on what works -- write more posts like the top converter, emphasize the winning CTA placement.

## Dashboards

A pre-built Library > Collection isn't set up yet (GA4 key events need first-traffic data to unlock). Instead, use Explorations -- save them to "SleepMedic collection" as you build them:

- **Top posts by views** -- free-form, rows: `Slug`, metric: `blog_post_view` event count
- **Subscriber acquisition** -- free-form, rows: `Slug` + `source`, metric: `newsletter_subscribe` event count
- **Funnel** (described above)

## SEO schema and SERP appearance

Two additional JSON-LD schema types are injected at build time by the pipeline:

- **FAQPage** -- emitted when a post uses the `Q&A` template type or has 3+ `<h2>` headings ending with `?`. Google may render these as expandable Q&A rich results in search, increasing click-through rate.
- **HowTo** -- emitted when a post uses the `Field Manual` template type or contains an ordered list with 3+ steps. Google may render these as numbered step rich results.

Neither requires any manual action. To verify a post has the schemas, view source and search for `"@type": "FAQPage"` or `"@type": "HowTo"`. To test rendering, use the [Google Rich Results Test](https://search.google.com/test/rich-results) with the post URL.

## Also tracking

- **GoatCounter** (`goatcounter.com/sleepmedic`) -- privacy-friendly pageviews as a second source of truth. No events, just raw traffic.
- **Pi `/stats`** -- raw subscriber count, app-interest events. Admin only.
