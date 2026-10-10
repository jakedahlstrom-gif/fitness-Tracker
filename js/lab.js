// Celebration lab: try every celebration and share card with sample data.
// Opened by tapping the version line on Profile five times. Nothing here is saved.

import { openSheet } from './sheet.js';
import { buildPlan } from './rewards.js';
import { celebrate, playIntro, openShare } from './celebrate.js';
import { unlockAudio } from './effects.js';
import { todayKey } from './dates.js';

const today = () => todayKey();
let n = 0;
const key = (k) => `${k}:lab${++n}`;

const SAMPLE_GOALS = {
  short: { id: 'lab-short', tier: 'short', metric: 'workouts', target: 3, name: '' },
  medium: { id: 'lab-medium', tier: 'medium', metric: 'minutes', target: 600, name: '' },
  long: { id: 'lab-long', tier: 'long', metric: 'workouts', target: 150, start: `${today().slice(0, 4)}-01-01`, end: `${today().slice(0, 4)}-12-31`, name: '' },
};

const EV = {
  ring: () => ({ kind: 'ring', ring: 'minutes', key: key('ring') }),
  weekFilled: () => ({ kind: 'weekFilled', streak: 3, key: key('fill') }),
  weekMet: () => ({ kind: 'weekMet', streak: 5, key: key('week') }),
  allRings: () => ({ kind: 'allRings', key: key('rings') }),
  short: () => ({ kind: 'goal', tier: 'short', goal: SAMPLE_GOALS.short, goalId: 'lab-short', key: key('goal:lab-short:W') }),
  medium: () => ({ kind: 'goal', tier: 'medium', goal: SAMPLE_GOALS.medium, goalId: 'lab-medium', key: `goal:lab-medium:M:${today().slice(0, 7)}:${++n}` }),
  pr: () => ({ kind: 'pr', record: 'longestWorkout', value: 95, prev: 80, key: key('pr:longestWorkout') }),
  freeze: () => ({ kind: 'freeze', freezes: 1, key: key('freeze') }),
  long: () => ({
    kind: 'goal', tier: 'long', goal: SAMPLE_GOALS.long, goalId: 'lab-long', key: key('goal:lab-long:L'),
    stats: [
      { value: 150, unit: 'workouts', label: 'LOGGED', color: 'pink' },
      { value: 112, unit: '', label: 'HOURS', color: 'purple' },
      { value: 283, unit: '', label: 'DAYS', color: 'cyan' },
    ],
  }),
};

function plan(events, { badges = [], unlocks = [] } = {}) {
  return buildPlan({ fresh: events, badges: Object.fromEntries(badges.map((id) => [id, {}])), newUnlocks: unlocks, repeats: [] }, { lastEndAt: 0, now: Date.now() });
}

const ITEMS = [
  ['Small wins', [
    ['Ring closed', () => plan([EV.ring()])],
    ['Week filled in', () => plan([EV.weekFilled()])],
    ['Week locked in', () => plan([EV.weekMet()])],
    ['All rings', () => plan([EV.allRings()])],
    ['Weekly goal', () => plan([EV.short(), EV.weekMet()])],
  ]],
  ['Big wins', [
    ['Monthly goal', () => plan([EV.medium(), EV.allRings()])],
    ['New PR', () => plan([EV.pr()])],
    ['Freeze banked', () => plan([EV.freeze()])],
    ['Monthly + badges', () => plan([EV.medium(), EV.allRings()], { badges: ['w100', 'm600'], unlocks: ['skin:lava'] })],
  ]],
  ['Finale', [
    ['Long-term goal', () => plan([EV.long(), EV.weekMet()], { badges: ['g1', 'w50'], unlocks: ['palette:gold', 'skin:holo'] })],
    ['Triple win', () => plan([EV.medium(), EV.pr(), EV.freeze()])],
  ]],
  ['Reveals', [
    ['Common badge', () => plan([], { badges: ['w5'] })],
    ['Rare badge', () => plan([], { badges: ['w25'] })],
    ['Epic badge', () => plan([], { badges: ['w100', 'ws4', 'w10'] })],
    ['Legendary badge', () => plan([], { badges: ['w250'] })],
    ['New theme', () => plan([], { unlocks: ['palette:sunset'] })],
    ['New button', () => plan([], { unlocks: ['skin:heartbeat'] })],
    ['Welcome (1st log)', () => plan([EV.weekFilled()], { badges: ['w1'] })],
  ]],
];

const SHARES = [
  ['Weekly goal card', () => ({ kind: 'goal', snapshot: { kind: 'goal', tier: 'short', on: today(), goalId: 'lab-short', label: '3 workouts this week', metric: 'workouts', target: 3, value: 4 } })],
  ['Monthly goal card', () => ({ kind: 'goal', snapshot: { kind: 'goal', tier: 'medium', on: today(), goalId: 'lab-medium', label: '600 min this month', metric: 'minutes', target: 600, value: 612 } })],
  ['Long-term card', () => ({ kind: 'goal', snapshot: { kind: 'goal', tier: 'long', on: today(), goalId: 'lab-long', label: `150 workouts in ${today().slice(0, 4)}`, metric: 'workouts', target: 150, value: 150 } })],
  ['Badge card', () => ({ kind: 'badge', id: 'w100', snapshot: { on: today() } })],
  ['PR card', () => ({ kind: 'pr', snapshot: { kind: 'pr', on: today(), record: 'longestWorkout', value: 95, prev: 80 } })],
];

export function openLab() {
  const sheet = openSheet({
    title: 'Celebration lab',
    className: 'lab-sheet',
    body: `
      <p class="muted small">Try every celebration with sample data. Nothing here is saved.</p>
      ${ITEMS.map(([title, list], g) => `
        <div class="field-label lab-head">${title}</div>
        <div class="lab-grid">${list.map(([label], i) => `<button type="button" class="btn btn-secondary btn-small" data-play="${g}:${i}">${label}</button>`).join('')}</div>`).join('')}
      <div class="field-label lab-head">Intro</div>
      <div class="lab-grid"><button type="button" class="btn btn-secondary btn-small" data-intro>Trophy Case intro</button></div>
      <div class="field-label lab-head">Share cards</div>
      <div class="lab-grid">${SHARES.map(([label], i) => `<button type="button" class="btn btn-secondary btn-small" data-share="${i}">${label}</button>`).join('')}</div>`,
  });
  sheet.body.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    unlockAudio();
    if (b.dataset.play) {
      const [g, i] = b.dataset.play.split(':').map(Number);
      sheet.close('lab');
      setTimeout(() => celebrate(ITEMS[g][1][i][1](), { inGesture: false, lab: true }), 350);
    } else if (b.hasAttribute('data-intro')) {
      sheet.close('lab');
      setTimeout(() => playIntro({ sample: { badges: ['w1', 'w5', 'w10', 'w25', 'ws2', 'ws4', 'f1', 'm600', 'pr1', 'g1', 'w50', 'weekend'], unlocks: ['skin:heartbeat', 'palette:sunset'] } }), 350);
    } else if (b.dataset.share) {
      openShare(SHARES[Number(b.dataset.share)][1]());
    }
  });
}
