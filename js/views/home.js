// Home: greeting, weekly rings, weekly streak strip (with freezes and rest days),
// and 2×2 stat tiles. All numbers come from store.derived() (see progress.js).

import { store } from '../store.js';
import { icon } from '../icons.js';
import { esc, fmtNum, plural, fmtDistance } from '../util.js';
import {
  dateKey, todayKey, addDays, addDaysKey, startOfWeek, weekdayShort, fmtLongDate, fmtWeekRange,
  fmtAgo, fmtDayLabel, greeting,
} from '../dates.js';
import { monthStats, groupByDate } from '../stats.js';
import {
  ringsSVG, miniRingSVG, animateRings, typeBadge, METRIC_COLOR, goalLabel, goalProgressText,
} from '../components.js';
import { navigate } from '../router.js';
import { openLogSheet } from '../logSheet.js';
import { startExport } from '../backupFlow.js';
import { openSheet } from '../sheet.js';
import { toast } from '../toast.js';
import { haptic } from '../effects.js';
import { isCelebrating, revealUnseen } from '../celebrate.js';

let weekOffset = 0; // 0 = this week, -1 = last week, …
let lastProgress = null; // previous ring ratios, so rings animate from where they were and "pop" when they close

const INTENSITY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const TIER_LABEL = { short: 'Weekly goal', medium: 'Monthly goal', long: 'Long-term goal' };
const RECORD_LABEL = { longestWorkout: 'Longest workout', bestWeek: 'Best week', bestMonth: 'Best month' };

const ratio = (v, t) => (t > 0 ? Math.min(1, v / t) : 0);

