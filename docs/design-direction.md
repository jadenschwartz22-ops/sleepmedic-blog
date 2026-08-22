# SleepMedic Design Direction Brief

Research date: 2026-08-22. Sources: live fetch of tomoji.com, jamesclear.com (+ /articles, /about), github.com (+ /features/copilot), and the current sleepmedic.co site (source read directly from this repo).

---

## 1. Current-state notes (what exists today)

Read directly from repo source (`index.html`, `blog/index.html`, `blog/posts/*.html`, `blog/_shared-styles.css`).

**Stack:** static HTML, no framework, Google Fonts `Inter` (weights 400/500/600/700/800/900), GA4, a `Pi` service (`pi.sleepmedic.co`) handling both `/subscribe` (newsletter) and `/app-interest` (app-download click capture).

**Palette actually in use — and it's inconsistent across templates:**
- `index.html` / `blog/index.html` define tokens: `--bg:#0a0a0c`, `--surface:#141416`, `--surface-2:#1c1c1f`, `--border:rgba(255,255,255,.07)`, `--text:#f5f5f5`, `--text-2:#b0b0b8`, `--text-3:#6b6b76`, `--accent:#a78bfa` (lavender), `--accent-2:#60a5fa` (blue), `--green:#34d399`. This is the dark/indigo/lavender system the user referenced.
- Individual blog **post** pages (`blog/posts/*.html`) instead reference `--primary`, `--secondary`, `--ink`, `--muted`, `--line` from `_shared-styles.css` — a *different, older* token set with a **teal accent** (`rgba(22,160,133,...)` category badges) and a purple-to-cyan gradient (`linear-gradient(135deg,#7c8cf5,#6dd5ed)`) on newsletter CTAs. **This is a real bug/drift**: the homepage and blog index look like one brand; the actual article pages — where most readers land — look like a different, older brand. Any redesign must unify these into one token set applied everywhere, including `_shared-styles.css`.
- Category tag colors are ad hoc hex, not tokens: `#34d399` (tools), `#fbbf24` (trending), `#fb923c` (troubleshooting), `#38bdf8` (shift work), `#c084fc` (life stages), `#f472b6` (special) — six extra hardcoded colors on top of the two accent tokens.

**Typography today:** Inter only, used for everything including body copy — no serif or display distinction anywhere. Hero H1 uses `clamp(2.2rem,4.5vw,3.6rem)` weight 800, tight tracking (`-0.03em` to `-0.04em`). Body copy is `Inter` at 17px/1.8 on post pages — perfectly readable but generic; nothing about the type signals "sleep" or "night" or differentiates SleepMedic from any other dark-mode SaaS blog.

**Homepage structure today:** nav (logo, Blog, About, "Download App" button) → hero (green pulsing "New post every Monday" badge, H1, subhead, two CTAs: "Read the blog" primary + "Subscribe via RSS" ghost) → featured post card → 3-col recent-posts grid → subscribe strip (email link + RSS link, **not an inline form**) → footer (copyright, Blog/RSS/Download App/Privacy links). **The homepage never shows an actual email input field** — "Email newsletter" is just a link to `/blog/#newsletter`. This is a real conversion leak: the spec's top priority (capture emails with genuine value promises) currently requires a click-through before a visitor ever sees a form.

**Blog index today:** has two working email forms (`data-sm-newsletter`, POSTs to `pi.sleepmedic.co/subscribe`) with copy "Get the free Shift Worker Sleep Protocol — a one-page reference guide. Plus weekly sleep science." This lead-magnet framing is good and should be the model pulled forward to the homepage. Also has category filter pills (All/Science/Tools/Troubleshooting/Trending/Timing/Shift Work), a stats bar (Articles / Topics / Weekly), and view counts pulled from a static GA snapshot.

**Article page today:** 720px reading column, category badge, H1 clamp(2rem,4vw,2.75rem) weight 900, meta line (date, read time), body 17px/1.8, sourced citations as a plain `<ul>` of links at the bottom, mid-article contextual link to the cornerstone "Shift Worker Sleep Protocol" post, an "app-cta" block (icon + copy + Download App link) — **no email capture on article pages at all**, and no author box (byline is "SleepMedic" as an Organization in schema, not a person).

