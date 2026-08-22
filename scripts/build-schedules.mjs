#!/usr/bin/env node
/**
 * Builds /schedules/ — one static reference page per shift pattern, plus an index.
 *
 * Every clock time on these pages is computed by plan/engine.mjs from the example
 * anchors in DEFAULTS below. Nothing here reimplements a rule: the generator only
 * asks the engine for a plan and lays the result out. Rerunnable and deterministic
 * — no Date.now anywhere in the output, only the UPDATED stamp.
 *
 *   node scripts/build-schedules.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, PATTERNS, fmt } from '../plan/engine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'schedules');
const SITE = 'https://sleepmedic.co';
const UPDATED = 'Updated August 2026';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Per-pattern copy and example anchors ──────────────────────────────
//
// slug        the URL segment
// h1/title    the reader's words for this rotation
// cycle       how the rotation actually runs. Structure only — cycle lengths and
//             day counts, nothing about how it feels.
// hard        what the structure itself makes difficult. Derived from the cycle
//             above and from the day-types the engine returns, never from
//             invented lived experience.
// workWake /  the example anchors. Labelled as examples on every page.
// restWake
// anchorWhy   one line saying why these particular example times are sensible.
// faqs        question + a function of the built plan returning the answer, so
//             the JSON-LD answer text is generated from the same numbers the
//             visible table shows.

// "an 11:30 PM target", "a 10:30 PM target" — 8 and 11 take "an".
const aOrAn = (t) => (/^(8|11)[:\s]/.test(t) ? 'an' : 'a');

const D = (id) => (plan) => plan.days.find((d) => d.id === id);
const blk = (day, key) => day.blocks.find((b) => b.key === key);
const timeOf = (day, key) => (blk(day, key) || {}).time || '';

const PATTERNS_META = {
  nights3x12: {
    slug: 'nights-3x12',
    h1: 'Sleeping days on three 12-hour nights',
    title: 'Nights, three 12s: a sleep schedule you can actually hold',
    desc: 'How to sleep on three consecutive 12-hour night shifts, with a worked example: light window, caffeine cutoff, last meal, wind-down, sleep target and nap window computed from one wake anchor.',
    lede: 'Three twelve-hour nights in a row, usually 1900 to 0700 or 1800 to 0600, then four days off. The three nights sit back to back, which is the part that makes the pattern workable: you are asking your body to hold one sleep schedule for three days rather than flipping it every other day. The days off are where it comes apart, because a normal day schedule is right there waiting.',
    hardTitle: 'The hard part of three nights',
    hard: 'The block itself is the easy half. Three nights running means one wake anchor held for three days, and the plan below only has to survive that. What the structure takes from you is the boundary at each end. You come off the last night owing a sleep debt and facing a full day of daylight, and everyone you live with is on the opposite clock. The engine handles that with a separate transition day-type: a short sleep aligned to the block rather than a full day sleep, which is what lets you go to bed that evening instead of at noon the next day.',
    workWake: '15:00',
    restWake: '09:00',
    anchorWhy: 'A 3:00 PM wake puts the 12-hour night starting at 1800 three hours after you get up, and leaves the sleep opportunity in the darkest part of the morning after it.'
  },
  days3x12: {
    slug: 'days-3x12',
    h1: 'Three 12-hour days and your sleep',
    title: 'Days, three 12s: the schedule that is easy to hold and easy to wreck',
    desc: 'A worked sleep plan for three consecutive 12-hour day shifts: computed light window, caffeine cutoff, last meal, wind-down and sleep target from one wake anchor.',
    lede: 'Three twelve-hour days in a row, usually 0700 to 1900, then four days off. Of the nine patterns here this is the one closest to a daylight schedule, and the only one where the work-day anchor and a normal rest-day anchor can sit within an hour of each other.',
    hardTitle: 'The hard part of three 12-hour days',
    hard: 'A 12 that starts at 0700 puts your wake anchor near 0500, which is early enough that a full sleep opportunity has to start before most people have finished dinner. That is the squeeze: the pattern is aligned to daylight but shifted early inside it. Then the four days off arrive and there is nothing forcing the anchor, so it drifts. The engine gives this pattern only two day-types, work and rest, because there is no turnaround to plan around — which means everything rests on how far apart you let those two anchors get.',
    workWake: '05:00',
    restWake: '06:30',
    anchorWhy: 'A 5:00 AM wake puts the shift start at 0700 with time to get out the door, and a 6:30 AM rest-day anchor sits inside the hour and a half of drift the pattern can absorb.'
  },
  s24_48: {
    slug: '24-48',
    h1: 'Sleeping on the 24/48',
    title: 'Sleeping on the 24/48: a worked schedule',
    desc: 'A worked sleep plan for the 24/48 rotation: the shift day, the recovery day and the reset day, with light, caffeine cutoff, meals, wind-down and nap windows computed from one wake anchor.',
    lede: 'Twenty-four hours on duty, then forty-eight off, repeating on a three-day cycle. Every third day you are back at shift change. The cycle is short enough that the same wake anchor can carry all three days, and it lands the two days off in a fixed order every time: the day you come off the truck, then a clear day before you go back.',
    hardTitle: 'The hard part of the 24/48',
    hard: 'The sleep you get on duty is not schedulable, so the plan has to be built around the two days off, and the structure makes those two days do different jobs. The first is short — you are awake from shift change and the night is already close — so the engine gives it a shorter sleep opportunity aligned to the shift-day anchor rather than a full eight. Chase eight hours in the morning after a 24 and you take them out of that night. The second day off is the only place in the whole cycle where a full night has room, and it is the last thing before the next 24. Rested going into a shift is decided there.',
    workWake: '06:30',
    restWake: '07:30',
    anchorWhy: 'A 6:30 AM wake puts you at an 0830 shift change with time to get to the station, and a 7:30 AM rest-day anchor keeps the reset day within an hour of the shift day.'
  },
  s48_96: {
    slug: '48-96',
    h1: 'Sleeping on the 48/96',
    title: 'Sleeping on the 48/96: a worked schedule',
    desc: 'A worked sleep plan for the 48/96 rotation: two days on duty, a recovery day, then the rest of the four days off, with computed light, caffeine, meal, wind-down and nap windows.',
    lede: 'Forty-eight hours on duty, then ninety-six off, on a six-day cycle. Two full days at the station back to back, then four days clear. The two on-duty days are identical in structure, which is why the engine builds one shift-day type and applies it to both.',
    hardTitle: 'The hard part of the 48/96',
    hard: 'Forty-eight hours on duty means two sleep opportunities you do not control, one after another, and the second is the one that goes badly — you enter it already short. There is no version of a 48 where the plan produces good sleep on the second night, so the plan is damage control: every horizontal opportunity taken, and the caffeine cutoff held even when it is the second night and the cutoff feels absurd. The other half is the ninety-six. Four clear days is long enough that the anchor drifts later a bit each day if nothing holds it, and the last day off is what you take into the next 48. The engine keeps the day off the 48 as its own recovery type, aligned to the shift anchor, rather than treating it as the first day of the break.',
    workWake: '06:30',
    restWake: '08:00',
    anchorWhy: 'A 6:30 AM wake puts you at an 0830 shift change, and an 8:00 AM rest-day anchor is about as late as the four days off can drift without leaving a gap to close before the next 48.'
  },
  kelly: {
    slug: 'kelly',
    h1: 'The Kelly schedule and your sleep',
    title: 'The Kelly schedule and your sleep: a worked plan',
    desc: 'A worked sleep plan for the Kelly schedule: 24 on, 24 off, 24 on, 24 off, 24 on, then four days off, with computed light, caffeine, meal, wind-down and nap windows per day-type.',
    lede: 'Three 24-hour tours separated by single days off, then a four-day break, on a nine-day cycle: on, off, on, off, on, then four off. The single days between tours are the defining feature. You are never more than a day away from the next shift change until the break arrives.',
    hardTitle: 'The hard part of the Kelly schedule',
    hard: 'A single day between two 24s is not a break, and the structure will not let it be one. You come off duty in the morning, and the next shift change is the following morning — so the sleep opportunity in between is the only one you get, and it has to leave you fit for another twenty-four hours. That is why the engine treats those single days as recovery rather than rest: a shorter sleep held near the shift-day anchor and an early night, not a lie-in. The four-day break is the only place in the cycle where a rest-day anchor has room to hold for more than one day, and it is also where the whole thing can be undone by drifting three hours later across four days.',
    workWake: '06:30',
    restWake: '08:00',
    anchorWhy: 'A 6:30 AM wake puts you at an 0830 shift change; the 8:00 AM rest anchor is for the four-day break, which is the only stretch long enough to hold a different one.'
  },
  dupont: {
    slug: 'dupont',
    h1: 'The DuPont schedule and your sleep',
    title: 'The DuPont schedule and your sleep: a worked plan',
    desc: 'A worked sleep plan for the DuPont rotation: four nights, three off, three days, one off, three nights, three off, four days, seven off, with computed windows per day-type.',
    lede: 'A four-week cycle of twelve-hour shifts: four nights, three days off, three days, one day off, three nights, three days off, four days, then seven days off. Two things follow from that structure. Every work run is short — three or four shifts — and the cycle turns you from nights to days and back inside a single month, with as little as one day off in between.',
    hardTitle: 'The hard part of the DuPont schedule',
    hard: 'Two features of the cycle do most of the damage, and both are structural. The first is the single day off between the three-day run and the three nights that follow it. One day is not enough time to move a body clock across twelve hours, so that turnaround is a night worked on a day schedule no matter what you do; the plan can only make it shorter, not painless. The engine gives it its own turnaround day-type for exactly that reason — a short deliberate sleep aligned to where you are going rather than a full sleep aligned to where you have been. The second is the seven days off at the end. That is long enough to fully return to daylight, which feels like a reward and means the four nights that open the next cycle start from zero.',
    workWake: '15:00',
    restWake: '09:00',
    anchorWhy: 'A 3:00 PM wake puts the 12-hour night starting at 1800, which is the harder half of the cycle to hold. The 9:00 AM rest anchor is for the breaks.'
  },
  panama223: {
    slug: 'panama',
    h1: 'The Panama 2-2-3 and your sleep',
    title: 'The Panama 2-2-3 and your sleep: a worked plan',
    desc: 'A worked sleep plan for the Panama 2-2-3 rotation: two on, two off, three on, then the mirror, with computed light, caffeine, meal, wind-down and nap windows.',
    lede: 'Twelve-hour shifts on a two-week cycle: two on, two off, three on, two off, two on, three off — then the same pattern with the roles reversed. No work run is longer than three shifts, and no break is longer than three days. You end up with every other weekend off, which is the reason the pattern gets adopted.',
    hardTitle: 'The hard part of the Panama 2-2-3',
    hard: 'Nothing in this cycle lasts long enough to adapt to. A two-day run ends before a body clock has moved, and a two-day break ends before it has moved back. If the version you work turns over between days and nights, that limit is the whole story: you are never fully on either schedule, and there is no run long enough to get there. That is an argument for keeping the two anchors close together rather than swinging between them, which is what the engine does here — it builds the short two-day break as its own day-type with a nearly full sleep opportunity held near the work anchor, and saves the wider rest anchor for the three-day break.',
    workWake: '05:30',
    restWake: '07:00',
    anchorWhy: 'A 5:30 AM wake puts the shift start at 0730 on the day half of the rotation, and a 7:00 AM rest anchor keeps the breaks within about ninety minutes of it.'
  },
  s24_72: {
    slug: '24-72',
    h1: 'Sleeping on the 24/72',
    title: 'Sleeping on the 24/72: a worked schedule',
    desc: 'A worked sleep plan for the 24/72 rotation: the shift day, the recovery day and the two clear days, with computed light, caffeine, meal, wind-down and nap windows.',
    lede: 'Twenty-four hours on duty, then seventy-two off, on a four-day cycle. One tour, then three clear days before the next shift change. It is the same shift-day structure as a 24/48 with one more day off attached to the end.',
    hardTitle: 'The hard part of the 24/72',
    hard: 'Three days off is enough room to drift, and drift is the failure mode this pattern has instead of exhaustion. The recovery day works the same as it does on a 24/48 — a shorter sleep aligned to the shift anchor, a planned nap, an early night — but after that there are two full days with nothing holding the anchor in place. Let it slide an hour a day and the last day off ends two hours from where the next shift change needs you. That is a bad first tour built entirely out of good days off.',
    workWake: '06:30',
    restWake: '07:30',
    anchorWhy: 'A 6:30 AM wake puts you at an 0830 shift change, and a 7:30 AM rest anchor is close enough that two clear days will not open a gap.'
  },
  rotating: {
    slug: 'rotating',
    h1: 'Rotating and irregular schedules',
    title: 'Rotating and irregular shifts: a sleep plan with a moving anchor',
    desc: 'A worked sleep plan for rotating and irregular schedules, where the anchor moves with the work block rather than the calendar. Computed light, caffeine, meal, wind-down and nap windows.',
    lede: 'No fixed cycle. The shift type changes between blocks — days one week, nights the next, or a schedule posted a fortnight at a time with no pattern to it at all. What holds constant is the shape of a block: a run of shifts of one type, then time off, then a run of a different type.',
    hardTitle: 'The hard part of a rotating schedule',
    hard: 'A fixed pattern gives you one thing an irregular one does not: a wake anchor that means the same thing next week. Without that, the anchor has to move, and the only structure left to attach it to is the block itself rather than the days of the week. So the plan sets the anchor when the block is posted, holds it for every day inside the block, and changes it only on the changeover. The changeover is where the pattern costs you — it is a sleep aligned to the block you are leaving, followed immediately by a shift belonging to the block you are entering. The engine builds that day as its own type: a shorter sleep aligned to where you are going, with the light window right after it doing the work of pulling the clock along.',
    workWake: '15:00',
    restWake: '08:00',
    anchorWhy: 'A 3:00 PM wake is the harder case — a night block — and the one worth working through. On a day block the same plan runs off an earlier anchor and every window moves with it.'
  }
};

// One-line descriptions for the index cards.
const CARD_LINE = {
  nights3x12: 'Three 12-hour nights back to back, then four days off.',
  days3x12: 'Three 12-hour days back to back, then four days off.',
  s24_48: '24 hours on duty, 48 off, on a three-day cycle.',
  s48_96: 'Two days on duty, then four days clear, on a six-day cycle.',
  kelly: 'Three 24s split by single days off, then a four-day break.',
  dupont: 'Four weeks of 12s that turn from nights to days and back.',
  panama223: 'Two on, two off, three on. Every other weekend free.',
  s24_72: '24 hours on duty, then three clear days.',
  rotating: 'No fixed cycle. The anchor moves with the block.'
};

// ── FAQ builders ──────────────────────────────────────────────────────
// Each returns [{q, a}]. Answers are assembled from the built plan, so the
// JSON-LD text and the visible table can never drift apart.

function faqsFor(id, plan, meta) {
  const work = D('work')(plan);
  const rest = D('rest')(plan);
  const trans = D('transition')(plan);
  const label = PATTERNS.find((p) => p.id === id).label;
  const cutoff = (d) => timeOf(d, 'caffeine').replace(/^.*stop by /, '');
  const sleepT = (d) => timeOf(d, 'sleep');
  const napT = (d) => timeOf(d, 'nap');
  const wd = (d) => timeOf(d, 'windDown');
  const lightT = (d) => timeOf(d, 'light');
  const mealT = (d) => timeOf(d, 'meal').replace(/^by /, '');

  const out = [
    {
      q: `When should I stop drinking coffee on ${meta.faqName}?`,
      a: `Eight hours before the sleep opportunity you are protecting. In the worked example on this page, a ${work.wakeAnchor} wake anchor on a work day puts the sleep target at ${sleepT(work)}, so the last caffeine of any kind lands at ${cutoff(work)}. Move the anchor and the cutoff moves with it — the eight hours is the rule, not the clock time.`
    },
    {
      q: `What time should I go to sleep on ${meta.faqName}?`,
      a: `The plan sets the sleep target backward from the wake anchor rather than forward from the end of a shift. In the example here, a ${work.wakeAnchor} work-day anchor gives ${aOrAn(sleepT(work))} ${sleepT(work)} sleep target, with wind-down starting at ${wd(work).split(' to ')[0]}. On a rest day the ${rest.wakeAnchor} anchor gives ${aOrAn(sleepT(rest))} ${sleepT(rest)} target.`
    },
    {
      q: `When should I get bright light on ${meta.faqName}?`,
      a: `Within 90 minutes of waking, whatever the sun is doing. In the worked example that is ${lightT(work)} on a work day. Ten to fifteen minutes is enough. Then keep bright light off you in the three hours before the sleep target.`
    },
    {
      q: `When should I stop eating on ${meta.faqName}?`,
      a: `Finish the last real meal three hours before wind-down starts — ${mealT(work)} on a work day in this example, given the ${wd(work).split(' to ')[0]} wind-down. After that keep it small and boring rather than nothing at all.`
    }
  ];

  if (napT(work)) {
    out.push({
      q: `Should I nap on ${meta.faqName}?`,
      a: `One nap, taken on purpose, four to five and a half hours after waking — ${napT(work)} in the worked example on this page. Twenty to thirty minutes, or a full ninety. Anything in between leaves you groggy.`
    });
  }

  if (trans) {
    out.push({
      q: `${meta.transQ}`,
      a: `${trans.name} is planned as its own kind of day rather than a normal one. In the example, it runs on a shorter sleep opportunity ending at ${trans.wakeAnchor}, with the caffeine cutoff at ${cutoff(trans)} and the last real meal by ${mealT(trans)}.`
    });
  }

  // Schema.org FAQPage wants a focused set. Five is the cap; the meal question
  // is the first to go when a pattern has both a nap and a turnaround day.
  return out.length > 5 ? out.filter((f) => !/stop eating/.test(f.q)) : out;
}

// The name that reads naturally inside a question.
const FAQ_NAME = {
  nights3x12: 'three 12-hour nights',
  days3x12: 'three 12-hour days',
  s24_48: 'the 24/48',
  s48_96: 'the 48/96',
  kelly: 'the Kelly schedule',
  dupont: 'the DuPont schedule',
  panama223: 'the Panama 2-2-3',
  s24_72: 'the 24/72',
  rotating: 'a rotating schedule'
};

const TRANS_Q = {
  nights3x12: 'How do I sleep coming off the last night shift?',
  s24_48: 'How should I sleep on the day I come off the 24?',
  s48_96: 'How should I sleep on the day I come off the 48?',
  kelly: 'How should I use the single day off between two 24s?',
  dupont: 'How do I handle the turnaround from days to nights?',
  panama223: 'How should I use the two-day break inside the cycle?',
  s24_72: 'How should I sleep on the day I come off the 24?',
  rotating: 'How do I handle the day the rotation changes?'
};

// ── Shared page shell ─────────────────────────────────────────────────

const NAV_BRAND_SVG = '<svg viewBox="0 0 64 64" width="21" height="21" aria-hidden="true" style="vertical-align:-5px;margin-right:7px"><path d="M32 5 L55 13 V31 C55 45.5 44.5 54.5 32 59 C19.5 54.5 9 45.5 9 31 V13 Z" fill="#1c1c1f" stroke="#a78bfa" stroke-width="2.8" stroke-linejoin="round"/><g transform="translate(3.95,8.26) scale(0.6842)"><path d="M 40 8 A 14.5 14.5 0 1 0 55 25 A 11.5 11.5 0 1 1 40 8 Z" fill="#f2ead9"/></g><path d="M15 43 H23 L26.5 36 L31 49 L34.5 43 H49" fill="none" stroke="#60a5fa" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function nav(ctaTag) {
  return `  <nav class="site-nav site-nav--narrow">
    <a href="/" class="nav-brand">${NAV_BRAND_SVG}SleepMedic</a>
    <div class="nav-links">
      <a href="/blog/">Blog</a>
      <a href="/schedules/">Schedules</a>
      <a href="/manual/">Manual</a>
      <a href="/about/">About</a>
      <a href="/plan/" class="nav-cta" data-cta="${esc(ctaTag)}"><span class="nav-cta-full">Build my free sleep plan</span><span class="nav-cta-short">Free plan</span></a>
    </div>
  </nav>`;
}

const FOOTER = `  <footer class="site-footer site-footer--narrow">
    <p>&copy; 2026 TeachMeToLive LLC</p>
    <div class="footer-links">
      <a href="/">Home</a>
      <a href="/blog/">Blog</a>
      <a href="/schedules/">Schedules</a>
      <a href="/manual/">Manual</a>
      <a href="/privacy/">Privacy</a>
      <a href="/blog/feed.xml">RSS</a>
    </div>
  </footer>`;

const CAPTURE_SCRIPT = `  <script>
    document.addEventListener('click', (e) => {
      const cta = e.target.closest('[data-cta]');
      if (cta && window.gtag) window.gtag('event', 'plan_cta_click', { location: cta.dataset.cta });
    });

    document.querySelectorAll('[data-sm-newsletter]').forEach((f) => {
      const msg = f.parentElement.querySelector('[data-sm-newsletter-msg]');
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = f.querySelector('input[name="email"]');
        const email = (input?.value || '').trim();
        if (!email) return;
        const btn = f.querySelector('button');
        if (msg) msg.textContent = 'Subscribing...';
        if (btn) btn.disabled = true;
        try {
          const r = await fetch('https://pi.sleepmedic.co/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, source: f.dataset.smSource || 'schedules', leadMagnet: f.dataset.smLeadMagnet })
          });
          const j = await r.json();
          if (msg) msg.textContent = j.ok ? (j.already ? 'Already subscribed.' : 'Subscribed. Check your inbox.') : (j.error || 'Something went wrong.');
          if (j.ok && input) input.value = '';
        } catch {
          if (msg) msg.textContent = 'Could not reach the server. Try again in a minute.';
        }
        if (btn) btn.disabled = false;
      });
    });
  </script>`;

function capture(slug) {
  return `    <section class="capture" style="margin-top:var(--space-section);">
      <p class="capture-eyebrow">Free, no account</p>
      <h2>The weekly brief</h2>
      <p class="capture-copy">One short email a week: what the research actually says, and what to do with it on your schedule.</p>
      <form class="capture-form" data-sm-newsletter data-sm-lead-magnet="schedule-guide" data-sm-source="schedules">
        <label class="visually-hidden" for="${esc(slug)}-email">Email address</label>
        <input type="email" id="${esc(slug)}-email" name="email" required autocomplete="email" placeholder="you@email.com" />
        <button type="submit">Subscribe</button>
      </form>
      <p class="capture-msg" role="status" data-sm-newsletter-msg></p>
      <p class="capture-fine">One email a week. Unsubscribe anytime.</p>
    </section>`;
}

const PAGE_CSS = `    .sched-hero { padding: clamp(36px, 5.5vw, 60px) 0 26px; }
    .sched-hero .crumb { font-size: 0.8rem; color: var(--text-3); margin-bottom: 14px; }
    .sched-hero .crumb a { color: var(--text-3); }
    .sched-hero .crumb a:hover { color: var(--accent); }
    .sched-hero h1 {
      font-size: clamp(1.9rem, 4.4vw, 2.7rem); font-weight: 800;
      line-height: 1.1; letter-spacing: -0.04em; margin-bottom: 16px;
    }
    .sched-hero h1 .serif { font-weight: 400; letter-spacing: -0.02em; }
    .sched-hero .lede { font-size: 1.03rem; color: var(--text-2); line-height: 1.75; max-width: 66ch; }
    .sched-meta {
      display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center;
      margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border);
      font-size: 0.83rem; color: var(--text-3);
    }

    .sched-body h2 {
      font-size: clamp(1.3rem, 2.9vw, 1.6rem); font-weight: 700;
      letter-spacing: -0.02em; margin: 48px 0 12px; line-height: 1.2;
    }
    .sched-body p { color: var(--text-2); line-height: 1.75; margin: 0 0 16px; max-width: 68ch; }
    .sched-body p a { text-decoration: underline; text-decoration-color: var(--accent-line); text-underline-offset: 3px; }

    .example-note {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius-md); padding: 16px 18px; margin: 0 0 26px;
      font-size: 0.9rem; color: var(--text-3); line-height: 1.65; max-width: 68ch;
    }
    .example-note b { color: var(--text-2); font-weight: 600; }

    .daytype { margin: 0 0 26px; }
    .daytype h3 { font-size: 1.05rem; font-weight: 700; margin-bottom: 3px; }
    .daytype .when { font-size: 0.85rem; color: var(--text-3); margin-bottom: 12px; }
    .table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius-lg); }
    table.sched { width: 100%; border-collapse: collapse; font-size: 0.9rem; min-width: 460px; }
    table.sched th, table.sched td { text-align: left; padding: 11px 16px; border-bottom: 1px solid var(--border); vertical-align: top; }
    table.sched tr:last-child th, table.sched tr:last-child td { border-bottom: 0; }
    table.sched th {
      font-weight: 600; color: var(--text); width: 38%;
      background: var(--surface); white-space: nowrap;
    }
    table.sched td { color: var(--text-2); font-variant-numeric: tabular-nums; }
    table.sched caption {
      caption-side: top; text-align: left; padding: 12px 16px;
      background: var(--surface-2); color: var(--text-3);
      font-size: 0.78rem; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase;
    }

    .plan-cta-block {
      background: var(--accent-dim); border: 1px solid var(--accent-line);
      border-radius: var(--radius-lg); padding: 26px; margin: 44px 0 0;
    }
    .plan-cta-block h2 { margin-top: 0 !important; font-size: 1.3rem; }
    .plan-cta-block p { color: var(--text-2); }
    .plan-cta-block .btn-primary {
      display: inline-block; background: var(--accent); color: var(--bg); font-weight: 700;
      padding: 12px 24px; border-radius: var(--radius-pill); margin-top: 6px;
    }
    .plan-cta-block .btn-primary:hover { color: var(--bg); }

    .faq-list { margin: 0; }
    .faq-item { border-bottom: 1px solid var(--border); padding: 18px 0; }
    .faq-item:last-child { border-bottom: 0; }
    .faq-item h3 { font-size: 1rem; font-weight: 600; margin-bottom: 6px; }
    .faq-item p { margin: 0; font-size: 0.94rem; }

    .other-schedules { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
    .other-schedules a {
      padding: 8px 15px; background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius-pill); color: var(--text-2); font-size: 0.84rem; font-weight: 500;
      transition: border-color 0.2s var(--ease), color 0.2s var(--ease);
    }
    .other-schedules a:hover { border-color: var(--accent-line); color: var(--text); }`;

const INDEX_CSS = `    .sched-hero { padding: clamp(36px, 5.5vw, 60px) 0 26px; }
    .sched-hero h1 {
      font-size: clamp(2rem, 4.6vw, 2.9rem); font-weight: 800;
      line-height: 1.1; letter-spacing: -0.04em; margin-bottom: 16px;
    }
    .sched-hero h1 .serif { font-weight: 400; letter-spacing: -0.02em; }
    .sched-hero p { font-size: 1.03rem; color: var(--text-3); line-height: 1.7; max-width: 62ch; }
    .sched-meta {
      margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border);
      font-size: 0.83rem; color: var(--text-3);
    }
    .sched-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 14px; margin-top: 30px;
    }
    .sched-card {
      display: block; background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius-lg); padding: 20px 22px; color: inherit;
      transition: border-color 0.2s var(--ease), transform 0.15s var(--ease);
    }
    .sched-card:hover { border-color: var(--border-hover); transform: translateY(-2px); color: inherit; }
    .sched-card h2 { font-size: 1.02rem; font-weight: 600; margin-bottom: 6px; letter-spacing: -0.015em; }
    .sched-card p { font-size: 0.86rem; color: var(--text-3); line-height: 1.55; margin: 0; }
    .sched-body h2 { font-size: clamp(1.3rem, 2.9vw, 1.6rem); margin: 52px 0 12px; }
    .sched-body p { color: var(--text-2); line-height: 1.75; margin: 0 0 16px; max-width: 68ch; }
    .plan-cta-block {
      background: var(--accent-dim); border: 1px solid var(--accent-line);
      border-radius: var(--radius-lg); padding: 26px; margin: 44px 0 0;
    }
    .plan-cta-block h2 { margin-top: 0 !important; font-size: 1.3rem; }
    .plan-cta-block p { color: var(--text-2); }
    .plan-cta-block .btn-primary {
      display: inline-block; background: var(--accent); color: var(--bg); font-weight: 700;
      padding: 12px 24px; border-radius: var(--radius-pill); margin-top: 6px;
    }
    .plan-cta-block .btn-primary:hover { color: var(--bg); }`;

function head({ title, desc, canonical, extraCss, jsonld }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} - SleepMedic</title>
  <meta name="description" content="${esc(desc)}" />

  <link rel="canonical" href="${esc(canonical)}" />
  <meta name="robots" content="index,follow" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:site_name" content="SleepMedic" />

  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />

${jsonld}
  <!-- GA4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-717M9L2RTM"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-717M9L2RTM');
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Source+Serif+4:ital,opsz,wght@1,8..60,400&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="/blog/_shared-styles.css">

  <style>
${extraCss}
  </style>
</head>`;
}

// JSON-LD is emitted from the same objects the HTML renders, so the structured
// answer and the visible answer are literally the same string.
function jsonldBlock(obj) {
  return '  <script type="application/ld+json">\n  ' +
    JSON.stringify(obj, null, 2).split('\n').join('\n  ') + '\n  </script>\n';
}

// ── Day-type table ────────────────────────────────────────────────────
// Row order follows the day, not the engine's array order: the anchor, then
// what you do after waking, then what closes the day out.

const ROW_ORDER = ['wake', 'light', 'caffeine', 'nap', 'meal', 'windDown', 'sleep'];
const ROW_LABEL = {
  wake: 'Wake anchor',
  light: 'Bright light',
  caffeine: 'Caffeine',
  nap: 'Planned nap',
  meal: 'Last real meal',
  windDown: 'Wind-down',
  sleep: 'Sleep target'
};

function dayTable(day) {
  const rows = ROW_ORDER
    .map((k) => [k, blk(day, k)])
    .filter(([, b]) => b)
    .map(([k, b]) => `            <tr><th scope="row">${esc(ROW_LABEL[k])}</th><td>${esc(b.time)}</td></tr>`)
    .join('\n');

  // The drawn shift band is clamped to the waking span so it never paints over
  // the sleep opportunity; durationH still reports the real length of the tour.
  const shift = day.timeline.shift;
  const shiftLine = shift
    ? `<p class="when">${esc(day.when)}. ${esc(shift.durationH)} hours on duty, going on ${esc(shift.durationH >= 24 ? 'the tour' : 'shift')} at ${esc(fmt(shift.startMin))}.</p>`
    : `<p class="when">${esc(day.when)}.</p>`;

  return `        <div class="daytype">
          <h3>${esc(day.name)}</h3>
          ${shiftLine}
          <div class="table-scroll">
            <table class="sched">
              <caption>Computed from a ${esc(day.wakeAnchor)} wake anchor</caption>
              <tbody>
${rows}
              </tbody>
            </table>
          </div>
        </div>`;
}

// ── Schedule page ─────────────────────────────────────────────────────

function schedulePage(id) {
  const meta = { ...PATTERNS_META[id], faqName: FAQ_NAME[id], transQ: TRANS_Q[id] };
  const canonical = `${SITE}/schedules/${meta.slug}/`;
  const plan = buildPlan({
    occupation: 'other',
    pattern: id,
    struggle: 'all',
    workWake: meta.workWake,
    restWake: meta.restWake
  });
  if (!plan.ok) throw new Error(`engine rejected ${id}: ${plan.errors.join(', ')}`);

  const work = D('work')(plan);
  const faqs = faqsFor(id, plan, meta);

  const ld = jsonldBlock([
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'SleepMedic', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Schedules', item: `${SITE}/schedules/` },
        { '@type': 'ListItem', position: 3, name: meta.h1, item: canonical }
      ]
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
      }))
    }
  ]);

  const others = Object.entries(PATTERNS_META)
    .filter(([k]) => k !== id)
    .map(([k, m]) => `        <a href="/schedules/${esc(m.slug)}/">${esc(PATTERNS.find((p) => p.id === k).label)}</a>`)
    .join('\n');

  return `${head({ title: meta.title, desc: meta.desc, canonical, extraCss: PAGE_CSS, jsonld: ld })}
<body>

${nav(`schedule-${meta.slug}-nav`)}

  <div class="page page--narrow">

    <header class="sched-hero">
      <p class="crumb"><a href="/">SleepMedic</a> / <a href="/schedules/">Schedules</a></p>
      <h1>${esc(meta.h1)}</h1>
      <p class="lede">${esc(meta.lede)}</p>
      <div class="sched-meta">
        <span>${esc(UPDATED)}</span>
        <span>Times computed by the SleepMedic plan engine</span>
      </div>
    </header>

    <div class="sched-body">

      <h2>A worked example</h2>

      <p class="example-note"><b>These are example times, not your times.</b> Everything below is computed from a single pair of wake anchors: ${esc(work.wakeAnchor)} on a work day and ${esc(D('rest')(plan).wakeAnchor)} on a rest day. ${esc(meta.anchorWhy)} If your anchors are different, every window below shifts with them, which is what the <a href="/plan/">plan builder</a> does with your own numbers.</p>

      <p>The plan works backward from the wake anchor rather than forward from bedtime, because bedtime is the part your schedule takes away from you. The sleep target on each day is the anchor minus the sleep opportunity; the caffeine cutoff is eight hours before that target; the last real meal is three hours before wind-down starts. So the anchor is the only number you set, and the rest falls out of it.</p>

${plan.days.map(dayTable).join('\n\n')}

      <h2>${esc(meta.hardTitle)}</h2>

      <p>${esc(meta.hard)}</p>

      <h2>What the pattern asks of you</h2>

      <p>${esc(plan.patternNote.body)}</p>

      <h2>Common questions</h2>

      <div class="faq-list">
${faqs.map((f) => `        <div class="faq-item">
          <h3>${esc(f.q)}</h3>
          <p>${esc(f.a)}</p>
        </div>`).join('\n')}
      </div>

      <div class="plan-cta-block">
        <h2>This example assumes a ${esc(work.wakeAnchor)} wake. Yours is computed from your own anchors.</h2>
        <p>The plan builder takes six questions — your pattern, your two wake times, your last cup of coffee — and computes the same windows against the schedule you actually work, as a visual timeline for each kind of day. Free, printable, no account.</p>
        <a class="btn-primary" href="/plan/" data-cta="schedule-${esc(meta.slug)}-body">Build my free sleep plan</a>
      </div>

      <h2>The reasoning behind the numbers</h2>

      <p>Every window on this page comes from one of a handful of rules, and <a href="/manual/">the Shift Worker's Field Manual</a> is where those rules are laid out with their sources: why the wake anchor is the lever rather than bedtime, what light does to the body clock and when, the eight-hour caffeine cutoff and where it comes from, and what to do when the problem is bigger than a schedule.</p>

      <h2>Other schedules</h2>

      <div class="other-schedules">
${others}
      </div>

    </div>

${capture(meta.slug)}

  </div>

${FOOTER}

${CAPTURE_SCRIPT}

</body>
</html>
`;
}

// ── Index page ────────────────────────────────────────────────────────

function indexPage() {
  const canonical = `${SITE}/schedules/`;
  const ld = jsonldBlock([
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'SleepMedic', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Schedules', item: canonical }
      ]
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Shift schedules',
      itemListElement: PATTERNS.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: p.label,
        url: `${SITE}/schedules/${PATTERNS_META[p.id].slug}/`
      }))
    }
  ]);

  const cards = PATTERNS.map((p) => {
    const m = PATTERNS_META[p.id];
    return `        <a class="sched-card" href="/schedules/${esc(m.slug)}/">
          <h2>${esc(p.label)}</h2>
          <p>${esc(CARD_LINE[p.id])}</p>
        </a>`;
  }).join('\n');

  return `${head({
    title: 'Find your schedule',
    desc: 'Nine shift patterns, each with a worked sleep plan: light window, caffeine cutoff, meal timing, wind-down, sleep target and nap window computed from a wake anchor. 24/48, 48/96, Kelly, DuPont, Panama 2-2-3, nights and days on 12s, 24/72, and rotating.',
    canonical,
    extraCss: INDEX_CSS,
    jsonld: ld
  })}
<body>

${nav('schedules-index-nav')}

  <div class="page page--narrow">

    <header class="sched-hero">
      <h1>Find your <span class="serif">schedule.</span></h1>
      <p>Nine patterns, one page each. Every page carries a worked example — light window, caffeine cutoff, last meal, wind-down, sleep target and nap window — computed from a wake anchor by the same engine that builds the free plan.</p>
      <div class="sched-meta">${esc(UPDATED)}</div>
    </header>

    <div class="sched-grid">
${cards}
    </div>

    <div class="sched-body">

      <h2>Why the pages are built this way</h2>

      <p>Sleep advice usually starts at bedtime, which is the one thing a shift schedule takes away from you. So these pages start at the wake anchor instead: one fixed wake time per kind of day, held within thirty minutes. From that single number the rest falls out — bright light in the ninety minutes after waking, the last caffeine eight hours before the sleep target, the last real meal three hours before wind-down, wind-down sixty to ninety minutes before the target.</p>

      <p>The times on each page are computed, not written. They come from the plan engine that powers the free plan builder, run against a sensible example anchor for that pattern and labelled as an example everywhere it appears. Change the anchor and every window moves with it.</p>

      <p>If your rotation is not on this list, it is closer to one of these than you think — and if it genuinely changes week to week, <a href="/schedules/rotating/">the rotating page</a> is written for exactly that.</p>

      <div class="plan-cta-block">
        <h2>Your schedule is not an example.</h2>
        <p>Six questions — your pattern, your two wake times, your last cup of coffee — and the same engine computes these windows against the shift you actually work, as a visual timeline for each kind of day. Free, printable, no account.</p>
        <a class="btn-primary" href="/plan/" data-cta="schedules-index-body">Build my free sleep plan</a>
      </div>

    </div>

${capture('schedules')}

  </div>

${FOOTER}

${CAPTURE_SCRIPT}

</body>
</html>
`;
}

// ── Run ───────────────────────────────────────────────────────────────

function write(relPath, html) {
  const full = join(OUT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, html);
  console.log('wrote schedules/' + relPath);
}

write('index.html', indexPage());
for (const p of PATTERNS) {
  write(`${PATTERNS_META[p.id].slug}/index.html`, schedulePage(p.id));
}
console.log(`\n${PATTERNS.length + 1} pages. ${UPDATED}.`);