export function renderHome(el) {
  const s = store.settings;
  const d = store.derived();
  const workouts = store.workouts();
  const now = new Date();
  const today = todayKey();
  const t = s.targets;

  // ---- Rings (this week) ----
  const sameWeek = lastProgress && lastProgress.weekKey === d.weekKey;
  const rings = [
    { key: 'workouts', label: 'Workouts', color: 'pink', value: d.week.count, target: t.workouts, unit: '' },
    { key: 'minutes', label: 'Minutes', color: 'purple', value: d.week.minutes, target: t.minutes, unit: 'min' },
    { key: 'days', label: 'Active days', color: 'cyan', value: d.week.activeDays, target: t.days, unit: '' },
  ].map((r) => ({
    ...r,
    from: sameWeek ? lastProgress[r.key] : 0,
    // A ring that just closed (since the last render this week) gets a one-time pop.
    pop: !!sameWeek && lastProgress[r.key] < 1 && ratio(r.value, r.target) >= 1,
  }));

  // ---- Weekly strip ----
  const thisWeek = startOfWeek(now, s.weekStart);
  const viewStart = addDays(thisWeek, weekOffset * 7);
  const byDay = groupByDate(workouts);
  const restMarks = new Set(store.state.restDays);
  const strip = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(viewStart, i);
    const key = dateKey(day);
    const done = byDay.has(key) && key <= today;
    const rest = !done && key <= today && restMarks.has(key);
    let state = key === today ? 'today' : key > today ? 'future' : done ? 'done' : 'missed';
    if (rest) state += ' rest';
    const what = done ? plural(byDay.get(key).length, 'workout') : rest ? 'rest day' : 'no workout';
    return `
      <button type="button" class="day ${state}${done ? ' has' : ''}" data-action="day" data-date="${key}"
        aria-label="${esc(`${fmtDayLabel(key)}: ${what}`)}" ${key > today ? 'disabled' : ''}>
        <span class="day-name">${esc(weekdayShort(day))}</span>
        <span class="day-dot">${rest ? icon('moon') : done && key !== today ? icon('check') : ''}</span>
      </button>`;
  }).join('');

  const streakHead = weekOffset === 0
    ? `<span class="streak-pills">
        <span class="pill pill-streak">${icon('flame')} ${d.weekly.current ? `${d.weekly.current} wk` : 'Start one'}</span>
        ${d.weekly.freezes ? `<span class="pill pill-freeze" title="Streak freezes">${icon('snowflake')} ${d.weekly.freezes}</span>` : ''}
      </span>`
    : `<span class="label label-quiet">${esc(fmtWeekRange(viewStart))}</span>`;

  const stripFoot = weekOffset === 0 ? currentWeekFoot(d, workouts.length, thisWeek) : pastWeekFoot(d, viewStart);

  // ---- Tiles ----
  const last = workouts.find((w) => w.date <= today) || workouts[0];
  const month = monthStats(workouts, now);
  const monthBars = weeklyBarsForMonth(workouts, now);

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

  const f = d.featured;
  const goalTile = f ? `
    <button type="button" class="card tile" data-action="goto-goal" data-id="${esc(f.id)}">
      <span class="label">${TIER_LABEL[f.tier]}</span>
      <span class="tile-row">
        ${miniRingSVG({ value: f.value, target: f.target, color: METRIC_COLOR[f.metric], from: lastProgress?.goalId === f.id ? lastProgress.goal : 0 })}
        ${f.met
          ? `<span class="tile-big tile-done">${icon('check')}<small>Done!</small></span>`
          : `<span class="tile-big">${Math.floor(f.pct * 100)}<small>%</small></span>`}
      </span>
      <span class="muted tile-clip">${esc(goalLabel(f.goal))}</span>
      <span class="muted tile-clip small">${esc(goalProgressText(f))}</span>
    </button>` : `
    <button type="button" class="card tile" data-action="goto-goals">
      <span class="label">Weekly goal</span>
      <span class="tile-row">
        ${miniRingSVG({ value: d.week.count, target: t.workouts, color: 'cyan', from: lastProgress?.goalId === 'week' ? lastProgress.goal : 0 })}
        <span class="tile-big">${Math.round(ratio(d.week.count, t.workouts) * 100)}<small>%</small></span>
      </span>
      <span class="muted">${d.week.count} of ${plural(t.workouts, 'workout')}</span>
    </button>`;

  const fresh = d.freshRecord ? d.records[d.freshRecord] : null;
  const best = store.getWorkout(d.records.longestWorkout.holder); // same record History marks with "PR"
  let bestTile;
  if (fresh) {
    bestTile = `
    <button type="button" class="card tile" data-action="goto-records">
      <span class="label c-pink-text">New PR!</span>
      <span class="tile-row">
        <span class="type-badge lg c-yellow">${icon('trophy')}</span>
        <span class="tile-big">${fmtNum(fresh.value)}<small>min</small></span>
      </span>
      <span class="muted">${RECORD_LABEL[d.freshRecord]}</span>
    </button>`;
  } else if (best) {
    bestTile = `
    <button type="button" class="card tile" data-action="goto-records">
      <span class="label">Personal best</span>
      <span class="tile-row">
        <span class="type-badge lg c-purple">${icon('trophy')}</span>
        <span class="tile-big">${best.duration}<small>min</small></span>
      </span>
      <span class="muted">Longest · ${esc(store.typeById(best.type).label)}</span>
    </button>`;
  } else {
    bestTile = `
    <div class="card tile tile-empty">
      <span class="label">Personal best</span>
      <span class="tile-row"><span class="type-badge lg c-purple">${icon('trophy')}</span></span>
      <span class="tile-empty-text">Your records will show up here.</span>
    </div>`;
  }

  el.innerHTML = `
    <header class="top">
      <div class="brand">GLOW<i>//</i>FIT</div>
      <h1 class="greeting">${greeting(now)}, ${esc(s.name || 'friend')}</h1>
      <p class="subtle">${esc(fmtLongDate(now))}</p>
      ${giftPillHTML()}
    </header>

    ${backupNudgeHTML(workouts.length)}

    <article class="card rings-card" aria-label="This week">
      <div class="rings-wrap">${ringsSVG(rings)}</div>
      <div class="ring-stats">
        ${rings.map((r) => `
          <div class="ring-stat${r.value >= r.target ? ' closed' : ''}">
            <span class="rs-label c-${r.color}">${r.label}</span>
            <span class="rs-val">${r.value >= r.target ? `<span class="rs-check c-${r.color}">${icon('check')}</span>` : ''}<b>${fmtNum(r.value)}</b>/${fmtNum(r.target)}${r.unit ? ` <small>${r.unit}</small>` : ''}</span>
          </div>`).join('')}
        <div class="ring-togo">${ringsToGoMessage(rings)}</div>
      </div>
    </article>

    <article class="card streak-card">
      <div class="card-head">
        <span class="label">Weekly streak</span>
        ${streakHead}
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
    weekKey: d.weekKey,
    workouts: ratio(d.week.count, t.workouts),
    minutes: ratio(d.week.minutes, t.minutes),
    days: ratio(d.week.activeDays, t.days),
    goalId: f ? f.id : 'week',
    goal: f ? f.pct : ratio(d.week.count, t.workouts),
  };

  if (!el.dataset.bound) bindHome(el);
}

/** Up to three short lines under this week's strip: weekly streak, daily streak, news. */
function currentWeekFoot(d, totalWorkouts, weekStart) {
  const w = d.weekly;
  const tw = w.thisWeek;
  const lastDay = weekdayShort(addDays(weekStart, 6));
  const lines = [];

  // 1. Weekly streak
  if (!totalWorkouts) {
    lines.push(`<span class="foot-main">${icon('sparkle')} Log a workout to start a streak</span>`);
  } else if (tw.met) {
    lines.push(`<span class="foot-main">${icon('flame')} ${plural(w.current, 'week')} in a row · this week is locked in${tw.earnedHere ? ' · freeze earned' : ''}</span>`);
  } else if (w.current > 0) {
    lines.push(`<span class="foot-main">${icon('flame')} ${tw.toGo} more ${tw.toGo === 1 ? 'workout' : 'workouts'} by ${esc(lastDay)} makes it ${w.current + 1} weeks${w.toNextFreeze === 1 ? ' · earns a freeze' : ''}</span>`);
  } else {
    lines.push(`<span class="foot-main">${icon('flame')} ${tw.toGo} more ${tw.toGo === 1 ? 'workout' : 'workouts'} this week starts a weekly streak</span>`);
  }

  // 2. Daily streak (with the "Rest day?" repair offer)
  const dl = d.daily;
  const neither = !dl.includesToday && !dl.restToday;
  if (dl.repairable) {
    lines.push(`<span class="foot-repair">Your ${dl.repairCount}-day streak paused yesterday. Rest day?
      <button type="button" class="btn btn-small btn-secondary" data-action="rest-yesterday">${icon('moon')} Mark rest</button></span>`);
  } else if (dl.count >= 2) {
    lines.push(`<span>${plural(dl.count, 'day')} in a row${dl.restUsed ? ` · ${dl.restUsed} rest` : ''}${neither ? '<span class="muted"> · log or rest today</span>' : ''}</span>`);
  } else if (dl.count === 1) {
    lines.push(`<span>1-day streak<span class="muted">${neither ? ' · log or rest today' : ' · go again tomorrow'}</span></span>`);
  } else if (totalWorkouts) {
    lines.push('<span class="muted">Start a daily streak today</span>');
  }

  // 3. What happened last week
  const lw = w.lastWeek;
  if (lw?.state === 'frozen') {
    lines.push(`<span class="muted">${icon('snowflake')} A freeze saved your streak last week</span>`);
  } else if (lw?.state === 'missed' && lw.endedRun >= 2) {
    lines.push(`<span class="muted">New week, fresh start. Your ${lw.endedRun}-week streak is in the books.</span>`);
  }
  return lines.map((l) => `<div class="foot-line">${l}</div>`).join('');
}

function pastWeekFoot(d, viewStart) {
  const wk = d.weekly.byKey.get(dateKey(viewStart));
  const mins = store.workouts().reduce((sum, w) => {
    const k = w.date;
    return k >= dateKey(viewStart) && k < dateKey(addDays(viewStart, 7)) ? sum + (w.duration || 0) : sum;
  }, 0);
  let text;
  if (!wk || !wk.count) text = '<span class="muted">No workouts this week</span>';
  else if (wk.state === 'met') text = `<span class="foot-main">${plural(wk.count, 'workout')} · ${fmtNum(mins)} min · goal met ✓</span>`;
  else if (wk.state === 'frozen') text = `<span>${wk.count} of ${wk.target} · saved by a freeze ${icon('snowflake')}</span>`;
  else text = `<span>${wk.count} of ${wk.target} · ${fmtNum(mins)} min</span>`;
  return `<div class="foot-line">${text}</div>`;
}

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

// ---------------------------------------------------------------------------
// Day sheet: a day with no workout can be marked as a rest day, or backfilled.
// ---------------------------------------------------------------------------

const REST_REASON = {
  cap: (c) => `You've used your ${c.cap} rest ${c.cap === 1 ? 'day' : 'days'} this week`,
  'too-old': () => 'Rest days can be marked up to 7 days back',
};

