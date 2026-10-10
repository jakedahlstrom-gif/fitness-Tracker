// Goals tab: weekly ring targets and short/medium/long-term goals with progress
// bars, streaks with freezes, and personal records. Numbers come from store.derived().

import { store } from '../store.js';
import { icon } from '../icons.js';
import { esc, clamp, fmtNum, plural, kmToUnit, unitToKm } from '../util.js';
import {
  todayKey, addDaysKey, parseKey, fmtWeekRange, fmtShortDate, daysBetween, dateKey,
} from '../dates.js';
import { FREEZE_EVERY, MAX_FREEZES } from '../progress.js';
import { TARGET_LIMITS, GOAL_LIMITS, clampGoalTarget, isRealDateKey } from '../schema.js';
import {
  METRIC_COLOR, goalLabel, goalUnit, goalProgressText, segmented, toggle,
} from '../components.js';
import { openSheet, confirmDialog } from '../sheet.js';
import { openLogSheet } from '../logSheet.js';
import { navigate } from '../router.js';
import { toast } from '../toast.js';
import { haptic } from '../effects.js';
import { rewardsCardHTML, bindRewardsCard } from '../studio.js';
import { openShare } from '../celebrate.js';

const RINGS = [
  { key: 'workouts', label: 'Workouts per week', color: 'pink', step: 1, unit: '' },
  { key: 'minutes', label: 'Minutes per week', color: 'purple', step: 10, unit: 'min' },
  { key: 'days', label: 'Active days per week', color: 'cyan', step: 1, unit: '' },
];

const METRIC_NAMES = { workouts: 'Workouts', minutes: 'Minutes', days: 'Active days', distance: 'Distance', longestDistance: 'Distance in one go' };

/** A sensible starting target when she picks a timeframe + metric (distances in km). */
const DEFAULT_TARGET = {
  short: { workouts: 3, minutes: 150, days: 3, distance: 10 },
  medium: { workouts: 12, minutes: 600, days: 12, distance: 50 },
  long: { workouts: 150, minutes: 6000, days: 100, distance: 500, longestDistance: 5 },
};

const hasDistanceType = () => store.types().some((t) => t.distance);

