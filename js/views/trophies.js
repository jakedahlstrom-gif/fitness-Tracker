// Trophy Case: the badge shelf (a tall sheet opened from Profile), the badge
// detail dialog with its tilting art, and the Profile summary card.

import { store } from '../store.js';
import { BADGES, BADGE_BY_ID, FAMILIES, RARITIES, RARITY_LABEL, badgeColors } from '../badges.js';
import { badgeSVG, FRAME_PATHS } from '../badgeArt.js';
import { LADDERS } from '../looks.js';
import { openSheet } from '../sheet.js';
import { icon } from '../icons.js';
import { esc, fmtNum, kmToUnit, clamp, prefersReducedMotion } from '../util.js';
import { parseKey, fmtShortDate } from '../dates.js';
import { haptic, sound } from '../effects.js';
import { toast } from '../toast.js';

const FILTERS = [['all', 'All'], ['earned', 'Earned'], ['locked', 'Locked']];
const RARITY_RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i]));

let lastFilter = 'all'; // remembered for the session
let openCase = null; // the open Trophy Case, so a second open just focuses it
let detailOpen = null; // the open badge detail (one at a time)

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

const who = () => String(store.settings.name || '').trim() || 'friend';
const flavorOf = (def) => String(def.flavor || '').replace(/\{name\}/g, who());
const colorVars = (def) => {
  const [c1, c2] = badgeColors(def);
  return `--b1:var(--${c1});--b2:var(--${c2})`;
};

/** Distance plates follow her unit (the 100-mile badge reads "161km" in km). */
function artDef(def) {
  if (def.id === 'd100mi' && store.settings.units === 'km') return { ...def, plate: '161km' };
  return def;
}

/** Badges on the shelf: hidden families and retired, still-locked badges are left out. */
function shelfBadges(rw) {
  return BADGES.filter((def) => {
    const p = rw.progress.get(def.id);
    return p && !p.hidden && !(def.retired && !p.earned);
  });
}

function viewOf(def, rw) {
  const p = rw.progress.get(def.id);
  const earned = !!p.earned;
  const frac = earned ? 1 : p.target ? clamp(p.value / p.target, 0, 1) : 0;
  return { def, p, earned, masked: !!def.secret && !earned, isNew: earned && p.seen === false, frac };
}

/** "workouts" → "workout" when the target is 1 ("rest days" → "rest day", "PRs" → "PR"). */
function unitWord(def, n) {
  const u = def.measure.unit;
  const word = u === 'wins' && def.winTier ? `${LADDERS[def.winTier].what}s` : u;
  return n === 1 ? word.replace(/s$/, '') : word;
}

/**
 * A locked badge's numbers as display strings in her units:
 * { have, need, unit, left } e.g. { have: '72', need: '100', unit: 'workouts', left: '28' }.
 */
function amounts(def, p) {
  const m = def.measure;
  const units = store.settings.units;
  if (m.unit === 'km') {
    const show = (km) => { const v = kmToUnit(km, units); return String(v >= 100 ? Math.round(v) : Math.round(v * 10) / 10); };
    const left = Math.max(0.1, Math.ceil(kmToUnit(p.target - p.value, units) * 10) / 10);
    return { have: show(p.value), need: show(p.target), unit: units, left: `${left} ${units}` };
  }
  if (m.unit === 'min' && m.kind === 'cum') {
    return { have: fmtNum(Math.floor(p.value / 60)), need: fmtNum(p.target / 60), unit: 'hours', left: `${fmtNum(Math.ceil((p.target - p.value) / 60))}h` };
  }
  if (m.unit === 'min') {
    return { have: fmtNum(p.value), need: fmtNum(p.target), unit: 'min', left: `${fmtNum(Math.ceil(p.target - p.value))} min` };
  }
  return { have: fmtNum(p.value), need: fmtNum(p.target), unit: unitWord(def, p.target), left: fmtNum(Math.ceil(p.target - p.value)) };
}

/** Grid sub-line: "Oct 3", "7 / 10", "7 / 10h", "2.1 / 3.1 mi" or "???". */
function subFor(v) {
  const { def, p } = v;
  if (v.earned) return fmtShortDate(parseKey(p.earnedOn));
  if (v.masked) return '???';
  if (def.measure.kind === 'allTypes' && p.tooFew) return 'Add a type';
  const a = amounts(def, p);
  const suffix = a.unit === 'hours' ? 'h' : a.unit === 'min' ? ' min' : a.unit === 'mi' || a.unit === 'km' ? ` ${a.unit}` : '';
  return `${a.have} / ${a.need}${suffix}`;
}

