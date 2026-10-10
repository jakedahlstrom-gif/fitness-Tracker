// Glow Studio: try on and equip the unlockable looks (palettes + hold-button skins),
// plus the two cards that lead to it: the Goals-tab Rewards card (the unlock ladders)
// and the Profile "Glow Studio" card.

import { store } from './store.js';
import { PALETTES, SKINS, LADDERS, ALL_UNLOCKABLES, unlockInfo, unlockRule, paletteStyle } from './looks.js';
import { resolveLook } from './rewards.js';
import { icon } from './icons.js';
import { esc } from './util.js';
import { ringsSVG, animateRings } from './components.js';
import { greeting } from './dates.js';
import { openSheet } from './sheet.js';
import { haptic, sound } from './effects.js';
import { holdMiniHTML, paletteOrbHTML, bindHoldMinis, equipLook } from './lookParts.js';

const PALETTE_IDS = Object.keys(PALETTES);
const SKIN_IDS = Object.keys(SKINS);
const TOTAL_LOOKS = PALETTE_IDS.length + SKIN_IDS.length;

const theme = () => (document.documentElement.dataset.glowTheme === 'light' ? 'light' : 'dark');
const s = (n) => (n === 1 ? '' : 's');

/** Wins still needed for an item (0 when unlocked or a default). */
function remaining(rw, uid) {
  const rule = unlockRule(uid);
  return rule ? Math.max(0, rule.at - (rw.counts[rule.tier] || 0)) : 0;
}

/** Short requirement for a card: "Win 3 weeks", "Win 2 months", "1 long-term goal". */
function reqText(uid) {
  const rule = unlockRule(uid);
  if (!rule) return '';
  if (rule.tier === 'short') return `Win ${rule.at} week${s(rule.at)}`;
  if (rule.tier === 'medium') return `Win ${rule.at} month${s(rule.at)}`;
  return `${rule.at} long-term goal${s(rule.at)}`;
}

/** "1 more weekly win" / "2 more long-term goals". */
function moreText(rw, uid) {
  const rule = unlockRule(uid);
  const n = remaining(rw, uid);
  return `${n} more ${rule.what}${s(n)}`;
}

const lookName = (look) => `${PALETTES[look.palette].name} · ${SKINS[look.skin].name}`;

// ---------------------------------------------------------------------------
// Glow Studio sheet
// ---------------------------------------------------------------------------

const PREVIEW_RINGS = [
  { color: 'pink', value: 0.8, target: 1 },
  { color: 'purple', value: 0.6, target: 1 },
  { color: 'cyan', value: 1, target: 1 },
];
const STATIC_RINGS = PREVIEW_RINGS.map((r) => ({ ...r, from: r.value }));

let studio = null; // the open Studio, so a second open just re-peeks

/**
 * Open the Glow Studio. `peek` (e.g. 'palette:sunset', 'skin:frost') preselects an item,
 * locked ones included, so she can see it in the preview. Opening marks every unlocked
 * item as seen (NEW pills still show until she closes it).
 * @param {{ peek?: string }} [o]
 */