export function renderGoals(el, params = {}) {
  const s = store.settings;
  const d = store.derived();
  const today = d.today;
  const weekStart = parseKey(d.weekKey);
  const weekLast = addDaysKey(d.weekKey, 6);
  const progress = new Map(d.goals.map((p) => [p.id, p]));
  const byTier = { short: [], medium: [], long: [] };
  for (const g of store.goals()) byTier[g.tier].push(progress.get(g.id));
  const monthEnd = dateKey(new Date(parseKey(today).getFullYear(), parseKey(today).getMonth() + 1, 0));
  const monthName = parseKey(today).toLocaleDateString(undefined, { month: 'long' });
  const current = { workouts: d.week.count, minutes: d.week.minutes, days: d.week.activeDays };
  const archivedCount = store.goals({ archived: true }).length;

  el.innerHTML = `
    <header class="top">
      <div class="brand">GLOW<i>//</i>FIT</div>
      <div class="top-row">
        <h1>Goals</h1>
        <button type="button" class="btn btn-small btn-secondary" data-action="new-goal">${icon('plus')} New goal</button>
      </div>
      <p class="subtle">Short, medium and long term. Tap a goal to edit it.</p>
    </header>

    <article class="card" id="week-goals">
      <div class="card-head">
        <span class="label">This week</span>
        <span class="label label-quiet">${esc(fmtWeekRange(weekStart))} · ${daysLeftText(daysBetween(today, weekLast) + 1)}</span>
      </div>
      <div class="target-list">
        ${RINGS.map((r) => {
          const v = s.targets[r.key];
          const pct = Math.min(100, Math.round((current[r.key] / v) * 100));
          return `
          <div class="target-row">
            <div class="target-info">
              <span class="target-name"><i class="dot c-${r.color}"></i>${r.label}</span>
              <span class="muted">This week: ${fmtNum(current[r.key])}${r.unit ? ` ${r.unit}` : ''}${current[r.key] >= v ? ` ${icon('check')}` : ''}</span>
              <span class="bar c-${r.color}"><i style="width:${pct}%"></i></span>
            </div>
            <div class="stepper small">
              <button type="button" class="step-btn" data-action="step" data-key="${r.key}" data-dir="-1" aria-label="Lower ${r.label}">−</button>
              <span class="stepper-num">${fmtNum(v)}</span>
              <button type="button" class="step-btn" data-action="step" data-key="${r.key}" data-dir="1" aria-label="Raise ${r.label}">+</button>
            </div>
          </div>`;
        }).join('')}
        ${byTier.short.map(goalRowHTML).join('')}
      </div>
      <p class="muted small card-note">Hit ${plural(s.targets.workouts, 'workout')} a week to grow your weekly streak. Changes count from this week on.</p>
      <button type="button" class="btn btn-small btn-ghost add-goal" data-action="new-goal" data-tier="short">${icon('plus')} Add weekly goal</button>
    </article>

    <article class="card" id="month-goals">
      <div class="card-head">
        <span class="label">This month</span>
        <span class="label label-quiet">${esc(monthName)} · ${daysLeftText(daysBetween(today, monthEnd) + 1)}</span>
      </div>
      ${byTier.medium.length
        ? `<div class="target-list">${byTier.medium.map(goalRowHTML).join('')}</div>`
        : `<p class="muted small">No monthly goal yet. Try one:</p>
           <div class="chip-row">${['m600', 'm12w', 'm12d'].map(templateChip).join('')}</div>`}
      <button type="button" class="btn btn-small btn-ghost add-goal" data-action="new-goal" data-tier="medium">${icon('plus')} Add monthly goal</button>
    </article>

    <article class="card" id="long-goals">
      <div class="card-head"><span class="label">Long term</span></div>
      ${byTier.long.length ? `<div class="target-list">${byTier.long.map(goalRowHTML).join('')}</div>` : ''}
      ${!byTier.long.some((p) => p.status === 'active' || p.status === 'upcoming')
        ? `<p class="muted small">${byTier.long.length ? 'Ready for the next one?' : 'Something bigger to aim for:'}</p>
           <div class="chip-row">${['lYear', ...(hasDistanceType() ? ['l5k'] : [])].map(templateChip).join('')}</div>`
        : ''}
      <button type="button" class="btn btn-small btn-ghost add-goal" data-action="new-goal" data-tier="long">${icon('plus')} Add long-term goal</button>
    </article>

    ${rewardsCardHTML()}
    ${streaksCardHTML(d)}
    ${recordsCardHTML(d)}

    ${archivedCount ? `
      <button type="button" class="card set-row set-link archived-link" data-action="archived">
        <span class="set-label">${icon('history')} Archived goals</span>
        <span class="muted">${archivedCount} ${icon('chevronRight')}</span>
      </button>` : ''}
  `;

  if (!el.dataset.bound) bindGoals(el);
  bindRewardsCard(el);

  const target = params.goal ? el.querySelector(`#goal-${CSS.escape(params.goal)}`)
    : params.section ? el.querySelector(`#${CSS.escape(params.section)}`) : null;
  if (target) {
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1600);
    });
  }
}

const daysLeftText = (n) => (n <= 1 ? 'last day' : `${n} days left`);

// ---- Goal rows ----

function roundUp(metric, v) {
  if (metric === 'minutes') return `${Math.ceil(v / 5) * 5} min`;
  if (metric === 'distance') {
    const u = kmToUnit(v, store.settings.units);
    return `${Math.ceil(u * 10) / 10} ${store.settings.units}`;
  }
  const n = Math.ceil(v);
  return `${n} ${goalUnit(metric, n)}`;
}

