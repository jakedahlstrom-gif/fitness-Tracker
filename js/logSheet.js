// The slide-up workout details sheet, used for:
//   'fresh' – right after a hold-to-log (the workout is already saved; this adds details)
//   'new'   – adding a past workout from History
//   'edit'  – editing an existing workout

import { store } from './store.js';
import { photos, compressImage } from './photos.js';
import { openSheet, confirmDialog } from './sheet.js';
import { icon } from './icons.js';
import { esc, kmToUnit, unitToKm, clamp } from './util.js';
import { todayKey, addDaysKey, timeNow, startOfWeek } from './dates.js';
import { weekStats } from './stats.js';
import { toast } from './toast.js';
import { celebrateLog, haptic, sound } from './effects.js';

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

/** "2 of 3 this week — 1 to go" style message after logging. */
function weekMessage() {
  const s = store.settings;
  const { count } = weekStats(store.workouts(), startOfWeek(new Date(), s.weekStart));
  const target = s.targets.workouts;
  if (count === target) return `Weekly goal hit: ${count} of ${target}! 🎯`;
  if (count < target) return `${count} of ${target} this week · ${target - count} to go`;
  return `${count} this week · above and beyond 🚀`;
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
 */
export function openLogSheet({ mode = 'new', workout = null, date = null } = {}) {
  const s = store.settings;
  const units = s.units;
  const draft = workout ? { ...workout } : defaultWorkout(date);
  let durationTouched = mode === 'edit';
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
      <button type="button" class="btn btn-primary" data-action="save">${icon('check')} Done</button>`,
    new: `
      <button type="button" class="btn btn-ghost" data-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-action="save">${icon('plus')} Log workout</button>`,
    edit: `
      <button type="button" class="btn btn-ghost btn-danger-text" data-action="delete">${icon('trash')} Delete</button>
      <button type="button" class="btn btn-primary" data-action="save">${icon('check')} Save</button>`,
  };

  const count = store.state.workouts.length;
  const headHTML = mode === 'fresh' ? `
    <div class="logged-banner">
      <span class="lb-check">${icon('check')}</span>
      <div>
        <div class="lb-title">Workout #${count} logged!</div>
        <div class="lb-sub">${esc(weekMessage())}</div>
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
    onClose: (reason) => { if (mode === 'fresh' && reason === 'dismiss' && !finished) save({ quiet: true }); },
  });

  const form = sheet.el.querySelector('.log-form');
  const durInput = form.elements.duration;
  const distInput = form.elements.distance;
  const dateInput = form.elements.date;
  const noteInput = form.elements.note;
  const photoInput = form.elements.photo;
  const preview = form.querySelector('.photo-preview');
  const addPhotoBtn = form.querySelector('.photo-add');

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
    const dist = parseFloat(distInput.value);
    draft.distanceKm = store.typeById(draft.type).distance && dist > 0 ? unitToKm(dist, units) : null;
    draft.note = noteInput.value.trim();
  }

  async function save({ quiet = false } = {}) {
    if (finished) return;
    finished = true;
    readFields();

    let oldPhoto = null;
    try {
      if (newPhoto) {
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
    if (mode === 'new') {
      store.addWorkout(fields);
      celebrateLog({ x: innerWidth / 2, y: innerHeight * 0.8 });
      toast(weekMessage());
    } else {
      store.updateWorkout(id, fields);
      if (!quiet && mode === 'edit') toast('Saved');
    }
    if (oldPhoto) photos.delete(oldPhoto).catch(() => {});
    sheet.close('saved');
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
