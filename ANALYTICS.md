# SleepMedic Analytics

GA4 is the only analytics on the site. GoatCounter is gone.

- Property `sleepmedic-90416`, measurement ID **`G-717M9L2RTM`**
- [Reports](https://analytics.google.com/analytics/web/#/p532856345/reports/intelligenthome) ·
  [Realtime](https://analytics.google.com/analytics/web/#/p532856345/reports/realtime)
- Ground truth for subscribers is the Pi, not GA4: `curl https://pi.sleepmedic.co/health`

## The number that matters

**Email subscribers.** Everything below is a leading indicator. If a report doesn't move
subscribers, it's noise at current scale.

## Events

| Event | Fires when | Params |
|---|---|---|
| `newsletter_subscribe` | Subscribe form submitted | `source`, `email_domain`, `slug` |
| `plan_completed` | Quiz finished, plan delivered | — |
| `plan_cta_click` | Any "get your plan" CTA clicked | `location` |
| `blog_post_view` | Post page load | `slug`, `category`, `read_time`, `word_count` |
| `scroll_depth` | Post pages | `depth` (25/50/75/100), `slug` |
| `tool_result` | Caffeine-cutoff or nap calculator produces a result | — |
| `schedule_view` | Schedule Manager / rotation page opened | — |
| `schedule_configured` | Schedule set up | — |
| `schedule_change` | Schedule edited | — |
| `schedule_print` | Schedule printed | — |
| `schedule_ics_export` | Calendar export | — |

**Key events** (GA4 > Admin > Events > "Mark as key event"): `newsletter_subscribe`,
`plan_completed`, `plan_cta_click`.

## Custom dimensions

`location`, `slug`, `category` — registered event-scoped. Add them as breakdowns in any Exploration.

## The funnel

`blog_post_view` (or `schedule_view` / `tool_result`) -> `plan_cta_click` -> `plan_completed` /
`newsletter_subscribe`.

Explore > Funnel exploration, breakdown by `slug`. Save as "SleepMedic conversion funnel".

## Monthly ritual

1. Which pages drew the most views? (Reports > Pages and screens)
2. Which converted best to subscribers? (funnel + `slug` breakdown)
3. Which `location` converted best? (funnel + `location` breakdown)
4. Write more of what won. Kill what didn't.

## Schema

The pipeline injects **FAQPage** JSON-LD (Q&A posts, or 3+ `<h2>` ending in `?`) and **HowTo**
JSON-LD (Field Manual posts, or ordered lists with 3+ steps). No manual step. Verify with the
[Rich Results Test](https://search.google.com/test/rich-results).

## Legacy events

`app_interest_email` and `blog_card_click` still fire from the retired `/app/` page, `assets/app-interest.js`,
and the blog category pages. They are not part of the current funnel — ignore them in reports.
