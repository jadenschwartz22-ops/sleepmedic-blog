/**
 * Cycle tests. Run: node pi-service/test-cycles.mjs
 * No framework — node:assert only, matching the repo's zero-dependency style.
 */

import assert from 'assert';
import {
  CYCLES, MANUAL_DAYS, manualDay,
  expandCycle, expandManual, offsetFromAnchorDate,
  startOfDay, addDays, isoDate, parseISODate
} from '../plan/cycles.mjs';
import { PATTERNS } from '../plan/engine.mjs';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { console.error(`  FAIL ${name}\n       ${err.message}`); process.exitCode = 1; }
}

const DAY_TYPES = new Set(['work', 'transition', 'rest']);

console.log('\ncoverage');
test('every engine pattern has a cycle', () => {
  for (const p of PATTERNS) assert.ok(CYCLES[p.id], `missing cycle: ${p.id}`);
  assert.strictEqual(Object.keys(CYCLES).length, PATTERNS.length);
});
test('only rotating is manual', () => {
  for (const [id, c] of Object.entries(CYCLES)) {
    assert.strictEqual(!!c.manual, id === 'rotating', `manual flag wrong on ${id}`);
  }
});

console.log('\nperiod lengths');
const PERIODS = {
  nights3x12: 7, days3x12: 7, s24_48: 3, s24_72: 4,
  s48_96: 6, kelly: 9, dupont: 28, panama223: 14
};
for (const [id, period] of Object.entries(PERIODS)) {
  test(`${id} period is ${period} days`, () => {
    assert.strictEqual(CYCLES[id].period, period);
    assert.strictEqual(CYCLES[id].days.length, period, `days array length != period on ${id}`);
  });
}

console.log('\nday shape');
test('every day is well formed', () => {
  for (const [id, c] of Object.entries(CYCLES)) {
    c.days.forEach((day, i) => {
      const at = `${id}[${i}]`;
      assert.ok(DAY_TYPES.has(day.dayType), `${at} bad dayType: ${day.dayType}`);
      assert.ok(day.label && typeof day.label === 'string', `${at} missing label`);
      if (day.onDuty) {
        assert.strictEqual(day.dayType, 'work', `${at} on duty but not a work day`);
        assert.ok(/^\d{2}:\d{2}$/.test(day.shiftStart), `${at} bad shiftStart`);
        assert.ok(day.shiftLen > 0 && day.shiftLen <= 48, `${at} bad shiftLen`);
        assert.ok(['night', 'day', 'tour'].includes(day.shiftKind), `${at} bad shiftKind`);
      } else {
        assert.strictEqual(day.shiftStart, null, `${at} off duty with a shiftStart`);
        assert.strictEqual(day.shiftLen, null, `${at} off duty with a shiftLen`);
        assert.notStrictEqual(day.dayType, 'work', `${at} work day with no shift`);
      }
    });
  }
});

console.log('\nknown cycle positions (ported from ShiftTemplates.swift)');
test('DuPont day 1 is a night shift, and the run is four nights', () => {
  const c = CYCLES.dupont.days;
  assert.strictEqual(c[0].dayType, 'work');
  assert.strictEqual(c[0].shiftKind, 'night');
  assert.strictEqual(c[0].label, 'Night 1 of 4');
  for (let i = 0; i < 4; i++) assert.strictEqual(c[i].shiftKind, 'night', `dupont[${i}]`);
  assert.notStrictEqual(c[4].dayType, 'work', 'dupont[4] should be off after four nights');
});
test('DuPont matches 4N,3off,3D,1off,3N,3off,4D,7off exactly', () => {
  const c = CYCLES.dupont.days;
  const on = c.map(x => (x.onDuty ? x.shiftKind[0].toUpperCase() : '.')).join('');
  assert.strictEqual(on, 'NNNN...DDD.NNN...DDDD.......');
});
test('DuPont ends with a seven-day break', () => {
  const c = CYCLES.dupont.days;
  for (let i = 21; i < 28; i++) {
    assert.strictEqual(c[i].dayType, 'rest', `dupont[${i}] should be rest`);
    assert.strictEqual(c[i].onDuty, false);
  }
});

test('Kelly day 6 is rest (the 96 starts after the third 24)', () => {
  const c = CYCLES.kelly.days;
  assert.strictEqual(c[5].dayType, 'rest');   // index 5 = day 6 of the cycle
  assert.strictEqual(c[5].onDuty, false);
});
test('Kelly is 24on/24off three times, then 96 off', () => {
  const c = CYCLES.kelly.days;
  assert.deepStrictEqual(c.map(x => x.onDuty), [true, false, true, false, true, false, false, false, false]);
  for (const i of [0, 2, 4]) assert.strictEqual(c[i].shiftLen, 24, `kelly[${i}] should be a 24`);
  // The single days between 24s are recovery, not rest.
  for (const i of [1, 3]) assert.strictEqual(c[i].dayType, 'transition', `kelly[${i}]`);
  for (const i of [5, 6, 7, 8]) assert.strictEqual(c[i].dayType, 'rest', `kelly[${i}]`);
});