/** The muted line under a goal's bar. */
function statusLine(p) {
  const g = p.goal;
  const when = (k) => fmtShortDate(parseKey(k));
  if (g.tier !== 'long') {
    if (p.met) return `Done ${when(p.achievedOn)}`;
    let line = `${goalProgressText(p)} · ${daysLeftText(p.daysLeft ?? 0)}`;
    if (p.pace) line += p.pace.onPace ? ' · on pace' : ` · ${roundUp(p.metric, p.pace.behindBy)} to catch up`;
    return line;
  }
  if (p.status === 'upcoming') return `Starts ${when(p.from)}`;
  if (p.status === 'met') return `Completed ${when(p.achievedOn)}`;
  if (p.status === 'ended') return `Ended ${when(g.end)} · reached ${Math.floor(p.pct * 100)}%`;
  if (!g.end) return `${goalProgressText(p)} · No end date`;
  const perWeek = p.pace ? ` · about ${roundUp(p.metric, p.pace.perWeek)} a week` : '';
  return `${goalProgressText(p)} · ${daysLeftText(p.daysLeft ?? 0)}${perWeek}`;
}

function goalRowHTML(p) {
  if (!p) return '';
  const color = METRIC_COLOR[p.metric];
  const pct = Math.floor(p.pct * 100);
  return `
    <button type="button" class="goal-row ${p.status}" id="goal-${esc(p.id)}" data-action="edit-goal" data-id="${esc(p.id)}">
      <span class="goal-top">
        <span class="target-name"><i class="dot c-${color}"></i><span class="goal-name">${esc(goalLabel(p.goal))}</span></span>
        <span class="goal-pct c-${color}">${p.met ? icon('check') : `${pct}%`}</span>
      </span>
      <span class="bar c-${color}"><i style="width:${pct}%"></i></span>
      <span class="muted small">${esc(statusLine(p))}</span>
    </button>`;
}

// ---- Templates ----

function thisYearWindow() {
  const now = parseKey(todayKey());
  const y = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear(); // from October, plan next year
  return { start: `${y}-01-01`, end: `${y}-12-31`, year: y };
}

function template(id) {
  const types = store.types();
  const run = types.find((t) => t.id === 'run') || null; // no Run type → the 5K counts any distance workout
  switch (id) {
    case 'w2s': {
      const strength = types.find((t) => t.id === 'strength');
      return { label: `2 ${strength ? strength.label : ''} workouts a week`.replace('  ', ' '), goal: { tier: 'short', metric: 'workouts', target: 2, typeId: strength?.id ?? null } };
    }
    case 'm600': return { label: '600 min this month', goal: { tier: 'medium', metric: 'minutes', target: 600 } };
    case 'm12w': return { label: '12 workouts this month', goal: { tier: 'medium', metric: 'workouts', target: 12 } };
    case 'm12d': return { label: '12 active days', goal: { tier: 'medium', metric: 'days', target: 12 } };
    case 'lYear': {
      const w = thisYearWindow();
      return { label: `150 workouts in ${w.year}`, goal: { tier: 'long', metric: 'workouts', target: 150, start: w.start, end: w.end } };
    }
    case 'l5k': {
      // Already ran a 5K? Suggest a 10K instead.
      const done5k = store.state.workouts.some((w) => (!run || w.type === run.id) && (w.distanceKm || 0) >= 4.975);
      const km = done5k ? 10 : 5;
      return { label: done5k ? 'First 10K' : 'First 5K', goal: { tier: 'long', metric: 'longestDistance', target: km, typeId: run?.id ?? null, start: todayKey(), end: null } };
    }
    default: return null;
  }
}

const templateChip = (id) => `<button type="button" class="chip" data-action="template" data-template="${id}">${icon('sparkle')} ${esc(template(id).label)}</button>`;

// ---- Streaks ----