**What's already good and should survive:** the dark near-black base + lavender/blue accent gradient on H1 text is a credible, calm, nocturnal palette — closer to a sleep-tech product than a content farm. The card system (rounded-16px surfaces, 1px hairline borders, subtle hover lift) is clean and modern. The lead-magnet framing ("Shift Worker Sleep Protocol") is the right instinct for value-first capture. Category color-coding on cards is a nice scan aid. RSS is already present, just needs demoting per spec, not removing.

**What's explicitly broken relative to the new spec:** app-download CTAs are everywhere (nav, hero-adjacent, footer, mid-article) and need to retire in favor of "Build my free sleep plan"; RSS is co-equal with email in the subscribe strip and needs demoting to footer-only; the homepage has no real capture form; the token drift between homepage and article template needs fixing; there's no author/credibility box anywhere; there's no audience-specific hub page (nurses/paramedics/new-parents/shift-workers directories exist as folders in `/blog/` but weren't inspected here as page templates — treat as an open item to audit against the hub blueprint in §3).

---

## 2. Per-reference: adoptable patterns

### 2.1 tomoji.com

Confirmed by downloading and inspecting the site's actual compiled CSS and body class list (not guesswork):

1. **Font pairing — Geist (sans) + Instrument Serif (italic accent) + Geist Mono.** The `<body>` class is literally `geist_..._variable geist_mono_..._variable instrument_serif_..._variable font-sans antialiased`. This is the modern "serif-italic-as-highlight" pattern: headline is set in Geist (clean grotesque sans) but one key phrase is wrapped in `font-serif italic` (Instrument Serif) to add warmth/personality without switching the whole headline to serif. Adoptable as-is: pair a grotesque/geometric sans for UI and body with a single elegant serif reserved for one accent word or phrase per hero/section, italicized.
2. **Hero H1 sizing is a real responsive clamp ladder, not a single clamp():** `text-[32px]` at base → `xs:text-[44px]` → `sm:text-6xl` (60px) → `md:text-7xl` (72px), `leading-[1.2]`, `font-semibold`, `tracking-tight`. Multiple breakpoints rather than one fluid clamp gives more art-direction control at each width — worth adopting for a hero that needs to feel considered on mobile, not just scaled down.
3. **Semantic Tailwind/shadcn-style tokens, not raw hex, throughout components:** buttons and links reference `text-primary-foreground`, `text-muted-foreground`, `hover:text-foreground`, `bg-primary` — i.e., a small, named token set (foreground / muted-foreground / primary / primary-foreground / background / card / border) rather than a sprawl of one-off hex values. This is the direct fix for SleepMedic's current token drift (§1).
4. **Generous, escalating section rhythm:** vertical padding values found in the page range from `py-12`/`py-16` for tight sections up to `py-32` and `py-40` for hero/major breaks — i.e., hero and section transitions get roughly double or more the padding of a normal content block. Adopt: define two or three padding tiers (compact/standard/hero) instead of one fixed section gap.
5. **Corner-radius hierarchy:** `rounded-full` for pills/badges/avatars, `rounded-2xl`/`rounded-xl` for cards and major containers, `rounded-lg`/`rounded-md` for buttons and inputs, `rounded-[0.15em]` (an em-relative micro-radius) for tiny inline icon chips next to text. Adopt the *tiering* — pill for status/badges, large-radius for surfaces, smaller radius for interactive controls — rather than one blanket `--radius`.
6. **Credibility badge pattern:** a small rounded-full pill near the hero (Y Combinator badge in tomoji's case) functions as instant third-party trust without a testimonial section. SleepMedic's existing "New post every Monday" pulsing-dot badge is structurally identical — keep that pattern, but a second badge slot (e.g., "Evidence-based, cited every post" or a subscriber count once real) would strengthen credibility the same way.
7. **Dark-mode-aware components at the token level:** classes like `bg-black dark:bg-white` appear directly on small elements (icon chips), meaning color decisions are made per-component with light/dark pairs baked in, not just at the page root. If SleepMedic ever ships a light mode, build it this way — token pairs per component, not a single inverted stylesheet.
8. **Restrained motion:** `scroll-smooth` on `<html>`, transition utilities (`transition-all`, `transition-colors`) on hover states only — no entrance animations detected on the hero itself. The site's polish reads through micro-interactions (hover shifts, smooth scroll) rather than motion-heavy reveals. Matches the "calm, not slop" goal directly.

### 2.2 jamesclear.com

1. **Value-first email framing, never "sign up for our newsletter."** The primary capture offer on the homepage is a named, scoped deliverable — "30 Days to Better Habits," 11 emails, a 20-page workbook, explicit cadence disclosed up front ("one short email every three days for a month"). Adopt directly: SleepMedic's capture offer should be a named artifact ("Free Sleep Plan," "Shift Worker Sleep Protocol") with a stated format and cadence, never a bare "subscribe to our newsletter" ask.
2. **Capture appears multiple times, each contextually different, not repeated verbatim.** Hero-level offer differs from mid-page offer differs from footer. Homepage leads with the book/flagship offer; further down a distinct "browse the newsletter" secondary capture appears with actual past-issue previews (proof of quality before asking for the email). Adopt: show 2-3 real recent email/post previews next to a capture form so the reader can judge quality before opting in, rather than a blind ask.
3. **Credibility is quantified, then filed away, not repeated.** Numbers appear once, in one dedicated bio block (30M copies, 3M subscribers, 10M visitors/year, 250+ articles), then the rest of the site trades on that established trust without repeating the numbers everywhere. Adopt: one strong author/credibility block (bio + citation count + review/press mentions if any exist) placed once on the homepage and once on the about/hub pages — not sprinkled as badges on every card.
4. **Topic hub pages organize by problem, not by publish date.** `/articles` groups posts under named categories (Habits, Focus, Decision Making, etc.) with 3-4 hand-picked links per category and a "Read more" — intentionally *not* a reverse-chronological feed. Adopt for SleepMedic's audience hub pages (nurses, paramedics, shift-workers, new-parents): lead with the 3-4 best/most load-bearing posts for that audience, not just their full chronological archive.
5. **No excerpts on the hub page — headlines only, high link density.** This keeps the hub page scannable and fast; it trusts a good headline over a teaser paragraph. Adopt selectively: SleepMedic's category filter grid could gain a pure-headline "quick jump" list above/alongside the current excerpt cards for power users.
6. **The credibility-to-CTA sequence is deliberate: prove expertise, then ask.** The email course pitch is placed *after* the author bio and press mentions, not before. Adopt the ordering for SleepMedic's homepage: badge/hook → proof (a stat bar or a "why trust this" line — SleepMedic already has a stats bar on the blog index, mirroring the idea) → capture offer.
7. **Footer is a small set of owned-product cards, not a link directory.** James Clear's footer surfaces his actual products (book, course, app, journal) as cards, then a thin legal/attribution line below. Adopt structurally for SleepMedic once there's more than one deliverable (sleep plan PDF, future app, blog) — footer becomes a short "what we make" row, with legal links minimized beneath it.
8. **Newsletter disclosure is explicit and short.** "You will get one short email every three days for a month" — stated plainly next to the form, no fine print elsewhere. Adopt directly: every SleepMedic capture form states cadence and content in one line under the button ("One email a week. Unsubscribe anytime.").

### 2.3 github.com

Confirmed via markup fetch plus general familiarity with GitHub's shipped dark theme (Primer design system) for token naming, cross-checked against fetched section/copy structure:

1. **Layered dark surfaces, not one flat black.** GitHub's dark theme uses a near-black canvas with at least one lighter "inset/subtle" surface layer for cards and a further step for hover/active states — never pure `#000`, and never more than ~3 background steps. SleepMedic's existing `--bg/--surface/--surface-2` three-step system already matches this instinct; keep exactly this pattern rather than adding more layers.
2. **One accent color used sparingly, reserved for interactive/attention elements.** GitHub's signature blue shows up on links, primary buttons, and focus rings — essentially nowhere else; body copy and most UI stay in the gray scale. Adopt: tighten SleepMedic's accent usage so lavender/blue only marks interactive or "this matters" elements (CTA buttons, active nav state, category label), not decorative gradient text on every H1 — reserve the gradient treatment for the homepage hero only, not every page.
3. **Dense information handled through grouped cards with consistent internal padding, not tables.** Feature/plan comparisons and metric call-outs are broken into repeatable card units (icon/label + short copy + optional CTA) rather than dense paragraphs — this is how GitHub keeps a lot of information legible in a dark theme. Adopt for a homepage "how it works" or "what you get" section: 3-4 identical small cards (icon, one-line label, one sentence), not prose.
4. **Section rhythm alternates hero-style full-bleed statements with tighter feature grids.** A big centered headline+CTA section is followed by a denser 3-column grid, then a testimonial/proof section, then another centered statement — a repeating "wide → dense → wide" cadence keeps a long page from feeling monotonous. Adopt this alternation for the SleepMedic homepage instead of a flat stack of same-width sections.
5. **Monospace used only for genuinely technical/precise content, never for decoration.** Any code-like or monospace styling on GitHub marks something literal (a command, a filename) — never used as a stylistic flourish. For SleepMedic this suggests: reserve monospace for genuinely data-like content only (e.g., a stat like "7.2 hrs," a citation DOI, a protocol step number) if used at all — do not adopt a "techy" monospace UI font wholesale, it would fight the calm/nocturnal brief.
6. **High-contrast, rounded, generously-padded primary buttons** stand distinctly apart from ghost/secondary buttons through fill alone (not size) — primary is a solid high-contrast pill/rounded-rect, secondary is outline or text-only at the same size. SleepMedic's existing `.btn-primary`/`.btn-ghost` split already follows this; keep it, just make sure only one primary-styled button exists per view (currently the homepage hero has a primary "Read the blog" next to a ghost "Subscribe via RSS," which is correct — extend that discipline everywhere including article pages).
7. **Testimonial/proof sections use a real metric headline, not a quote alone** ("increases developer productivity by 94%") — the number is the headline, the quote/attribution is secondary. Adopt once SleepMedic has real numbers (open rate, subscriber count, "read by X shift workers") — until then, skip fabricated proof entirely rather than mimic the pattern with invented numbers (see §4).
8. **Precision in copy: short, declarative section headers, no marketing fluff adjectives.** Headers read as capability statements ("Automate any workflow," "Command your craft") rather than adjective-stacked taglines. Adopt for SleepMedic section headers: replace anything like "Amazing sleep science" with a plain capability/outcome statement, e.g. "Read the research in five minutes" or "Built for people who sleep at 9am."

---

## 3. Synthesized direction for SleepMedic

### Typography (Google Fonts only)

Replace Inter-only with a two-family system, following the tomoji sans+serif-accent pattern but picked for "calm/nocturnal/credible" rather than "startup energetic":

- **Primary (UI, body, nav, buttons): `Inter`** — keep it. It's already integrated, it's excellent for long-form reading at small sizes, and changing it site-wide is unnecessary churn. Weights: 400 (body), 500 (meta/labels), 600 (subheads/buttons), 700 (H2/H3), 800 (H1).
- **Accent/display (hero phrase, pull-quotes, section eyebrows on the homepage only): `Fraunces`** (Google Fonts, optical-size variable serif, available in italic) as SleepMedic's equivalent of Instrument Serif. Fraunces reads warmer and more "editorial sleep science" than a generic serif, has real italic weights, and is free on Google Fonts (Instrument Serif itself is also on Google Fonts if a closer visual match to tomoji is preferred — either is acceptable; Fraunces has more optical-size character suited to a calmer brand). Use it exactly the way tomoji uses Instrument Serif: one italicized phrase inside an otherwise-Inter headline, e.g. "Evidence-based *sleep science*." for shift workers — never a full paragraph in serif.
- **Do not add a monospace font site-wide.** Reserve `ui-monospace` (system stack, no new Google Font needed) strictly for numeric/data callouts (a stat tile, a citation year) if used at all, per the GitHub note in §2.3.5.
- **Scale:** keep the existing clamp-based hero (`clamp(2.4rem, 5vw, 3.6rem)`, weight 800, `-0.04em` tracking) — it already matches tomoji's tight-tracking/bold-weight hero pattern. Extend the *tiered* responsive sizing idea from tomoji (§2.1.2) to H2s: define explicit `sm:`/`md:` breakpoint sizes for section titles instead of one clamp, so section headers can be art-directed rather than purely fluid.

### Color tokens — night-first theme

Unify the two current token sets into one, applied via `_shared-styles.css` everywhere (fixing the drift in §1). Keep the existing near-black/lavender/blue direction — it's already correct for "calm/credible/nocturnal" — but formalize it as a semantic token set (per tomoji's `primary`/`foreground`/`muted-foreground` pattern, §2.1.3) so category colors and one-off hexes stop proliferating:

