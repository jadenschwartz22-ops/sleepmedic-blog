/**
 * Engine tests. Run: node pi-service/test-engine.mjs
 * No framework — node:assert only, matching the repo's zero-dependency style.
 */

import assert from 'assert';
import { buildPlan, parseTime, fmt, wrap, RULES, PATTERNS, STRUGGLES, OCCUPATIONS } from '../plan/engine.mjs';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { console.error(`  FAIL ${name}\n       ${err.message}`); process.exitCode = 1; }
}

// Parse "7:30 PM" back to minutes so computed strings can be checked numerically.
function unfmt(s) {
  const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(s.trim());
  assert.ok(m, `unparseable time: ${s}`);
  let h = +m[1] % 12;
  if (m[3] === 'PM') h += 12;
  return h * 60 + +m[2];
}
const diff = (a, b) => wrap(a - b); // minutes from b forward to a

console.log('\ntime helpers');
test('parseTime handles valid and invalid input', () => {
  assert.strictEqual(parseTime('07:30'), 450);
  assert.strictEqual(parseTime('23:59'), 1439);
  assert.strictEqual(parseTime('00:00'), 0);
  assert.strictEqual(parseTime('24:00'), null);
  assert.strictEqual(parseTime('7:60'), null);
  assert.strictEqual(parseTime(''), null);
  assert.strictEqual(parseTime(undefined), null);
});
test('fmt round-trips through unfmt for every minute of the day', () => {
  for (let m = 0; m < 1440; m++) assert.strictEqual(unfmt(fmt(m)), m, `minute ${m}`);
});

console.log('\nvalidation');
test('missing fields are reported, never thrown', () => {
  const r = buildPlan({});
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.errors.sort(), ['occupation', 'pattern', 'restWake', 'struggle', 'workWake']);
});
test('unknown pattern is rejected', () => {
  const r = buildPlan({ occupation: 'ems', pattern: 'nope', struggle: 'all', workWake: '19:00', restWake: '08:00' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.includes('pattern'));
});

// ── The four required patterns ───────────────────────

const CASES = [
  // Nights 3x12 starting at 19:00: wakes in the afternoon before the shift.
  { name: 'nights3x12', answers: { occupation: 'ems', pattern: 'nights3x12', struggle: 'fallingAsleep', workWake: '16:00', restWake: '08:00', lastCaffeine: '02:00' } },
  { name: 's24_48',     answers: { occupation: 'fire', pattern: 's24_48', struggle: 'stayingAsleep', workWake: '06:00', restWake: '07:30' } },
  { name: 's48_96',     answers: { occupation: 'fire', pattern: 's48_96', struggle: 'wakingExhausted', workWake: '05:45', restWake: '09:00' } },
  { name: 'rotating',   answers: { occupation: 'nurse', pattern: 'rotating', struggle: 'all', workWake: '23:15', restWake: '00:30' } }
];

for (const { name, answers } of CASES) {
  console.log(`\npattern: ${name}`);
  const plan = buildPlan(answers);

  test('builds successfully with day-type coverage', () => {
    assert.strictEqual(plan.ok, true);
    assert.ok(plan.days.length >= 2, 'at least work and rest day types');
    const ids = plan.days.map(d => d.id);
    assert.ok(ids.includes('work'), 'has a work day');
    assert.ok(ids.includes('rest'), 'has a rest day');
    assert.strictEqual(new Set(ids).size, ids.length, 'day ids unique');
  });

  test('no NaN, no empty, no unrendered values anywhere', () => {
    const s = JSON.stringify(plan);
    assert.ok(!/NaN/.test(s), 'contains NaN');
    assert.ok(!/undefined/.test(s), 'contains undefined');
    assert.ok(!/null:/.test(s));
    for (const d of plan.days) {
      assert.ok(d.name && d.when && d.wakeAnchor, `day ${d.id} missing labels`);
      for (const b of d.blocks) {
        assert.ok(b.title && b.time && b.detail && b.why, `block ${d.id}/${b.key} incomplete`);
        assert.ok(b.cite && /^https:\/\/www\.sleepmedic\.co\//.test(b.cite.url), `block ${d.id}/${b.key} bad citation`);
      }
    }
  });

  test('caffeine cutoff is exactly 8h before the sleep target, every day type', () => {
    for (const d of plan.days) {
      const sleep = unfmt(d.blocks.find(b => b.key === 'sleep').time);
      const cutoff = d.caffeineCutoff;
      assert.strictEqual(diff(sleep, cutoff), RULES.caffeineCutoffH * 60,
        `${d.id}: cutoff ${fmt(cutoff)} to sleep ${fmt(sleep)}`);
    }
  });

  test('first cup is 60-90 min after the wake anchor', () => {
    for (const d of plan.days) {
      assert.strictEqual(diff(d.firstCup[0], d.wakeMins), RULES.caffeineFirstCupMin[0], d.id);
      assert.strictEqual(diff(d.firstCup[1], d.wakeMins), RULES.caffeineFirstCupMin[1], d.id);
    }
  });

  test('light window follows the wake anchor by 0-90 min', () => {
    for (const d of plan.days) {
      assert.strictEqual(diff(d.light[0], d.wakeMins), RULES.lightWindowMin[0], d.id);
      assert.strictEqual(diff(d.light[1], d.wakeMins), RULES.lightWindowMin[1], d.id);
    }
  });

  test('wind-down starts 60-90 min before the sleep target', () => {
    for (const d of plan.days) {
      const sleep = unfmt(d.blocks.find(b => b.key === 'sleep').time);
      assert.strictEqual(diff(sleep, d.windDownStart), RULES.windDownMin[1], d.id);
    }
  });

  test('naps, where present, land 4-5.5h after waking', () => {
    for (const d of plan.days) {
      if (!d.napWindow) continue;
      assert.strictEqual(diff(d.napWindow[0], d.wakeMins), RULES.napAfterWakeH[0] * 60, d.id);
      assert.strictEqual(diff(d.napWindow[1], d.wakeMins), RULES.napAfterWakeH[1] * 60, d.id);
    }
  });

  test('every time is a real clock time in range', () => {
    for (const d of plan.days) {
      assert.ok(d.wakeMins >= 0 && d.wakeMins < 1440, `${d.id} wake out of range`);
      for (const v of [d.targetSleep, d.caffeineCutoff, d.windDownStart, ...d.light, ...d.firstCup, ...(d.napWindow || [])]) {
        assert.ok(Number.isInteger(v) && v >= 0 && v < 1440, `${d.id}: ${v} not a valid minute-of-day`);
      }
    }
  });

  test('anchors echo the submitted answers', () => {
    assert.strictEqual(plan.anchors.work, fmt(parseTime(answers.workWake)));
    assert.strictEqual(plan.anchors.rest, fmt(parseTime(answers.restWake)));
    const work = plan.days.find(d => d.id === 'work');
    const rest = plan.days.find(d => d.id === 'rest');
    assert.strictEqual(work.wakeMins, parseTime(answers.workWake));
    assert.strictEqual(rest.wakeMins, parseTime(answers.restWake));
  });

  test('pattern note and struggle sections are present and specific', () => {
    assert.ok(plan.patternNote && plan.patternNote.title && plan.patternNote.body.length > 100);
    assert.ok(plan.struggleSections.length >= 1);
    assert.strictEqual(plan.struggleSections.length, answers.struggle === 'all' ? 3 : 1);
    for (const s of plan.struggleSections) {
      assert.ok(s.title && s.body && s.steps.length && s.cite.url);
    }
  });

  test('no emoji or hype markers in rendered copy', () => {
    const s = JSON.stringify(plan);
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s), 'emoji found');
    assert.ok(!/journey/i.test(s), '"journey" found');
  });
}

