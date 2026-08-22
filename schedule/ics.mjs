/**
 * ICS export for the schedule manager - RFC 5545, dependency-free, no DOM.
 *
 * Imported unchanged by the browser (schedule/index.html) and by Node (tests).
 * Times are floating local (no Z, no TZID), so a 07:00 report stays 07:00 on
 * whatever device the file lands on. Every clock time comes from the engine or
 * the cycle; nothing is invented here.
 */

import { fmt } from '../plan/engine.mjs';
import { startOfDay, addDays } from '../plan/cycles.mjs';

const pad = (n) => String(n).padStart(2, '0');

/** Floating local stamp YYYYMMDDTHHMMSS. `minutes` may be negative or over 1440. */
export function icsLocal(date, minutes) {
  const dayShift = Math.floor(minutes / 1440);
  const d = addDays(startOfDay(date), dayShift);
  const m = minutes - dayShift * 1440;
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
}

/** DTSTAMP is the one field that must be UTC. */
export function icsStampUTC(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
         `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Escape TEXT values per RFC 5545 3.3.11. */
export const icsText = (s) => String(s)
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

/** Fold a content line to 75 octets; continuations start with one space. */
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > 75) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

const TYPE_WORD = { work: 'On duty', transition: 'Recovery day', rest: 'Day off' };

/**
 * Build the calendar text.
 *   days     - dated days from cycles.mjs (expandCycle / expandManual)
 *   planFor  - (dayType) => the engine day object for that type
 *   shiftFor - (day) => { startMin, lenH } or null
 *   now      - Date used for DTSTAMP, injectable so tests are deterministic
 *   opts     - { shifts, sleep } event-type toggles; both default on.
 *              A calendar full of unasked-for events is spam - the page lets
 *              the person choose, and this honors the choice.
 */
export function buildICS(days, planFor, shiftFor, now = new Date(), opts = {}) {
  const { shifts: wantShifts = true, sleep: wantSleep = true } = opts;
  const stamp = icsStampUTC(now);
  const host = 'sleepmedic.co';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SleepMedic//Schedule Manager//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:SleepMedic',
    fold(`X-WR-CALDESC:${icsText('Shifts and planned sleep from the SleepMedic schedule manager')}`)
  ];

  days.forEach((day, i) => {
    const dp = planFor(day.dayType);
    const sw = shiftFor(day);

    if (sw && wantShifts) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:shift-${day.iso}-${i}@${host}`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsLocal(day.date, sw.startMin)}`,
        `DTEND:${icsLocal(day.date, sw.startMin + sw.lenH * 60)}`,
        fold(`SUMMARY:${icsText(sw.lenH >= 24 ? `On duty (${sw.lenH}h tour)` : `On shift (${sw.lenH}h)`)}`),
        fold(`DESCRIPTION:${icsText(`${day.label}. Caffeine off by ${fmt(dp.caffeineCutoff)}.`)}`),
        'TRANSP:OPAQUE',
        'END:VEVENT'
      );
    }

    // The sleep opportunity ends at the anchor on this date, so it starts
    // sleepMins earlier - the day before, when it crosses midnight.
    if (!wantSleep) return;
    lines.push(
      'BEGIN:VEVENT',
      `UID:sleep-${day.iso}-${i}@${host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsLocal(day.date, dp.wakeMins - dp.sleepMins)}`,
      `DTEND:${icsLocal(day.date, dp.wakeMins)}`,
      fold(`SUMMARY:${icsText(`Sleep (${TYPE_WORD[day.dayType]})`)}`),
      fold(`DESCRIPTION:${icsText(`Asleep by ${fmt(dp.targetSleep)}, wake at ${dp.wakeAnchor}. Wind-down from ${fmt(dp.windDownStart)}. Caffeine off by ${fmt(dp.caffeineCutoff)}.`)}`),
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export default buildICS;
