# ADR-001 / Spec: The Free-Value Engine

Status: DRAFT — awaiting grill-plan
Date: 2026-08-22
Owner: Jaden
Decides: what SleepMedic (sleepmedic.co) is, what gets built, what gets killed

---

## North Star

**Become the most useful free resource on the internet for people who sleep against the clock — and own the email list that proves it.**

The model is James Clear's blog before Atomic Habits: one narrow topic owned completely,
few definitive pieces instead of many thin ones, named concepts people repeat, a fixed
publishing cadence, and email capture everywhere with a real value exchange. The list is
the business. Products (the iOS app, anything else) come later and launch to the list.

**The only metric that counts: email subscribers.** Leading indicators: pillar-page
views, quiz completions, plan deliveries. Everything else (A/B tags, engagement seconds)
is noise at current scale and is suspended.

**Value stance: give the whole thing away.** The personalized plan is free and complete —
no teaser, no paywall, no affiliate links anywhere. If affiliates ever return it is gear
Jaden personally uses, disclosed, and never the point. Revenue is explicitly a non-goal
of this phase.

## Context (audit, 2026-08-22)

- 53 posts published, 106 all-time tracked views, 3 subscribers. Pipeline runs
  correctly, unattended, into a void.
- The one shift-work protocol page holds 44% of all traffic ever. The audience thesis
  is confirmed by our own data; recent output has drifted off-audience (perimenopause,
  gut bacteria).
- Plumbing (Actions pipeline, Pi service, GA4, docs) is good. The funnel, targeting,
  and trust details are not.
- Founder story exists nowhere in writing. VOICE.md is excellent and currently
  unenforced. The app codebase contains a complete, numeric plan-generation ruleset.
- Site is indexed; discovery failure is authority/demand, not indexing.

## Decision

Re-aim the existing machine from "AI sleep magazine" to "definitive free resource for
shift-worker sleep," rebuild the funnel around genuine value exchange, and put the
founder's real credential on it. Keep the two-system architecture. No new platforms.

### Non-goals (explicit)

- No affiliate monetization, no paid product, no paywall in this phase.
- No programmatic thin-page matrix (the routines.club move). Fewer, deeper pages win.
- No social-media presence beyond value-first community posts (WS9).
- No app marketing. The "Download App" smokescreen CTA is retired (app doesn't exist
  publicly; a false CTA is a trust leak). Replaced by plan/newsletter CTAs.
- No A/B machinery until a page clears ~1,000 views.

---

## WS0 — Trust fixes (first, before any content work)

| # | Fix | Where |
|---|-----|-------|
| 1 | Unsubscribe URL placeholder `your-pi.sleepmedic.co` → `pi.sleepmedic.co` (CAN-SPAM) | `pi-service/server.mjs:166` |
| 2 | Welcome email on signup (currently UI claims "Check your inbox" and nothing sends). Welcome = deliver the promised asset (plan or field manual) + what to expect | `pi-service/server.mjs` /subscribe handler; `blog/_template.html:505` |
| 3 | Kill the silent no-grounding fallback: if search grounding fails, the run FAILS and opens an issue. Never publish from model memory | `scripts/generate-blog-post.mjs:~454` |
| 4 | Newsletter form backfilled onto the 18 posts missing it | template + backfill script |
| 5 | Rotate Pi SSH password out of `OPERATIONS.md:16`; key auth only | Pi + docs |
| 6 | Nightly `subscribers.json` backup off the SD card (push encrypted copy to a private repo or GCS) | `pi-service/` + cron |
| 7 | Delete iCloud " 2" duplicate files, dead workflow copies (`weekly-blog-draft.yml` root + workflows dir), stale worktree | repo hygiene |

## WS1 — Editorial re-aim

**Audience, permanently: people who sleep against the clock.** EMS, nurses, fire,
dispatch, security, overnight retail/warehouse, residents, new parents. Everything
published must pass the test: *would a night-shift worker forward this to a coworker?*

**Two content tiers** (resolves VOICE.md vs. reference-content tension):

