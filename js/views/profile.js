// Profile: stats summary, install hint, settings, workout types, backup, reset.

import { store } from '../store.js';
import { photos } from '../photos.js';
import { icon, TYPE_ICONS } from '../icons.js';
import { esc, fmtNum, plural, isIOS, isStandalone, isEmbedded } from '../util.js';
import { totals } from '../stats.js';
import { segmented, toggle } from '../components.js';
import { openSheet, confirmDialog } from '../sheet.js';
import { readBackup } from '../backup.js';
import { startExport, confirmAndRestore } from '../backupFlow.js';
import { toast } from '../toast.js';
import { applyTheme } from '../theme.js';
import { haptic, sound, unlockAudio } from '../effects.js';
import { TYPE_COLORS } from '../store.js';
import { trophyCardHTML, bindTrophyCard } from './trophies.js';
import { studioCardHTML, bindStudioCard } from '../studio.js';

export const APP_VERSION = '1.3.0 · Stage 4';

let installPrompt = null; // Chrome/Android "beforeinstallprompt" event
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});

export function renderProfile(el) {
  const s = store.settings;
  const all = store.workouts();
  const sum = totals(all);
  const since = new Date(store.meta.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const lastBackup = store.meta.lastBackupAt
    ? new Date(store.meta.lastBackupAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Never';

  el.innerHTML = `
    <header class="top">
      <div class="brand">GLOW<i>//</i>FIT</div>
      <h1>Profile</h1>
    </header>

    <article class="card profile-card">
      <div class="avatar" aria-hidden="true">${esc((s.name || '?').trim().charAt(0).toUpperCase())}</div>
      <div>
        <div class="profile-name">${esc(s.name || 'You')}</div>
        <div class="muted">Member since ${esc(since)}</div>
      </div>
      <div class="profile-stats">
        <div><b class="c-pink">${fmtNum(sum.count)}</b><span>Workouts</span></div>
        <div><b class="c-purple">${fmtNum(Math.round(sum.minutes / 60))}</b><span>Hours</span></div>
        <div><b class="c-cyan">${fmtNum(store.derived().records.weeklyStreak.value)}<small>wk</small></b><span>Best streak</span></div>
      </div>
    </article>

    ${trophyCardHTML()}
    ${studioCardHTML()}

    ${installCardHTML()}

    <article class="card settings">
      <div class="card-head"><span class="label">Settings</span></div>

      <label class="set-row">
        <span class="set-label">${icon('user')} Name</span>
        <input class="input input-inline" name="name" value="${esc(s.name)}" maxlength="30" autocomplete="given-name" enterkeyhint="done">
      </label>

      <div class="set-row">
        <span class="set-label">${icon('calendar')} Week starts</span>
        ${segmented('weekStart', [[1, 'Mon'], [0, 'Sun']], s.weekStart, { ariaLabel: 'Week starts on' })}
      </div>
      <p class="muted small set-note">Changing this recounts your weekly streaks.</p>

      <div class="set-row">
        <span class="set-label">${icon('ruler')} Units</span>
        ${segmented('units', [['mi', 'Miles'], ['km', 'Km']], s.units, { ariaLabel: 'Distance units' })}
      </div>

      <div class="set-row">
        <span class="set-label">${icon(s.theme === 'light' ? 'sun' : 'moon')} Theme</span>
        ${segmented('theme', [['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto']], s.theme, { ariaLabel: 'Theme' })}
      </div>

      <div class="set-row">
        <span class="set-label">${icon('volume')} Sounds</span>
        ${toggle('sounds', s.sounds, 'Sounds')}
      </div>

      <div class="set-row">
        <span class="set-label">${icon('vibrate')} Haptics</span>
        ${toggle('haptics', s.haptics, 'Haptics')}
      </div>

      <div class="set-row">
        <span class="set-label">${icon('sparkle')} Celebrations</span>
        ${segmented('celebrations', [['full', 'Full'], ['calm', 'Calm']], s.celebrations, { ariaLabel: 'Celebrations' })}
      </div>
      <p class="muted small set-note">Calm skips fireworks and halves confetti.</p>

      <button type="button" class="set-row set-link" data-action="types">
        <span class="set-label">${icon('dumbbell')} Workout types</span>
        <span class="muted">${store.types().length} ${icon('chevronRight')}</span>
      </button>
    </article>

    <article class="card">
      <div class="card-head"><span class="label">Backup</span><span class="label label-quiet">Last: ${esc(lastBackup)}</span></div>
      <p class="muted small">${isEmbedded()
        ? 'Export copies every workout, goal, rest day, setting and photo as text. Paste it into a note or an email to yourself. To restore, tap Export and paste it back in.'
        : 'One file with every workout, goal, rest day, setting and photo. Save it to Files or iCloud Drive, or email it to yourself.'}</p>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" data-action="export">${icon(isEmbedded() ? 'copy' : 'download')} Export</button>
        <button type="button" class="btn btn-secondary" data-action="import">${icon('upload')} Import</button>
      </div>
      <input type="file" accept="application/json,.json" hidden data-import>
      <p class="muted small" data-storage-info></p>
    </article>

    <article class="card">
      <div class="card-head"><span class="label">Data</span></div>
      <button type="button" class="btn btn-ghost btn-danger-text btn-block" data-action="erase">${icon('trash')} Erase all data</button>
    </article>

    <p class="app-version" data-action="version">Glow Fitness ${APP_VERSION}<br>Made with 💗 for ${esc(s.name || 'you')}</p>
  `;

  bindTrophyCard(el);
  bindStudioCard(el);
  fillStorageInfo(el, sum.count);
  if (!el.dataset.bound) bindProfile(el);
}

function installCardHTML() {
  if (isStandalone() || isEmbedded()) return '';
  if (installPrompt) {
    return `
      <article class="card install-card">
        <span class="type-badge lg c-cyan">${icon('phone')}</span>
        <div><b>Install Glow</b><p class="muted small">Add it to your home screen for full-screen, offline use.</p></div>
        <button type="button" class="btn btn-small btn-primary" data-action="install">Install</button>
      </article>`;
  }
  if (isIOS()) {
    return `
      <article class="card install-card">
        <span class="type-badge lg c-cyan">${icon('phone')}</span>
        <div><b>Add to Home Screen</b>
          <p class="muted small">In Safari, tap <span class="inline-icon">${icon('share')}</span> Share (on newer iOS it's under <b>•••</b>), then <b>Add to Home Screen</b>. It runs full-screen, works offline, and keeps your data safer.</p>
        </div>
      </article>`;
  }
  return '';
}

async function fillStorageInfo(el, count) {
  const out = el.querySelector('[data-storage-info]');
  if (!out) return;
  let n = 0;
  try { n = await photos.count(); } catch { /* ignore */ }
  out.textContent = `${plural(count, 'workout')} and ${plural(n, 'photo')} stored on this device.`;
}

let versionTaps = [];

function bindProfile(el) {
  el.dataset.bound = '1';

  el.addEventListener('change', (e) => {
    if (e.target.name === 'name') {
      store.updateSettings({ name: e.target.value.trim().slice(0, 30) || 'Melinda' });
      toast('Name saved');
    }
  });
  el.addEventListener('keydown', (e) => {
    if (e.target.name === 'name' && e.key === 'Enter') e.target.blur();
  });

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const s = store.settings;
    switch (btn.dataset.action) {
      case 'weekStart':
        store.updateSettings({ weekStart: Number(btn.dataset.value) });
        break;
      case 'units':
        store.updateSettings({ units: btn.dataset.value });
        break;
      case 'theme':
        store.updateSettings({ theme: btn.dataset.value });
        applyTheme(btn.dataset.value);
        break;
      case 'sounds':
        store.updateSettings({ sounds: !s.sounds });
        if (store.settings.sounds) { unlockAudio(); sound.success(); }
        break;
      case 'haptics':
        store.updateSettings({ haptics: !s.haptics });
        haptic('success');
        break;
      case 'celebrations':
        store.updateSettings({ celebrations: btn.dataset.value === 'calm' ? 'calm' : 'full' });
        break;
      case 'version': {
        // Five quick taps open the Celebration lab (for trying every celebration).
        const now = Date.now();
        versionTaps = versionTaps.filter((t) => now - t < 2000).concat(now);
        if (versionTaps.length >= 5) {
          versionTaps = [];
          import('../lab.js').then((m) => m.openLab()).catch((err) => console.error(err));
        }
        break;
      }
      case 'types':
        openTypesEditor();
        break;
      case 'install':
        if (installPrompt) {
          installPrompt.prompt();
          await installPrompt.userChoice.catch(() => {});
          installPrompt = null;
          renderProfile(el);
        }
        break;
      case 'export':
        startExport();
        break;
      case 'import':
        el.querySelector('[data-import]').click();
        break;
      case 'erase': {
        const ok = await confirmDialog({
          title: 'Erase everything?',
          message: 'This deletes every workout, photo and setting on this device. Export a backup first if you might want them back.',
          confirmText: 'Erase all',
          danger: true,
        });
        if (!ok) return;
        store.reset();
        await photos.clear().catch(() => {});
        applyTheme(store.settings.theme);
        toast('All data erased');
        break;
      }
      default:
    }
  });

  el.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-import]')) return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await confirmAndRestore(await readBackup(file));
    } catch (err) {
      toast(err.message || 'Import failed');
    }
  });
}