```css
:root {
  /* surfaces — 3-step layering, never pure black (GitHub pattern) */
  --bg:          #0a0a0c;
  --surface:     #141416;
  --surface-2:   #1c1c1f;
  --border:      rgba(255,255,255,0.07);
  --border-hover: rgba(255,255,255,0.14);

  /* text */
  --text:        #f5f5f5;   /* headings, primary copy */
  --text-2:      #b0b0b8;   /* body */
  --text-3:      #6b6b76;   /* meta, captions, disabled */

  /* single reserved accent pair — interactive elements only (GitHub §2.3.2) */
  --accent:      #a78bfa;   /* lavender — links, primary buttons, active states */
  --accent-2:    #60a5fa;   /* blue — gradient partner, secondary accents */
  --accent-dim:  rgba(167,139,250,0.10);

  /* status — used sparingly, functional only */
  --success:     #34d399;

  /* category tags — one small, fixed palette, referenced by name not invented per-post */
  --cat-science:        var(--accent);
  --cat-tools:           #34d399;
  --cat-timing:          var(--accent-2);
  --cat-troubleshooting: #fb923c;
  --cat-trending:        #fbbf24;
  --cat-shiftwork:       #38bdf8;

  --radius-pill: 999px;   /* badges, tags */
  --radius-lg:   16px;    /* cards, major surfaces */
  --radius-md:   10px;    /* buttons */
  --radius-sm:   8px;     /* inputs, small controls */
}
```