export function openStudio({ peek } = {}) {
  if (studio) { studio.peek(peek); return studio.handle; }

  const rw0 = store.rewards();
  const fresh = new Set(rw0.unseen.unlocks); // NEW pills for this visit
  if (fresh.size) store.markSeen({ unlocks: [...fresh] });

  const effective = () => resolveLook(store.settings, store.rewards().unlocked);
  const preview = { ...effective() };
  applyPeek(peek);

  const sheet = openSheet({
    title: 'Glow Studio',
    className: 'studio-layer',
    body: '<div class="studio"></div>',
    footer: '<button type="button" class="btn btn-primary studio-equip" data-studio-equip></button>',
    onClose: () => cleanup(),
  });
  const root = sheet.body.querySelector('.studio');
  const foot = sheet.el.querySelector('.sheet-foot');
  const unbindMinis = bindHoldMinis(root);
  let rendered = false; // the preview rings fill in once, on open

  function applyPeek(uid) {
    if (typeof uid !== 'string') return false;
    const [type, id] = uid.split(':');
    if (type === 'palette' && PALETTES[id]) preview.palette = id;
    else if (type === 'skin' && SKINS[id]) preview.skin = id;
    else return false;
    return true;
  }

  // ---- Markup ----

  function previewHTML() {
    const name = String(store.settings.name || '').trim() || 'friend';
    return `
      <div class="studio-preview" style="${paletteStyle(preview.palette, theme())}">
        <div class="sp-top">
          <div class="sp-brand">GLOW<i>//</i>FIT</div>
          <div class="sp-greet">${esc(greeting())}, ${esc(name)}</div>
          <div class="sp-name">${esc(lookName(preview))}</div>
        </div>
        <div class="sp-rings">${ringsSVG(rendered ? STATIC_RINGS : PREVIEW_RINGS, { stroke: 12, label: 'Preview of the rings' })}</div>
        <div class="sp-hold">
          ${holdMiniHTML(preview.skin, { size: 72, holdable: true })}
          <span class="sp-cap">Hold to test</span>
        </div>
      </div>`;
  }

  function themeCardHTML(id, rw, eff) {
    const uid = `palette:${id}`;
    const locked = !rw.unlocked.has(uid);
    const equipped = eff.palette === id;
    const rule = unlockRule(uid);
    const have = rule ? Math.min(rule.at, rw.counts[rule.tier] || 0) : 0;
    const name = PALETTES[id].name;
    const state = equipped ? 'equipped' : locked ? `locked, ${reqText(uid)}` : 'unlocked';
    return `
      <button type="button" class="theme-card${locked ? ' is-locked' : ''}${equipped ? ' is-equipped' : ''}${preview.palette === id ? ' is-preview' : ''}"
        data-uid="${uid}" style="${paletteStyle(id, theme())}" aria-pressed="${preview.palette === id}" aria-label="${esc(`${name}, ${state}`)}">
        <span class="tc-top">
          <span class="tc-rings">${ringsSVG(STATIC_RINGS, { stroke: 13, label: '' })}</span>
          <span class="tc-dots"><i class="c-pink"></i><i class="c-cyan"></i><i class="c-purple"></i><i class="c-lime"></i></span>
        </span>
        <span class="tc-name">${esc(name)}</span>
        ${locked ? `<span class="tc-req">${esc(reqText(uid))}</span>
          <span class="tc-prog"><span class="tc-bar"><i style="width:${Math.round((have / rule.at) * 100)}%"></i></span>${have}/${rule.at}</span>` : ''}
        ${equipped ? `<span class="tc-badge tc-check">${icon('check')}</span>` : locked ? `<span class="tc-badge tc-lock">${icon('lock')}</span>` : ''}
        ${fresh.has(uid) ? '<span class="pill pill-new tc-new">NEW</span>' : ''}
      </button>`;
  }

  function skinCellHTML(id, rw, eff) {
    const uid = `skin:${id}`;
    const locked = !rw.unlocked.has(uid);
    const equipped = eff.skin === id;
    const name = SKINS[id].name;
    const state = equipped ? 'equipped' : locked ? `locked, ${reqText(uid)}` : 'unlocked';
    return `
      <button type="button" class="skin-cell${locked ? ' is-locked' : ''}${equipped ? ' is-equipped' : ''}${preview.skin === id ? ' is-preview' : ''}"
        data-uid="${uid}" aria-pressed="${preview.skin === id}" aria-label="${esc(`${name}, ${state}`)}">
        <span class="sc-art">${holdMiniHTML(id, { size: 56 })}
          ${equipped ? `<span class="sc-badge sc-check">${icon('check')}</span>` : locked ? `<span class="sc-badge sc-lock">${icon('lock')}</span>` : ''}
        </span>
        <span class="sc-name">${esc(name)}</span>
        ${locked ? `<span class="sc-req">${esc(reqText(uid))}</span>` : ''}
        ${fresh.has(uid) ? '<span class="pill pill-new sc-new">NEW</span>' : ''}
      </button>`;
  }

  function render() {
    const rw = store.rewards();
    const eff = effective();
    const row = root.querySelector('.theme-row');
    const keep = { x: row ? row.scrollLeft : null, y: sheet.body.scrollTop };
    const pCount = PALETTE_IDS.filter((id) => rw.unlocked.has(`palette:${id}`)).length;
    const sCount = SKIN_IDS.filter((id) => rw.unlocked.has(`skin:${id}`)).length;
    root.innerHTML = `
      ${previewHTML()}
      <div class="studio-sec">
        <div class="studio-sec-head"><span class="label">Themes · ${pCount} of ${PALETTE_IDS.length}</span></div>
        <div class="theme-row">${PALETTE_IDS.map((id) => themeCardHTML(id, rw, eff)).join('')}</div>
      </div>
      <div class="studio-sec">
        <div class="studio-sec-head"><span class="label">Hold button · ${sCount} of ${SKIN_IDS.length}</span></div>
        <div class="skin-grid">${SKIN_IDS.map((id) => skinCellHTML(id, rw, eff)).join('')}</div>
      </div>`;
    const newRow = root.querySelector('.theme-row');
    if (keep.x != null) newRow.scrollLeft = keep.x;
    sheet.body.scrollTop = keep.y;
    renderFoot();
    if (!rendered) animateRings(root.querySelector('.studio-preview'));
    rendered = true;
  }

  /** Light update after a tap: selection, preview and footer (keeps scroll and live minis). */
  function update() {
    root.querySelectorAll('[data-uid]').forEach((el) => {
      const [type, id] = el.dataset.uid.split(':');
      const on = preview[type] === id;
      el.classList.toggle('is-preview', on);
      el.setAttribute('aria-pressed', String(on));
    });
    const box = root.querySelector('.studio-preview');
    box.setAttribute('style', paletteStyle(preview.palette, theme()));
    box.querySelector('.sp-name').textContent = lookName(preview);
    const mini = box.querySelector('.hold-mini');
    if (mini.dataset.skin !== preview.skin) mini.outerHTML = holdMiniHTML(preview.skin, { size: 72, holdable: true });
    renderFoot();
  }

  function renderFoot() {
    const rw = store.rewards();
    const eff = effective();
    const lockedUid = [`palette:${preview.palette}`, `skin:${preview.skin}`].find((u) => !rw.unlocked.has(u));
    const btn = foot.querySelector('[data-studio-equip]');
    let html;
    let disabled = true;
    if (lockedUid) html = `${icon('lock')} ${esc(moreText(rw, lockedUid))} to unlock`;
    else if (preview.palette === eff.palette && preview.skin === eff.skin) html = `${icon('check')} Equipped`;
    else { html = `${icon('sparkle')} Equip`; disabled = false; }
    btn.innerHTML = html;
    btn.disabled = disabled;
    btn.classList.toggle('btn-primary', !disabled);
    btn.classList.toggle('btn-secondary', disabled);
  }

  function scrollToPreview(uid, smooth = true) {
    const el = uid && root.querySelector(`[data-uid="${CSS.escape(uid)}"]`);
    if (!el) return;
    const behavior = smooth ? 'smooth' : 'auto';
    if (el.classList.contains('theme-card')) {
      const row = el.parentElement;
      const left = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
      row.scrollTo({ left: Math.max(0, left), behavior });
    } else {
      const body = sheet.body;
      const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
      if (top + el.offsetHeight > body.scrollTop + body.clientHeight) body.scrollTo({ top: top - 120, behavior });
    }
  }

  // ---- Events ----

  root.addEventListener('click', (e) => {
    const item = e.target.closest('[data-uid]');
    if (!item) return;
    const [type, id] = item.dataset.uid.split(':');
    if (preview[type] === id) return;
    preview[type] = id;
    haptic('tick');
    sound.tap();
    update();
    if (type === 'palette') scrollToPreview(item.dataset.uid);
  });

  foot.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-studio-equip]');
    if (!btn || btn.disabled) return;
    const eff = effective();
    const patch = {};
    if (preview.palette !== eff.palette) patch.palette = preview.palette;
    if (preview.skin !== eff.skin) patch.skin = preview.skin;
    if (Object.keys(patch).length) equipLook(patch, btn);
  });

  // Equip (inside the view-transition callback) and new wins re-render the Studio.
  const unsubscribe = store.subscribe((reason) => {
    if (reason === 'settings' || reason === 'awards' || reason === 'replace') render();
  });

  const handle = { el: sheet.el, close: sheet.close };
  studio = {
    handle,
    peek(uid) {
      if (applyPeek(uid)) { update(); scrollToPreview(uid); }
    },
  };

  function cleanup() {
    unsubscribe();
    unbindMinis();
    if (studio?.handle === handle) studio = null;
  }

  render();
  if (peek) requestAnimationFrame(() => scrollToPreview(peek, false));
  return handle;
}

