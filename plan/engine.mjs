/**
 * SleepMedic plan engine - deterministic, dependency-free, no DOM.
 *
 * Imported unchanged by the browser (plan/index.html, <script type="module">)
 * and by Node (pi-service/server.mjs, tests). Every clock time in a plan is
 * computed from the answers; nothing here is a hardcoded time of day.
 *
 * Rule numbers come from docs/2026-08-22-north-star-free-value-engine.md (WS3),
 * which ports them from the iOS app's engines.
 *
 * Input:
 *   {
 *     occupation:   one of OCCUPATIONS[].id
 *     pattern:      one of PATTERNS[].id
 *     struggle:     one of STRUGGLES[].id
 *     workWake:     "HH:MM"  wake anchor on a work day
 *     restWake:     "HH:MM"  wake anchor on a rest day
 *     lastCaffeine: "HH:MM"  optional
 *   }
 * Output: see buildPlan() - a plain object, safe to JSON round-trip.
 */

// ── Rule constants (WS3) ─────────────────────────────

export const RULES = {
  anchorGraceMin: 30,        // full credit within +/- 30 min of the anchor
  anchorZeroMin: 120,        // no credit past 2h off
  lightWindowMin: [0, 90],   // bright light 0-90 min after waking
  lightAvoidPreBedH: 3,      // no bright light in the 3h before sleep
  caffeineCutoffH: 8,        // last caffeine 8h before target sleep
  caffeineFirstCupMin: [60, 90], // first cup 60-90 min after waking
  mealBeforeWindDownH: 3,    // finish eating 3h before wind-down starts
  windDownMin: [60, 90],     // wind-down starts 60-90 min before target sleep
  napAfterWakeH: [4, 5.5],   // one planned nap 4-5.5h after waking
  sleepNeedH: 8              // sleep opportunity budgeted per anchor
};

// ── Question vocabulary (verbatim per WS3) ───────────

export const OCCUPATIONS = [
  { id: 'ems',       label: 'EMT / Paramedic (12s, 24s, 48s)' },
  { id: 'nurse',     label: 'Nurse' },
  { id: 'fire',      label: 'Firefighter' },
  { id: 'dispatch',  label: 'Police / Dispatch' },
  { id: 'other',     label: 'Other shift work' },
  { id: 'nonshift',  label: 'Not shift work' }
];

export const PATTERNS = [
  { id: 'nights3x12',  label: 'Nights, three 12s' },
  { id: 'days3x12',    label: 'Days, three 12s' },
  { id: 's24_48',      label: '24 on, 48 off' },
  { id: 's48_96',      label: '48 on, 96 off' },
  { id: 'kelly',       label: 'Kelly schedule' },
  { id: 'dupont',      label: 'DuPont' },
  { id: 'panama223',   label: 'Panama 2-2-3' },
  { id: 's24_72',      label: '24 on, 72 off' },
  { id: 'rotating',    label: 'Rotating or irregular' }
];

export const STRUGGLES = [
  { id: 'fallingAsleep',   label: 'Falling asleep after shift' },
  { id: 'stayingAsleep',   label: 'Staying asleep' },
  { id: 'wakingExhausted', label: 'Waking exhausted' },
  { id: 'all',             label: 'All of it' }
];

// ── Citations: real pages on this site only ──────────
// Never a fabricated study. Where a study would be cited, the concept is named
// generically and the link points at the site page that covers it.