test('24/48 is one tour then two days off', () => {
  const c = CYCLES.s24_48.days;
  assert.deepStrictEqual(c.map(x => x.dayType), ['work', 'transition', 'rest']);
  assert.strictEqual(c[0].shiftLen, 24);
  assert.strictEqual(c[0].shiftStart, '07:00');
});
test('24/72 is one tour then three days off', () => {
  assert.deepStrictEqual(CYCLES.s24_72.days.map(x => x.onDuty), [true, false, false, false]);
});
test('48/96 is two tours then four days off', () => {
  const c = CYCLES.s48_96.days;
  assert.deepStrictEqual(c.map(x => x.onDuty), [true, true, false, false, false, false]);
  assert.strictEqual(c[2].dayType, 'transition');
});

test('nights 3x12 reports at 19:00, days 3x12 at 07:00', () => {
  assert.strictEqual(CYCLES.nights3x12.days[0].shiftStart, '19:00');
  assert.strictEqual(CYCLES.nights3x12.days[0].shiftLen, 12);
  assert.strictEqual(CYCLES.days3x12.days[0].shiftStart, '07:00');
  assert.strictEqual(CYCLES.days3x12.days[0].shiftLen, 12);
  assert.deepStrictEqual(CYCLES.nights3x12.days.map(x => x.onDuty), [true, true, true, false, false, false, false]);
});
test('Panama 2-2-3 is 2 on, 2 off, 3 on, 2 off, 2 on, 3 off', () => {
  const c = CYCLES.panama223.days;
  assert.deepStrictEqual(c.map(x => x.onDuty),
    [true, true, false, false, true, true, true, false, false, true, true, false, false, false]);
  assert.strictEqual(c.filter(x => x.onDuty).length, 7, 'seven work days per fortnight');
  // The three-day break is the only real rest; the two-day breaks are transitions.
  assert.deepStrictEqual(c.slice(11).map(x => x.dayType), ['rest', 'rest', 'rest']);
  assert.deepStrictEqual(c.slice(2, 4).map(x => x.dayType), ['transition', 'transition']);
});