// ---------------------------------------------------------------------------
// Workout types editor
// ---------------------------------------------------------------------------

function openTypesEditor() {
  let expanded = null; // id of the type whose icon/color picker is open

  const sheet = openSheet({
    title: 'Workout types',
    body: '<div class="types-editor"></div>',
    footer: '<button type="button" class="btn btn-primary btn-block" data-close>Done</button>',
  });
  const host = sheet.body.querySelector('.types-editor');

  function draw() {
    const types = store.types();
    host.innerHTML = `
      <p class="muted small">Tap an icon to change it. Types you remove stay on old workouts.</p>
      <ul class="type-list">${types.map((t) => `
        <li class="type-item" data-id="${esc(t.id)}">
          <div class="type-item-row">
            <button type="button" class="type-badge c-${t.color}" data-action="expand" aria-label="Change icon and color">${icon(t.icon)}</button>
            <input class="input" value="${esc(t.label)}" maxlength="24" data-field="label" aria-label="Name">
            <button type="button" class="chip chip-small${t.distance ? ' on' : ''}" data-action="distance" aria-pressed="${t.distance}" title="Track distance">${icon('route')}</button>
            <button type="button" class="icon-btn" data-action="remove" aria-label="Remove ${esc(t.label)}" ${types.length <= 1 ? 'disabled' : ''}>${icon('trash')}</button>
          </div>
          ${expanded === t.id ? `
          <div class="picker">
            <div class="picker-icons">${TYPE_ICONS.map((name) => `
              <button type="button" class="pick-icon${t.icon === name ? ' on' : ''}" data-action="set-icon" data-value="${name}" aria-label="${name}">${icon(name)}</button>`).join('')}
            </div>
            <div class="picker-colors">${TYPE_COLORS.map((c) => `
              <button type="button" class="pick-color c-${c}${t.color === c ? ' on' : ''}" data-action="set-color" data-value="${c}" aria-label="${c}"></button>`).join('')}
            </div>
          </div>` : ''}
        </li>`).join('')}
      </ul>
      <form class="add-type" data-add-form>
        <input class="input" name="label" placeholder="New type, e.g. Pilates" maxlength="24" enterkeyhint="done">
        <button type="submit" class="btn btn-primary">${icon('plus')} Add</button>
      </form>`;
  }

  draw();

  host.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.closest('[data-id]')?.dataset.id;
    const t = store.types().find((x) => x.id === id);
    switch (btn.dataset.action) {
      case 'expand':
        expanded = expanded === id ? null : id;
        break;
      case 'set-icon':
        store.updateType(id, { icon: btn.dataset.value });
        break;
      case 'set-color':
        store.updateType(id, { color: btn.dataset.value });
        break;
      case 'distance':
        store.updateType(id, { distance: !t.distance });
        break;
      case 'remove': {
        const ok = await confirmDialog({ title: `Remove “${t.label}”?`, message: 'Past workouts of this type are kept.', confirmText: 'Remove', danger: true });
        if (!ok) return;
        store.removeType(id);
        break;
      }
      default:
        return;
    }
    draw();
  });

  host.addEventListener('change', (e) => {
    if (e.target.dataset.field !== 'label') return;
    const id = e.target.closest('[data-id]').dataset.id;
    const label = e.target.value.trim().slice(0, 24);
    if (label) store.updateType(id, { label });
    else draw();
  });

  host.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.elements.label;
    const label = input.value.trim();
    if (!label) { input.focus(); return; }
    const t = store.addType({ label });
    expanded = t.id;
    draw();
    toast(`Added “${label}”. Pick an icon!`);
  });
}
