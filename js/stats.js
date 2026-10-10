// Pure functions that turn the workout list into numbers for the UI.

import { dateKey, addDays, todayKey, addDaysKey } from './dates.js';

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

/**
 * Consecutive days with at least one workout, counting back from today.
 * If today has nothing yet, the streak is still alive from yesterday.
 */
export function dailyStreak(workouts) {
  const days = new Set(workouts.map((w) => w.date));
  const today = todayKey();
  let key = days.has(today) ? today : addDaysKey(today, -1);
  let count = 0;
  while (days.has(key)) {
    count++;
    key = addDaysKey(key, -1);
  }
  return { count, includesToday: days.has(today) };
}

/** Longest run of consecutive active days ever. */
export function longestDailyStreak(workouts) {
  const days = [...new Set(workouts.map((w) => w.date))].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of days) {
    run = prev && addDaysKey(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** The single longest workout by duration (ties → most recent). */
export function longestWorkout(workouts) {
  let best = null;
  for (const w of workouts) {
    if (w.duration && (!best || w.duration > best.duration)) best = w;
  }
  return best;
}

export function totals(workouts) {
  return {
    count: workouts.length,
    minutes: workouts.reduce((sum, w) => sum + (w.duration || 0), 0),
  };
}
