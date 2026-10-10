// Home: greeting, weekly rings, weekly streak strip, and 2×2 stat tiles.

import { store } from '../store.js';
import { icon } from '../icons.js';
import { esc, fmtNum, plural, fmtDistance } from '../util.js';
import {
  dateKey, todayKey, addDays, startOfWeek, weekdayShort, fmtLongDate, fmtWeekRange, fmtAgo,
  fmtDayLabel, greeting,
} from '../dates.js';
import { weekStats, monthStats, dailyStreak, longestWorkout, groupByDate } from '../stats.js';
import { ringsSVG, miniRingSVG, animateRings, typeBadge } from '../components.js';
import { navigate } from '../router.js';
import { openLogSheet } from '../logSheet.js';
import { startExport } from '../backupFlow.js';
import { toast } from '../toast.js';

let weekOffset = 0; // 0 = this week, -1 = last week, …
let lastProgress = { workouts: 0, minutes: 0, days: 0, goal: 0 }; // for smooth ring animation

const INTENSITY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export function renderHome(el) {
  const s = store.settings;
  const workouts = store.workouts();
  const now = new Date();
  const today = todayKey();
  const thisWeek = startOfWeek(now, s.weekStart);
  const week = weekStats(workouts, thisWeek);
  const t = s.targets;

  // ---- Rings ----
  const rings = [
    { key: 'workouts', label: 'Workouts', color: 'pink', value: week.count, target: t.workouts, unit: '' },
    { key: 'minutes', label: 'Minutes', color: 'purple', value: week.minutes, target: t.minutes, unit: 'min' },
    { key: 'days', label: 'Active days', color: 'cyan', value: week.activeDays, target: t.days, unit: '' },
  ];
  const ringData = rings.map((r) => ({ ...r, from: lastProgress[r.key] }));
  const toGo = ringsToGoMessage(rings);

  // ---- Weekly strip ----
  const viewStart = addDays(thisWeek, weekOffset * 7);
  const byDay = groupByDate(workouts);
  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(viewStart, i);
    const key = dateKey(d);
    const done = byDay.has(key);
    const state = key === today ? 'today' : key > today ? 'future' : done ? 'done' : 'missed';
    const label = `${fmtDayLabel(key)}: ${done ? plural(byDay.get(key).length, 'workout') : 'no workout'}`;
    return `
      <button type="button" class="day ${state}${done ? ' has' : ''}" data-action="day" data-date="${key}" aria-label="${esc(label)}" ${state === 'future' ? 'disabled' : ''}>
        <span class="day-name">${esc(weekdayShort(d))}</span>
        <span class="day-dot">${done && state !== 'today' ? icon('check') : ''}</span>
      </button>`;
  }).join('');

  const viewWeek = weekStats(workouts, viewStart);
  let stripFoot;
  if (weekOffset === 0) {
    const streak = dailyStreak(workouts);
    if (streak.count >= 2) {
      stripFoot = `<span class="streak-text">${icon('flame')} ${streak.count}-day streak!</span>${
        streak.includesToday ? '' : '<span class="muted"> Keep it alive today</span>'}`;
    } else if (streak.count === 1) {
      stripFoot = `<span class="streak-text">${icon('flame')} 1-day streak</span><span class="muted"> · go again tomorrow</span>`;
    } else {
      stripFoot = '<span class="muted">Log a workout to start a streak ✨</span>';
    }
  } else {
    const met = viewWeek.count >= t.workouts;
    stripFoot = viewWeek.count
      ? `<span class="${met ? 'streak-text' : ''}">${plural(viewWeek.count, 'workout')} · ${fmtNum(viewWeek.minutes)} min${met ? ' · goal met ✓' : ''}</span>`
      : '<span class="muted">No workouts this week</span>';
  }

  // ---- Tiles ----
  const last = workouts[0];
  const month = monthStats(workouts, now);
  const best = longestWorkout(workouts);
  const monthBars = weeklyBarsForMonth(workouts, now);
  const goalPct = t.workouts ? Math.min(100, Math.round((week.count / t.workouts) * 100)) : 0;

  const lastTile = last ? `
    <button type="button" class="card tile" data-action="edit-last">
      <span class="label">Last workout</span>
      <span class="tile-row">
        ${typeBadge(last.type, 'lg')}
        <span class="tile-lines">
          <span class="tile-strong">${last.duration ? `${last.duration}<small> min</small>` : esc(store.typeById(last.type).label)}</span>
          <span>${esc([last.intensity && INTENSITY_LABEL[last.intensity], last.distanceKm && fmtDistance(last.distanceKm, s.units)].filter(Boolean).join(' · ') || store.typeById(last.type).label)}</span>
          <span class="muted">${fmtAgo(last.date)}</span>
        </span>
      </span>
    </button>` : `
    <div class="card tile tile-empty">
      <span class="label">Last workout</span>
      <span class="tile-empty-text">Nothing yet. Hold the pink button to log your first one!</span>
    </div>`;

  const monthTile = `
    <button type="button" class="card tile" data-action="goto-history">
      <span class="label">This month</span>
      <span class="tile-big c-lime">${fmtNum(month.minutes)}<small>min</small></span>
      <span class="muted">${plural(month.count, 'workout')}</span>
      <span class="mini-bars" aria-hidden="true">${monthBars}</span>
    </button>`;

  const goalTile = `
    <button type="button" class="card tile" data-action="goto-goals">
      <span class="label">Weekly goal</span>
      <span class="tile-row">
        ${miniRingSVG({ value: week.count, target: t.workouts, color: 'cyan', from: lastProgress.goal })}
        <span class="tile-big">${goalPct}<small>%</small></span>
      </span>
      <span class="muted">${week.count} of ${plural(t.workouts, 'workout')}</span>
    </button>`;

  const bestTile = best ? `
    <button type="button" class="card tile" data-action="edit-best">
      <span class="label">Personal best</span>
      <span class="tile-row">
        <span class="type-badge lg c-purple">${icon('trophy')}</span>
        <span class="tile-big">${best.duration}<small>min</small></span>
      </span>
      <span class="muted">Longest · ${esc(store.typeById(best.type).label)}</span>
    </button>` : `
    <div class="card tile tile-empty">
      <span class="label">Personal best</span>
      <span class="tile-row"><span class="type-badge lg c-purple">${icon('trophy')}</span></span>
      <span class="tile-empty-text">Your records will show up here.</span>
    </div>`;

  el.innerHTML = `
    <header class="top">
      <div class="brand">GLOW<i>//</i>FIT</div>
      <h1 class="greeting">${greeting(now)}, ${esc(s.name || 'friend')}</h1>
      <p class="subtle">${esc(fmtLongDate(now))}</p>
    </header>

    ${backupNudgeHTML(workouts.length)}

    <article class="card rings-card" aria-label="This week">
      <div class="rings-wrap">${ringsSVG(ringData)}</div>
      <div class="ring-stats">
        ${rings.map((r) => `
          <div class="ring-stat">
            <span class="rs-label c-${r.color}">${r.label}</span>
            <span class="rs-val"><b>${fmtNum(r.value)}</b>/${fmtNum(r.target)}${r.unit ? ` <small>${r.unit}</small>` : ''}</span>
          </div>`).join('')}
        <div class="ring-togo">${toGo}</div>
      </div>
    </article>

    <article class="card streak-card">
      <div class="card-head">
        <span class="label">Weekly streak</span>
        <span class="label label-quiet">${weekOffset === 0 ? 'This week' : esc(fmtWeekRange(viewStart))}</span>
      </div>
      <div class="strip">
        <button type="button" class="icon-btn strip-nav" data-action="week-prev" aria-label="Previous week">${icon('chevronLeft')}</button>
        <div class="days">${strip}</div>
        <button type="button" class="icon-btn strip-nav" data-action="week-next" aria-label="Next week" ${weekOffset >= 0 ? 'disabled' : ''}>${icon('chevronRight')}</button>
      </div>
      <div class="strip-foot">${stripFoot}</div>
    </article>

    <div class="tiles">${lastTile}${monthTile}${goalTile}${bestTile}</div>
  `;

  animateRings(el);
  lastProgress = {
    workouts: ratio(week.count, t.workouts),
    minutes: ratio(week.minutes, t.minutes),
    days: ratio(week.activeDays, t.days),
    goal: ratio(week.count, t.workouts),
  };

  if (!el.dataset.bound) bindHome(el);
}