// ---------------------------------------------------------------------------
// Rewards card (Goals tab)
// ---------------------------------------------------------------------------

/** Art for one rung: a palette orb, a skin core, or both for a set. */
function rungArt(items, size = 28) {
  const parts = items.map(unlockInfo);
  const pal = parts.find((p) => p.type === 'palette');
  const skin = parts.find((p) => p.type === 'skin');
  if (pal && skin) {
    return `<span class="ln-set">${paletteOrbHTML(pal.id, { size })}${holdMiniHTML(skin.id, { size: Math.round(size * 0.64) })}</span>`;
  }
  return pal ? paletteOrbHTML(pal.id, { size }) : holdMiniHTML(skin.id, { size });
}

/** Fill position (0–100) for `count` wins on a ladder whose rungs sit at evenly spaced nodes. */
function ladderFill(rungs, count) {
  const n = rungs.length;
  let prevAt = 0;
  let prevPos = 0;
  for (let i = 0; i < n; i++) {
    const pos = ((i + 1) / n) * 100;
    if (count < rungs[i].at) return prevPos + ((count - prevAt) / (rungs[i].at - prevAt)) * (pos - prevPos);
    prevAt = rungs[i].at;
    prevPos = pos;
  }
  return 100;
}

function ladderHTML(tier, ladder, count) {
  const nextIdx = ladder.rungs.findIndex((r) => count < r.at);
  const peekUid = (nextIdx >= 0 ? ladder.rungs[nextIdx] : ladder.rungs[ladder.rungs.length - 1]).items[0];
  const nodes = ladder.rungs.map((r, i) => {
    const pos = ((i + 1) / ladder.rungs.length) * 100;
    const name = r.set || unlockInfo(r.items[0]).name;
    const state = count >= r.at ? 'reached' : i === nextIdx ? 'next' : 'future';
    const left = r.at - count;
    const label = state === 'reached' ? `${name}, unlocked` : `${name}, ${left} more ${ladder.what}${s(left)} to unlock`;
    const inner = state === 'future' ? `<span class="ln-lock">${icon('lock')}</span>` : rungArt(r.items);
    return `
      <button type="button" class="ln ln-${state}" style="left:${pos}%" data-studio-peek="${esc(r.items[0])}" aria-label="${esc(label)}">
        ${inner}
        ${state === 'reached' ? `<span class="ln-check">${icon('check')}</span>` : ''}
        ${state === 'next' ? `<span class="ln-cap">${left} to go</span>` : ''}
      </button>`;
  }).join('');
  return `
    <div class="ladder c-${ladder.color}" data-tier="${tier}">
      <button type="button" class="ladder-head" data-studio-peek="${esc(peekUid)}">
        <span>${esc(ladder.label)} · <b>${count}</b></span>${icon('chevronRight')}
      </button>
      <div class="ladder-track">
        <span class="lt-rail"><i style="width:${ladderFill(ladder.rungs, count).toFixed(1)}%"></i></span>
        ${nodes}
      </div>
    </div>`;
}