function streaksCardHTML(d) {
  const w = d.weekly;
  const filled = w.toNextFreeze === null ? 1 : (FREEZE_EVERY - w.toNextFreeze) / FREEZE_EVERY;
  const dots = w.weeks.slice(-9).map((x) => {
    const label = `${fmtShortDate(parseKey(x.key))}: ${x.state === 'open' ? 'this week' : x.state}`;
    const glyph = x.state === 'met' ? icon('check') : x.state === 'frozen' ? icon('snowflake') : '';
    return `<span class="week-dot ${x.state}" title="${esc(label)}" aria-label="${esc(label)}">${glyph}</span>`;
  }).join('');
  return `
    <article class="card" id="streaks">
      <div class="card-head"><span class="label">Streaks</span></div>
      <div class="profile-stats streak-stats">
        <div><b class="c-pink">${w.current}</b><span>Week streak</span><small class="muted">Best ${w.best}</small></div>
        <div><b class="c-cyan">${d.daily.count}</b><span>Day streak</span><small class="muted">Best ${d.daily.best}</small></div>
        <div><b class="c-blue">${w.freezes}/${MAX_FREEZES}</b><span>Freezes</span><small class="muted">${w.used ? `${w.used} used` : '&nbsp;'}</small></div>
      </div>
      <div class="freeze-progress">
        <span class="muted small">${w.toNextFreeze === null
          ? `Freezes full (${MAX_FREEZES}/${MAX_FREEZES})`
          : `Next freeze: ${plural(w.toNextFreeze, 'more weekly goal')}`}</span>
        <span class="bar c-blue"><i style="width:${Math.round(filled * 100)}%"></i></span>
      </div>
      ${w.weeks.length ? `<div class="week-dots" aria-label="Recent weeks">${dots}</div>` : ''}
      <p class="muted small card-note">Hit your weekly workout goal to grow your streak. Every ${FREEZE_EVERY} weeks in a row earns a freeze (you can hold ${MAX_FREEZES}), and a freeze covers a missed week automatically. Rest days (tap a day on Home) keep your daily streak going.</p>
    </article>`;
}

// ---- Personal records ----

