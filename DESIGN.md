# SleepMedic — Design System

Implemented in `blog/_shared-styles.css`, which every front-of-site page links.
Page-local `<style>` blocks may add layout, never redefine tokens.

## Scene

A medic on hour 19 of a 24, parked in a dark bay, reading on a phone at half
brightness. That sentence forces the theme: dark, low-glare, no pure white, no
pure black, nothing that flares in a dark room.

## Color strategy: Restrained

Tinted neutrals plus one accent held under ~10% of surface area. The accent
marks interactive or load-bearing elements only: primary buttons, links, active
states, category labels. Never decoration.

Neutrals are tinted toward the brand hue (a cool indigo), never neutral gray.
`--bg` is `#0a0a0c`, not `#000`. `--text` is `#f5f5f5`, not `#fff`.

The palette carries forward the shipping lavender/blue identity from the
existing site (53 published posts depend on it). This is identity preservation,
not a fresh choice.

### Tokens

Surfaces layer in three steps, never more: `--bg` → `--surface` → `--surface-2`.
Borders are alpha-white hairlines with a `--border-hover` step.

Text has three steps: `--text` (headings), `--text-2` (body), `--text-3` (meta).

Accent pair: `--accent` (#a78bfa lavender) and `--accent-2` (#60a5fa blue), plus
`--accent-dim` for tinted fills. `--success` for the live-status dot only.

Category colors are named tokens (`--cat-science`, `--cat-tools`, …), never ad
hoc hex in page CSS. Six of them, and the count does not grow.

### Radius tiering

`--radius-pill` (999px) badges and tags · `--radius-lg` (16px) cards and major
surfaces · `--radius-md` (10px) buttons · `--radius-sm` (8px) inputs.

## Typography

- **Inter** — UI, body, headings. Already shipping site-wide across every post;
  changing it is churn, not design. Weights 400/500/600/700/800.
- **Source Serif 4 italic** — the accent voice. Used for exactly one phrase per
  page, inside an otherwise-Inter headline. Chosen over the obvious display
  serifs because the brand's physical object is a laminated protocol card, not a
  magazine cover: Source Serif was drawn for on-screen reading and reads as a
  clinical reference face rather than editorial affectation. Loaded italic-only
  (400/600) to keep the font payload small.
- **No monospace font.** `ui-monospace` system stack only, and only for literal
  numeric values.

Every stack ends in a real system fallback.

### Rules

- One serif-italic accent phrase per page. Never on H2s. Never a full sentence.
- Body copy caps at 65–75ch. The reading column is 720px.
- Dark-mode line-height bonus: body runs 1.85, not 1.6.
- Type scale steps ≥1.25×.

## Layout

- **Left-aligned asymmetric hero.** The previous centered-stack hero read as
  template. The hero is a two-column composition at desktop and stacks on mobile.
- Section padding is tiered, not uniform: `--space-hero` for major breaks,
  `--space-section` for standard, tighter inside groups.
- Rhythm alternates wide statement → dense grid → wide statement.
- Grids use `repeat(auto-fit, minmax(280px, 1fr))` for breakpoint-free response.

## Motion

Hover and focus transitions only. No entrance animation, no scroll reveals. The
one exception is the status-dot pulse, which signals a live publishing cadence.
`prefers-reduced-motion` disables it. Restraint is the voice here: an animated
landing page aimed at exhausted people would be the wrong instinct.

## Bans specific to this site

- **No gradient text.** The previous hero used `background-clip:text`. It is
  decoration masquerading as hierarchy, and it fails on high-contrast modes.
  Emphasis comes from the serif italic and from weight.
- **No fabricated proof.** No subscriber counts, testimonials, "as seen in"
  rows, or metrics until real ones exist.
- **No app-download CTA anywhere.** Retired from the funnel.
- **No colored side-stripe borders.** Callouts use full hairline borders and a
  tinted fill.
- **No identical three-card icon grid.** The "what you get" section varies card
  weight and content shape instead.

## Accessibility

- Visible `:focus-visible` ring on every interactive element, drawn in `--accent`.
- Contrast: `--text-2` on `--surface` clears 4.5:1; `--text-3` is reserved for
  meta text at or above its minimum size.
- Buttons on `--accent` use `--bg` as foreground for a high-contrast pair.
- Forms carry real labels (visually hidden where the design needs it), and
  status messages use `role="status"` for screen-reader announcement.
