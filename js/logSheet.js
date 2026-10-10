// The slide-up workout details sheet, used for:
//   'fresh' – right after a hold-to-log (the workout is already saved; this adds details)
//   'new'   – adding a past workout from History
//   'edit'  – editing an existing workout

import { store } from './store.js';
import { photos, compressImage } from './photos.js';
import { openSheet, confirmDialog } from './sheet.js';
import { icon } from './icons.js';
import { esc, kmToUnit, unitToKm, clamp, plural } from './util.js';
import { todayKey, addDaysKey, timeNow } from './dates.js';
import { derive, milestones } from './progress.js';
import { goalLabel } from './components.js';
import { toast } from './toast.js';
import { celebrateLog, haptic, sound } from './effects.js';
import { collect, buildPlan, compliment } from './rewards.js';
import { celebrate, lastCelebrationEnd } from './celebrate.js';
import { BADGE_BY_ID, badgeColors } from './badges.js';
import { badgeSVG } from './badgeArt.js';
import { unlockInfo } from './looks.js';

const FEELS = [[1, 'Rough'], [2, 'Meh'], [3, 'Okay'], [4, 'Good'], [5, 'Amazing']];
const MOODS = ['😫', '😮‍💨', '😐', '🙂', '😄', '🤩', '💪', '🔥'];
const QUICK_MINUTES = [15, 20, 30, 45, 60, 90];
const INTENSITY_OPTS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];

/** Most recent duration logged for a type, or 30. */
function typicalDuration(typeId) {
  return store.workouts().find((w) => w.type === typeId && w.duration)?.duration ?? 30;
}

/** Sensible defaults for a new workout: last type used, its usual length. */
export function defaultWorkout(date = null) {
  const active = store.types();
  const lastType = store.workouts()[0]?.type;
  const type = active.find((t) => t.id === lastType)?.id ?? active[0]?.id ?? 'other';
  const d = date || todayKey();
  return {
    type,
    date: d,
    time: d === todayKey() ? timeNow() : '12:00',
    duration: typicalDuration(type),
    distanceKm: null,
    intensity: 'medium',
    feel: null,
    mood: null,
    note: '',
    photoId: null,
  };
}

/** "2 of 3 this week · 1 more makes it 5 weeks" style message after logging. */
function weekMessage(d) {
  const t = d.weekly.thisWeek;
  const n = d.weekly.current;
  if (t.count < t.target) return `${t.count} of ${t.target} this week · ${t.toGo} more ${n > 0 ? `makes it ${n + 1} weeks` : 'starts a streak'}`;
  if (t.count === t.target) return `Weekly goal hit! ${plural(n, 'week')} in a row 🎯`;
  return `${t.count} this week · above and beyond 🚀`;
}

/** Line 2 of the "logged!" banner: a near-miss badge hint or a personal compliment. */
function bannerHint(workout) {
  if (!workout) return '';
  const name = store.settings.name;
  const today = todayKey();
  const nice = compliment(store.state, workout, today, name);
  const hint = store.state.workouts.length > 1 ? store.rewards().nextUp[0] : null;
  if (hint) {
    const def = BADGE_BY_ID.get(hint.id);
    const art = def ? badgeSVG(def, { state: 'locked', size: 16, progress: hint.frac }) : icon('palette');
    return `<div class="lb-hint">${art}<span>${esc(hint.text)}</span></div>`;
  }
  return nice ? `<div class="lb-hint">${icon('sparkle')}<span>${esc(nice)}</span></div>` : '';
}

// ---- What a save earned (see milestones() in progress.js) ----

const RECORD_CHIPS = {
  longestWorkout: 'Longest workout ever', bestWeek: 'Best week ever', bestMonth: 'Best month ever',
  dailyStreak: 'Longest daily streak', weeklyStreak: 'Longest weekly streak',
};

/** Short chip text for the live "this save will…" preview in the sheet. */
function chipText(e) {
  switch (e.kind) {
    case 'pr': return [icon('trophy'), RECORD_CHIPS[e.record], 'yellow'];
    case 'goal': return [icon('goals'), goalLabel(e.goal), 'lime'];
    case 'freeze': return [icon('snowflake'), 'Earns a freeze', 'blue'];
    case 'allRings': return [icon('flame'), 'Closes all rings', 'pink'];
    case 'weekMet': return [icon('flame'), `Locks in week ${e.streak}`, 'pink'];
    case 'weekFilled': return [icon('flame'), 'Fills in a week', 'pink'];
    case 'ring': return [icon('flame'), e.ring === 'minutes' ? 'Closes minutes ring' : 'Closes active days ring', e.ring === 'minutes' ? 'purple' : 'cyan'];
    default: return null;
  }
}