const ratio = (v, t) => (t > 0 ? Math.min(1, v / t) : 0);

/** "1 workout · 55 min to go" or "All rings closed! 🎉" */
function ringsToGoMessage(rings) {
  const left = rings.filter((r) => r.value < r.target);
  if (!left.length) return `${icon('sparkle')} All rings closed!`;
  const parts = left.slice(0, 2).map((r) => {
    const n = r.target - r.value;
    if (r.key === 'workouts') return plural(n, 'workout');
    if (r.key === 'minutes') return `${fmtNum(n)} min`;
    return plural(n, 'active day');
  });
  return `<span class="muted">${parts.join(' · ')} to go</span>`;
}

/** Tiny bar chart: minutes for each week of the current month. */
function weeklyBarsForMonth(workouts, now) {
  const s = store.settings;
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const monthStart = dateKey(first);
  const bars = [];
  for (let start = startOfWeek(first, s.weekStart); dateKey(start) < nextMonth; start = addDays(start, 7)) {
    const from = dateKey(start) < monthStart ? monthStart : dateKey(start);
    const to = dateKey(addDays(start, 7)) > nextMonth ? nextMonth : dateKey(addDays(start, 7));
    const mins = workouts.reduce((sum, w) => (w.date >= from && w.date < to ? sum + (w.duration || 0) : sum), 0);
    bars.push({ mins, future: from > todayKey() });
  }
  const max = Math.max(60, ...bars.map((b) => b.mins));
  return bars.map((b) => `<i class="${b.future || !b.mins ? 'future' : ''}" style="height:${Math.max(8, Math.round((b.mins / max) * 100))}%"></i>`).join('');
}