function recordsCardHTML(d) {
  const r = d.records;
  const day = (k) => fmtShortDate(parseKey(k));
  const any = r.longestWorkout.value || r.bestWeek.value || r.dailyStreak.value || r.weeklyStreak.value;
  const pills = (rec) => `${rec.isNew ? '<span class="pill pill-new">NEW</span>' : ''}${rec.current ? '<span class="pill pill-current">Current</span>' : ''}`;
  const row = (kind, label, rec, value, context, action = '') => `
    <${action ? `button type="button" data-action="${action}" data-kind="${kind}"` : 'div'} class="record-row">
      <span class="type-badge c-yellow">${icon('trophy')}</span>
      <span class="record-main">
        <span class="record-label">${label}${pills(rec)}</span>
        <span class="muted small">${rec.value ? esc(context) : 'Not set yet'}</span>
      </span>
      <span class="record-value">${rec.value ? value : '—'}</span>
    </${action ? 'button' : 'div'}>`;

  let lw = '';
  if (r.longestWorkout.value) {
    const w = store.getWorkout(r.longestWorkout.holder);
    lw = `${w ? store.typeById(w.type).label : 'Workout'} · ${day(r.longestWorkout.date)}`;
  }
  const weekCtx = r.bestWeek.value ? fmtWeekRange(parseKey(r.bestWeek.holder)) : '';
  const monthCtx = r.bestMonth.value ? parseKey(`${r.bestMonth.holder}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
  const dailyCtx = r.dailyStreak.value ? `${day(r.dailyStreak.holder)} – ${day(r.dailyStreak.date)}` : '';
  const weeklyCtx = r.weeklyStreak.value ? `since ${day(r.weeklyStreak.holder)}` : '';

  return `
    <article class="card" id="records">
      <div class="card-head"><span class="label">Personal records</span></div>
      ${any ? '' : '<p class="muted small">Your records will show up here.</p>'}
      <div class="record-list">
        ${row('longestWorkout', 'Longest workout', r.longestWorkout, `${fmtNum(r.longestWorkout.value)}<small> min</small>`, lw, r.longestWorkout.value ? 'record' : '')}
        ${row('bestWeek', 'Most minutes in a week', r.bestWeek, `${fmtNum(r.bestWeek.value)}<small> min</small>`, weekCtx, r.bestWeek.value ? 'record' : '')}
        ${row('bestMonth', 'Most minutes in a month', r.bestMonth, `${fmtNum(r.bestMonth.value)}<small> min</small>`, monthCtx, r.bestMonth.value ? 'record' : '')}
        ${row('dailyStreak', 'Longest daily streak', r.dailyStreak, `${r.dailyStreak.value}<small> ${r.dailyStreak.value === 1 ? 'day' : 'days'}</small>`, dailyCtx)}
        ${row('weeklyStreak', 'Longest weekly streak', r.weeklyStreak, `${r.weeklyStreak.value}<small> ${r.weeklyStreak.value === 1 ? 'week' : 'weeks'}</small>`, weeklyCtx)}
      </div>
    </article>`;
}

// ---- Events ----

function bindGoals(el) {
  el.dataset.bound = '1';
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'step': {
        const key = btn.dataset.key;
        const r = RINGS.find((x) => x.key === key);
        const { min, max } = TARGET_LIMITS[key];
        const next = clamp(store.settings.targets[key] + r.step * Number(btn.dataset.dir), min, max);
        if (next === store.settings.targets[key]) return;
        haptic('tick');
        store.setTarget(key, next);
        break;
      }
      case 'new-goal':
        openGoalSheet({ mode: 'new', preset: btn.dataset.tier ? { tier: btn.dataset.tier } : null });
        break;
      case 'template':
        openGoalSheet({ mode: 'new', preset: template(btn.dataset.template).goal });
        break;
      case 'edit-goal': {
        const g = store.getGoal(btn.dataset.id);
        if (g) openGoalSheet({ mode: 'edit', goal: g });
        break;
      }
      case 'record': {
        const r = store.derived().records[btn.dataset.kind];
        if (btn.dataset.kind === 'longestWorkout') {
          const w = store.getWorkout(r.holder);
          if (w) openLogSheet({ mode: 'edit', workout: w });
        } else {
          navigate('history', { day: r.date });
        }
        break;
      }
      case 'archived':
        openArchivedSheet();
        break;
      default:
    }
  });
}

// ---------------------------------------------------------------------------
// Goal sheet: create or edit a goal
// ---------------------------------------------------------------------------

function stepFor(metric, tier) {
  if (metric === 'minutes') return tier === 'short' ? 10 : 30;
  if (metric === 'distance') return 1;
  if (metric === 'longestDistance') return 0.5;
  return 1;
}

export function openGoalSheet({ mode = 'new', goal = null, preset = null } = {}) {
  const units = store.settings.units;
  const draft = goal
    ? { ...goal }
    : { tier: 'medium', metric: 'minutes', target: 600, typeId: null, start: null, end: null, name: '', ...(preset || {}) };
  if (!goal && preset && preset.target === undefined) {
    draft.target = DEFAULT_TARGET[draft.tier][draft.metric] ?? draft.target;
  }
  if (draft.tier === 'long' && !draft.start) draft.start = todayKey();
  const wasPinned = !!goal && store.settings.featuredGoalId === goal.id;
  let featured = wasPinned;
  let finished = false;

  const sheet = openSheet({
    title: mode === 'new' ? 'New goal' : 'Edit goal',
    body: '<div class="goal-form"></div>',
    footer: mode === 'new'
      ? `<button type="button" class="btn btn-ghost" data-close>Cancel</button>
         <button type="button" class="btn btn-primary" data-action="save">${icon('plus')} Create goal</button>`
      : `<button type="button" class="btn btn-ghost" data-action="archive">Archive</button>
         <button type="button" class="btn btn-primary" data-action="save">${icon('check')} Save</button>`,
    className: 'goal-sheet',
  });
  const host = sheet.body.querySelector('.goal-form');

  const metricsFor = (tier) => ['workouts', 'minutes', 'days',
    ...(hasDistanceType() || isDist(draft.metric) ? ['distance'] : []),
    ...(tier === 'long' ? ['longestDistance'] : [])];
  const isDist = (m) => m === 'distance' || m === 'longestDistance';

  function typeOptions() {
    const list = store.types().filter((t) => !isDist(draft.metric) || t.distance);
    const current = draft.typeId ? store.typeById(draft.typeId) : null;
    if (current && !list.some((t) => t.id === current.id)) list.push(current); // keep an archived type selectable
    return list;
  }

  // A goal already crushed this period (or a met long-term goal) can be shared from here.
  const crushed = goal ? store.progressFor(goal) : null;
  const crushedHTML = crushed?.met ? `
    <div class="crushed-banner">
      <span class="cb-check">${icon('check')}</span>
      <span>Crushed ${esc(parseKey(crushed.achievedOn).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span>
      <button type="button" class="btn btn-small btn-secondary" data-share-goal>${icon('share')} Share card</button>
    </div>` : '';
  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-share-goal]')) openShare({ kind: 'goal', goalId: goal.id });
  });

  function draw() {
    const shownTarget = isDist(draft.metric) ? Math.round(kmToUnit(draft.target, units) * 100) / 100 : draft.target;
    const unit = isDist(draft.metric) ? units : goalUnit(draft.metric, draft.target);
    host.innerHTML = `${crushedHTML}
      ${mode === 'new' ? `
      <section class="field">
        <div class="field-label">Ideas</div>
        <div class="chip-row chip-row-tight">${['w2s', 'm600', 'lYear', ...(hasDistanceType() ? ['l5k'] : [])].map(templateChip).join('')}</div>
      </section>` : ''}

      <section class="field">
        <div class="field-label">Timeframe</div>
        ${segmented('tier', [['short', 'This week'], ['medium', 'This month'], ['long', 'Long term']], draft.tier, { ariaLabel: 'Timeframe' })}
      </section>

      <section class="field">
        <div class="field-label">Track</div>
        <div class="chip-row chip-row-tight">${metricsFor(draft.tier).map((m) => `
          <button type="button" class="chip c-${METRIC_COLOR[m]}${draft.metric === m ? ' on' : ''}" aria-pressed="${draft.metric === m}" data-action="metric" data-value="${m}">${METRIC_NAMES[m]}</button>`).join('')}
        </div>
      </section>

      <section class="field">
        <div class="field-label">Target</div>
        <div class="stepper">
          <button type="button" class="step-btn" data-action="target-step" data-dir="-1" aria-label="Lower target">−</button>
          <label class="stepper-value">
            <input type="number" id="goal-target" inputmode="decimal" min="0" step="any" value="${shownTarget}" aria-label="Target">
            <span>${esc(unit)}</span>
          </label>
          <button type="button" class="step-btn" data-action="target-step" data-dir="1" aria-label="Raise target">+</button>
        </div>
      </section>

      <section class="field">
        <div class="field-label">Workout type</div>
        <div class="chip-row chip-row-tight">
          <button type="button" class="chip${draft.typeId ? '' : ' on'}" aria-pressed="${!draft.typeId}" data-action="type" data-value="">Any</button>
          ${typeOptions().map((t) => `
            <button type="button" class="chip c-${t.color}${draft.typeId === t.id ? ' on' : ''}" aria-pressed="${draft.typeId === t.id}" data-action="type" data-value="${esc(t.id)}">${icon(t.icon)} ${esc(t.label)}</button>`).join('')}
        </div>
      </section>

      ${draft.tier === 'long' ? `
      <section class="field">
        <div class="field-label">Dates</div>
        <div class="date-pair">
          <label><span class="muted small">Start</span><input type="date" class="input input-date" id="goal-start" value="${esc(draft.start || '')}"></label>
          <label><span class="muted small">End</span><input type="date" class="input input-date" id="goal-end" value="${esc(draft.end || '')}"></label>
        </div>
        <div class="chip-row chip-row-tight">
          <button type="button" class="chip" data-action="this-year">This year</button>
          <button type="button" class="chip${draft.end ? '' : ' on'}" aria-pressed="${!draft.end}" data-action="no-end">No end date</button>
        </div>
      </section>` : ''}

      <section class="field">
        <label class="field-label" for="goal-name">Name <span class="opt">optional</span></label>
        <input class="input" id="goal-name" maxlength="40" value="${esc(draft.name || '')}" placeholder="${esc(goalLabel({ ...draft, name: '' }))}" enterkeyhint="done">
      </section>

      <div class="set-row goal-pin">
        <span class="set-label">${icon('home')} Show on Home</span>
        ${toggle('featured', featured, 'Show on Home')}
      </div>

      <div class="goal-preview" aria-live="polite"></div>`;
    preview();
  }

  /** Live "you're at X already" line, computed against her real workouts. */
  function preview() {
    const out = host.querySelector('.goal-preview');
    if (!out) return;
    const p = store.progressFor({ ...draft, id: draft.id || 'draft', createdAt: draft.createdAt || new Date().toISOString() });
    let text;
    if (draft.tier === 'long' && draft.start > todayKey()) text = `Starts ${fmtShortDate(parseKey(draft.start))}`;
    else if (p.met) text = `Already done on ${fmtShortDate(parseKey(p.achievedOn))}! Make it bigger?`;
    else if (draft.tier === 'long' && draft.end && p.pace) text = `About ${perWeekText(p)} a week to finish by ${fmtShortDate(parseKey(draft.end))}`;
    else text = `You're at ${goalProgressText(p)} already`;
    out.innerHTML = `
      <span class="bar c-${METRIC_COLOR[draft.metric]}"><i style="width:${Math.floor(p.pct * 100)}%"></i></span>
      <span class="muted small">${esc(text)}</span>`;
  }

  function resetTarget() {
    draft.target = DEFAULT_TARGET[draft.tier][draft.metric] ?? draft.target;
  }

  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const v = btn.dataset.value;
    switch (btn.dataset.action) {
      case 'template': {
        Object.assign(draft, { typeId: null, start: null, end: null, name: '' }, template(btn.dataset.template).goal);
        if (draft.tier === 'long' && !draft.start) draft.start = todayKey();
        break;
      }
      case 'tier':
        if (draft.tier === v) return;
        draft.tier = v;
        if (!metricsFor(v).includes(draft.metric)) draft.metric = 'workouts';
        if (v === 'long' && !draft.start) draft.start = todayKey();
        resetTarget();
        break;
      case 'metric':
        if (draft.metric === v) return;
        draft.metric = v;
        if (isDist(v) && draft.typeId && !store.typeById(draft.typeId).distance) draft.typeId = null;
        resetTarget();
        break;
      case 'target-step': {
        const step = stepFor(draft.metric, draft.tier);
        if (isDist(draft.metric)) {
          const shown = kmToUnit(draft.target, units);
          const next = Math.max(step, Math.round((shown + step * Number(btn.dataset.dir)) / step) * step);
          draft.target = clampGoalTarget(draft.metric, draft.tier, unitToKm(next, units));
        } else {
          // Stop at the minimum (clampGoalTarget swaps values ≤ 0 for a default, which is for repairing data).
          const next = Math.max(GOAL_LIMITS[draft.metric].min, draft.target + step * Number(btn.dataset.dir));
          draft.target = clampGoalTarget(draft.metric, draft.tier, next);
        }
        haptic('tick');
        break;
      }
      case 'type':
        draft.typeId = v || null;
        break;
      case 'this-year': {
        const y = parseKey(todayKey()).getFullYear();
        draft.start = `${y}-01-01`;
        draft.end = `${y}-12-31`;
        break;
      }
      case 'no-end':
        draft.end = null;
        break;
      case 'featured':
        featured = !featured;
        break;
      default:
        return;
    }
    draw();
  });

  host.addEventListener('input', (e) => {
    if (e.target.id === 'goal-target') {
      const n = parseFloat(e.target.value);
      if (n > 0) draft.target = isDist(draft.metric) ? unitToKm(n, units) : n;
      preview();
    } else if (e.target.id === 'goal-name') {
      draft.name = e.target.value;
    }
  });
  // Typed values update the form in place: rebuilding here would remove whatever she taps next.
  host.addEventListener('change', (e) => {
    const nameEl = host.querySelector('#goal-name');
    if (e.target.id === 'goal-target') {
      draft.target = clampGoalTarget(draft.metric, draft.tier, draft.target);
      e.target.value = isDist(draft.metric) ? Math.round(kmToUnit(draft.target, units) * 100) / 100 : draft.target;
      host.querySelector('.stepper-value span').textContent = isDist(draft.metric) ? units : goalUnit(draft.metric, draft.target);
    } else if (e.target.id === 'goal-start' || e.target.id === 'goal-end') {
      const v = e.target.value;
      if (e.target.id === 'goal-start') {
        draft.start = isRealDateKey(v) ? v : draft.start;
        e.target.value = draft.start || '';
      } else {
        draft.end = isRealDateKey(v) ? v : null;
      }
      const noEnd = host.querySelector('[data-action="no-end"]');
      noEnd?.classList.toggle('on', !draft.end);
      noEnd?.setAttribute('aria-pressed', String(!draft.end));
    } else {
      return;
    }
    nameEl.placeholder = goalLabel({ ...draft, name: '' });
    preview();
  });

  sheet.el.querySelector('.sheet-foot').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || finished) return;
    if (btn.dataset.action === 'archive') {
      finished = true;
      sheet.close('archive');
      const pinned = store.archiveGoal(goal.id);
      toast('Goal archived', {
        duration: 5000,
        action: {
          label: 'Undo',
          fn: () => {
            store.unarchiveGoal(goal.id);
            if (pinned) store.setFeaturedGoal(goal.id); // must run after unarchive
          },
        },
      });
      return;
    }
    if (btn.dataset.action !== 'save') return;

    // Validate
    draft.name = (host.querySelector('#goal-name')?.value || '').trim();
    if (!(draft.target > 0)) {
      toast('Set a target above zero');
      host.querySelector('#goal-target')?.focus();
      return;
    }
    if (draft.tier === 'long') {
      if (!isRealDateKey(draft.start)) { toast('Pick a start date'); host.querySelector('#goal-start')?.focus(); return; }
      if (draft.end && draft.end < draft.start) { toast('The end date is before the start date'); host.querySelector('#goal-end')?.focus(); return; }
    }

    finished = true;
    const spec = {
      tier: draft.tier, metric: draft.metric, target: draft.target, typeId: draft.typeId,
      start: draft.tier === 'long' ? draft.start : null, end: draft.tier === 'long' ? draft.end : null, name: draft.name,
    };
    let saved;
    if (mode === 'new') {
      saved = store.addGoal(spec);
      toast(saved ? `Goal set: ${goalLabel(saved)}` : 'Could not create that goal');
    } else {
      saved = store.updateGoal(goal.id, spec);
      toast('Goal saved');
    }
    if (saved && featured !== wasPinned) store.setFeaturedGoal(featured ? saved.id : null);
    sheet.close('saved');
  });

  draw();
  return sheet;
}

