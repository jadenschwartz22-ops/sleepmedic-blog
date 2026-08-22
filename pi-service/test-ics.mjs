/**
 * ICS export tests. Run: node pi-service/test-ics.mjs
 * No framework — node:assert only, matching the repo's zero-dependency style.
 *
 * Checks the exact text schedule/index.html downloads: RFC 5545 line endings,
 * required properties, floating local times, and that a sleep block crossing
 * midnight lands on the previous calendar day.
 */

import assert from 'assert';
import { buildICS, icsLocal, icsStampUTC, icsText, fold } from '../schedule/ics.mjs';
import { buildPlan } from '../plan/engine.mjs';
import { CYCLES, expandCycle, parseISODate } from '../plan/cycles.mjs';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { console.error(`  FAIL ${name}\n       ${err.message}`); process.exitCode = 1; }
}

// ── Fixture: a 24/48 anchored to Friday 2026-09-04, on duty at 07:00 ──
const CFG = { pattern: 's24_48', workWake: '06:00', restWake: '07:30', shiftTime: '07:00' };
const FRIDAY = parseISODate('2026-09-04');
const PLAN = buildPlan({ occupation: 'fire', pattern: CFG.pattern, struggle: 'all', workWake: CFG.workWake, restWake: CFG.restWake });
const DAYS = expandCycle(CFG.pattern, FRIDAY, CYCLES.s24_48.anchorIndex, 14);

const byId = Object.fromEntries(PLAN.days.map(d => [d.id, d]));
const planFor = (t) => byId[t] || byId.rest;
const shiftFor = (d) => (d.onDuty ? { startMin: 7 * 60, lenH: d.shiftLen } : null);

const NOW = new Date(Date.UTC(2026, 8, 3, 15, 4, 5));
const ICS = buildICS(DAYS, planFor, shiftFor, NOW);
const rawLines = ICS.split('\r\n');

console.log('\nline endings and structure');
test('every line break is CRLF, never a bare LF or CR', () => {
  assert.ok(!/[^\r]\n/.test(ICS), 'bare LF present');
  assert.ok(!/\r(?!\n)/.test(ICS), 'bare CR present');
  assert.ok(ICS.endsWith('\r\n'), 'file must end with CRLF');
});
test('opens and closes as a VCALENDAR', () => {
  assert.strictEqual(rawLines[0], 'BEGIN:VCALENDAR');
  assert.strictEqual(rawLines[rawLines.length - 2], 'END:VCALENDAR');
  assert.strictEqual(rawLines[rawLines.length - 1], '', 'trailing CRLF');
});
test('carries the required calendar properties', () => {
  for (const req of ['VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:SleepMedic']) {
    assert.ok(rawLines.includes(req), `missing ${req}`);
  }
  assert.ok(rawLines.some(l => l.startsWith('PRODID:-//SleepMedic//')), 'missing PRODID');
});
test('BEGIN and END counts balance', () => {
  const begins = rawLines.filter(l => l === 'BEGIN:VEVENT').length;
  const ends = rawLines.filter(l => l === 'END:VEVENT').length;
  assert.strictEqual(begins, ends, 'unbalanced VEVENT');
  assert.ok(begins > 0, 'no events emitted');
});

console.log('\nevents');
// Unfold before inspecting properties, per RFC 5545 3.1.
const lines = [];
for (const l of rawLines) {
  if (l.startsWith(' ') && lines.length) lines[lines.length - 1] += l.slice(1);
  else lines.push(l);
}
const events = [];
for (const l of lines) {
  if (l === 'BEGIN:VEVENT') events.push({});
  else if (events.length && l.includes(':') && l !== 'END:VEVENT') {
    const i = l.indexOf(':');
    events[events.length - 1][l.slice(0, i)] = l.slice(i + 1);
  }
}

