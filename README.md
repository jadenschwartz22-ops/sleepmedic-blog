# SleepMedic Blog

Auto-generated weekly blog at [sleepmedic.co/blog](https://sleepmedic.co/blog).

## How It Works

GitHub Actions runs every Monday at 9am MT (`.github/workflows/weekly-blog-draft-auto.yml`).

**Multi-agent pipeline** (`scripts/generate-blog-post.mjs`):

1. **Topic Selection** - Rotates through 6 SEO buckets in `scripts/editorial/topics.yaml` using ISO week + random offset
2. **Planner Agent** (Gemini 2.5 Flash) - Creates outline, title, sections, image prompt
3. **Section Writers** (Gemini 2.5 Flash) - One API call per section, varied temperature, style guidelines injected
4. **Editor Agent** (Gemini 2.5 Flash) - Polishes draft, enforces 60+ banned phrases, style guidelines injected
5. **Cross-Linker** (Gemini 2.5 Flash) - Reads `blog/posts-index.json`, inserts 1-3 internal links
6. **Cover Image** (gemini-2.5-flash-image) - Native image generation via `responseModalities: ['TEXT', 'IMAGE']`
7. **HTML Builder** - Assembles from `blog/_template.html`, injects og:image

All Gemini calls use retry logic (3 attempts, exponential backoff). Workflow creates a PR, auto-merges, commits topic history and content memory back to repo, and posts a summary issue. On failure, creates a GitHub issue notification.

## Site Structure

```
sleepmedic.co/            -> Landing page
sleepmedic.co/blog/       -> Blog homepage (loads from posts-index.json)
sleepmedic.co/blog/posts/ -> Individual posts
sleepmedic.co/app/        -> App coming-soon page
sleepmedic.co/privacy/    -> Privacy policy
```

## Key Files

| File | Purpose |
|------|---------|
| `scripts/generate-blog-post.mjs` | Main pipeline (all agents, retry logic, banned phrases) |
| `scripts/editorial/topics.yaml` | 6 topic buckets (~83 topics) |
| `scripts/editorial/style_guidelines.md` | Editorial voice, rules, before/after examples |
| `scripts/editorial/app-context.json` | App features for natural mentions |
| `scripts/content-memory-system.mjs` | Novelty scoring, phrase dedup (Set-based) |
| `scripts/generate-posts-index.mjs` | Regenerates `blog/posts-index.json` from HTML |
| `scripts/generate-rss-feed.mjs` | Regenerates `blog/feed.xml` for Follow.it |
| `scripts/check-duplicate-titles.mjs` | Jaccard similarity check (70% threshold) |
| `scripts/monitor-blog-health.mjs` | Post frequency health check |
| `scripts/cleanup-posts.mjs` | Batch update nav bars, footers, og:image |
| `blog/_template.html` | Post HTML template |
| `blog/_shared-styles.css` | Shared CSS with backward-compat variable aliases |
| `blog/index.html` | Blog homepage (category filters, loads from `posts-index.json`) |
| `.topic-history.json` | Persistent topic history (committed by workflow) |
| `.content-memory.json` | Content memory for novelty scoring (committed by workflow) |
| `.github/workflows/weekly-blog-draft-auto.yml` | Weekly automation |

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

~$0.01-0.03 per post (5-7 Gemini 2.5 Flash calls + 1 image gen call).