function perWeekText(p) {
  const v = p.pace.perWeek;
  if (p.metric === 'minutes') return `${Math.ceil(v / 5) * 5} min`;
  if (p.metric === 'distance') return `${Math.ceil(kmToUnit(v, store.settings.units) * 10) / 10} ${store.settings.units}`;
  const n = Math.ceil(v);
  return `${n} ${goalUnit(p.metric, n)}`;
}

// ---------------------------------------------------------------------------
// Archived goals
// ---------------------------------------------------------------------------

function openArchivedSheet() {
  const sheet = openSheet({ title: 'Archived goals', body: '<div class="archived-list"></div>' });
  const host = sheet.body.querySelector('.archived-list');

  function draw() {
    const list = store.goals({ archived: true });
    if (!list.length) {
      host.innerHTML = '<p class="muted">No archived goals.</p>';
      return;
    }
    host.innerHTML = list.map((g) => {
      const p = store.progressFor(g);
      return `
        <div class="archived-row" data-id="${esc(g.id)}">
          <span class="dot c-${METRIC_COLOR[g.metric]}"></span>
          <span class="archived-main">
            <span class="goal-name">${esc(goalLabel(g))}</span>
            <span class="muted small">${esc(statusLine(p))}</span>
          </span>
          ${g.tier === 'long' && p.met ? `<button type="button" class="icon-btn" data-action="share" aria-label="Share">${icon('share')}</button>` : ''}
          <button type="button" class="btn btn-small btn-secondary" data-action="restore">Restore</button>
          <button type="button" class="icon-btn" data-action="delete" aria-label="Delete forever">${icon('trash')}</button>
        </div>`;
    }).join('');
  }
  draw();

  host.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.closest('[data-id]').dataset.id;
    if (btn.dataset.action === 'share') {
      openShare({ kind: 'goal', goalId: id });
      return;
    }
    if (btn.dataset.action === 'restore') {
      store.unarchiveGoal(id);
      toast('Goal restored');
    } else if (btn.dataset.action === 'delete') {
      const ok = await confirmDialog({ title: 'Delete this goal forever?', message: "This can't be undone.", confirmText: 'Delete', danger: true });
      if (!ok) return;
      store.deleteGoal(id);
    }
    draw();
    if (!store.goals({ archived: true }).length) sheet.close('empty');
  });
}