test('every VEVENT has UID, DTSTAMP, DTSTART, DTEND and SUMMARY', () => {
  assert.ok(events.length >= 14, `expected at least 14 events, got ${events.length}`);
  for (const [i, e] of events.entries()) {
    for (const k of ['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY']) {
      assert.ok(e[k], `event ${i} missing ${k}`);
    }
  }
});
test('UIDs are unique and domain-qualified', () => {
  const uids = events.map(e => e.UID);
  assert.strictEqual(new Set(uids).size, uids.length, 'duplicate UID');
  for (const u of uids) assert.ok(u.endsWith('@sleepmedic.co'), `unqualified UID: ${u}`);
});
test('DTSTAMP is UTC, DTSTART and DTEND are floating local', () => {
  for (const e of events) {
    assert.ok(/^\d{8}T\d{6}Z$/.test(e.DTSTAMP), `bad DTSTAMP: ${e.DTSTAMP}`);
    assert.ok(/^\d{8}T\d{6}$/.test(e.DTSTART), `DTSTART not floating: ${e.DTSTART}`);
    assert.ok(/^\d{8}T\d{6}$/.test(e.DTEND), `DTEND not floating: ${e.DTEND}`);
  }
});
test('DTEND is always after DTSTART', () => {
  for (const e of events) {
    assert.ok(e.DTEND > e.DTSTART, `${e.SUMMARY}: ${e.DTSTART} -> ${e.DTEND}`);
  }
});
test('each day emits one sleep event; on-duty days also emit a shift', () => {
  const sleeps = events.filter(e => e.UID.startsWith('sleep-'));
  const shifts = events.filter(e => e.UID.startsWith('shift-'));
  assert.strictEqual(sleeps.length, 14, 'one sleep block per day');
  assert.strictEqual(shifts.length, DAYS.filter(d => d.onDuty).length);
  assert.ok(shifts.length > 0);
});
test('a 24-hour tour is exactly 24 hours long in the file', () => {
  const shift = events.find(e => e.UID === 'shift-2026-09-04-0@sleepmedic.co');
  assert.ok(shift, 'Friday tour missing');
  assert.strictEqual(shift.DTSTART, '20260904T070000');
  assert.strictEqual(shift.DTEND, '20260905T070000');
  assert.ok(/24h tour/.test(shift.SUMMARY), shift.SUMMARY);
});
test('a sleep block ending after midnight starts on the previous day', () => {
  // Work-day anchor 06:00, 8h opportunity, so Friday's sleep starts Thursday 22:00.
  const sleep = events.find(e => e.UID === 'sleep-2026-09-04-0@sleepmedic.co');
  assert.strictEqual(sleep.DTSTART, '20260903T220000');
  assert.strictEqual(sleep.DTEND, '20260904T060000');
});
test('the recovery day carries the shorter aligned sleep', () => {
  // 24/48 transition day: 6h opportunity ending at the 06:00 work anchor.
  const sleep = events.find(e => e.UID === 'sleep-2026-09-05-1@sleepmedic.co');
  assert.strictEqual(sleep.DTSTART, '20260905T000000');
  assert.strictEqual(sleep.DTEND, '20260905T060000');
  assert.ok(/Recovery day/.test(sleep.SUMMARY), sleep.SUMMARY);
});
test('the reset day uses the rest anchor', () => {
  // Rest anchor 07:30, 8h opportunity: 23:30 the night before.
  const sleep = events.find(e => e.UID === 'sleep-2026-09-06-2@sleepmedic.co');
  assert.strictEqual(sleep.DTSTART, '20260905T233000');
  assert.strictEqual(sleep.DTEND, '20260906T073000');
  assert.ok(/Day off/.test(sleep.SUMMARY), sleep.SUMMARY);
});
test('no NaN, undefined or Invalid Date leaks into the file', () => {
  assert.ok(!/NaN|undefined|Invalid/.test(ICS), 'placeholder value in ICS');
});

