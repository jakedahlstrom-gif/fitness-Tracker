// Writes the daily-nudge calendar files (reminders/glow-HHMM.ics), one per time in the picker.
// Run after changing reminders.js: node tools/make-reminders.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { REMINDER_TIMES, icsPath, icsText } from '../js/reminders.js';

mkdirSync(new URL('../reminders/', import.meta.url), { recursive: true });
for (const t of REMINDER_TIMES) writeFileSync(new URL(`../${icsPath(t)}`, import.meta.url), icsText(t));
console.log(`wrote ${REMINDER_TIMES.length} calendar files`);
