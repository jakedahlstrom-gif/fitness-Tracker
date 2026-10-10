// History: every workout grouped by day, filterable by type. Tap to edit.

import { store } from '../store.js';
import { photos } from '../photos.js';
import { icon } from '../icons.js';
import { esc, plural, fmtDistance, fmtMinutes } from '../util.js';
import { fmtDayLabel, fmtTime } from '../dates.js';
import { totals } from '../stats.js';
import { typeBadge } from '../components.js';
import { openLogSheet } from '../logSheet.js';
import { openSheet } from '../sheet.js';

let filter = 'all';

const INTENSITY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const FEEL_LABEL = ['', 'Rough', 'Meh', 'Okay', 'Good', 'Amazing'];

export function renderHistory(el, params = {}) {
  const s = store.settings;
  const all = store.workouts();
  if (filter !== 'all' && !all.some((w) => w.type === filter)) filter = 'all';
  if (params.day) filter = 'all';
  const list = filter === 'all' ? all : all.filter((w) => w.type === filter);
  const sum = totals(all);

  // Filter chips: only types that actually appear in history.
  const usedTypes = [...new Set(all.map((w) => w.type))].map((id) => store.typeById(id));
  const chips = usedTypes.length > 1 ? `
    <div class="filter-row" role="tablist" aria-label="Filter by type">
      <button type="button" class="chip${filter === 'all' ? ' on' : ''}" data-action="filter" data-value="all">All</button>
      ${usedTypes.map((t) => `
        <button type="button" class="chip c-${t.color}${filter === t.id ? ' on' : ''}" data-action="filter" data-value="${esc(t.id)}">
          ${icon(t.icon)} ${esc(t.label)}
        </button>`).join('')}
    </div>` : '';

  // Group by day, keeping newest-first order.
  const groups = [];
  for (const w of list) {
    const g = groups[groups.length - 1];
    if (g && g.date === w.date) g.items.push(w);
    else groups.push({ date: w.date, items: [w] });
  }

  const listHTML = groups.map((g) => {
    const mins = g.items.reduce((a, w) => a + (w.duration || 0), 0);
    return `
      <section class="day-group" id="day-${g.date}">
        <h3 class="day-head"><span>${esc(fmtDayLabel(g.date))}</span><span class="muted">${mins ? fmtMinutes(mins) : ''}</span></h3>
        <ul class="wk-list">${g.items.map((w) => rowHTML(w, s.units)).join('')}</ul>
      </section>`;
  }).join('');

  const empty = `
    <div class="empty card">
      <div class="empty-art">${icon('sparkle')}</div>
      <h3>No workouts yet</h3>
      <p class="muted">Press and hold the pink button below to log your first one.</p>
    </div>`;

  el.innerHTML = `
    <header class="top">
      <div class="brand">GLOW<i>//</i>FIT</div>
      <div class="top-row">
        <h1>History</h1>
        <button type="button" class="btn btn-small btn-secondary" data-action="add-past">${icon('plus')} Add past</button>
      </div>
      <p class="subtle">${plural(sum.count, 'workout')} · ${fmtMinutes(sum.minutes)} total</p>
    </header>
    ${chips}
    ${groups.length ? listHTML : empty}
  `;

  loadThumbs(el);
  if (!el.dataset.bound) bindHistory(el);

  if (params.day) {
    const target = el.querySelector(`#day-${CSS.escape(params.day)}`);
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        target.classList.add('flash');
        setTimeout(() => target.classList.remove('flash'), 1600);
      });
    }
  }
}

function rowHTML(w, units) {
  const t = store.typeById(w.type);
  const meta = [
    w.duration ? `${w.duration} min` : '',
    w.distanceKm ? fmtDistance(w.distanceKm, units) : '',
    w.time ? fmtTime(w.time) : '',
  ].filter(Boolean).join(' · ');
  const tags = [
    w.intensity ? `<span class="pill i-${w.intensity}">${INTENSITY_LABEL[w.intensity]}</span>` : '',
    w.feel ? `<span class="pill">Felt ${FEEL_LABEL[w.feel].toLowerCase()} · ${w.feel}/5</span>` : '',
  ].filter(Boolean).join('');
  return `
    <li>
      <div class="wk-row" role="button" tabindex="0" data-action="edit" data-id="${esc(w.id)}" aria-label="Edit ${esc(t.label)} workout">
        ${typeBadge(w.type)}
        <span class="wk-main">
          <span class="wk-title">${esc(t.label)}${w.mood ? ` <span class="wk-mood">${esc(w.mood)}</span>` : ''}</span>
          <span class="wk-meta">${esc(meta)}</span>
          ${tags ? `<span class="wk-tags">${tags}</span>` : ''}
          ${w.note ? `<span class="wk-note">${esc(w.note)}</span>` : ''}
        </span>
        ${w.photoId ? `<button type="button" class="wk-thumb" data-action="photo" data-photo="${esc(w.photoId)}" aria-label="View photo"><img alt=""></button>` : ''}
        <span class="wk-chev">${icon('chevronRight')}</span>
      </div>
    </li>`;
}

/** Fill in photo thumbnails from IndexedDB after the list renders. */
function loadThumbs(el) {
  el.querySelectorAll('.wk-thumb[data-photo]').forEach(async (btn) => {
    try {
      const url = await photos.get(btn.dataset.photo);
      if (url) btn.querySelector('img').src = url;
      else btn.remove();
    } catch {
      btn.remove();
    }
  });
}

function showPhoto(url) {
  const sheet = openSheet({
    title: 'Photo',
    body: `<img class="photo-full" src="${esc(url)}" alt="Workout photo">`,
    className: 'photo-sheet',
  });
  sheet.el.querySelector('.photo-full').addEventListener('click', () => sheet.close());
}

function bindHistory(el) {
  el.dataset.bound = '1';
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'filter':
        filter = btn.dataset.value;
        renderHistory(el);
        break;
      case 'photo': {
        e.stopPropagation();
        const url = await photos.get(btn.dataset.photo).catch(() => null);
        if (url) showPhoto(url);
        break;
      }
      case 'edit': {
        const w = store.getWorkout(btn.dataset.id);
        if (w) openLogSheet({ mode: 'edit', workout: w });
        break;
      }
      case 'add-past':
        openLogSheet({ mode: 'new' });
        break;
      default:
    }
  });
  // Keyboard access for the rows (they're divs so the photo button can sit inside).
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.wk-row')) {
      e.preventDefault();
      e.target.click();
    }
  });
}