/** The nearest single unlock: "1 more weekly win unlocks Sunset Drive". */
function nearestCaption(counts) {
  let best = null;
  for (const [tier, ladder] of Object.entries(LADDERS)) {
    const r = ladder.rungs.find((x) => counts[tier] < x.at);
    if (!r) continue;
    const left = r.at - counts[tier];
    if (!best || left < best.left) best = { left, ladder, rung: r };
  }
  if (!best) return 'Every look is unlocked. Shine on!';
  const { left, ladder, rung } = best;
  const name = rung.set ? `the ${rung.set}` : unlockInfo(rung.items[0]).name;
  return `${left} more ${ladder.what}${s(left)} unlock${left === 1 ? 's' : ''} ${name}`;
}

/** Goals tab: three unlock ladders (weekly, monthly, long-term wins). */
export function rewardsCardHTML() {
  const rw = store.rewards();
  const unlocked = ALL_UNLOCKABLES.filter((u) => rw.unlocked.has(u)).length;
  return `
    <article class="card rewards-card" id="rewards">
      <div class="card-head">
        <span class="label">Rewards</span>
        <span class="label label-quiet">${unlocked} of ${ALL_UNLOCKABLES.length} unlocked</span>
      </div>
      ${Object.entries(LADDERS).map(([tier, ladder]) => ladderHTML(tier, ladder, rw.counts[tier] || 0)).join('')}
      <p class="rewards-caption">${icon('sparkle')}<span>${esc(nearestCaption(rw.counts))}</span></p>
    </article>`;
}