function openDaySheet(key) {
  const marked = store.state.restDays.includes(key);
  const check = store.restCheck(key);
  const reason = !check.ok && REST_REASON[check.reason] ? REST_REASON[check.reason](check) : '';
  const body = marked
    ? '<p>Marked as a rest day. Your daily streak is safe.</p>'
    : `<p>Nothing logged. Resting? A rest day keeps your daily streak going.</p>
       <p class="muted small">Rest days this week: ${check.used} of ${check.cap}</p>`;
  const sheet = openSheet({
    title: fmtDayLabel(key),
    body: `<div class="day-sheet">${body}${reason ? `<p class="muted small">${esc(reason)}</p>` : ''}</div>`,
    footer: `
      <button type="button" class="btn btn-ghost" data-action="toggle-rest" ${check.ok ? '' : 'disabled'}>${icon('moon')} ${marked ? 'Not a rest day' : 'Rest day'}</button>
      <button type="button" class="btn btn-primary" data-action="log-day">${icon('plus')} Log workout</button>`,
    className: 'day-sheet-layer',
  });
  sheet.el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'toggle-rest') {
      if (store.setRestDay(key, !marked)) {
        haptic('tick');
        toast(marked ? 'Rest day removed' : 'Rest day saved. Streak safe 🌙');
      }
      sheet.close('rest');
    } else if (btn.dataset.action === 'log-day') {
      sheet.close('log');
      openLogSheet({ mode: 'new', date: key });
    }
  });
}