/** "72 of 100 workouts", "2 of 4 weeks in a row", "45 of 60 min in one go". */
function progressPhrase(def, p) {
  const a = amounts(def, p);
  const tail = def.measure.kind === 'run' || def.measure.kind === 'gm3' ? ' in a row' : def.measure.kind === 'max' ? ' in one go' : '';
  return `${a.have} of ${a.need} ${a.unit}${tail}`;
}

const longDate = (key) => parseKey(key).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

/** "Century Club, earned October 10, 2026" / "Locked: Century Club, 72 of 100 workouts". */
function ariaFor(v) {
  const { def, p } = v;
  if (v.earned) return `${def.name}, earned ${longDate(p.earnedOn)}${v.isNew ? ', new' : ''}`;
  if (v.masked) return `Secret badge, locked. Hint: ${def.hint || ''}`;
  if (def.measure.kind === 'allTypes' && p.tooFew) return `Locked: ${def.name}. Add a type to go for it`;
  return `Locked: ${def.name}, ${progressPhrase(def, p)}`;
}

/** "Workout #25" for the earned line, only when it's unambiguous. */
function workoutNumber(def, on) {
  if (def.measure.key === 'nth') return def.measure.target;
  const ws = store.state.workouts;
  if (ws.filter((w) => w.date === on).length !== 1) return null; // a rest day, or several that day
  return ws.filter((w) => w.date <= on).length;
}

/** The six most recently earned badges, newest first. */
function recentEarned(rw, n = 6) {
  const aw = store.awards.badges;
  return shelfBadges(rw)
    .map((def) => viewOf(def, rw))
    .filter((v) => v.earned)
    .sort((a, b) => String(b.p.earnedOn).localeCompare(String(a.p.earnedOn))
      || String(aw[b.def.id]?.at || '').localeCompare(String(aw[a.def.id]?.at || ''))
      || RARITY_RANK[b.def.rarity] - RARITY_RANK[a.def.rarity])
    .slice(0, n);
}

/** Near-miss hints that point at a badge on the shelf (top 3). */
function railHints(rw) {
  return rw.nextUp.filter((h) => BADGE_BY_ID.has(h.id) && rw.progress.get(h.id) && !rw.progress.get(h.id).earned).slice(0, 3);
}

const firstBadgeLine = (rw) => {
  const w1 = rw.progress.get('w1');
  return w1 && !w1.earned && !w1.value ? 'Your first badge is 1 workout away' : 'Your first badges are on their way';
};

/** Small frame outline for a rarity chip. */
const frameIcon = (rarity) =>
  `<svg class="tro-frame-ico" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="${FRAME_PATHS[rarity]}"/></svg>`;

// ---------------------------------------------------------------------------
// Trophy Case sheet
// ---------------------------------------------------------------------------

let ringSeq = 0;

function ringHTML(earned, total) {
  const R = 31;
  const C = 2 * Math.PI * R;
  const frac = total ? earned / total : 0;
  const id = `tro-ring-g${++ringSeq}`;
  return `
    <svg class="tro-ring" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style="stop-color:var(--pink)"/><stop offset="1" style="stop-color:var(--cyan)"/>
      </linearGradient></defs>
      <circle class="tro-ring-track" cx="36" cy="36" r="${R}"/>
      <circle class="tro-ring-arc" cx="36" cy="36" r="${R}" stroke="url(#${id})" transform="rotate(-90 36 36)"
        stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}" data-to="${(C * (1 - frac)).toFixed(2)}"
        ${frac === 0 ? 'opacity="0"' : ''}/>
    </svg>`;
}

function headerHTML(views) {
  const earned = views.filter((v) => v.earned);
  const byRarity = Object.fromEntries(RARITIES.map((r) => [r, earned.filter((v) => v.def.rarity === r).length]));
  const chips = RARITIES.map((r) => `
    <span class="tro-rar r-${r}${byRarity[r] ? '' : ' zero'}">${frameIcon(r)}<span class="tro-rar-text">${byRarity[r]} ${RARITY_LABEL[r]}</span></span>`)
    .join('');
  return `
    <div class="tro-head">
      <div class="tro-ring-wrap">${ringHTML(earned.length, views.length)}<span class="tro-ring-ico">${icon('trophy')}</span></div>
      <div class="tro-head-text">
        <div class="tro-count"><b>${earned.length}</b><span class="tro-of"> / ${views.length}</span></div>
        <div class="tro-count-label">badges</div>
      </div>
    </div>
    <div class="tro-rars" role="group" aria-label="${RARITIES.map((r) => `${byRarity[r]} ${RARITY_LABEL[r]}`).join(', ')}">${chips}</div>`;
}