const BASE = 'https://www.sleepmedic.co/blog/posts/';
export const CITATIONS = {
  protocol:   { concept: 'shift-work sleep protocol',            url: BASE + 'shift-worker-sleep-protocol.html' },
  light:      { concept: 'circadian phase response to light',    url: BASE + 'shift-worker-sleep-protocol.html' },
  anchor:     { concept: 'wake-time consistency as the anchor',  url: BASE + '2025-07-10-shift-workers-wake-up-consistency.html' },
  timing:     { concept: 'sleep and wake timing',                url: BASE + '2026-02-02-what-time-should-i-sleep-and-wake.html' },
  caffeine:   { concept: 'caffeine half-life and adenosine',     url: BASE + 'shift-worker-sleep-protocol.html' },
  meals:      { concept: 'night-shift meal timing and digestion', url: BASE + '2026-07-16-what-can-i-eat-on-night-shift-to-stop-bloating.html' },
  windDown:   { concept: 'pre-sleep arousal and wind-down',      url: BASE + '2026-04-20-unwiring-your-brain-the-30-minute-night-shift-sleep-protocol.html' },
  nap:        { concept: 'prophylactic napping on shift',        url: BASE + '2026-06-11-rapid-rest-firefighters-field-manual-for-on-shift-deep-sleep.html' },
  inertia:    { concept: 'sleep inertia after waking',           url: BASE + '2026-08-13-conquer-morning-brain-fog-stop-sleep-inertia-fast.html' },
  noise:      { concept: 'noise and daytime sleep depth',        url: BASE + '2026-05-28-why-youre-still-tired-the-hidden-impact-of-noise-on-deep-sle.html' },
  cbti:       { concept: 'CBT-I adapted to irregular schedules', url: BASE + '2026-04-23-shift-work-insomnia-adapting-cbt-i-for-irregular-schedules.html' },
  newborn:    { concept: 'sleep with a newborn at home',         url: BASE + '2026-07-23-how-to-get-functional-sleep-with-a-newborn.html' }
};

// ── Time helpers: minutes-since-midnight, always wrapped ──

export function parseTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export const wrap = (mins) => ((mins % 1440) + 1440) % 1440;