function bindHome(el) {
  el.dataset.bound = '1';
  el.addEventListener('click', (e) => {
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
        if (store.state.workouts.some((w) => w.date === key)) navigate('history', { day: key });
        else if (key <= todayKey()) openDaySheet(key);
        break;
      }
      case 'rest-yesterday': {
        const y = addDaysKey(todayKey(), -1);
        if (store.setRestDay(y, true)) {
          haptic('tick');
          toast(`Streak saved: ${fmtDayLabel(y).toLowerCase()} is a rest day 🌙`);
        }
        break;
      }
      case 'edit-last': {
        const w = store.workouts().find((x) => x.date <= todayKey()) || store.workouts()[0];
        if (w) openLogSheet({ mode: 'edit', workout: w });
        break;
      }
      case 'goto-history':
        navigate('history');
        break;
      case 'goto-goals':
        navigate('goals');
        break;
      case 'goto-goal':
        navigate('goals', { goal: btn.dataset.id });
        break;
      case 'goto-records':
        navigate('goals', { section: 'records' });
        break;
      case 'backup-now':
        startExport();
        break;
      case 'open-gift':
        revealUnseen();
        break;
      case 'backup-snooze':
        store.updateMeta({ backupNudgeSnoozedUntil: new Date(Date.now() + 14 * 86400000).toISOString() });
        break;
      default:
    }
  });
}

/** "2 new badges waiting · tap to open": rewards earned quietly that she hasn't seen yet. */
function giftPillHTML() {
  if (store.awards.introPending || isCelebrating()) return '';
  const { badges, unlocks } = store.rewards().unseen;
  if (!badges.length && !unlocks.length) return '';
  const what = badges.length
    ? `${plural(badges.length, 'new badge')}${unlocks.length ? ` + ${plural(unlocks.length, 'look')}` : ''}`
    : `${plural(unlocks.length, 'new look')}`;
  return `<button type="button" class="gift-pill" data-action="open-gift">${icon('gift')}<span>${esc(what)} waiting · tap to open</span></button>`;
}

/** Jump the strip back to the current week (e.g. when Home is re-opened). */
export function resetHomeWeek() { weekOffset = 0; }