function filterHTML(filter, views) {
  const n = { all: views.length, earned: views.filter((v) => v.earned).length };
  n.locked = n.all - n.earned;
  return `
    <div class="segmented tro-seg" role="radiogroup" aria-label="Show badges">${FILTERS.map(([v, label]) => `
      <button type="button" role="radio" class="seg${v === filter ? ' on' : ''}" aria-checked="${v === filter}" data-filter="${v}">
        ${label}<small>${n[v]}</small></button>`).join('')}
    </div>`;
}

function railHTML(rw) {
  const hints = railHints(rw);
  if (!hints.length) return '';
  return `
    <div class="tro-rail">
      <div class="tro-rail-head label">${icon('sparkle')} Almost there</div>
      <div class="tro-rail-row">${hints.map((h) => {
        const v = viewOf(BADGE_BY_ID.get(h.id), rw);
        const a = amounts(v.def, v.p);
        return `
          <button type="button" class="tro-near" data-id="${esc(v.def.id)}" style="${colorVars(v.def)}"
            aria-label="${esc(`Almost there: ${v.def.name}, ${progressPhrase(v.def, v.p)}, ${a.left} to go`)}">
            <span class="tro-near-art">${badgeSVG(artDef(v.def), { state: 'locked', size: 48, progress: v.frac, className: 'no-glow' })}</span>
            <span class="tro-near-name">${esc(v.def.name)}</span>
            <span class="tro-near-cap">${esc(a.left)} to go</span>
          </button>`;
      }).join('')}</div>
    </div>`;
}

function cellHTML(v) {
  const { def, earned, masked, isNew } = v;
  const state = earned ? 'earned' : masked ? 'secret' : 'locked';
  const art = badgeSVG(artDef(def), { state, size: 64, progress: earned ? 0 : v.frac, className: 'no-glow' });
  return `
    <button type="button" class="tro-cell r-${def.rarity} ${earned ? 'is-earned' : 'is-locked'}${isNew ? ' is-new' : ''}"
      data-id="${esc(def.id)}" style="${colorVars(def)}" aria-label="${esc(ariaFor(v))}">
      <span class="tro-art">${art}</span>
      ${isNew ? '<span class="tro-new" aria-hidden="true">NEW</span>' : ''}
      <span class="tro-name" aria-hidden="true">${esc(masked ? '???' : def.name)}</span>
      <span class="tro-sub" aria-hidden="true">${esc(subFor(v))}</span>
    </button>`;
}

const gridCols = () => (window.matchMedia?.('(max-width: 359px)').matches ? 3 : 4);

function emptyHTML(text, sub = '') {
  return `
    <div class="tro-empty">
      <div class="tro-ghosts" aria-hidden="true">${['w25', 'w1', 'w100'].map((id, i) =>
        badgeSVG(id, { state: i === 1 ? 'locked' : 'secret', size: i === 1 ? 60 : 46, className: 'no-glow' })).join('')}</div>
      <p class="tro-empty-title">${esc(text)}</p>
      ${sub ? `<p class="muted small">${esc(sub)}</p>` : ''}
    </div>`;
}

