// Goals. Stage 1: the weekly ring targets. Tiered goals, streak freezes and
// personal records arrive in Stage 2.

import { store } from '../store.js';
import { icon } from '../icons.js';
import { startOfWeek } from '../dates.js';
import { weekStats } from '../stats.js';
import { clamp, fmtNum } from '../util.js';
import { haptic } from '../effects.js';

const TARGETS = [
  { key: 'workouts', label: 'Workouts per week', color: 'pink', step: 1, min: 1, max: 21, unit: '' },
  { key: 'minutes', label: 'Minutes per week', color: 'purple', step: 10, min: 10, max: 2000, unit: 'min' },
  { key: 'days', label: 'Active days per week', color: 'cyan', step: 1, min: 1, max: 7, unit: '' },
];

export function renderGoals(el) {
  const s = store.settings;
  const week = weekStats(store.workouts(), startOfWeek(new Date(), s.weekStart));
  const current = { workouts: week.count, minutes: week.minutes, days: week.activeDays };

  el.innerHTML = `
    <header class="top">
      <div class="brand">GLOW<i>//</i>FIT</div>
      <h1>Goals</h1>
      <p class="subtle">Set the targets that close your rings each week.</p>
    </header>

    <article class="card">
      <div class="card-head"><span class="label">Weekly targets</span></div>
      <div class="target-list">
        ${TARGETS.map((t) => {
          const v = s.targets[t.key];
          const pct = Math.min(100, Math.round((current[t.key] / v) * 100));
          return `
          <div class="target-row">
            <div class="target-info">
              <span class="target-name"><i class="dot c-${t.color}"></i>${t.label}</span>
              <span class="muted">This week: ${fmtNum(current[t.key])}${t.unit ? ` ${t.unit}` : ''}</span>
              <span class="bar c-${t.color}"><i style="width:${pct}%"></i></span>
            </div>
            <div class="stepper small">
              <button type="button" class="step-btn" data-action="step" data-key="${t.key}" data-dir="-1" aria-label="Lower ${t.label}">−</button>
              <span class="stepper-num">${fmtNum(v)}</span>
              <button type="button" class="step-btn" data-action="step" data-key="${t.key}" data-dir="1" aria-label="Raise ${t.label}">+</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </article>

    <article class="card soon">
      <div class="card-head"><span class="label">Coming next</span></div>
      <ul class="soon-list">
        <li>${icon('goals')} Short, medium & long-term goals with progress bars</li>
        <li>${icon('flame')} Weekly streaks, rest days and streak freezes</li>
        <li>${icon('trophy')} Personal records, flagged the moment you set them</li>
      </ul>
    </article>
  `;

  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="step"]');
      if (!btn) return;
      const t = TARGETS.find((x) => x.key === btn.dataset.key);
      const next = clamp(store.settings.targets[t.key] + t.step * Number(btn.dataset.dir), t.min, t.max);
      haptic('tick');
      store.setTarget(t.key, next);
    });
  }
}
