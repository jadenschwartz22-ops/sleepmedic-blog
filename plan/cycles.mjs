/**
 * SleepMedic rotation cycles - deterministic, dependency-free, no DOM.
 *
 * Imported unchanged by the browser (schedule/index.html, <script type="module">)
 * and by Node (tests). Ported from the iOS app's ShiftTemplates.swift, keyed by
 * the ids in plan/engine.mjs PATTERNS so a cycle position can be handed straight
 * to buildPlan()'s day types.
 *
 * A cycle is a repeating list of days. Each day is:
 *   {
 *     dayType:    'work' | 'transition' | 'rest'   - which engine day the plan uses
 *     label:      "Night 2 of 4"                    - human position in the cycle
 *     onDuty:     true when the person reports for a shift that calendar day
 *     shiftStart: "HH:MM" report time, when onDuty
 *     shiftLen:   hours on duty, when onDuty
 *     shiftKind:  'night' | 'day' | 'tour'          - what kind of shift it is
 *   }
 *
 * Day-type semantics match how plan/engine.mjs already treats them:
 *   work       - a day you are on duty, or inside a block you are still on
 *   transition - the day you come off the block; a short aligned sleep, one nap,
 *                an early night. Never a full rest day.
 *   rest       - a clear day, where the rest-day wake anchor lives
 *
 * 'rotating' has no fixed cycle. It is flagged manual:true and carries no days;
 * the caller collects the next week by hand.
 */

// ── Cycle builders ───────────────────────────────────

const d = (dayType, label, opts = {}) => ({
  dayType,
  label,
  onDuty: !!opts.shiftLen,
  shiftStart: opts.shiftStart ?? null,
  shiftLen: opts.shiftLen ?? null,
  shiftKind: opts.shiftKind ?? null
});

// A 12-hour night reports at 19:00; a 12-hour day reports at 07:00; a 24 or 48
// reports at 07:00 shift change. These are the defaults the iOS templates use
// and the only clock times in this file - everything else is positional.
const NIGHT_START = '19:00';
const DAY_START = '07:00';
const TOUR_START = '07:00';

const night = (label, len = 12) => d('work', label, { shiftStart: NIGHT_START, shiftLen: len, shiftKind: 'night' });
const dayShift = (label, len = 12) => d('work', label, { shiftStart: DAY_START, shiftLen: len, shiftKind: 'day' });
const tour = (label, len = 24) => d('work', label, { shiftStart: TOUR_START, shiftLen: len, shiftKind: 'tour' });
const trans = (label) => d('transition', label);
const rest = (label) => d('rest', label);

const seq = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

/**
 * CYCLES, keyed by plan/engine.mjs PATTERNS id.
 *
 *   period   - length of the repeating sequence in days
 *   days     - the sequence itself, index 0 .. period-1
 *   anchorAsk- which setup question pins this cycle to the calendar
 *              'nextShift' : "When does your next shift start?" (date + time)
 *              'cyclePos'  : "Which day of your cycle is today?"
 *   anchorIndex - for 'nextShift', the cycle index that the answered date lands on
 *   manual   - true when there is no fixed cycle to expand
 */