function shelvesHTML(views, filter, rw) {
  const match = (v) => filter === 'all' || (filter === 'earned' ? v.earned : !v.earned);
  const cols = gridCols();
  let i = 0;
  const sections = FAMILIES.map((fam) => {
    const all = views.filter((v) => v.def.family === fam.id);
    const shown = all.filter(match);
    if (!shown.length) return '';
    const done = all.filter((v) => v.earned).length;
    const fill = shown.length % cols ? cols - (shown.length % cols) : 0;
    return `
      <section class="tro-sec" style="--i:${i++};--b1:var(--${fam.b1})" aria-label="${esc(`${fam.label}, ${done} of ${all.length} earned`)}">
        <h3 class="tro-sec-head"><span class="tro-sec-ico">${icon(fam.id === 'count' ? 'medal' : fam.glyph)}</span>
          <span class="label">${esc(fam.label)} · ${done}/${all.length}</span></h3>
        <div class="tro-grid">${shown.map(cellHTML).join('')}${'<span class="tro-fill" aria-hidden="true"></span>'.repeat(fill)}</div>
      </section>`;
  }).join('');

  if (!sections) {
    return filter === 'earned'
      ? emptyHTML(firstBadgeLine(rw), 'Every badge you earn lands on this shelf.')
      : `<div class="tro-empty tro-all-done"><div class="tro-crown">${icon('crown')}</div>
          <p class="tro-empty-title">Every badge earned. Legend.</p><p class="muted small">The whole shelf is glowing, ${esc(who())}.</p></div>`;
  }
  return `${filter === 'earned' ? '' : railHTML(rw)}${sections}`;
}

/**
 * Open the Trophy Case sheet.
 * @param {object} [o]
 * @param {string} [o.focus]  a badge id to scroll to and open in detail
 */