console.log('\nfolding and escaping');
test('no unfolded content line exceeds 75 octets', () => {
  const enc = new TextEncoder();
  for (const l of rawLines) {
    assert.ok(enc.encode(l).length <= 75, `line too long (${enc.encode(l).length}): ${l.slice(0, 60)}...`);
  }
});
test('continuation lines begin with a single space', () => {
  for (const l of rawLines) {
    if (l.startsWith(' ')) assert.ok(!l.startsWith('  '), `double-space continuation: ${l.slice(0, 40)}`);
  }
});
test('fold round-trips: unfolding restores the original line', () => {
  const long = 'DESCRIPTION:' + 'a'.repeat(400);
  const unfolded = fold(long).split('\r\n').map((s, i) => (i ? s.slice(1) : s)).join('');
  assert.strictEqual(unfolded, long);
  assert.strictEqual(fold('SHORT:ok'), 'SHORT:ok', 'short lines are untouched');
});
test('icsText escapes the RFC 5545 special characters', () => {
  assert.strictEqual(icsText('a,b;c\\d'), 'a\\,b\\;c\\\\d');
  assert.strictEqual(icsText('one\ntwo'), 'one\\ntwo');
});
test('no unescaped comma or semicolon in a TEXT value', () => {
  for (const l of lines) {
    const m = /^(SUMMARY|DESCRIPTION|X-WR-CALNAME|X-WR-CALDESC):(.*)$/.exec(l);
    if (!m) continue;
    // Strip escaped pairs, then nothing special may remain.
    const stripped = m[2].replace(/\\[\\;,nN]/g, '');
    assert.ok(!/[;,]/.test(stripped), `unescaped separator in ${m[1]}: ${m[2]}`);
  }
});

console.log('\ntime helpers');
test('icsLocal handles negative and over-a-day minute offsets', () => {
  const d = parseISODate('2026-09-04');
  assert.strictEqual(icsLocal(d, 0), '20260904T000000');
  assert.strictEqual(icsLocal(d, 6 * 60), '20260904T060000');
  assert.strictEqual(icsLocal(d, -120), '20260903T220000');
  assert.strictEqual(icsLocal(d, 1440), '20260905T000000');
  assert.strictEqual(icsLocal(d, 1440 + 7 * 60), '20260905T070000');
  assert.strictEqual(icsLocal(d, -1440), '20260903T000000');
});
test('icsLocal crosses a DST boundary without drifting an hour', () => {
  const before = parseISODate('2026-03-07');
  assert.strictEqual(icsLocal(before, 24 * 60 + 7 * 60), '20260308T070000');
  const fall = parseISODate('2026-10-31');
  assert.strictEqual(icsLocal(fall, 24 * 60 + 7 * 60), '20261101T070000');
});
test('icsStampUTC formats a UTC instant', () => {
  assert.strictEqual(icsStampUTC(new Date(Date.UTC(2026, 8, 3, 15, 4, 5))), '20260903T150405Z');
});

console.log('\nevery pattern exports cleanly');
test('all nine patterns produce a valid file', () => {
  for (const id of Object.keys(CYCLES)) {
    if (CYCLES[id].manual) continue;
    const p = buildPlan({ occupation: 'ems', pattern: id, struggle: 'all', workWake: '19:30', restWake: '08:15' });
    const b = Object.fromEntries(p.days.map(d => [d.id, d]));
    const days = expandCycle(id, FRIDAY, 0, 14);
    const text = buildICS(days, (t) => b[t] || b.rest, (d) => (d.onDuty ? { startMin: 19 * 60, lenH: d.shiftLen } : null), NOW);
    assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'), id);
    assert.ok(text.endsWith('END:VCALENDAR\r\n'), id);
    assert.ok(!/NaN|undefined|Invalid/.test(text), `${id} has a placeholder value`);
    assert.ok(!/[^\r]\n/.test(text), `${id} has a bare LF`);
    const be = text.split('\r\n').filter(l => l === 'BEGIN:VEVENT').length;
    const en = text.split('\r\n').filter(l => l === 'END:VEVENT').length;
    assert.strictEqual(be, en, `${id} unbalanced VEVENT`);
  }
});

console.log(`\n${passed} assertions passed${process.exitCode ? ', WITH FAILURES' : ''}\n`);