/** A gentle reminder to export a backup once there's data worth protecting. */
function backupNudgeHTML(count) {
  const m = store.meta;
  if (count < 5) return '';
  const now = Date.now();
  const last = m.lastBackupAt ? Date.parse(m.lastBackupAt) : 0;
  const snoozed = m.backupNudgeSnoozedUntil && Date.parse(m.backupNudgeSnoozedUntil) > now;
  if (snoozed || now - last < 30 * 86400000) return '';
  return `
    <div class="nudge">
      <span class="nudge-icon">${icon('database')}</span>
      <span class="nudge-text">${last ? "It's been a while since your last backup." : 'Back up your workouts so nothing gets lost.'}</span>
      <button type="button" class="btn btn-small btn-primary" data-action="backup-now">Back up</button>
      <button type="button" class="icon-btn" data-action="backup-snooze" aria-label="Remind me later">${icon('close')}</button>
    </div>`;
}

function bindHome(el) {
  el.dataset.bound = '1';
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'week-prev':
        weekOffset--;
        renderHome(el);
        break;
      case 'week-next':
        if (weekOffset < 0) weekOffset++;
        renderHome(el);
        break;
      case 'day': {
        const key = btn.dataset.date;
        if (store.workouts().some((w) => w.date === key)) {
          navigate('history', { day: key });
        } else {
          toast(`No workout on ${fmtDayLabel(key)}`, {
            action: { label: 'Add one', fn: () => openLogSheet({ mode: 'new', date: key }) },
          });
        }
        break;
      }
      case 'edit-last': {
        const w = store.workouts()[0];
        if (w) openLogSheet({ mode: 'edit', workout: w });
        break;
      }
      case 'edit-best': {
        const w = longestWorkout(store.workouts());
        if (w) openLogSheet({ mode: 'edit', workout: w });
        break;
      }
      case 'goto-history':
        navigate('history');
        break;
      case 'goto-goals':
        navigate('goals');
        break;
      case 'backup-now':
        startExport();
        break;
      case 'backup-snooze':
        store.updateMeta({ backupNudgeSnoozedUntil: new Date(Date.now() + 14 * 86400000).toISOString() });
        break;
      default:
    }
  });
}

/** Jump the strip back to the current week (e.g. when Home is re-opened). */
export function resetHomeWeek() { weekOffset = 0; }