// Ring / week-filled events have no ledger entry, so repeats are tracked for this session.
const sessionSeen = new Set();

let openCount = 0;
/** True while a log sheet is open (quiet reward passes wait until it closes). */
export const isLogSheetOpen = () => openCount > 0;

/** What a save would earn: rewards.collect() on the saved (or hypothetical) state. Nothing is written. */
function collectFor(state, b, a, events) {
  return collect(state, a, store.awards, {
    today: b.today, mode: 'live', events, now: new Date().toISOString(), label: goalLabel, seenKeys: sessionSeen,
  });
}

/** Delete with a 5-second Undo. The photo is only removed once Undo expires. */
export function deleteWithUndo(id) {
  const removed = store.deleteWorkout(id);
  if (!removed) return;
  sound.cancel();
  toast('Workout deleted', {
    duration: 5000,
    action: { label: 'Undo', fn: () => store.restoreWorkout(removed) },
    onExpire: () => { if (removed.photoId) photos.delete(removed.photoId).catch(() => {}); },
  });
}

/**
 * @param {object} o
 * @param {'fresh'|'new'|'edit'} o.mode
 * @param {object} [o.workout]  required for 'fresh' and 'edit'
 * @param {string} [o.date]     preset date for 'new'
 * @param {object} [o.before]   store.derived() from before a hold-to-log, so the save can tell what it earned
 */
