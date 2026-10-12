// Challenges UI: the picker sheet, plus the sheet that starts a preset or builds her own.
// A challenge is a long-term goal with a `challenge` tag (see challenges.js); this file
// only collects the choices and hands a spec to store.addGoal.

import { store } from './store.js';
import { icon } from './icons.js';
import { esc, kmToUnit, unitToKm } from './util.js';
import { todayKey, addDaysKey, parseKey, daysBetween, fmtShortDate } from './dates.js';
import { GOAL_LIMITS, clampGoalTarget } from './schema.js';
import { segmented, goalLabel, goalUnit } from './components.js';
import { BADGE_BY_ID } from './badges.js';
import { badgeSVG } from './badgeArt.js';
import { openSheet } from './sheet.js';
import { toast } from './toast.js';
import { haptic } from './effects.js';
import {
  CHALLENGES, PRESET_BY_ID, LENGTHS, CHALLENGE_METRICS, presetBadgeId, resolveType, defaultWhen,
  presetWindow, presetName, presetSpec, customSpec,
} from './challenges.js';

const METRIC_NAMES = { workouts: 'Workouts', minutes: 'Minutes', days: 'Days', distance: 'Distance' };
const STEP = { workouts: 1, minutes: 50, days: 1, distance: 1 }; // distance step is in her units
const START_TARGET = { workouts: 8, minutes: 300, days: 10 }; // for her own; distance is set per unit below

const hasDistanceType = () => store.types().some((t) => t.distance);
const hasDistance = () => hasDistanceType() || store.state.workouts.some((w) => w.distanceKm > 0);

/** "Oct 12 – Nov 10", or just "October" for a calendar-month preset. */
function whenText(preset, today, when) {
  const { start, end } = presetWindow(preset, today, when);
  if (preset.window === 'month') return parseKey(start).toLocaleDateString(undefined, { month: 'long' });
  return `${fmtShortDate(parseKey(start))} – ${fmtShortDate(parseKey(end))}`;
}

/** A preset's name for now, with its type (or the one that would be added) and month filled in. */
export function presetTitle(preset, today = todayKey(), { typeId = null, when } = {}) {
  const r = resolveType(preset, store.types(), typeId);
  return presetName(preset, { type: r.type || r.create, start: presetWindow(preset, today, when).start });
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

export function openChallengePicker() {
  const today = todayKey();
  const running = new Set(store.derived().goals
    .filter((p) => p.goal.challenge && !p.goal.archivedAt && (p.status === 'active' || p.status === 'upcoming'))
    .map((p) => p.goal.challenge));
  const list = CHALLENGES.filter((p) => p.id !== 'marathon' || hasDistance());

  const sheet = openSheet({
    title: 'Challenges',
    body: `<div class="chal-list">${list.map((p) => `
      <article class="chal-card">
        <span class="type-badge lg c-${p.color}">${icon(p.icon)}</span>
        <div class="chal-main c-${p.color}">
          <b class="chal-name">${esc(presetTitle(p, today))}</b>
          <span class="muted small">${esc(p.blurb)}</span>
          <span class="muted small chal-meta">${icon('calendar')} ${esc(whenText(p, today))}</span>
          <span class="small chal-meta chal-earn-name">${icon('medal')} ${esc(BADGE_BY_ID.get(presetBadgeId(p.id)).name)}</span>
        </div>
        ${running.has(p.id)
          ? '<span class="pill pill-current">In progress</span>'
          : `<button type="button" class="btn btn-small btn-secondary" data-action="start" data-id="${p.id}">Start</button>`}
      </article>`).join('')}</div>`,
    footer: `<button type="button" class="btn btn-secondary" data-action="custom">${icon('plus')} Create your own</button>`,
    className: 'challenge-sheet',
  });

  const onSaved = () => sheet.close('started');
  sheet.el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'start') openChallengeSheet({ preset: PRESET_BY_ID.get(btn.dataset.id), onSaved });
    else if (btn.dataset.action === 'custom') openChallengeSheet({ preset: null, onSaved });
  });
  return sheet;
}

// ---------------------------------------------------------------------------
// Start a preset, or build her own
// ---------------------------------------------------------------------------