const boundRewards = new WeakSet();
const boundStudioCard = new WeakSet();

/** Taps on a ladder row or node open the Studio peeking at that item. Bind once per root. */
export function bindRewardsCard(root) {
  if (!root || boundRewards.has(root)) return;
  boundRewards.add(root);
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-studio-peek]');
    if (!el || !root.contains(el)) return;
    haptic('tick');
    openStudio({ peek: el.dataset.studioPeek });
  });
}

// ---------------------------------------------------------------------------
// Profile "Glow Studio" card
// ---------------------------------------------------------------------------

/** Profile: the equipped look, how many looks are unlocked, and a NEW pill. Tap → Studio. */
export function studioCardHTML() {
  const rw = store.rewards();
  const eff = resolveLook(store.settings, rw.unlocked);
  const have = PALETTE_IDS.filter((id) => rw.unlocked.has(`palette:${id}`)).length
    + SKIN_IDS.filter((id) => rw.unlocked.has(`skin:${id}`)).length;
  const isNew = rw.unseen.unlocks.length > 0;
  return `
    <button type="button" class="card studio-card" data-studio-open aria-label="${esc(`Glow Studio: ${lookName(eff)}. ${have} of ${TOTAL_LOOKS} looks unlocked.${isNew ? ' New looks to try.' : ''}`)}">
      <span class="stc-art">${paletteOrbHTML(eff.palette, { size: 46 })}${holdMiniHTML(eff.skin, { size: 40 })}</span>
      <span class="stc-main">
        <span class="stc-head"><span class="label">Glow Studio</span>${isNew ? '<span class="pill pill-new">NEW</span>' : ''}</span>
        <span class="stc-name">${esc(lookName(eff))}</span>
        <span class="muted small">${have} of ${TOTAL_LOOKS} unlocked</span>
      </span>
      <span class="stc-chev">${icon('chevronRight')}</span>
    </button>`;
}

/** Tap on the Profile card opens the Studio. Bind once per root. */
export function bindStudioCard(root) {
  if (!root || boundStudioCard.has(root)) return;
  boundStudioCard.add(root);
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-studio-open]');
    if (!el || !root.contains(el)) return;
    haptic('tick');
    openStudio();
  });
}