1. **Pillars & reference** — templated structure allowed, held to the evidence bar,
   no voice pretensions. Written/assembled with pipeline assistance, human-reviewed
   before publish (pillars are never auto-published).
2. **Voiced essays & newsletter** — VOICE.md rules absolutely. First person, one
   thread, self-interruption, end on tension. One per week. Claude drafts in Jaden's
   voice from real material; Jaden approves.

**topics.yaml is rewritten**: all six magazine buckets replaced with shift-work cells
(pattern-specific problems, first-night-back, day-sleep environment, caffeine timing,
naps on shift, driving home, nights + newborn). The weekly auto-post continues but only
inside these buckets, and only with grounding (WS0 #3).

**Expert transcript corpus**: new research stage. Curated episode list (Matt Walker
podcast + Huberman appearances, Huberman sleep toolkit, Kirk Parsley, relevant Attia
episodes) pulled via yt-dlp auto-captions into `research/transcripts/`. The research
stage cites episode + timestamp inline. Book content (e.g. Why We Sleep) is cited by
chapter, never ingested — no pirated texts, facts not prose. Where popularizer claims
conflict with primary literature, we say so; the rigor is the brand.

## WS2 — Funnel and CTAs

Every capture point states a value promise. The word "newsletter" never appears alone.

- **Homepage**: real email form above the fold. Primary CTA: "Build my free sleep plan"
  (→ quiz). Secondary: "One short brief a week for people who work while everyone
  sleeps." RSS demoted to footer. "Download App" removed.
- **Post pages**: mid-article capture on pillars (after the first payoff section),
  end-of-post capture everywhere, both promising the plan or the field manual — never
  "subscribe."
- **Pillar pages**: end in the quiz CTA ("This guide is general. Your schedule isn't —
  build your plan").
- **Welcome email** (WS0 #2) delivers the asset immediately, sets cadence expectation,
  one-line founder intro.
- Copy tone: Cialdini without the sleaze — commitment via the quiz's micro-answers,
  authority via citations + credential, unity via "built by someone who works the truck."

## WS3 — Quiz → free personalized plan (the value engine)

Web quiz, static JS + Pi endpoint (same pattern as /subscribe), reusing the app's
onboarding beats with the *unshipped* occupation-framed options:

1. Occupation: EMT/Paramedic (12s, 24s, 48s) / Nurse / Firefighter / Police-Dispatch /
   Other shift work / Not shift work
2. Pattern: Nights 3x12, Days 3x12, 24/48, 48/96, Kelly, DuPont, Panama 2-2-3, 24/72,
   rotating/irregular
3. Biggest struggle: falling asleep after shift / staying asleep / waking exhausted /
   all of it
4. Work-day wake anchor + rest-day wake anchor ("the one number the whole plan
   revolves around")
5. Caffeine: rough last-cup time
6. Email: "Where should we send your plan?"

**Plan generator ports the app engine's actual rules** (deterministic core; Claude only
renders prose around computed numbers — the numbers are never LLM-generated):

- Anchors: full credit ±30 min, zero at 120 (RealityEngine)
- Light: within 0–90 min after waking; avoid 3h pre-bed
- Caffeine: cutoff 8h before target sleep (default; the vision-doc model), first cup
  ≥60–90 min after waking. RESOLVED here: the "+8h after wake" LocalStore variant loses.
- Meals: finish ≥3h before wind-down
- Wind-down: 60–90 min before target sleep
- Nap: one planned nap 4–5.5h after waking when pattern demands
- Per-pattern schedules from ShiftTemplates geometry (e.g. 24/48: post-shift recovery
  sleep rules, anchor placement across the 48)
- Consistency framing: 7-opportunity ledger + grace, "after waking" never "morning"

Delivery: plan rendered as a clean page (tokenized URL) + emailed via Resend. Fully
free, printable. This IS the lead magnet.

**Field manual**: "The Shift Worker's Sleep Field Manual" — a genuinely good PDF
distilling the pillars; the general-purpose magnet for non-quiz capture points.

## WS4 — Identity and credential

- About page rewritten in first person: working paramedic, has run 12s, 24s, 48s,
  nights, rotating — the credential is the differentiator. **[TODO: Jaden's raw story
  dump — does not exist in writing anywhere; blocked on him.]**
- **[DECISION FOR JADEN: real name on the site? Recommended yes.]**
- Author box on every post; Person JSON-LD with credential; footer entity
  TeachMeToLive LLC.

## WS5 — Named concepts (the Clear move)

One definitive essay each, linked forever, vocabulary used consistently site-wide:

- **Sleep Anchors** — the one number the whole plan revolves around
- **Sleep protection, not sleep advice** — you know what to do; nobody helps you
  protect it (the thesis essay)
- **"After waking," never "morning"** — the night-worker reframe
- **The 7-Opportunity Streak** (+ grace) — consistency scored fairly for shift work
- **The First Night Back** — the hardest night in shift work, named

## WS6 — Pillar guides (initial set, ~1 per 2 weeks, human-reviewed)

1. Sleep on 24/48: The Complete Guide
2. Sleep on Nights (3x12): The Complete Guide
3. Rotating Shifts: The Complete Guide
4. Sleep on 48/96
5. Nights With a Newborn
6. The First Night Back Protocol (doubles as WS5 essay)

Each: primary-study + transcript citations, printable, per-section anchors, FAQ/HowTo
schema, honest dateModified maintenance, ends in quiz CTA.

## WS7 — The weekly brief

Short, fixed-day, forwardable. Format: one protocol, one study explained straight, one
field note. Jaden's voice (VOICE.md), drafted by Claude from real material, approved by
Jaden. Sent via existing Pi/Resend path.

## WS8 — GEO

Hand-written `llms.txt` (browsing guide for LLMs: pillars, concepts, quiz, who we are).
Keep existing schema; add Person + credential. Quarterly refresh job re-touches pillars
with real updates before re-dating. Target: be the citation for "how do shift workers
sleep" class queries.

## WS9 — Distribution (value-first only)

- Reddit: r/nightshift, r/ems, r/nursing — post the artifacts (field manual, pillar,
  planner), participate honestly, never spam. Cadence: when there's something worth
  sharing, not on schedule.
- The brief itself is the referral loop (forwardable; "forwarded this? get your own").
- Delete the Twitter stub or wire it — no half-built channels.

## Sequencing

1. WS0 trust fixes + WS1 topics.yaml/pipeline changes (one batch)
2. WS4 About (needs Jaden's story) + WS2 funnel rebuild
3. WS3 quiz → plan
4. WS5/WS6 rolling: first thesis essay + first two pillars
5. WS7 brief starts when there are ≥2 pillars to cite
6. WS8/WS9 continuous after 3

## Open questions (grill-plan targets)

1. Name on site? (WS4)
2. Story dump — voice memo or text, whenever ready.
3. Cadence commitment for the weekly voiced essay/brief approval loop (~30 min/wk of
   Jaden's time). If zero-touch is required, brief goes biweekly and pillar-review
   batches monthly.
4. Repo location: still on iCloud-synced Desktop (source of " 2" dupes). Move to
   ~/dev like PQ-B2C?
5. Keep the Pi as the email backbone for now (fine at this scale), revisit at 1k subs?

## Status addendum (2026-08-22, end of day)

Every workstream shipped same-day except the ongoing rhythms:
WS0-WS3 complete (trust, editorial, funnel, quiz+plan - plus unplanned additions:
Schedule Manager, tools, schedules matrix, guides). WS4 complete including the real
name. WS5 partially (thesis essay + Nap Menu live; three named-concept essays remain).
WS6 two of six pillars live (24/48, Nights 3x12). WS7 live (brief No. 1 sent; Discord
approval flow verified). WS8 live (llms.txt, GSC verified, IndexNow). WS9 staged but
ON HOLD (Reddit drafts written, not posted - Jaden's call).
Open: remaining essays/pillars on cadence, Reddit go/no-go, Pi password rotation.
