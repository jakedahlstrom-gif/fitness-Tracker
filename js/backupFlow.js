// Backup flows shared by Profile and the Home reminder. Normally Export saves a
// file. When the app runs inside another page's frame (like a claude.ai preview
// link), downloads are blocked, so Export offers copy/paste instead.

import { store } from './store.js';
import { exportBackup, buildBackup, parseBackup, restoreBackup } from './backup.js';
import { openSheet, confirmDialog } from './sheet.js';
import { toast } from './toast.js';
import { applyTheme } from './theme.js';
import { icon } from './icons.js';
import { plural, isEmbedded } from './util.js';
import { restoreText } from './rewardsFlow.js';

/** Export a backup the best way this environment allows. */
export async function startExport() {
  if (isEmbedded()) {
    openCopyPasteSheet();
    return;
  }
  try {
    const result = await exportBackup();
    if (result !== 'cancelled') toast('Backup saved 💾');
  } catch (err) {
    toast(`Export failed: ${err.message}`);
  }
}

/** Ask before replacing everything with a backup. Resolves true if restored. */
export async function confirmAndRestore(backup) {
  const n = backup.data.workouts.length;
  const goals = (Array.isArray(backup.data.goals) ? backup.data.goals : []).filter((g) => g && !g.archivedAt).length;
  const when = backup.exportedAt ? new Date(backup.exportedAt).toLocaleDateString() : 'an unknown date';
  const ok = await confirmDialog({
    title: 'Restore this backup?',
    message: `It has ${plural(n, 'workout')}${goals ? ` and ${plural(goals, 'goal')}` : ''} from ${when}. This replaces everything on this device.`,
    confirmText: 'Restore',
  });
  if (!ok) return false;
  const { photosRestored } = await restoreBackup(backup);
  applyTheme(store.settings.theme);
  toast(photosRestored ? `${restoreText(n)} ✨` : `${restoreText(n)} (photos skipped)`);
  return true;
}

/** Copy the backup as text, or paste one in to restore. */
function openCopyPasteSheet() {
  const sheet = openSheet({
    title: 'Backup',
    body: `
      <div class="backup-sheet">
        <p class="muted small">This version can't save files. Copy your backup and keep it somewhere safe, like a note or an email to yourself.</p>
        <button type="button" class="btn btn-primary btn-block" data-action="copy" disabled>${icon('copy')} <span>Preparing…</span></button>
        <textarea class="input backup-text" id="backup-out" readonly hidden aria-label="Backup text"></textarea>
        <label class="field-label" for="backup-in">Restore from a copied backup</label>
        <textarea class="input" id="backup-in" rows="3" placeholder="Paste a backup here"></textarea>
        <button type="button" class="btn btn-secondary btn-block" data-action="restore">${icon('upload')} Restore</button>
      </div>`,
  });

  const copyBtn = sheet.body.querySelector('[data-action="copy"]');
  let json = '';
  buildBackup().then((payload) => {
    json = JSON.stringify(payload);
    copyBtn.disabled = false;
    copyBtn.querySelector('span').textContent = 'Copy backup';
  });

  sheet.body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    if (btn.dataset.action === 'copy') {
      try {
        await navigator.clipboard.writeText(json); // must run inside the tap itself
        store.updateMeta({ lastBackupAt: new Date().toISOString() });
        toast('Backup copied. Paste it somewhere safe.');
      } catch {
        // Clipboard refused: show the text selected so it can be copied by hand.
        const out = sheet.body.querySelector('#backup-out');
        out.hidden = false;
        out.value = json;
        out.focus();
        out.select();
        toast('Copy the selected text');
      }
    }

    if (btn.dataset.action === 'restore') {
      const text = sheet.body.querySelector('#backup-in').value.trim();
      if (!text) {
        toast('Paste a backup into the box first');
        return;
      }
      try {
        if (await confirmAndRestore(parseBackup(text))) sheet.close('restored');
      } catch (err) {
        toast(err.message);
      }
    }
  });
}