export function openTrophyCase({ focus } = {}) {
  if (openCase) {
    if (focus) openCase.focusBadge(focus);
    return openCase.sheet;
  }
  if (focus) lastFilter = 'all';
  let filter = lastFilter;
  let rw = store.rewards();
  let views = shelfBadges(rw).map((def) => viewOf(def, rw));
  const popped = new Set();
  let io = null;
  let stuckIO = null;

  const sheet = openSheet({
    title: 'Trophy Case',
    className: 'tro-sheet',
    body: '<div class="tro-body"></div>',
    onClose() {
      unsubscribe();
      io?.disconnect();
      stuckIO?.disconnect();
      openCase = null;
      const unseen = store.rewards().unseen.badges;
      if (unseen.length) store.markSeen({ badges: unseen });
    },
  });
  const host = sheet.body.querySelector('.tro-body');

  function draw() {
    host.innerHTML = `
      ${headerHTML(views)}
      <div class="tro-sentinel" aria-hidden="true"></div>
      <div class="tro-filter">${filterHTML(filter, views)}</div>
      <div class="tro-shelves" data-filter="${filter}">${shelvesHTML(views, filter, rw)}</div>`;
    watchSticky();
    watchNew();
  }

  function drawShelves() {
    const shelves = host.querySelector('.tro-shelves');
    shelves.dataset.filter = filter;
    shelves.innerHTML = shelvesHTML(views, filter, rw);
    watchNew();
  }

  // NEW badges pop once as they scroll into view.
  function watchNew() {
    io?.disconnect();
    const cells = [...host.querySelectorAll('.tro-cell.is-new')].filter((c) => {
      if (!popped.has(c.dataset.id)) return true;
      c.classList.add('popped');
      return false;
    });
    if (!cells.length) return;
    if (!window.IntersectionObserver || prefersReducedMotion()) {
      cells.forEach((c) => { c.classList.add('popped'); popped.add(c.dataset.id); });
      return;
    }
    io = new window.IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const c = e.target;
        io.unobserve(c);
        popped.add(c.dataset.id);
        setTimeout(() => c.classList.add('pop', 'popped'), 120);
      }
    }, { root: sheet.body, threshold: 0.6 });
    cells.forEach((c) => io.observe(c));
  }

  // Shadow under the filter bar once it sticks to the top.
  function watchSticky() {
    stuckIO?.disconnect();
    const sentinel = host.querySelector('.tro-sentinel');
    const bar = host.querySelector('.tro-filter');
    if (!window.IntersectionObserver || !sentinel) return;
    stuckIO = new window.IntersectionObserver(([e]) => bar.classList.toggle('stuck', !e.isIntersecting), { root: sheet.body });
    stuckIO.observe(sentinel);
  }

  function fillRing(instant = false) {
    const arc = host.querySelector('.tro-ring-arc');
    if (!arc) return;
    const go = () => {
      arc.removeAttribute('opacity');
      arc.style.strokeDashoffset = arc.dataset.to;
    };
    if (instant) go();
    else requestAnimationFrame(() => requestAnimationFrame(go));
  }

  function focusBadge(id) {
    const def = BADGE_BY_ID.get(id);
    if (!def) return;
    if (filter !== 'all') setFilter('all');
    const cell = host.querySelector(`.tro-cell[data-id="${CSS.escape(id)}"]`);
    if (!cell) return; // hidden family or unknown id: just show the case
    const reduce = prefersReducedMotion();
    cell.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    cell.classList.add('focus-ring');
    setTimeout(() => cell.classList.remove('focus-ring'), 1600);
    setTimeout(() => openBadgeDetail(id, { fromCase: true, returnFocus: cell }), reduce ? 60 : 420);
  }

  function setFilter(next) {
    if (next === filter || !FILTERS.some(([v]) => v === next)) return;
    filter = lastFilter = next;
    host.querySelectorAll('.tro-seg .seg').forEach((b) => {
      const on = b.dataset.filter === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    drawShelves();
    // If she had scrolled past the header, start the new list right under the stuck filter bar.
    if (host.querySelector('.tro-filter').classList.contains('stuck')) {
      const sentinel = host.querySelector('.tro-sentinel');
      sheet.body.scrollTop += sentinel.getBoundingClientRect().top - sheet.body.getBoundingClientRect().top + 1;
    }
  }

  host.addEventListener('click', (e) => {
    const seg = e.target.closest('.tro-seg .seg');
    if (seg) {
      if (seg.dataset.filter !== filter) haptic('tick');
      setFilter(seg.dataset.filter);
      return;
    }
    const cell = e.target.closest('.tro-cell, .tro-near');
    if (cell) {
      haptic('tick');
      sound.tap();
      openBadgeDetail(cell.dataset.id, { fromCase: true, returnFocus: cell });
    }
  });

  // Arrow keys move between filter options (radiogroup pattern).
  host.addEventListener('keydown', (e) => {
    if (!e.target.closest('.tro-seg') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const i = FILTERS.findIndex(([v]) => v === filter);
    const next = FILTERS[(i + (e.key === 'ArrowRight' ? 1 : FILTERS.length - 1)) % FILTERS.length][0];
    setFilter(next);
    host.querySelector(`.tro-seg [data-filter="${next}"]`)?.focus();
    e.preventDefault();
  });

  // A badge earned while the case is open (e.g. a quiet reconcile) shows up right away.
  const unsubscribe = store.subscribe((reason) => {
    if (reason === 'awards:seen') return;
    const top = sheet.body.scrollTop;
    rw = store.rewards();
    views = shelfBadges(rw).map((def) => viewOf(def, rw));
    draw();
    fillRing(true);
    sheet.body.scrollTop = top;
  });

  draw();
  fillRing();
  openCase = { sheet, focusBadge };
  if (focus) setTimeout(() => focusBadge(focus), 360);
  return sheet;
}

// ---------------------------------------------------------------------------
// Badge detail dialog
// ---------------------------------------------------------------------------

function maskURL(rarity) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${FRAME_PATHS[rarity] || FRAME_PATHS.common}"/></svg>`;
  return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`; // single quotes: it sits in a style attribute
}

function statusHTML(v) {
  const { def, p } = v;
  if (v.earned) {
    const n = workoutNumber(def, p.earnedOn);
    const when = parseKey(p.earnedOn).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    return `<p class="trod-earned">${icon('check')}<span class="trod-earned-text"><span>Earned ${esc(when)}</span>${
      n ? ` <span class="trod-wn">Workout #${fmtNum(n)}</span>` : ''}</span></p>`;
  }
  if (v.masked) {
    return `<p class="trod-hint">${icon('sparkle')}<span>${esc(def.hint || 'Keep glowing to find this one.')}</span></p>`;
  }
  if (def.measure.kind === 'allTypes' && p.tooFew) {
    return `<p class="trod-hint">${icon('plus')}<span>Add a type to go for ${esc(def.name)}</span></p>`;
  }
  const a = amounts(def, p);
  let extra = '';
  if (def.measure.kind === 'allTypes' && p.missing?.length) {
    const names = p.missing.slice(0, 3);
    extra = ` · Try ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}`;
  }
  return `
    <div class="trod-prog">
      <span class="bar" style="--c:var(--b1)"><i style="width:0" data-w="${(v.frac * 100).toFixed(1)}%"></i></span>
      <span class="trod-prog-text"><b>${esc(progressPhrase(def, p))}</b> · ${esc(a.left)} to go${esc(extra)}</span>
    </div>`;
}

/**
 * The centered badge dialog: tilting art, rarity, name, flavor or criteria, and
 * the earned date, progress or secret hint. [Share] for earned badges.
 * @param {string} id
 * @param {object} [o]
 * @param {boolean} [o.fromCase]  opened from the Trophy Case (it marks badges seen itself)
 * @param {HTMLElement} [o.returnFocus]
 */
export function openBadgeDetail(id, { fromCase = false, returnFocus = null } = {}) {
  const def = BADGE_BY_ID.get(id);
  if (!def) return null;
  detailOpen?.close(true);
  const rw = store.rewards();
  if (!rw.progress.get(id)) return null;
  const v = viewOf(def, rw);
  const reduce = prefersReducedMotion();
  const state = v.earned ? 'earned' : v.masked ? 'secret' : 'locked';
  const name = v.masked ? '???' : def.name;
  const rarityText = v.masked ? 'Secret badge' : RARITY_LABEL[def.rarity];
  const text = v.earned ? flavorOf(def) : v.masked ? 'A secret badge. Find it to reveal it.' : def.how;

  const layer = document.createElement('div');
  layer.className = 'dialog-layer trod-layer';
  layer.style.zIndex = '450';
  layer.innerHTML = `
    <div class="dialog-backdrop" data-close></div>
    <div class="dialog tcd r-${def.rarity} s-${state}" role="dialog" aria-modal="true" aria-labelledby="trod-name" aria-describedby="trod-desc"
      tabindex="-1" style="${colorVars(def)}">
      <div class="trod-stage">
        <div class="trod-tilt"><div class="trod-pop">
          <span class="trod-halo" aria-hidden="true"></span>
          ${badgeSVG(artDef(def), { state, size: 168, progress: v.earned ? 0 : v.frac, label: v.masked ? 'Secret badge' : `${def.name} badge` })}
          ${v.earned ? `<span class="trod-sheen" aria-hidden="true" style="-webkit-mask-image:${maskURL(def.rarity)};mask-image:${maskURL(def.rarity)}"></span>` : ''}
        </div></div>
      </div>
      <div class="trod-rarity r-${v.masked ? 'secret' : def.rarity}">${v.earned ? '' : icon('lock')}<span>${esc(rarityText)}</span></div>
      <h3 class="trod-name" id="trod-name">${esc(name)}</h3>
      <div id="trod-desc">
        <p class="trod-text${v.earned ? ' flavor' : ''}">${esc(text)}</p>
        ${v.earned && def.how ? `<p class="trod-how">${esc(def.how)}</p>` : ''}
        ${statusHTML(v)}
      </div>
      <div class="dialog-actions${v.earned ? '' : ' single'}">
        ${v.earned ? `<button type="button" class="btn btn-secondary" data-action="share">${icon('share')} Share</button>` : ''}
        <button type="button" class="btn ${v.earned ? 'btn-primary' : 'btn-secondary'}" data-close>Close</button>
      </div>
    </div>`;
  document.body.appendChild(layer);
  document.body.classList.add('has-overlay');

  const dialog = layer.querySelector('.tcd');
  const prevFocus = returnFocus || document.activeElement;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    layer.classList.add('open');
    const bar = layer.querySelector('.trod-prog .bar i');
    if (bar) bar.style.width = bar.dataset.w;
  }));
  setTimeout(() => dialog.focus({ preventScroll: true }), 60);

  let closed = false;
  function close(instant = false) {
    if (closed) return;
    closed = true;
    detailOpen = null;
    window.removeEventListener('keydown', onKey, true);
    layer.classList.remove('open');
    const done = () => {
      layer.remove();
      if (!document.querySelector('.sheet-layer, .dialog-layer')) document.body.classList.remove('has-overlay');
      if (!instant) prevFocus?.focus?.({ preventScroll: true });
    };
    if (instant) done();
    else setTimeout(done, 220);
    if (!fromCase && v.isNew) store.markSeen({ badges: [id] });
  }

  // Capture phase, so Escape closes only this dialog and not the sheet underneath.
  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const f = [...dialog.querySelectorAll('button')];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
  }
  window.addEventListener('keydown', onKey, true);

  layer.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { close(); return; }
    if (e.target.closest('[data-action="share"]')) {
      haptic('tick');
      close(true);
      import('../shareCard.js')
        .then((m) => m.openShareSheet({ kind: 'badge', id }))
        .catch(() => toast("Sharing isn't available right now"));
    }
  });

  if (!reduce) bindTilt(layer.querySelector('.trod-stage'), layer.querySelector('.trod-tilt'));

  detailOpen = { close };
  return { el: dialog, close };
}

/** Pointer-driven 3D tilt (±14°) with a sheen that follows the finger; springs back on release. */
function bindTilt(stage, tilt) {
  const MAX = 14;
  let raf = 0;
  let rx = 0;
  let ry = 0;
  let mx = 50;
  let my = 30;
  const apply = () => {
    raf = 0;
    tilt.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    tilt.style.setProperty('--mx', `${mx.toFixed(1)}%`);
    tilt.style.setProperty('--my', `${my.toFixed(1)}%`);
  };
  const track = (e) => {
    const r = stage.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width, 0, 1);
    const y = clamp((e.clientY - r.top) / r.height, 0, 1);
    ry = (x - 0.5) * 2 * MAX;
    rx = (0.5 - y) * 2 * MAX;
    mx = x * 100;
    my = y * 100;
    tilt.classList.add('tracking');
    if (!raf) raf = requestAnimationFrame(apply);
  };
  const reset = () => {
    tilt.classList.remove('tracking');
    rx = ry = 0;
    mx = 50;
    my = 30;
    if (raf) cancelAnimationFrame(raf);
    apply();
  };
  stage.addEventListener('pointerdown', track);
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || e.buttons || e.pressure) track(e);
  });
  stage.addEventListener('pointerleave', reset);
  stage.addEventListener('pointercancel', reset);
  stage.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') reset(); });
}

// ---------------------------------------------------------------------------
// Profile card
// ---------------------------------------------------------------------------

/** HTML for the Profile "Trophy Case" card (the whole card is a button). */
export function trophyCardHTML() {
  const rw = store.rewards();
  const views = shelfBadges(rw).map((def) => viewOf(def, rw));
  const earned = views.filter((v) => v.earned).length;
  const total = views.length;
  const unseen = views.filter((v) => v.isNew).length;
  const recent = recentEarned(rw);
  const hint = recent.length ? rw.nextUp[0] || null : null; // the empty state has its own call to action

  let shelf;
  if (!recent.length) {
    shelf = `
      <span class="troc-empty">
        <span class="tro-ghosts" aria-hidden="true">${['w25', 'w1', 'w100'].map((id, i) =>
          badgeSVG(id, { state: i === 1 ? 'locked' : 'secret', size: i === 1 ? 52 : 40, className: 'no-glow' })).join('')}</span>
        <span class="troc-empty-text">${esc(firstBadgeLine(rw))}</span>
      </span>`;
  } else {
    const slots = recent.map((v) => `
      <span class="troc-slot is-earned r-${v.def.rarity}" style="${colorVars(v.def)}">
        ${badgeSVG(artDef(v.def), { state: 'earned', size: 48, className: 'no-glow' })}
        ${v.isNew ? '<span class="tro-new">NEW</span>' : ''}
      </span>`);
    for (let i = recent.length; i < 6; i++) slots.push('<span class="troc-slot troc-open"><i></i></span>');
    shelf = `<span class="troc-shelf" aria-hidden="true">${slots.join('')}</span>`;
  }

  const hintText = hint ? hint.text : '';
  const aria = [
    `Trophy Case: ${earned} of ${total} badges earned`,
    unseen ? `${unseen} new` : '',
    hintText ? `Almost there: ${hintText.replace('→', 'for')}` : '',
  ].filter(Boolean).join('. ');

  return `
    <button type="button" class="card tro-card${unseen ? ' has-new' : ''}" data-action="trophies" aria-label="${esc(aria)}">
      <span class="troc-head">
        <span class="troc-title">${icon('trophy')}<span>Trophy Case</span></span>
        <span class="troc-count"><b>${earned}</b> / ${total}${icon('chevronRight')}</span>
      </span>
      ${shelf}
      ${hintText ? `<span class="troc-hint"><span class="troc-hint-label">Almost there:</span> ${esc(hintText)}</span>` : ''}
    </button>`;
}

/** Wire the Profile card (rendered by trophyCardHTML) inside `rootEl` to open the case. */
export function bindTrophyCard(rootEl) {
  const card = rootEl?.querySelector('.tro-card[data-action="trophies"]');
  if (!card || card.dataset.bound) return;
  card.dataset.bound = '1';
  card.addEventListener('click', () => {
    haptic('tick');
    sound.tap();
    openTrophyCase();
  });
}
