# SleepMedic — Product Context

Source of truth: `docs/design-direction.md` (design brief, 2026-08-22) and
`docs/2026-08-22-north-star-free-value-engine.md` (strategy). This file
summarizes those documents for design work; when they disagree, they win.

## register

brand

The front-of-site is marketing and long-form editorial. The design *is* the
product: sleepmedic.co has no app shell, no logged-in state, no dashboard. The
only interactive surface is a quiz at `/plan/` and email capture forms.

## Product purpose

Publish evidence-based sleep science for people whose schedules make ordinary
sleep advice useless, and convert readers into subscribers by giving away a
genuinely useful free artifact: a personalized sleep plan built from a short
quiz, plus a weekly brief.

The business model is not the app. The north-star doc retires "Download App"
from the funnel entirely. The free plan is the product the site sells.

## Users

- **Paramedics and EMTs** — 12s, 24s, 48s. Post-call insomnia, hypervigilance,
  no control of when the tones drop. The founder is one of these.
- **Nurses** — 3x12s, rotating days-to-nights, the "first night back."
- **Firefighters, police, dispatch** — Kelly, DuPont, 24/72.
- **New parents** — broken nights, no schedule to protect at all.
- **Anyone off a 9-to-5** — the biology is the same; shift work is the hard case.

They read on phones, often at 3am, often exhausted, often on hospital or station
wifi. Mobile-first is not a checkbox here; it is the primary case.

## Brand and tone

- **Rigor is the brand.** Every claim cited. Where popularizers conflict with
  primary literature, say so.
- **Plain, declarative, unhyped.** Capability statements, not adjective stacks.
  "Sleep plans that survive 24s and 48s," not "Amazing sleep science."
- **Peer, not authority-figure.** Built by someone who works the truck. Speak to
  someone who already knows what good sleep looks like and cannot get it.
- **"After waking," never "morning."** Vocabulary that assumes a night worker.
- **Never sell a newsletter.** Every capture states a named artifact and a
  cadence. The word "newsletter" never appears alone.
- Honest about limits. No medical advice. No fabricated proof.

## Anti-references

Things the site must never be mistaken for:

- **AI content-farm slop.** This is the explicit, repeated goal in both docs.
  Tells to avoid: fabricated social proof, invented metrics, "as seen in" rows,
  stock-photo optimism, generic stacked feature cards, headline adjective soup.
- **Dark-mode SaaS landing page.** Gradient-text hero, hero-metric template,
  three identical icon cards, pill badge saying "AI-powered."
- **Wellness/sleep-hygiene blog.** Soft focus, lavender-fields imagery, "sweet
  dreams," moon-and-stars decoration, aspirational lifestyle framing.
- **Clinical/medical-portal.** White and teal, stock stethoscopes, institutional
  voice.

## Strategic principles

1. **Value before ask.** Prove quality (real posts, real citations, honest
   stats), then ask for the email. Never the reverse.
2. **Named artifact, stated cadence.** Every form: what you get, how often.
3. **One primary action per view.** "Build my free sleep plan" is the primary.
   Everything else is secondary or ghost.
4. **Audience specificity converts.** A named, audience-scoped promise beats a
   generic one. Hubs carry their own value promise.
5. **No invented credibility.** Until real numbers exist, the proof slot holds
   only true statements (post count, citation practice, publishing cadence).
6. **Restraint over decoration.** Polish reads through hover states, spacing
   discipline, and typography, not through motion or effects.
7. **Static and fast.** No frameworks. No build step. Hand-written CSS with
   custom properties, per the brief's explicit simplicity mandate.

## Constraints

- Static HTML on GitHub Pages. No build system.
- Google Fonts only. Page weight budget ~60KB HTML+CSS per page.
- Existing JS contracts must survive: GA4 events, `data-sm-newsletter` +
  `data-sm-newsletter-msg`, the `posts-index.json` fetch, `views.json` fetch,
  JSON-LD blocks, giscus.
- Email capture POSTs `{ email, leadMagnet }` to `https://pi.sleepmedic.co/subscribe`.
- Legal entity in the footer: TeachMeToLive LLC.
- The founder's story does not exist in writing yet. Placeholders, never
  fabrication.