console.log('\ncaffeine reality check');
test('a cup past the cutoff is flagged late with a real gap', () => {
  const p = buildPlan({ occupation: 'ems', pattern: 'nights3x12', struggle: 'all', workWake: '16:00', restWake: '08:00', lastCaffeine: '02:00' });
  assert.strictEqual(p.caffeineNote.status, 'late');
  assert.ok(/hours past it/.test(p.caffeineNote.text));
  assert.ok(!/NaN/.test(p.caffeineNote.text));
});
test('a cup inside the cutoff is confirmed, not scolded', () => {
  const work = buildPlan({ occupation: 'ems', pattern: 'days3x12', struggle: 'all', workWake: '05:00', restWake: '08:00' }).days.find(d => d.id === 'work');
  const inside = fmt(wrap(work.caffeineCutoff - 120)).replace(/ (AM|PM)/, '');
  const hhmm = (() => { const m = wrap(work.caffeineCutoff - 120); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; })();
  const p = buildPlan({ occupation: 'ems', pattern: 'days3x12', struggle: 'all', workWake: '05:00', restWake: '08:00', lastCaffeine: hhmm });
  assert.strictEqual(p.caffeineNote.status, 'ok', `cutoff ${fmt(work.caffeineCutoff)}, cup ${inside}`);
});
test('omitting caffeine yields no note rather than a broken one', () => {
  const p = buildPlan({ occupation: 'other', pattern: 'kelly', struggle: 'all', workWake: '06:00', restWake: '09:00' });
  assert.strictEqual(p.caffeineNote, null);
});

console.log('\nfull matrix smoke');
test('every pattern x struggle x occupation builds cleanly', () => {
  let n = 0;
  for (const pat of PATTERNS) for (const st of STRUGGLES) for (const occ of OCCUPATIONS) {
    const p = buildPlan({ occupation: occ.id, pattern: pat.id, struggle: st.id, workWake: '18:45', restWake: '07:15' });
    assert.strictEqual(p.ok, true, `${pat.id}/${st.id}/${occ.id}`);
    assert.ok(!/NaN|undefined/.test(JSON.stringify(p)), `${pat.id}/${st.id}/${occ.id}`);
    n++;
  }
  assert.strictEqual(n, PATTERNS.length * STRUGGLES.length * OCCUPATIONS.length);
});
test('midnight-crossing anchors do not produce negative times', () => {
  for (const w of ['00:00', '00:30', '23:45', '12:00']) {
    const p = buildPlan({ occupation: 'nurse', pattern: 'nights3x12', struggle: 'all', workWake: w, restWake: '23:59' });
    for (const d of p.days) {
      assert.ok(d.targetSleep >= 0 && d.caffeineCutoff >= 0 && d.windDownStart >= 0, `wake ${w}`);
    }
  }
});

console.log(`\n${passed} assertions passed${process.exitCode ? ', WITH FAILURES' : ''}\n`);