Delete `--primary`/`--secondary`/`--ink`/`--muted`/`--line` from `_shared-styles.css` and the teal `rgba(22,160,133,...)` badge color entirely — that's the drifted legacy system from §1 and should not survive the redesign. Every template (homepage, blog index, post, hub pages) imports the same token block.

### Homepage section-by-section blueprint

Centered on **"Build my free sleep plan"** as the primary CTA and a real inline email form, per spec (app-download retired, RSS demoted to footer):

1. **Nav** — logo, `Blog`, `About`, and the primary CTA button now reads **"Build my free sleep plan"** (replaces "Download App" everywhere it appeared: nav, hero, footer, article mid-page). No app-download control remains anywhere in the nav.
2. **Hero** — keep the pulsing-dot badge ("New post every Monday" or similar), H1 with the Fraunces-italic accent phrase per the typography section, subhead unchanged in spirit ("Weekly, research-backed sleep writing for shift workers..."). Two CTAs: primary = **"Build my free sleep plan"** (opens/scrolls to the capture form, or links to a dedicated `/sleep-plan/` capture page — pick one canonical destination and route every "Build my free sleep plan" button to it), secondary ghost = **"Read the blog"**. RSS is not in the hero at all.
3. **Inline capture block directly under the hero** (this is the fix for the current "no real form above the fold" gap in §1) — a single input + button, James-Clear-style scoped offer copy: "Get your Free Sleep Plan — a personalized shift-schedule protocol built from the research, delivered to your inbox in 2 minutes." One-line disclosure beneath the button: "One weekly email. No spam, unsubscribe anytime." No RSS mention here.
4. **Proof / credibility strip** (new section, James Clear ordering: prove before asking again) — a stats bar in the existing style (Articles count / Topics count / citations-per-post or similar honest metric) plus a one-line "why trust this" statement, e.g. "Every claim cited. No affiliate padding, no pseudoscience." Do not fabricate subscriber counts or testimonials that don't exist yet (see §4).
5. **Featured post + recent posts grid** — keep the existing featured-card + 3-col grid pattern; it already works and matches the GitHub "wide → dense" rhythm (§2.3.4). Category color tags now pull from the unified token set.
6. **"How it works" / what-you-get section** (new, GitHub card-grid pattern §2.3.3) — 3 small identical cards, icon + one-line label + one sentence, e.g. "Evidence-based" / "Built for real schedules" / "Free, always" — replacing any implicit app pitch.
7. **Second, lower-friction capture** (audience-specific) — a second, shorter form scoped to a specific audience selector if feasible ("I'm a: Nurse / Paramedic / New parent / Other shift worker") linking into the audience hub pages in this section, otherwise a plain repeat of the hero offer in shorter form.
8. **Footer** — copyright, `Blog`, `About`, `Privacy`, and **RSS demoted here** as a small text link (no longer co-equal with email in a "subscribe strip"). No app-download link anywhere.