export function fmt(mins) {
  const t = wrap(Math.round(mins));
  const h24 = Math.floor(t / 60), m = t % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

const range = (a, b) => `${fmt(a)} to ${fmt(b)}`;

// ── Per-day-type block construction ──────────────────

/**
 * All time blocks for one sleep opportunity, derived from a wake anchor.
 * targetSleep is wake minus the sleep budget, so every downstream time
 * (caffeine cutoff, wind-down, last meal) falls out of the anchor.
 */
function blocksForAnchor(wake, { sleepH = RULES.sleepNeedH, nap = false, labelWake = 'Wake anchor' } = {}) {
  const sleepMins = sleepH * 60;
  const targetSleep = wrap(wake - sleepMins);
  const windDownStart = wrap(targetSleep - RULES.windDownMin[1]);
  const windDownLate = wrap(targetSleep - RULES.windDownMin[0]);
  const lastMeal = wrap(windDownStart - RULES.mealBeforeWindDownH * 60);
  const caffeineCutoff = wrap(targetSleep - RULES.caffeineCutoffH * 60);
  const firstCup = [wrap(wake + RULES.caffeineFirstCupMin[0]), wrap(wake + RULES.caffeineFirstCupMin[1])];
  const light = [wrap(wake + RULES.lightWindowMin[0]), wrap(wake + RULES.lightWindowMin[1])];
  const lightAvoidFrom = wrap(targetSleep - RULES.lightAvoidPreBedH * 60);
  const napWindow = nap
    ? [wrap(wake + RULES.napAfterWakeH[0] * 60), wrap(wake + RULES.napAfterWakeH[1] * 60)]
    : null;

  const b = [
    {
      key: 'wake', title: labelWake, time: fmt(wake),
      detail: `Protect the 30-minute window: ${range(wrap(wake - RULES.anchorGraceMin), wrap(wake + RULES.anchorGraceMin))}. Inside it you get full credit. Past two hours off, the day stops counting as an anchored day.`,
      why: 'One fixed wake time does more for a shift worker than any bedtime rule, because bedtime is the part your schedule takes away from you.',
      cite: CITATIONS.anchor
    },
    {
      key: 'light', title: 'Bright light', time: range(light[0], light[1]),
      detail: `Get outside or under bright light within 90 minutes of waking. Ten to fifteen minutes is enough. Then keep bright light away after ${fmt(lightAvoidFrom)}.`,
      why: 'Light is the strongest input to your body clock, and its effect depends entirely on when it lands relative to your sleep.',
      cite: CITATIONS.light
    },
    {
      key: 'caffeine', title: 'Caffeine window', time: `${range(firstCup[0], firstCup[1])} (first cup), stop by ${fmt(caffeineCutoff)}`,
      detail: `Hold the first cup 60 to 90 minutes after waking. Last caffeine of any kind by ${fmt(caffeineCutoff)} - that is eight hours before your ${fmt(targetSleep)} sleep target.`,
      why: 'Caffeine clears slowly enough that a late cup is still working against you when you lie down, even when you fall asleep fine.',
      cite: CITATIONS.caffeine
    },
    {
      key: 'meal', title: 'Last real meal', time: `by ${fmt(lastMeal)}`,
      detail: 'Finish eating at least three hours before wind-down starts. After that, keep it small and boring.',
      why: 'Digestion competes with sleep onset, and eating at the wrong circadian time is the usual reason night crews wake up feeling rough.',
      cite: CITATIONS.meals
    },
    {
      key: 'windDown', title: 'Wind-down', time: range(windDownStart, windDownLate),
      detail: `Start winding down between ${fmt(windDownStart)} and ${fmt(windDownLate)}. Lights low, screens down or dimmed, nothing that needs a decision from you.`,
      why: 'Sleep onset is limited by how aroused you still are, not by how tired you are. Wind-down is the only lever that touches arousal.',
      cite: CITATIONS.windDown
    },
    {
      key: 'sleep', title: 'Sleep target', time: fmt(targetSleep),
      detail: `Aim to be asleep by ${fmt(targetSleep)} for a full ${sleepH}-hour opportunity ending at your ${fmt(wake)} anchor.`,
      why: 'The target is set backward from the anchor, so a short night moves the sleep time and never the wake time.',
      cite: CITATIONS.timing
    }
  ];

  if (napWindow) {
    b.splice(4, 0, {
      key: 'nap', title: 'Planned nap', time: range(napWindow[0], napWindow[1]),
      detail: 'One nap, taken on purpose, 20 to 30 minutes or a full 90. Anything in between leaves you groggy.',
      why: 'A nap taken four to five and a half hours after waking lands in the natural dip and costs you the least from the night that follows.',
      cite: CITATIONS.nap
    });
  }

  return { blocks: b, targetSleep, caffeineCutoff, windDownStart, light, firstCup, napWindow };
}

function day(id, name, when, wake, opts) {
  const built = blocksForAnchor(wake, opts);
  return { id, name, when, wakeAnchor: fmt(wake), wakeMins: wake, ...built };
}

// ── Pattern geometry ─────────────────────────────────
// Each entry returns the day-types the plan renders, built off the two anchors.

const PATTERN_DAYS = {
  nights3x12: (w, r) => [
    day('work', 'Work day (night shift)', 'The three nights you work, back to back', w, { nap: true, labelWake: 'Wake anchor (work block)' }),
    day('transition', 'Last night into first day off', 'The morning you come off the block', w, { sleepH: 5, nap: true, labelWake: 'Short sleep after the last night' }),
    day('rest', 'Rest day', 'Your days off between blocks', r)
  ],
  days3x12: (w, r) => [
    day('work', 'Work day', 'The three days you work', w, { labelWake: 'Wake anchor (work block)' }),
    day('rest', 'Rest day', 'Your days off', r)
  ],
  s24_48: (w, r) => [
    day('work', 'Shift day (on the truck)', 'The 24 you are on duty', w, { nap: true, labelWake: 'Wake anchor (shift day)' }),
    day('transition', 'Recovery day (off at shift change)', 'The day you come off the 24', w, { sleepH: 6, nap: true, labelWake: 'Post-shift sleep ends' }),
    day('rest', 'Reset day (second day off)', 'The second day off, before you go back', r, { labelWake: 'Wake anchor (reset day)' })
  ],
  s24_72: (w, r) => [
    day('work', 'Shift day (on duty)', 'The 24 you are on duty', w, { nap: true, labelWake: 'Wake anchor (shift day)' }),
    day('transition', 'Recovery day', 'The day you come off the 24', w, { sleepH: 6, nap: true, labelWake: 'Post-shift sleep ends' }),
    day('rest', 'Rest day', 'The two clear days before you go back', r)
  ],
  s48_96: (w, r) => [
    day('work', 'Shift day (both 24s)', 'Each of the two days on duty', w, { nap: true, labelWake: 'Wake anchor (shift day)' }),
    day('transition', 'Recovery day (off the 48)', 'The day you come off the second 24', w, { sleepH: 7, nap: true, labelWake: 'Post-shift sleep ends' }),
    day('rest', 'Rest day', 'The remaining days of the 96', r)
  ],
  kelly: (w, r) => [
    day('work', 'Shift day (on duty)', 'Each 24 in the Kelly cycle', w, { nap: true, labelWake: 'Wake anchor (shift day)' }),
    day('transition', 'Single day off between shifts', 'The one day between two 24s', w, { sleepH: 7, nap: true, labelWake: 'Post-shift sleep ends' }),
    day('rest', 'Long break', 'The four-day break at the end of the cycle', r)
  ],
  dupont: (w, r) => [
    day('work', 'Night block', 'The four nights of the cycle', w, { nap: true, labelWake: 'Wake anchor (night block)' }),
    day('transition', 'Turnaround', 'Nights into days, or the last night into the break', w, { sleepH: 6, nap: true, labelWake: 'Short sleep on the turnaround' }),
    day('rest', 'Rest day', 'The three- and seven-day breaks', r)
  ],
  panama223: (w, r) => [
    day('work', 'Work day', 'The two- and three-day runs', w, { nap: true, labelWake: 'Wake anchor (work run)' }),
    day('transition', 'Two-day break inside the cycle', 'The short breaks between runs', w, { sleepH: 7, labelWake: 'Wake anchor (short break)' }),
    day('rest', 'Three-day break', 'The long break in the cycle', r)
  ],
  rotating: (w, r) => [
    day('work', 'Work day (any rotation)', 'Every day inside a work block, whichever shift it is', w, { nap: true, labelWake: 'Wake anchor (work block)' }),
    day('transition', 'Rotation change', 'The day the shift type changes', w, { sleepH: 6, nap: true, labelWake: 'Wake anchor on the changeover' }),
    day('rest', 'Rest day', 'Days outside any work block', r)
  ]
};

const PATTERN_NOTES = {
  nights3x12: {
    title: 'Sleeping days on a night block',
    body: 'Treat your three nights as one continuous time zone. Do not flip back to a day schedule on the middle days off inside the block; you will pay for it on the next shift. Your bedroom has to be dark enough that you cannot see your hand, cool, and quiet enough that the house waking up does not reach you. Blackout the window properly rather than draping something over it, and run a fan or white noise loud enough to cover doors and traffic.',
    cite: CITATIONS.noise
  },
  days3x12: {
    title: 'The two anchors are close, so hold them',
    body: 'Day 12s are the easiest pattern to keep aligned and the easiest to wreck on days off. Keep your rest-day anchor within about an hour of your work-day anchor. The temptation to sleep until noon on the first day off is the single thing that makes the first shift back feel like a night shift.',
    cite: CITATIONS.anchor
  },
  s24_48: {
    title: 'The two days off are not the same day',
    body: 'The day you come off the truck is a recovery day: a shorter sleep aligned to your shift-day anchor, one deliberate nap, and an early night. Do not chase eight hours in the morning - it steals the night. The second day is the reset day: this is where the rest-day anchor lives, and where a full night has room. Going into the next 24 rested is decided on that second day, not the first.',
    cite: CITATIONS.protocol
  },
  s24_72: {
    title: 'One recovery day, then two real ones',
    body: 'The recovery day off the 24 works the same as on a 24/48: short aligned sleep, a planned nap, early night. The difference is you get two clear days after it, so let the rest-day anchor hold for both instead of drifting later each day. Drifting is what turns the last day off into a bad first shift.',
    cite: CITATIONS.protocol
  },
  s48_96: {
    title: 'Two days on, then a real reset',
    body: 'Sleep on a 48 is interrupted sleep by definition, so the plan is damage control: take every horizontal opportunity, keep caffeine on the cutoff even when the second night feels impossible, and treat the first day off as recovery rather than the start of the break. Once you are past that day, the 96 is long enough to genuinely reset - hold the rest-day anchor rather than drifting later across four days.',
    cite: CITATIONS.protocol
  },
  kelly: {
    title: 'The single days off are the whole problem',
    body: 'A Kelly cycle gives you one day between 24s. That day is recovery, not a break: keep the anchor near your shift-day anchor, take the nap, and go to bed early. Save the rest-day anchor for the four-day break at the end, where a real shift back toward a normal schedule can actually hold.',
    cite: CITATIONS.protocol
  },
  dupont: {
    title: 'Four nights, then a turnaround',
    body: 'The four-night run works like any night block: one time zone, sleep the days, do not flip mid-block. The turnaround out of nights is the dangerous part. Take a short, deliberate sleep after the last night rather than a full day sleep, get bright light after you wake from it, and go to bed early that evening. That is what moves you back in one day instead of three.',
    cite: CITATIONS.light
  },
  panama223: {
    title: 'Short cycles reward one anchor, not two',
    body: 'Panama 2-2-3 never leaves a block long enough to fully adapt to. That is an argument for keeping your work-day and rest-day anchors close together rather than swinging between them. Use the two-day breaks to hold steady and the three-day break to catch up, not to reinvent your schedule.',
    cite: CITATIONS.anchor
  },
  rotating: {
    title: 'Anchor to the block, not to the calendar',
    body: 'When the schedule changes constantly, the anchor moves with the work block instead of with the days of the week. Set it as soon as you know the block, hold it for every day inside the block, and change it only on the changeover day. On the changeover, take a shorter sleep aligned to the new block rather than a full sleep aligned to the old one, and get bright light immediately after waking to pull the clock with you.',
    cite: CITATIONS.light
  }
};

const STRUGGLE_MODULES = {
  fallingAsleep: (ctx) => ({
    title: 'You cannot fall asleep after shift',
    body: `Lying awake after a shift is an arousal problem, not a tiredness problem. Your wind-down starts at ${ctx.windDown} on a work day - treat that as the real end of the shift, not the drive home. If you are still awake twenty minutes after lying down, get up, keep the lights low, do something dull, and come back when you feel sleepy. Staying in bed awake teaches the bed to mean awake.`,
    steps: [
      `Stop caffeine at ${ctx.caffeineCutoff} on work days, without exceptions on the hard days`,
      'End the shift mentally before you get home: the drive is the debrief, the door is the line',
      'Twenty minutes awake means get up; return only when sleepy',
      'Keep the room dark enough that you cannot read by it'
    ],
    cite: CITATIONS.cbti
  }),
  stayingAsleep: (ctx) => ({
    title: 'You fall asleep fine and wake up at hour four',
    body: `Broken sleep on a shift schedule is usually environmental or circadian, not psychological. Daytime sleep is fragile: noise and light that would not touch you at night will surface you at 10 AM. Your sleep opportunity runs to ${ctx.wake} - defend the back half of it, because that is where the sleep you actually feel lives.`,
    steps: [
      'Blackout the room properly; tape the edges if light leaks around the blind',
      'Run continuous sound loud enough to mask the house and the street, all the way through',
      'Phone out of the room, or at minimum face down and silent, not just on vibrate',
      'If you wake and cannot get back within twenty minutes, get up rather than fight it'
    ],
    cite: CITATIONS.noise
  }),
  wakingExhausted: (ctx) => ({
    title: 'You sleep and still wake up wrecked',
    body: `The first twenty to thirty minutes after waking feel bad for everyone; on a shift schedule they feel much worse and last longer. That is sleep inertia, and it responds to light and movement far better than to caffeine. Hit your light window at ${ctx.light} before you touch the first cup at ${ctx.firstCup}.`,
    steps: [
      `Bright light within 90 minutes of waking - outside if at all possible (${ctx.light})`,
      `First caffeine ${ctx.firstCup}, not before`,
      'Move for five minutes before you judge how you feel',
      'If this holds every day for two weeks, the problem is sleep quantity or a medical cause, not your routine'
    ],
    cite: CITATIONS.inertia
  })
};

// ── Public API ───────────────────────────────────────

export function buildPlan(answers = {}) {
  const errors = [];
  const pattern = PATTERNS.find(p => p.id === answers.pattern) ? answers.pattern : null;
  const occupation = OCCUPATIONS.find(o => o.id === answers.occupation) ? answers.occupation : null;
  const struggle = STRUGGLES.find(s => s.id === answers.struggle) ? answers.struggle : null;
  const workWake = parseTime(answers.workWake);
  const restWake = parseTime(answers.restWake);
  const lastCaffeine = answers.lastCaffeine ? parseTime(answers.lastCaffeine) : null;

  if (!pattern) errors.push('pattern');
  if (!occupation) errors.push('occupation');
  if (!struggle) errors.push('struggle');
  if (workWake === null) errors.push('workWake');
  if (restWake === null) errors.push('restWake');
  if (errors.length) return { ok: false, errors };

  const days = PATTERN_DAYS[pattern](workWake, restWake);
  const workDay = days.find(d => d.id === 'work');

  const ctx = {
    wake: fmt(workDay.wakeMins),
    windDown: fmt(workDay.windDownStart),
    caffeineCutoff: fmt(workDay.caffeineCutoff),
    light: range(workDay.light[0], workDay.light[1]),
    firstCup: range(workDay.firstCup[0], workDay.firstCup[1])
  };

  const struggleIds = struggle === 'all'
    ? ['fallingAsleep', 'stayingAsleep', 'wakingExhausted']
    : [struggle];
  const struggleSections = struggleIds.map(id => STRUGGLE_MODULES[id](ctx));

  // Caffeine reality check against what they actually drink.
  let caffeineNote = null;
  if (lastCaffeine !== null) {
    const cutoff = workDay.caffeineCutoff;
    const over = wrap(lastCaffeine - cutoff);      // minutes past the cutoff, wrapped
    const late = over > 0 && over < 12 * 60;
    caffeineNote = late
      ? {
          status: 'late',
          text: `Your last cup lands around ${fmt(lastCaffeine)}. On a work day the cutoff is ${fmt(cutoff)} - you are about ${Math.round(over / 60 * 10) / 10} hours past it. Move it earlier by an hour a week rather than all at once; the headache is what makes people quit.`
        }
      : {
          status: 'ok',
          text: `Your last cup around ${fmt(lastCaffeine)} is already inside the ${fmt(cutoff)} cutoff on a work day. Keep it there on the hard days too, which is when it slips.`
        };
  }

  const occLabel = OCCUPATIONS.find(o => o.id === occupation).label;
  const patLabel = PATTERNS.find(p => p.id === pattern).label;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    answers: { occupation, pattern, struggle, workWake: answers.workWake, restWake: answers.restWake, lastCaffeine: answers.lastCaffeine || null },
    headline: `Your sleep plan: ${patLabel}`,
    subhead: `Built around a ${fmt(workWake)} wake anchor on work days and ${fmt(restWake)} on rest days. ${occLabel}.`,
    anchors: {
      work: fmt(workWake),
      rest: fmt(restWake),
      graceMin: RULES.anchorGraceMin,
      note: `Every time below is computed from those two numbers. Full credit within ${RULES.anchorGraceMin} minutes either side - protect the 30-minute window. Two hours off and the day does not count as anchored.`
    },
    days,
    patternNote: PATTERN_NOTES[pattern],
    struggleSections,
    caffeineNote,
    consistency: {
      title: 'How to score this fairly',
      body: 'Seven sleep opportunities a week, not seven nights. Hit the anchor within thirty minutes and the opportunity counts. Miss one because of a late call or a bad turnaround and it is one missed opportunity, not a broken streak. Five of seven, held for a month, moves more than a perfect week you cannot repeat.',
      cite: CITATIONS.protocol
    },
    citations: Object.values(CITATIONS)
  };
}

export default buildPlan;
