// Backup export/import as a single JSON file (workouts, settings and photos).

import { store, SCHEMA_VERSION } from './store.js';
import { photos } from './photos.js';
import { dateKey } from './dates.js';
import { isTouchDevice } from './util.js';

const APP_ID = 'glow-fitness';

/**
 * Save a backup file. On phones this opens the share sheet (Save to Files, AirDrop,
 * Mail…); elsewhere it downloads. Resolves 'shared' | 'downloaded' | 'cancelled'.
 */
export async function exportBackup() {
  let photoMap = {};
  try { photoMap = await photos.all(); } catch { /* no photos / IndexedDB unavailable */ }

  const payload = {
    app: APP_ID,
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: store.state,
    photos: photoMap,
  };
  const name = `glow-backup-${dateKey()}.json`;
  const file = new File([JSON.stringify(payload)], name, { type: 'application/json' });

  if (isTouchDevice() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Glow fitness backup' });
      store.updateMeta({ lastBackupAt: new Date().toISOString() });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // Share failed for another reason, so fall back to a download.
    }
  }

  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  store.updateMeta({ lastBackupAt: new Date().toISOString() });
  return 'downloaded';
}

/** Read and validate a backup file. Throws a friendly Error if it isn't one. */
export async function readBackup(file) {
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't a valid backup (couldn't read the JSON).");
  }
  if (obj?.app !== APP_ID || !obj.data || !Array.isArray(obj.data.workouts)) {
    throw new Error("That doesn't look like a Glow backup file.");
  }
  return obj;
}

/** Replace all current data with a validated backup. */
export async function restoreBackup(backup) {
  store.replaceAll(backup.data);
  try {
    await photos.clear();
    for (const [id, url] of Object.entries(backup.photos || {})) {
      if (typeof url === 'string' && url.startsWith('data:image/')) await photos.put(id, url);
    }
  } catch (err) {
    console.warn('Photos could not be restored', err);
    return { photosRestored: false };
  }
  return { photosRestored: true };
}