### Article page blueprint

1. **Header** — category badge (unified token color), H1, byline + date + read time. Byline should name a real author or "SleepMedic Editorial" consistently — decide once and apply everywhere (schema.org `author` currently says "Organization"; fine to keep, but the visible byline UI should feel human, not purely corporate, to avoid "AI content-farm" feel per the spec's explicit goal).
2. **Body** — keep 720px column, 17px/1.8 Inter — this is already good long-form typography. Use the Fraunces-italic treatment sparingly for a lead paragraph drop-cap or pull-quote only if it doesn't slow reading; otherwise body stays pure Inter.
3. **Mid-article capture** (new — currently missing per §1) — insert a compact inline capture block after the 2nd or 3rd H2, visually distinct from the app-cta box it replaces: same scoped "Free Sleep Plan" offer, shorter copy than the homepage version, single input + button, no illustration needed. This is a mid-length article, not a hard interrupt — style it as a bordered card matching `.newsletter-cta`'s existing gradient-surface pattern but with the unified tokens instead of the drifted purple/cyan gradient.
4. **Author box** (new — currently absent) — small card near the end of the article, before Sources: avatar/initials, one-line credibility statement (borrow James Clear's "state numbers once" discipline — e.g., "Written by the SleepMedic team. Sources reviewed: CDC, NIH, AASM." — only real, verifiable claims), link to `/about/`.
5. **Citation styling** (upgrade from plain `<ul>` links) — numbered or labeled citation list with a small `--text-3` superscript-style marker matching in-text reference points if the writing style supports inline numbered citations; at minimum, style the existing Sources list as a distinct bordered block with source-organization name bolded (CDC, NIH, AASM, Cochrane) so it reads as a credibility artifact, not a link dump — this directly serves "never feel like AI content-farm slop."
6. **End-of-article capture** (upgrade existing `.newsletter-cta` / retire `.app-cta`) — full-width version of the mid-article block, same offer, unified tokens, no app mention.
7. **Footer** — same as homepage footer (RSS demoted, no app link).

### Audience hub page blueprint (nurses / paramedics / new-parents / shift-workers)

Modeled on James Clear's `/articles` topic-hub pattern (curated, not chronological) crossed with the existing blog-index stats/filter UI:

1. **Header** — audience-specific H1 with the Fraunces-italic accent on the audience name, e.g. "Sleep science for *night-shift nurses*." One-sentence framing of why this audience is different (circadian-specific challenge in one line).
2. **Curated top posts** (3-4 hand-picked, not full chronological archive, per §2.2.4) — reuse the `.featured` + `.card` components already in the design system, just filtered/curated rather than sorted by date.
3. **Audience-specific capture form** — same scoped offer pattern, but the headline names the audience: "Get the Nurse Shift Sleep Plan." This is the single highest-value personalization move available — a generic "sleep plan" converts worse than a named, audience-specific one.
4. **Full archive link** — "See all posts for [audience] →" leading into the filtered blog index (the existing `.filter-btn` category system already supports this if audience tags are added alongside topic categories).
5. **Footer** — standard.

---

## 4. What NOT to adopt, and why

- **Do not adopt tomoji's YC/investor-badge pattern literally.** SleepMedic has no equivalent institutional credential yet. Inventing or implying one (a fake "as seen in" row, a vague "trusted by thousands") would directly violate the "never feel like AI content-farm slop" goal — that kind of fabricated social proof is exactly the tell readers associate with content-farm sites. Use the badge *slot* for something true instead (e.g., "New post every Monday," post/citation counts) until real credibility markers exist.
- **Do not adopt GitHub's testimonial-with-big-metric pattern until real metrics exist.** A "94% improvement" style headline stat requires real data. Fabricating one is worse than omitting the section. Skip proof sections entirely rather than simulate them.
- **Do not port tomoji's Tailwind/shadcn utility-class architecture wholesale.** SleepMedic is static hand-written CSS with custom properties; that's fine and appropriately lightweight for the site's size. Take tomoji's *token discipline* (semantic names, tiered radius/spacing) but keep the current plain-CSS implementation — introducing a full Tailwind/shadcn build pipeline is unnecessary complexity for a blog this size (violates the simplicity mandate).
- **Do not add a monospace/code-aesthetic UI font site-wide just because GitHub is a reference.** GitHub's precision aesthetic comes from information density appropriate to developers; SleepMedic's audience wants calm, not a "technical dashboard" feel. A monospace UI font would fight the "calm/nocturnal" brief directly — reserve monospace strictly for literal data values, if at all (§2.3.5).
- **Do not copy James Clear's book/course/app four-card footer structure yet.** That pattern assumes multiple owned products. SleepMedic currently has one deliverable (the blog + sleep plan lead magnet). Copying the multi-product footer now would either look sparse (one card) or invite padding it with things that don't exist (fake "app coming soon" cards, which the spec explicitly retires). Keep the footer minimal until there's a second real product.
- **Do not let the hero's serif-italic accent become a habit used on every H2.** tomoji and the proposed Fraunces treatment work because they're used exactly once per page, on the hero. Repeating a display serif on every section header would read as decorative noise, not editorial warmth, and slow scanning on a content-heavy blog.
- **Do not increase the number of accent colors.** The current six ad hoc category hex values are already at the edge of what a "calm" palette can carry. Resist the temptation each reference site's density might suggest (GitHub's multi-brand-color feature grids, tomoji's pink/blue/green Tailwind defaults) — SleepMedic's category tags should stay exactly as many as needed and no more, all defined as tokens.
- **Do not remove RSS.** Per spec it's demoted to the footer, not deleted — it still matters for a segment of technical/privacy-conscious readers in this audience (paramedics, IT-literate shift workers) and costs nothing to keep as a small footer link.

---

## 5. Open items for a follow-up pass (not blocking this brief)

- Audit `/blog/nurses/`, `/blog/paramedics/`, `/blog/new-parents/`, `/blog/shift-workers/` as they currently exist on disk against the hub blueprint in §3 — this brief specifies the target pattern but did not inventory those folders' current templates.
- Confirm whether "Build my free sleep plan" routes to a new dedicated capture page/route or an anchor on the existing pages — this brief assumes one canonical destination should be chosen but leaves the routing decision to implementation.
- Decide the real author/byline model (named persona vs. "SleepMedic Editorial") before building the author box — this affects schema.org markup as well as the visible UI.