export function openChallengeSheet({ preset = null, onSaved } = {}) {
  const units = store.settings.units;
  const today = todayKey();
  const startTarget = (m) => (m === 'distance' ? unitToKm(units === 'mi' ? 15 : 25, units) : START_TARGET[m]);
  const draft = preset
    ? { metric: preset.metric, target: preset.target, typeId: null, when: defaultWhen(preset, today) }
    : { metric: 'workouts', target: START_TARGET.workouts, typeId: null, name: '', days: 14, startIn: 0 };
  const base = preset ? resolveType(preset, store.types()) : null; // what the preset counts before she picks
  let finished = false;

  const sheet = openSheet({
    title: preset ? 'Start a challenge' : 'Your own challenge',
    body: '<div class="goal-form chal-form"></div>',
    footer: `<button type="button" class="btn btn-ghost" data-close>Cancel</button>
             <button type="button" class="btn btn-primary" data-action="save">${icon('medal')} Start challenge</button>`,
    className: 'challenge-sheet',
  });
  const host = sheet.body.querySelector('.chal-form');

  const windowOf = () => (preset
    ? presetWindow(preset, today, draft.when)
    : { start: addDaysKey(today, draft.startIn), end: addDaysKey(today, draft.startIn + draft.days - 1) });
  /** Clamp a km/count target to the metric's limits; "days" can't exceed the window. */
  function fit(v) {
    const t = clampGoalTarget(draft.metric, 'long', v);
    const { start, end } = windowOf();
    return draft.metric === 'days' ? Math.min(t, daysBetween(start, end) + 1) : t;
  }
  const isDist = () => draft.metric === 'distance';
  const shownTarget = () => (isDist() ? Math.round(kmToUnit(draft.target, units) * 100) / 100 : draft.target);
  const unitText = () => (isDist() ? units : goalUnit(draft.metric, draft.target));

  /** Her own challenge as a goal spec, named "<label> in N days" when she leaves the name blank. */
  function customFromDraft() {
    const spec = customSpec({ ...draft, target: fit(draft.target), start: windowOf().start });
    if (!spec.name) {
      const auto = `${goalLabel({ ...spec, name: '', start: null, end: null })} in ${draft.days} days`;
      spec.name = auto.length <= 40 ? auto : ''; // too long to fit: fall back to the dated label
    }
    return spec;
  }

  const typeChip = (t, on) => `
    <button type="button" class="chip c-${t.color}${on ? ' on' : ''}" aria-pressed="${on}" data-action="type" data-value="${esc(t.id)}">${icon(t.icon)} ${esc(t.label)}</button>`;

  function typeField() {
    if (preset && !preset.pickType) {
      return base.create ? `<p class="muted small">Adds a ${esc(base.create.label)} workout type for you.</p>` : '';
    }
    const list = store.types().filter((t) => (preset ? t.id !== 'other' : !isDist() || t.distance));
    const sel = draft.typeId || (preset ? base.typeId : null);
    const first = preset
      ? (base.create ? `<button type="button" class="chip c-${base.create.color}${sel ? '' : ' on'}" aria-pressed="${!sel}" data-action="type" data-value="">${icon(base.create.icon)} ${esc(base.create.label)} (new)</button>` : '')
      : `<button type="button" class="chip${sel ? '' : ' on'}" aria-pressed="${!sel}" data-action="type" data-value="">Any</button>`;
    return `
      <section class="field">
        <div class="field-label">Workout type</div>
        <div class="chip-row chip-row-tight">${first}${list.map((t) => typeChip(t, t.id === sel)).join('')}</div>
      </section>`;
  }

  const stepperField = () => `
      <section class="field">
        <div class="field-label">Target</div>
        <div class="stepper">
          <button type="button" class="step-btn" data-action="target-step" data-dir="-1" aria-label="Lower target">−</button>
          <label class="stepper-value">
            <input type="number" id="chal-target" inputmode="decimal" min="0" step="any" value="${shownTarget()}" aria-label="Target">
            <span>${esc(unitText())}</span>
          </label>
          <button type="button" class="step-btn" data-action="target-step" data-dir="1" aria-label="Raise target">+</button>
        </div>
      </section>`;

  function draw() {
    let top;
    let tail;
    if (preset) {
      const r = resolveType(preset, store.types(), draft.typeId);
      const badge = BADGE_BY_ID.get(presetBadgeId(preset.id));
      top = `
        <div class="chal-intro c-${preset.color}">
          <span class="type-badge lg">${icon(preset.icon)}</span>
          <div class="chal-main">
            <b class="chal-name">${esc(presetName(preset, { type: r.type || r.create, start: windowOf().start }))}</b>
            <span class="muted small">${esc(preset.blurb)}</span>
            <span class="muted small chal-meta">${icon('calendar')} ${esc(whenText(preset, today, draft.when))}</span>
          </div>
        </div>
        ${preset.window === 'month' ? `
        <section class="field">
          <div class="field-label">Month</div>
          ${segmented('when', [['this', 'This month'], ['next', 'Next month']], draft.when, { ariaLabel: 'Month' })}
        </section>` : ''}`;
      tail = `
        <div class="chal-earn">
          ${badgeSVG(badge, { size: 44 })}
          <span class="small"><span class="muted">Earn:</span> <b>${esc(badge.name)}</b></span>
        </div>`;
    } else {
      const { start, end } = windowOf();
      const metrics = CHALLENGE_METRICS.filter((m) => m !== 'distance' || hasDistanceType());
      top = `
        <section class="field">
          <label class="field-label" for="chal-name">Name <span class="opt">optional</span></label>
          <input class="input" id="chal-name" maxlength="40" value="${esc(draft.name)}" placeholder="${esc(customFromDraft().name || 'Your challenge')}" enterkeyhint="done">
        </section>
        <section class="field">
          <div class="field-label">Track</div>
          ${segmented('metric', metrics.map((m) => [m, METRIC_NAMES[m]]), draft.metric, { ariaLabel: 'Track' })}
        </section>`;
      tail = `
        <section class="field">
          <div class="field-label">Length</div>
          ${segmented('length', LENGTHS.map((n) => [n, `${n} days`]), draft.days, { ariaLabel: 'Length' })}
        </section>
        <section class="field">
          <div class="field-label">Start</div>
          ${segmented('start', [[0, 'Today'], [1, 'Tomorrow']], draft.startIn, { ariaLabel: 'Start' })}
        </section>
        <p class="muted small">${esc(fmtShortDate(parseKey(start)))} – ${esc(fmtShortDate(parseKey(end)))}. Finishing counts toward Challenge Accepted.</p>`;
    }
    host.innerHTML = `${top}${typeField()}${stepperField()}${tail}`;
  }

  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const v = btn.dataset.value;
    switch (btn.dataset.action) {
      case 'type':
        draft.typeId = v || null;
        break;
      case 'when':
        draft.when = v;
        draft.target = fit(draft.target);
        break;
      case 'metric':
        if (draft.metric === v) return;
        draft.metric = v;
        if (v === 'distance' && draft.typeId && !store.typeById(draft.typeId).distance) draft.typeId = null;
        draft.target = fit(startTarget(v));
        break;
      case 'length':
        draft.days = Number(v);
        draft.target = fit(draft.target);
        break;
      case 'start':
        draft.startIn = Number(v);
        break;
      case 'target-step': {
        const step = STEP[draft.metric];
        const dir = Number(btn.dataset.dir);
        if (isDist()) {
          const next = Math.max(step, Math.round((kmToUnit(draft.target, units) + step * dir) / step) * step);
          draft.target = fit(unitToKm(next, units));
        } else {
          draft.target = fit(Math.max(GOAL_LIMITS[draft.metric].min, draft.target + step * dir));
        }
        haptic('tick');
        break;
      }
      default:
        return;
    }
    draw();
  });

  host.addEventListener('input', (e) => {
    if (e.target.id === 'chal-target') {
      const n = parseFloat(e.target.value);
      if (n > 0) draft.target = isDist() ? unitToKm(n, units) : n;
    } else if (e.target.id === 'chal-name') {
      draft.name = e.target.value;
    }
  });
  // Typed values update the form in place: rebuilding here would remove whatever she taps next.
  host.addEventListener('change', (e) => {
    if (e.target.id !== 'chal-target') return;
    draft.target = fit(draft.target);
    e.target.value = shownTarget();
    host.querySelector('.stepper-value span').textContent = unitText();
    const nameEl = host.querySelector('#chal-name');
    if (nameEl) nameEl.placeholder = customFromDraft().name || 'Your challenge';
  });

  sheet.el.querySelector('.sheet-foot').addEventListener('click', (e) => {
    if (!e.target.closest('[data-action="save"]') || finished) return;
    finished = true;
    let spec;
    if (preset) {
      const r = resolveType(preset, store.types(), draft.typeId);
      const type = r.create ? store.addType(r.create) : r.type;
      spec = presetSpec(preset, { today, type, when: draft.when, target: fit(draft.target) });
    } else {
      draft.name = (host.querySelector('#chal-name')?.value || '').trim();
      spec = customFromDraft();
    }
    const saved = store.addGoal(spec);
    toast(saved ? `Challenge on: ${saved.name || goalLabel(saved)}` : 'Could not start that challenge');
    sheet.close('saved');
    if (saved) onSaved?.(saved);
  });

  draw();
  return sheet;
}