console.log('\ndate helpers');
test('isoDate is local, never UTC-shifted', () => {
  // 11:30 PM local on the 5th must be the 5th, not the 6th.
  assert.strictEqual(isoDate(new Date(2026, 8, 5, 23, 30)), '2026-09-05');
  assert.strictEqual(isoDate(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
});
test('parseISODate round-trips through isoDate', () => {
  for (const s of ['2026-01-01', '2026-03-08', '2026-11-01', '2026-12-31']) {
    assert.strictEqual(isoDate(parseISODate(s)), s, s);
  }
  assert.strictEqual(parseISODate('nope'), null);
  assert.strictEqual(parseISODate(''), null);
});
test('addDays survives a DST boundary', () => {
  // US DST spring forward 2026-03-08, fall back 2026-11-01.
  assert.strictEqual(isoDate(addDays(new Date(2026, 2, 7), 1)), '2026-03-08');
  assert.strictEqual(isoDate(addDays(new Date(2026, 2, 8), 1)), '2026-03-09');
  assert.strictEqual(isoDate(addDays(new Date(2026, 9, 31), 1)), '2026-11-01');
  assert.strictEqual(isoDate(addDays(new Date(2026, 10, 1), 1)), '2026-11-02');
  assert.strictEqual(startOfDay(new Date(2026, 2, 8, 15, 0)).getHours(), 0);
});

console.log('\nexpandCycle');
test('expands the requested number of dated days', () => {
  const out = expandCycle('s24_48', new Date(2026, 8, 4), 0, 14);
  assert.strictEqual(out.length, 14);
  assert.strictEqual(out[0].iso, '2026-09-04');
  assert.strictEqual(out[13].iso, '2026-09-17');
  out.forEach((x, i) => assert.strictEqual(x.cycleIndex, i % 3, `day ${i}`));
});
test('cycleOffset rotates the sequence', () => {
  const a = expandCycle('kelly', new Date(2026, 8, 4), 0, 9).map(x => x.cycleIndex);
  const b = expandCycle('kelly', new Date(2026, 8, 4), 4, 9).map(x => x.cycleIndex);
  assert.deepStrictEqual(a, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepStrictEqual(b, [4, 5, 6, 7, 8, 0, 1, 2, 3]);
});
test('negative and oversized offsets wrap', () => {
  assert.strictEqual(expandCycle('dupont', new Date(2026, 8, 4), -1, 1)[0].cycleIndex, 27);
  assert.strictEqual(expandCycle('dupont', new Date(2026, 8, 4), 30, 1)[0].cycleIndex, 2);
});
test('rotating expands to nothing', () => {
  assert.deepStrictEqual(expandCycle('rotating', new Date(2026, 8, 4), 0, 7), []);
  assert.deepStrictEqual(expandCycle('nope', new Date(2026, 8, 4), 0, 7), []);
});
test('every pattern expands 14 clean days from every offset', () => {
  for (const id of Object.keys(PERIODS)) {
    for (let off = 0; off < CYCLES[id].period; off++) {
      const out = expandCycle(id, new Date(2026, 8, 4), off, 14);
      assert.strictEqual(out.length, 14, `${id}@${off}`);
      for (const x of out) {
        assert.ok(DAY_TYPES.has(x.dayType), `${id}@${off} ${x.iso}`);
        assert.ok(x.label && x.iso, `${id}@${off} ${x.iso}`);
      }
    }
  }
});

console.log('\nthe hand-computed case: 24/48, next shift Friday 07:00');
test('Friday on, Saturday off, Sunday off, Monday on', () => {
  // 2026-09-04 is a Friday.
  const friday = new Date(2026, 8, 4);
  assert.strictEqual(friday.getDay(), 5, 'fixture date is not a Friday');
  const out = expandCycle('s24_48', friday, CYCLES.s24_48.anchorIndex, 4);
  assert.strictEqual(out[0].iso, '2026-09-04');
  assert.strictEqual(out[0].dayType, 'work');
  assert.strictEqual(out[0].onDuty, true);
  assert.strictEqual(out[0].shiftStart, '07:00');
  assert.strictEqual(out[1].iso, '2026-09-05');       // Saturday
  assert.strictEqual(out[1].onDuty, false);
  assert.strictEqual(out[2].iso, '2026-09-06');       // Sunday
  assert.strictEqual(out[2].onDuty, false);
  assert.strictEqual(out[3].iso, '2026-09-07');       // Monday, back on
  assert.strictEqual(out[3].onDuty, true);
  assert.strictEqual(out[3].dayType, 'work');
});
test('viewing from Saturday still puts Monday back on duty', () => {
  const friday = new Date(2026, 8, 4);
  const saturday = new Date(2026, 8, 5);
  const off = offsetFromAnchorDate('s24_48', friday, saturday);
  assert.strictEqual(off, 1, 'Saturday is cycle index 1');
  const out = expandCycle('s24_48', saturday, off, 3);
  assert.deepStrictEqual(out.map(x => x.onDuty), [false, false, true]);
  assert.strictEqual(out[2].iso, '2026-09-07');
});

console.log('\noffsetFromAnchorDate');
test('anchor date itself is anchorIndex', () => {
  for (const id of Object.keys(PERIODS)) {
    const anchDate = new Date(2026, 8, 4);
    assert.strictEqual(
      offsetFromAnchorDate(id, anchDate, anchDate),
      CYCLES[id].anchorIndex ?? 0, id
    );
  }
});
test('a past anchor still resolves forward correctly', () => {
  // Kelly anchored 20 days ago: 20 mod 9 = 2.
  const anchor = new Date(2026, 7, 15);
  const today = addDays(anchor, 20);
  assert.strictEqual(offsetFromAnchorDate('kelly', anchor, today), 2);
});
test('a future anchor resolves backward correctly', () => {
  // Next shift is in 2 days on a 24/48: today is index -2 mod 3 = 1.
  const anchor = new Date(2026, 8, 6);
  const today = new Date(2026, 8, 4);
  assert.strictEqual(offsetFromAnchorDate('s24_48', anchor, today), 1);
});
test('offset holds across a DST boundary', () => {
  const anchor = new Date(2026, 2, 6);      // Friday before spring forward
  const after = new Date(2026, 2, 10);      // 4 days later, clocks moved
  assert.strictEqual(offsetFromAnchorDate('s24_48', anchor, after), 1);  // 4 mod 3
  const fallAnchor = new Date(2026, 9, 30);                              // Oct 30
  assert.strictEqual(offsetFromAnchorDate('s24_48', fallAnchor, new Date(2026, 10, 2)), 0); // 3 days, back on
  assert.strictEqual(offsetFromAnchorDate('s24_48', fallAnchor, new Date(2026, 10, 3)), 1); // 4 days
});

console.log('\nmanual days (rotating)');
test('manual options build valid days', () => {
  assert.strictEqual(MANUAL_DAYS.length, 3);
  for (const m of MANUAL_DAYS) {
    const day = m.build();
    assert.ok(DAY_TYPES.has(day.dayType), m.id);
    assert.ok(day.label, m.id);
  }
  assert.strictEqual(manualDay('workNight').shiftKind, 'night');
  assert.strictEqual(manualDay('workDay').shiftKind, 'day');
  assert.strictEqual(manualDay('off').dayType, 'rest');
  assert.strictEqual(manualDay('garbage').dayType, 'rest', 'unknown id falls back to off');
});
test('expandManual dates a hand-set week', () => {
  const out = expandManual(new Date(2026, 8, 4), ['workNight', 'workNight', 'off', 'off', 'workDay', 'off', 'off']);
  assert.strictEqual(out.length, 7);
  assert.strictEqual(out[0].iso, '2026-09-04');
  assert.strictEqual(out[6].iso, '2026-09-10');
  assert.deepStrictEqual(out.map(x => x.onDuty), [true, true, false, false, true, false, false]);
});

console.log(`\n${passed} assertions passed${process.exitCode ? ', WITH FAILURES' : ''}\n`);