export function openLogSheet({ mode = 'new', workout = null, date = null, before = null } = {}) {
  const s = store.settings;
  const units = s.units;
  const draft = workout ? { ...workout } : defaultWorkout(date);
  let durationTouched = mode === 'edit';
  let distanceTouched = false; // only re-read the distance box if she changed it, so stored km never drift
  const original = workout ? { ...workout } : null;
  let newPhoto = null; // compressed data URL picked in this session
  let removePhoto = false;
  let finished = false;

  // ---- Markup ----

  const typeGrid = store.types().map((t) => `
    <button type="button" class="type-chip c-${t.color}" role="radio" data-action="type" data-value="${esc(t.id)}">
      ${icon(t.icon)}<span>${esc(t.label)}</span>
    </button>`).join('');

  // Keep an archived type selectable when editing an old workout that uses it.
  const archived = store.typeById(draft.type);
  const archivedChip = archived.archived ? `
    <button type="button" class="type-chip c-${archived.color}" role="radio" data-action="type" data-value="${esc(archived.id)}">
      ${icon(archived.icon)}<span>${esc(archived.label)}</span>
    </button>` : '';

  const distanceValue = draft.distanceKm ? Math.round(kmToUnit(draft.distanceKm, units) * 100) / 100 : '';

  const body = `
    <form class="log-form" novalidate>
      <div class="wins-row" aria-live="polite" hidden></div>

      <section class="field">
        <div class="field-label">Workout type</div>
        <div class="type-grid" role="radiogroup" aria-label="Workout type">${typeGrid}${archivedChip}</div>
      </section>

      <section class="field">
        <div class="field-label">Duration</div>
        <div class="stepper">
          <button type="button" class="step-btn" data-action="dur-step" data-value="-5" aria-label="5 minutes less">−</button>
          <label class="stepper-value">
            <input type="number" name="duration" inputmode="numeric" min="0" max="600" value="${draft.duration ?? ''}" placeholder="0" aria-label="Minutes">
            <span>min</span>
          </label>
          <button type="button" class="step-btn" data-action="dur-step" data-value="5" aria-label="5 minutes more">+</button>
        </div>
        <div class="chip-row">${QUICK_MINUTES.map((m) => `<button type="button" class="chip" data-action="dur-chip" data-value="${m}">${m}</button>`).join('')}</div>
      </section>

      <section class="field" data-distance-field>
        <div class="field-label">Distance <span class="opt">optional</span></div>
        <label class="input-unit">
          <input type="number" name="distance" inputmode="decimal" min="0" step="0.01" value="${distanceValue}" placeholder="0.0" aria-label="Distance">
          <span>${units}</span>
        </label>
      </section>

      <section class="field">
        <div class="field-label">Intensity</div>
        <div class="segmented intensity" role="radiogroup" aria-label="Intensity">${INTENSITY_OPTS.map(([v, l]) => `
          <button type="button" role="radio" class="seg i-${v}" data-action="intensity" data-value="${v}">${l}</button>`).join('')}
        </div>
      </section>

      <section class="field">
        <div class="field-label">How did it feel?</div>
        <div class="feel-row" role="radiogroup" aria-label="How did it feel, 1 to 5">${FEELS.map(([v, l]) => `
          <button type="button" role="radio" class="feel-btn" data-action="feel" data-value="${v}"><b>${v}</b><span>${l}</span></button>`).join('')}
        </div>
        <div class="mood-row" role="radiogroup" aria-label="Mood">${MOODS.map((m) => `
          <button type="button" role="radio" class="mood-btn" data-action="mood" data-value="${m}">${m}</button>`).join('')}
        </div>
      </section>

      <section class="field">
        <div class="field-label">When</div>
        <div class="when-row">
          <button type="button" class="chip" data-action="when" data-value="today">Today</button>
          <button type="button" class="chip" data-action="when" data-value="yesterday">Yesterday</button>
          <input type="date" class="input input-date" name="date" value="${draft.date}" max="${todayKey()}" aria-label="Date">
        </div>
      </section>

      <section class="field">
        <div class="field-label">Note <span class="opt">optional</span></div>
        <textarea class="input" name="note" rows="2" maxlength="1000" placeholder="How was it? Anything to remember?">${esc(draft.note)}</textarea>
      </section>

      <section class="field">
        <div class="field-label">Photo <span class="opt">optional</span></div>
        <div class="photo-field">
          <label class="photo-add">
            <input type="file" accept="image/*" name="photo" hidden>
            ${icon('camera')}<span>Add photo</span>
          </label>
          <div class="photo-preview" hidden>
            <img alt="Workout photo">
            <button type="button" class="photo-remove" data-action="photo-remove" aria-label="Remove photo">${icon('close')}</button>
          </div>
        </div>
      </section>
    </form>`;

  const footers = {
    fresh: `
      <button type="button" class="btn btn-ghost" data-action="undo-log">Undo log</button>
      <button type="button" class="btn btn-primary" data-action="save">${icon('check')} <span>Done</span></button>`,
    new: `
      <button type="button" class="btn btn-ghost" data-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-action="save">${icon('plus')} <span>Log workout</span></button>`,
    edit: `
      <button type="button" class="btn btn-ghost btn-danger-text" data-action="delete">${icon('trash')} Delete</button>
      <button type="button" class="btn btn-primary" data-action="save">${icon('check')} <span>Save</span></button>`,
  };

  const count = store.state.workouts.length;
  const headHTML = mode === 'fresh' ? `
    <div class="logged-banner">
      <span class="lb-check">${icon('check')}</span>
      <div>
        <div class="lb-title">Workout #${count} logged!</div>
        <div class="lb-sub">${esc(weekMessage(store.derived()))}</div>
        ${bannerHint(workout)}
      </div>
    </div>` : '';

  const titles = { fresh: 'Add details', new: 'Log a workout', edit: 'Edit workout' };

  const sheet = openSheet({
    title: titles[mode],
    headHTML,
    body,
    footer: footers[mode],
    className: `log-sheet mode-${mode}`,
    // A just-logged workout keeps whatever was entered even if the sheet is swiped away.
    onClose: (reason) => {
      openCount = Math.max(0, openCount - 1);
      if (mode === 'fresh' && reason === 'dismiss' && !finished) save({ quiet: true });
    },
  });
  openCount++;

  const form = sheet.el.querySelector('.log-form');
  const durInput = form.elements.duration;
  const distInput = form.elements.distance;
  const dateInput = form.elements.date;
  const noteInput = form.elements.note;
  const photoInput = form.elements.photo;
  const preview = form.querySelector('.photo-preview');
  const addPhotoBtn = form.querySelector('.photo-add');
  const winsRow = form.querySelector('.wins-row');

  // ---- Reflect the draft in the UI ----

  function sync() {
    const mark = (selector, isOn) => form.querySelectorAll(selector).forEach((b) => {
      const on = isOn(b.dataset.value);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    mark('[data-action="type"]', (v) => v === draft.type);
    mark('[data-action="intensity"]', (v) => v === draft.intensity);
    mark('[data-action="feel"]', (v) => Number(v) === draft.feel);
    mark('[data-action="mood"]', (v) => v === draft.mood);
    mark('[data-action="dur-chip"]', (v) => Number(v) === draft.duration);
    mark('[data-action="when"]', (v) =>
      (v === 'today' && draft.date === todayKey()) || (v === 'yesterday' && draft.date === addDaysKey(todayKey(), -1)));
    form.querySelector('[data-distance-field]').hidden = !store.typeById(draft.type).distance;
    if (document.activeElement !== durInput) durInput.value = draft.duration ?? '';
    if (document.activeElement !== dateInput) dateInput.value = draft.date;
    scheduleWins();
  }

  // ---- Live "this save will…" chips (PR, goal done, freeze earned, ring closed) ----

  let winsTimer = 0;
  function scheduleWins() {
    clearTimeout(winsTimer);
    winsTimer = setTimeout(renderWins, 150);
  }

  function renderWins() {
    if (finished) return;
    const base = before ?? store.derived();
    const st = store.state;
    const w = {
      ...draft,
      distanceKm: currentDistanceKm(),
      id: draft.id || '__draft__',
      time: draft.time || timeNow(),
      createdAt: draft.createdAt || new Date().toISOString(),
    };
    const workouts = mode === 'new' ? [...st.workouts, w] : st.workouts.map((x) => (x.id === w.id ? { ...x, ...w } : x));
    const hypo = { ...st, workouts };
    const a = derive(hypo, base.today);
    const events = milestones(base, a);
    const res = collectFor(hypo, base, a, events);
    const fresh = res.fresh;
    const chips = [
      ...fresh.slice(0, 2).map(chipText).filter(Boolean).map(([ic, text, color]) => ({ key: text, html: ic, text, color })),
      ...Object.keys(res.badges).map((id) => BADGE_BY_ID.get(id)).filter(Boolean).map((def) => ({
        key: `b:${def.id}`, html: badgeSVG(def, { size: 18, className: 'no-glow' }), text: `Earns ${def.name}`, color: badgeColors(def)[0],
      })),
      ...res.newUnlocks.map((u) => ({ key: `u:${u}`, html: icon('palette'), text: `Unlocks ${unlockInfo(u).name}`, color: 'purple' })),
      ...fresh.slice(2).map(chipText).filter(Boolean).map(([ic, text, color]) => ({ key: text, html: ic, text, color })),
    ].slice(0, 3);
    winsRow.hidden = !chips.length;
    winsRow.innerHTML = chips.map((c) => `<span class="win-chip c-${c.color}${shownChips.has(c.key) ? ' seen' : ''}">${c.html}<span>${esc(c.text)}</span></span>`).join('');
    chips.forEach((c) => shownChips.add(c.key));
    // A save that earns something big gets a gold "Claim" button.
    const plan = buildPlan(res, { lastEndAt: 0, now: 0 });
    setClaim(plan.level >= 2 || !!plan.reveal || !!plan.alsoEarned);
  }

  const shownChips = new Set();
  const saveBtn = sheet.el.querySelector('[data-action="save"]');
  const saveLabel = saveBtn.querySelector('span').textContent;
  function setClaim(on) {
    if (saveBtn.classList.contains('btn-claim') === on) return;
    saveBtn.classList.toggle('btn-claim', on);
    saveBtn.classList.toggle('btn-primary', !on);
    saveBtn.querySelector('.icon').outerHTML = icon(on ? 'sparkle' : mode === 'new' ? 'plus' : 'check');
    saveBtn.querySelector('span').textContent = on ? (mode === 'new' ? 'Log & claim' : 'Claim') : saveLabel;
  }

  function currentDistanceKm() {
    if (!store.typeById(draft.type).distance) return null;
    if (!distanceTouched) return draft.distanceKm ?? null;
    const dist = parseFloat(distInput.value);
    return dist > 0 ? unitToKm(dist, units) : null;
  }

  async function showPhoto(url) {
    preview.querySelector('img').src = url || '';
    preview.hidden = !url;
    addPhotoBtn.hidden = !!url;
  }

  sync();
  if (draft.photoId) photos.get(draft.photoId).then(showPhoto).catch(() => {});

  // ---- Interactions ----

  sheet.el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const v = btn.dataset.value;
    switch (btn.dataset.action) {
      case 'type':
        draft.type = v;
        if (!durationTouched) draft.duration = typicalDuration(v);
        haptic('tick');
        break;
      case 'intensity':
        draft.intensity = draft.intensity === v ? null : v;
        haptic('tick');
        break;
      case 'feel':
        draft.feel = draft.feel === Number(v) ? null : Number(v);
        haptic('tick');
        break;
      case 'mood':
        draft.mood = draft.mood === v ? null : v;
        haptic('tick');
        break;
      case 'dur-step':
        draft.duration = clamp((draft.duration || 0) + Number(v), 0, 600);
        durationTouched = true;
        durInput.value = draft.duration;
        break;
      case 'dur-chip':
        draft.duration = Number(v);
        durationTouched = true;
        durInput.value = draft.duration;
        haptic('tick');
        break;
      case 'when':
        draft.date = v === 'today' ? todayKey() : addDaysKey(todayKey(), -1);
        dateInput.value = draft.date;
        break;
      case 'photo-remove':
        newPhoto = null;
        removePhoto = true;
        photoInput.value = '';
        showPhoto(null);
        break;
      case 'save':
        save();
        return;
      case 'undo-log':
        finished = true;
        sheet.close('undo');
        store.deleteWorkout(draft.id);
        sound.cancel();
        toast('Log removed');
        return;
      case 'delete':
        confirmDelete();
        return;
      default:
        return;
    }
    sync();
  });

  durInput.addEventListener('input', () => {
    const n = parseInt(durInput.value, 10);
    draft.duration = Number.isFinite(n) ? clamp(n, 0, 600) : null;
    durationTouched = true;
    sync();
  });

  distInput.addEventListener('input', () => {
    distanceTouched = true;
    scheduleWins();
  });

  dateInput.addEventListener('change', () => {
    const v = dateInput.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) draft.date = v > todayKey() ? todayKey() : v;
    sync();
  });

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    addPhotoBtn.classList.add('busy');
    try {
      newPhoto = await compressImage(file);
      removePhoto = false;
      showPhoto(newPhoto);
    } catch (err) {
      toast(err.message || 'Could not use that photo');
    } finally {
      addPhotoBtn.classList.remove('busy');
    }
  });

  // Enter in a field shouldn't submit/reload anything.
  form.addEventListener('submit', (e) => e.preventDefault());

  // ---- Save / delete ----

  function readFields() {
    draft.distanceKm = currentDistanceKm();
    draft.note = noteInput.value.trim();
  }

  async function save({ quiet = false } = {}) {
    if (finished) return;
    finished = true;
    clearTimeout(winsTimer);
    readFields();
    // Snapshot before the change (a hold-to-log passes the one from before its add).
    const b = before ?? store.derived();

    let oldPhoto = null;
    let awaited = false; // a photo save breaks the tap gesture (iOS haptics)
    try {
      if (newPhoto) {
        awaited = true;
        const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        await photos.put(id, newPhoto);
        oldPhoto = draft.photoId;
        draft.photoId = id;
      } else if (removePhoto && draft.photoId) {
        oldPhoto = draft.photoId;
        draft.photoId = null;
      }
    } catch {
      toast("Photo couldn't be saved on this device");
    }

    const { id, createdAt, updatedAt, ...fields } = draft;
    if (mode === 'new') store.addWorkout(fields);
    else store.updateWorkout(id, fields);
    if (oldPhoto) photos.delete(oldPhoto).catch(() => {});
    sheet.close('saved');

    // What did this save earn? Compare with the same "today" so midnight can't fake an event.
    const a = store.derivedAt(b.today);
    const events = milestones(b, a);
    const res = collectFor(store.state, b, a, events);
    store.grant(res);
    events.forEach((e) => sessionSeen.add(e.key));
    const plan = buildPlan(res, { lastEndAt: lastCelebrationEnd(), now: Date.now(), label: goalLabel });
    const inGesture = !awaited;
    if (mode === 'new') {
      const burst = plan.level < 2 && !plan.reveal;
      if (burst) celebrateLog({ x: innerWidth / 2, y: innerHeight * 0.8 });
      celebrate(plan, { fallback: weekMessage(a), inGesture, skipConfetti: burst });
    } else if (mode === 'fresh') {
      celebrate(plan, { inGesture }); // the hold already celebrated; only speak up if something happened
    } else if (!res.fresh.length && !plan.reveal && a.weekly.current < b.weekly.current) {
      // An edit moved a workout out of a met week: say so, and offer to put it back.
      toast(`Saved · weekly streak is now ${plural(a.weekly.current, 'week')}`, {
        duration: 5000,
        action: {
          label: 'Undo',
          fn: () => store.updateWorkout(id, {
            date: original.date, type: original.type, duration: original.duration, distanceKm: original.distanceKm,
          }),
        },
      });
    } else {
      celebrate(plan, { fallback: quiet ? null : 'Saved', inGesture });
    }
  }

  async function confirmDelete() {
    const ok = await confirmDialog({
      title: 'Delete this workout?',
      message: 'You can undo right after.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    finished = true;
    sheet.close('deleted');
    deleteWithUndo(draft.id);
  }

  return sheet;
}