export const CYCLES = {
  // 3 on / 4 off, one week. The iOS template runs the three shifts back to back.
  nights3x12: {
    label: 'Nights, three 12s',
    period: 7,
    anchorAsk: 'nextShift',
    anchorIndex: 0,
    days: [
      night('Night 1 of 3'),
      night('Night 2 of 3'),
      night('Night 3 of 3'),
      trans('Off the block'),
      rest('Day off 2 of 4'),
      rest('Day off 3 of 4'),
      rest('Day off 4 of 4')
    ]
  },

  days3x12: {
    label: 'Days, three 12s',
    period: 7,
    anchorAsk: 'nextShift',
    anchorIndex: 0,
    days: [
      dayShift('Day 1 of 3'),
      dayShift('Day 2 of 3'),
      dayShift('Day 3 of 3'),
      rest('Day off 1 of 4'),
      rest('Day off 2 of 4'),
      rest('Day off 3 of 4'),
      rest('Day off 4 of 4')
    ]
  },

  // 24 on, 48 off. The 24 runs shift change to shift change, so the calendar day
  // after the tour starts is the one you come off on: that is the recovery day.
  s24_48: {
    label: '24 on, 48 off',
    period: 3,
    anchorAsk: 'nextShift',
    anchorIndex: 0,
    days: [
      tour('On duty (24)'),
      trans('Recovery day (off at shift change)'),
      rest('Reset day (back on tomorrow)')
    ]
  },

  s24_72: {
    label: '24 on, 72 off',
    period: 4,
    anchorAsk: 'nextShift',
    anchorIndex: 0,
    days: [
      tour('On duty (24)'),
      trans('Recovery day (off at shift change)'),
      rest('Day off 2 of 3'),
      rest('Day off 3 of 3 (back on tomorrow)')
    ]
  },

  // 48 on, 96 off. Two calendar days on duty, then the day you come off, then
  // three clear days.
  s48_96: {
    label: '48 on, 96 off',
    period: 6,
    anchorAsk: 'nextShift',
    anchorIndex: 0,
    days: [
      tour('On duty, day 1 of the 48'),
      tour('On duty, day 2 of the 48'),
      trans('Recovery day (off the 48)'),
      rest('Day off 2 of 4'),
      rest('Day off 3 of 4'),
      rest('Day off 4 of 4 (back on tomorrow)')
    ]
  },

  // Kelly: 24 on / 24 off, three times, then 96 off. Nine days.
  // The single days off between the 24s are transition days, not rest days -
  // that is the whole problem with a Kelly and the engine treats it that way.
  kelly: {
    label: 'Kelly schedule',
    period: 9,
    anchorAsk: 'nextShift',
    anchorIndex: 0,
    days: [
      tour('On duty, 24 number 1 of 3'),
      trans('Single day off (back on tomorrow)'),
      tour('On duty, 24 number 2 of 3'),
      trans('Single day off (back on tomorrow)'),
      tour('On duty, 24 number 3 of 3'),
      rest('Long break, day 1 of 4'),
      rest('Long break, day 2 of 4'),
      rest('Long break, day 3 of 4'),
      rest('Long break, day 4 of 4 (back on tomorrow)')
    ]
  },

  // DuPont, 28 days: 4N, 3 off, 3D, 1 off, 3N, 3 off, 4D, 7 off.
  // The day after a night run is a turnaround, not a rest day.
  dupont: {
    label: 'DuPont',
    period: 28,
    anchorAsk: 'cyclePos',
    days: [
      ...seq(4, i => night(`Night ${i + 1} of 4`)),
      trans('Turnaround off nights'),
      rest('Break, day 2 of 3'),
      rest('Break, day 3 of 3 (days start tomorrow)'),
      ...seq(3, i => dayShift(`Day shift ${i + 1} of 3`)),
      trans('Single day off (nights start tomorrow)'),
      ...seq(3, i => night(`Night ${i + 1} of 3`)),
      trans('Turnaround off nights'),
      rest('Break, day 2 of 3'),
      rest('Break, day 3 of 3 (days start tomorrow)'),
      ...seq(4, i => dayShift(`Day shift ${i + 1} of 4`)),
      rest('Long break, day 1 of 7'),
      rest('Long break, day 2 of 7'),
      rest('Long break, day 3 of 7'),
      rest('Long break, day 4 of 7'),
      rest('Long break, day 5 of 7'),
      rest('Long break, day 6 of 7'),
      rest('Long break, day 7 of 7 (nights start tomorrow)')
    ]
  },

  // Panama 2-2-3, 14 days: 2 on, 2 off, 3 on, 2 off, 2 on, 3 off.
  // The two-day breaks are short breaks the engine calls transition days;
  // the three-day break is the real rest.
  panama223: {
    label: 'Panama 2-2-3',
    period: 14,
    anchorAsk: 'cyclePos',
    days: [
      dayShift('Work 1 of 2'),
      dayShift('Work 2 of 2'),
      trans('Short break, day 1 of 2'),
      trans('Short break, day 2 of 2'),
      dayShift('Work 1 of 3'),
      dayShift('Work 2 of 3'),
      dayShift('Work 3 of 3'),
      trans('Short break, day 1 of 2'),
      trans('Short break, day 2 of 2'),
      dayShift('Work 1 of 2'),
      dayShift('Work 2 of 2'),
      rest('Long break, day 1 of 3'),
      rest('Long break, day 2 of 3'),
      rest('Long break, day 3 of 3 (back on tomorrow)')
    ]
  },

  rotating: {
    label: 'Rotating or irregular',
    manual: true,
    period: 7,
    anchorAsk: 'manual',
    days: []
  }
};

