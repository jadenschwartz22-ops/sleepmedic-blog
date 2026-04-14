# SleepMedic Blog

Auto-generated weekly blog at [sleepmedic.co/blog](https://sleepmedic.co/blog).

## How It Works

GitHub Actions runs every Monday at 9am MT (`.github/workflows/weekly-blog-draft-auto.yml`).

**10-stage multi-agent pipeline** (`scripts/generate-blog-post.mjs`):

1. **Topic Selector** - 50/50 split: predefined buckets from `topics.yaml` or original LLM-generated topics via search grounding. SEO-aware angle generation with `seo_gap` targeting.
2. **Researcher** (Gemini + Google Search grounding) - Finds real studies, stats, mechanisms. Identifies high-search-volume / low-competition angles (`seo_angles`). Falls back to non-search if grounding fails.
3. **Planner** (Gemini 2.5 Flash) - Structured outline with research refs, varied article formats (Story-First, Myth-Busting, Q&A, etc.)
4. **Section Writers** (Gemini 2.5 Flash) - One call per section, varied temperature, style guidelines injected
5. **Assembler** - Programmatic join + inline image slot selection
6. **Editor** (Gemini 2.5 Flash) - Polish, enforce 60+ banned AI-isms, fix transitions
7. **Humanizer** (Gemini 2.5 Flash) - Conversational pass, rhetorical questions, micro-stories
8. **Cross-Linker** (Gemini 2.5 Flash) - Reads `posts-index.json`, inserts 1-3 internal links
9. **Image Generation** (gemini-2.5-flash-image) - Cover + 1-2 inline images. Diverse editorial imagery (landscapes, science visuals, macro, urban, abstract). Avoids generic beds/bedrooms.
10. **HTML Builder** - Template assembly + metadata + GA4

All Gemini calls use retry logic (3 attempts, exponential backoff). JSON responses use robust parsing with truncation repair. Workflow creates a PR, auto-merges, commits topic history and content memory, and posts a summary issue.

**Notifications:** Success = "Blog posted: [title]", failure = "Blog FAILED - [date]" (GitHub issue -> email).

## Integrations

| Service | Purpose |
|---------|---------|
| **GA4** (G-5H4073EG26) | Analytics on all pages (landing, blog index, all posts) |
| **Giscus** | Comments via GitHub Discussions (Announcements category) |
| **Follow.it** | Newsletter - RSS-to-email, auto-sends weekly to subscribers |
| **RSS** | `blog/feed.xml` for feed readers and Follow.it |

## Site Structure

```
sleepmedic.co/            -> Landing page
sleepmedic.co/blog/       -> Blog homepage (loads from posts-index.json)
sleepmedic.co/blog/posts/ -> Individual posts (comments, newsletter CTA)
sleepmedic.co/app/        -> App coming-soon page
sleepmedic.co/privacy/    -> Privacy policy
```

## Key Files

| File | Purpose |
|------|---------|
| `scripts/generate-blog-post.mjs` | Main 10-stage pipeline |
| `scripts/editorial/topics.yaml` | 6 topic buckets (~83 seed topics, not a constraint) |
| `scripts/editorial/style_guidelines.md` | Editorial voice, rules, before/after examples |
| `scripts/editorial/app-context.json` | App features for natural mentions |
| `scripts/content-memory-system.mjs` | Novelty scoring, phrase dedup (Set-based) |
| `scripts/generate-posts-index.mjs` | Regenerates `blog/posts-index.json` from HTML |
| `scripts/generate-rss-feed.mjs` | Regenerates `blog/feed.xml` for Follow.it |
| `scripts/check-duplicate-titles.mjs` | Jaccard similarity check (70% threshold) |
| `scripts/monitor-blog-health.mjs` | Post frequency health check |
| `scripts/cleanup-posts.mjs` | Batch update nav bars, footers, og:image |
| `blog/_template.html` | Post HTML template (GA4, Giscus, Follow.it) |
| `blog/_shared-styles.css` | Shared CSS with backward-compat variable aliases |
| `blog/index.html` | Blog homepage (category filters, newsletter) |
| `.topic-history.json` | Persistent topic history (committed by workflow) |
| `.content-memory.json` | Content memory for novelty scoring (committed by workflow) |
| `.github/workflows/weekly-blog-draft-auto.yml` | Weekly automation + notifications |

## Running Locally

```bash
npm install
GEMINI_API_KEY=xxx node scripts/generate-blog-post.mjs
node scripts/generate-posts-index.mjs
node scripts/generate-rss-feed.mjs
node scripts/content-memory-system.mjs stats
node scripts/monitor-blog-health.mjs
```

## Secrets

`GEMINI_API_KEY` on `jadenschwartz22-ops/sleepmedic-blog`.

## Cost

~$0.01-0.03 per post (8-10 Gemini 2.5 Flash calls + 1-2 image gen calls).
