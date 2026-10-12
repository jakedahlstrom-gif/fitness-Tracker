// Unit tests for the Stage 5 daily nudge (free version). Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REMINDER_TIMES, DEFAULT_REMINDER, normalizeReminder, shouldNudge, icsPath, icsText, timeLabel,
} from '../js/reminders.js';
import { normalize } from '../js/schema.js';

test('N1 times, labels and the saved setting', () => {
  assert.equal(REMINDER_TIMES.length, 36);
  assert.equal(REMINDER_TIMES[0], '05:00');
  assert.equal(REMINDER_TIMES.at(-1), '22:30');
  assert.ok(REMINDER_TIMES.includes(DEFAULT_REMINDER.time));
  assert.equal(timeLabel('05:30'), '5:30 AM');
  assert.equal(timeLabel('12:00'), '12:00 PM');
  assert.equal(timeLabel('18:00'), '6:00 PM');
  assert.deepEqual(normalizeReminder({ on: true, time: '07:30' }), { on: true, time: '07:30' });
  assert.deepEqual(normalizeReminder({ on: 'yes', time: '07:15' }), { on: false, time: '18:00' });
  assert.deepEqual(normalizeReminder(null), { on: false, time: '18:00' });
  assert.deepEqual(normalize({ version: 3 }).settings.reminder, { on: false, time: '18:00' });
  assert.deepEqual(normalize({ version: 3, settings: { reminder: { on: true, time: '21:00' } } }).settings.reminder, { on: true, time: '21:00' });
});

test('N2 when the in-app nudge shows', () => {
  const base = { reminder: { on: true, time: '18:00' }, now: '18:05', today: '2026-10-12', loggedToday: false, restToday: false, lastNudged: null };
  assert.equal(shouldNudge(base), true);
  assert.equal(shouldNudge({ ...base, now: '17:59' }), false, 'before her time');
  assert.equal(shouldNudge({ ...base, reminder: { on: false, time: '18:00' } }), false, 'off');
  assert.equal(shouldNudge({ ...base, loggedToday: true }), false, 'already logged');
  assert.equal(shouldNudge({ ...base, restToday: true }), false, 'rest day');
  assert.equal(shouldNudge({ ...base, lastNudged: '2026-10-12' }), false, 'once a day');
  assert.equal(shouldNudge({ ...base, lastNudged: '2026-10-11' }), true);
});

test('N3 every time has its calendar file, and it matches the generator', () => {
  for (const t of REMINDER_TIMES) {
    const file = readFileSync(new URL(`../${icsPath(t)}`, import.meta.url), 'utf8');
    assert.equal(file, icsText(t), `${icsPath(t)} is stale: run node tools/make-reminders.mjs`);
  }
  const ics = icsText('07:30');
  assert.ok(ics.split('\r\n').length > 10, 'CRLF line endings');
  assert.ok(!/[^\r]\n/.test(ics), 'no bare LF');
  assert.match(ics, /\r\nDTSTART:\d{8}T073000\r\n/, 'floating local time');
  assert.match(ics, /\r\nRRULE:FREQ=DAILY\r\n/);
  assert.match(ics, /BEGIN:VALARM[\s\S]*TRIGGER:PT0M[\s\S]*END:VALARM/);
});
