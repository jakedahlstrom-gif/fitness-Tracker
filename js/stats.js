// Pure helpers that turn the workout list into numbers for the UI.
// Streaks, goals and records live in progress.js.

import { dateKey, addDays } from './dates.js';

/** Map of dateKey → workouts on that day. */
export function groupByDate(workouts) {
  const map = new Map();
  for (const w of workouts) {
    if (!map.has(w.date)) map.set(w.date, []);
    map.get(w.date).push(w);
  }
  return map;
}

/** Totals for workouts with startKey <= date < endKey. */
export function rangeStats(workouts, startKey, endKey) {
  let count = 0;
  let minutes = 0;
  const days = new Set();
  for (const w of workouts) {
    if (w.date >= startKey && w.date < endKey) {
      count++;
      minutes += w.duration || 0;
      days.add(w.date);
    }
  }
  return { count, minutes, activeDays: days.size, days };
}

/** Totals for the 7-day week starting at weekStart (a Date at midnight). */
export function weekStats(workouts, weekStart) {
  return rangeStats(workouts, dateKey(weekStart), dateKey(addDays(weekStart, 7)));
}

/** Totals for the calendar month containing `date`. */
export function monthStats(workouts, date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return rangeStats(workouts, dateKey(start), dateKey(end));
}

export function totals(workouts) {
  return {
    count: workouts.length,
    minutes: workouts.reduce((sum, w) => sum + (w.duration || 0), 0),
  };
}