// ── Manual day options, for 'rotating' ───────────────
// The three states a person can set by hand on the picker, mapped onto the same
// day shapes every other cycle produces.

export const MANUAL_DAYS = [
  { id: 'workNight', label: 'Work night', build: () => night('Night shift') },
  { id: 'workDay', label: 'Work day', build: () => dayShift('Day shift') },
  { id: 'off', label: 'Off', build: () => rest('Day off') }
];

export function manualDay(id) {
  const m = MANUAL_DAYS.find(x => x.id === id) || MANUAL_DAYS[2];
  return m.build();
}

// ── Date helpers: local calendar days, no timezone math ──
// Every date here is a local Date pinned to midnight. Adding days by setDate()
// keeps DST transitions correct, which adding 86400000 milliseconds does not.

export function startOfDay(date) {
  const t = new Date(date);
  t.setHours(0, 0, 0, 0);
  return t;
}

export function addDays(date, n) {
  const t = startOfDay(date);
  t.setDate(t.getDate() + n);
  return t;
}

/** Local YYYY-MM-DD, never UTC-shifted. */
export function isoDate(date) {
  const t = startOfDay(date);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** Parse "YYYY-MM-DD" as a local midnight, not a UTC instant. */
export function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(t.getTime()) ? null : t;
}

const mod = (n, m) => ((n % m) + m) % m;

/**
 * Expand a cycle into N dated days.
 *
 *   patternId   - a key of CYCLES
 *   startDate   - the Date the expansion begins on (day 0 of the output)
 *   cycleOffset - the cycle index that startDate falls on
 *   count       - how many days to emit
 *
 * Returns [{ date, iso, cycleIndex, ...cycleDay }]. Pure: no clock reads, so the
 * same arguments always give the same answer.
 */
export function expandCycle(patternId, startDate, cycleOffset, count) {
  const cycle = CYCLES[patternId];
  if (!cycle || cycle.manual || !cycle.days.length) return [];
  const base = startOfDay(startDate);
  return Array.from({ length: count }, (_, i) => {
    const idx = mod(cycleOffset + i, cycle.period);
    const date = addDays(base, i);
    return { date, iso: isoDate(date), cycleIndex: idx, ...cycle.days[idx] };
  });
}

/**
 * Expand a hand-set week for 'rotating'.
 *   manualIds - array of MANUAL_DAYS ids, one per day starting at startDate
 */
export function expandManual(startDate, manualIds) {
  const base = startOfDay(startDate);
  return manualIds.map((id, i) => {
    const date = addDays(base, i);
    return { date, iso: isoDate(date), cycleIndex: i, ...manualDay(id) };
  });
}

/**
 * The cycle offset for `today` given that the cycle's anchorIndex lands on
 * `anchorDate`. Used by the 'nextShift' anchoring question: the person names the
 * date their next shift starts, and that date is anchorIndex of the cycle.
 */
export function offsetFromAnchorDate(patternId, anchorDate, today) {
  const cycle = CYCLES[patternId];
  if (!cycle || cycle.manual) return 0;
  const anchor = startOfDay(anchorDate);
  const now = startOfDay(today);
  const dayDelta = Math.round((now - anchor) / 86400000);
  return mod((cycle.anchorIndex ?? 0) + dayDelta, cycle.period);
}

export default CYCLES;
