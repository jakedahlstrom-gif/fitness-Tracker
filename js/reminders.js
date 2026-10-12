// Stage 5 reminders, the free version (pure, no DOM; tested in tests/reminders.test.js).
//
// A web app can't wake itself up at a set time, so the daily nudge has two halves:
//   - in the app: opening it after her reminder time, with nothing logged today, shows a gentle toast
//   - on the phone: "Add to Calendar" opens reminders/glow-HHMM.ics, a repeating daily event with
//     an alert. Those files are static (one per half hour), made by tools/make-reminders.mjs.

export const APP_URL = 'https://jakedahlstrom-gif.github.io/fitness-Tracker/';
export const DEFAULT_REMINDER = { on: false, time: '18:00' };

/** Every half hour from 05:00 to 22:30. */
export const REMINDER_TIMES = Array.from({ length: 36 }, (_, i) => {
  const m = 300 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

/** Repair the saved setting: { on, time } with a time from the list. */
export function normalizeReminder(r) {
  const time = REMINDER_TIMES.includes(r?.time) ? r.time : DEFAULT_REMINDER.time;
  return { on: r?.on === true, time };
}

/** Where the calendar file for a time lives (relative to the app). */
export const icsPath = (time) => `reminders/glow-${time.replace(':', '')}.ics`;

/** The calendar file: a daily event at `time` (floating local time) with an alert. */
export function icsText(time) {
  const hhmm = time.replace(':', '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Glow Fitness//Daily nudge//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:glow-nudge-${hhmm}@glow-fitness`,
    'DTSTAMP:20261012T000000Z',
    `DTSTART:20261012T${hhmm}00`,
    'DURATION:PT15M',
    'RRULE:FREQ=DAILY',
    'SUMMARY:✨ Glow time',
    `DESCRIPTION:A quick workout counts. Hold + to log it: ${APP_URL}`,
    `URL:${APP_URL}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:✨ Glow time',
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/**
 * Should the app nudge now? On, past her time, nothing logged and no rest day today,
 * and not already nudged today. `now` is "HH:MM".
 */
export function shouldNudge({ reminder, now, today, loggedToday, restToday, lastNudged }) {
  return !!reminder?.on && now >= reminder.time && !loggedToday && !restToday && lastNudged !== today;
}

/** "6:30 PM" style label for the time picker. */
export function timeLabel(time) {
  const [h, m] = time.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The nudge lines ({name}, {left} filled in by pickLine). The first set is used when her week is still open. */
export const NUDGE_WEEK = [
  '{left} to go this week, {name}. Even 10 minutes counts.',
  'Your week needs {left}. A quick one today?',
];
export const NUDGE_LINES = [
  'Gentle nudge: a short walk still counts, {name}.',
  'Still time to glow today. Hold + when you are done.',
  'Ten minutes is a workout too, {name}.',
];
