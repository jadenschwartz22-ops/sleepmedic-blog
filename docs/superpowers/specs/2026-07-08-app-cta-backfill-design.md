# App-Interest CTA Backfill — Design

Date: 2026-07-08
Branch: `app-cta-backfill`

## Problem

The "Download the SleepMedic app" CTA that tracks clicks (GA4 `app_interest_click`),
POSTs to the Pi `/app-interest` endpoint, pings Discord, and stores counts in
`app-interest.json` is **already built and live**. The Pi endpoint returns HTTP 200.

The gap is **coverage**: of 33 blog posts, 20 predate the template change and don't
load `assets/app-interest.js`, so their CTA buttons (where present) do nothing.

Future posts are **already covered**: `scripts/generate-blog-post.mjs` builds every
new post from `blog/_template.html`, which already contains both CTAs + the script.
No generator/template change needed.

## Goal (updated)

Get a **clean, honest, SleepMedic-only demand signal**: every post has a working
tracked "Download App" CTA that fires GA4 + Pi + Discord and opens the "notify me"
modal. No direct App Store links (app is not positioned as live), and no ProtoQuiz
cross-promo diluting the page. Then the click count answers "do lots of people want
the SleepMedic app?"

## Decisions

- **App status: NOT live.** All CTAs use the tracked "coming soon / notify me" modal.
  Remove SleepMedic direct App Store links (`id6744752786`, "Download Free on iOS").
- **Remove ProtoQuiz cross-promo** from SleepMedic posts (`data-ext-link="protoquiz"`,
  `id6753611139`) — keep the page about SleepMedic only.
- **Shared CSS in the script.** `app-interest.js` gains low-specificity fallback styles
  for `.app-cta` and `.nav-cta` so injected CTAs render on old posts that lack that CSS,
  without overriding newer posts that define their own. One change, all posts covered.

## Scope — per-post fix rules (17 older posts; 25 newer already correct)

Applied by an idempotent script; every step is a no-op if already satisfied.

1. **Add script** before `</body>` if `app-interest.js` not present. (all 17)
   ```html
   <script src="/assets/app-interest.js" data-pi="https://pi.sleepmedic.co/app-interest"></script>
   ```
2. **Ensure in-body CTA.** If no `class="app-cta"` block, insert the canonical block
   (from `_template.html`) after `.post-content`/before newsletter or comments:
   ```html
   <div class="app-cta"><div class="app-cta-icon">SM</div><div class="app-cta-text">
     <p>SleepMedic adapts to your actual schedule -- not a rigid ideal. Track consistency, get smart reminders, and see what's really working.</p>
     <a href="#" data-app-interest="post-cta">Download App</a>
   </div></div>
   ```
3. **Convert SleepMedic direct link** `<a href="...id6744752786">Download Free on iOS</a>`
   → `<a href="#" data-app-interest="post-cta">Download App</a>`. (4 posts: 03-01, 03-23, 03-30, 04-06)
4. **Remove ProtoQuiz promo** — delete the whole `<p><em>Working in EMS? ... ProtoQuiz ...</em></p>`
   line. (3 posts: 12-22, 01-12, shift-worker-sleep-protocol)

Net after run: every post has exactly one tracked in-body CTA (+ nav button where present),
zero direct App Store links, zero ProtoQuiz mentions.

## Shared script change (`assets/app-interest.js`)

Extend `injectStyles()` with fallback `.app-cta`/`.nav-cta` rules (dark-card + accent
button matching the brand `#a78bfa`). Low specificity so page-defined styles win.

## Cleanup — delete 3 `" 2.html"` post dupes

Verified older, smaller, unreferenced in sitemap/posts-index; originals are canonical.
Files: 03-23, 03-30, 04-06 `" 2.html"`.

## Out of scope

- `_template.html` / `generate-blog-post.mjs` (already correct — future posts covered)
- CTA/modal visual redesign
- The other 21 repo-wide `" 2"` dupes (config/scripts/images) — flagged, not touched
- Pi service code
- ProtoQuiz's own listing (untouched)

## Verification

- Re-run per-post audit → every post: script ✓, tracked CTA ✓, no `id6744752786`, no `protoquiz`.
- Generator/template untouched (git diff scope).
- Live-test one backfilled post in the browser: CTA visible, click opens modal, GA4 +
  Pi + Discord fire. Pull click count via `/app-interest/stats?key=ADMIN_KEY`.

## Idempotency / safety

- Every insertion/replacement guards on current state; re-running is a no-op.
- Dupe deletion only removes verified-unreferenced files.
