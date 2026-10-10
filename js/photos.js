// Workout photos. Stored as compressed JPEG data URLs in IndexedDB, which has far
// more room than localStorage (localStorage tops out around 5 MB, or ~50 photos).

const DB_NAME = 'glow-fitness';
const STORE = 'photos';
const cache = new Map(); // id → data URL, so lists don't re-read the database

let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

/** Run one request in a transaction and resolve with its result once committed. */
async function run(mode, makeRequest) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = makeRequest(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const photos = {
  async put(id, dataUrl) {
    await run('readwrite', (s) => s.put(dataUrl, id));
    cache.set(id, dataUrl);
  },

  async get(id) {
    if (cache.has(id)) return cache.get(id);
    const url = await run('readonly', (s) => s.get(id));
    if (url) cache.set(id, url);
    return url || null;
  },

  async delete(id) {
    cache.delete(id);
    await run('readwrite', (s) => s.delete(id));
  },

  async clear() {
    cache.clear();
    await run('readwrite', (s) => s.clear());
  },

  /** Every stored photo as { id: dataUrl } (used by backup export). */
  async all() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const out = {};
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) { out[cursor.key] = cursor.value; cursor.continue(); }
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
    });
  },

  async count() {
    return run('readonly', (s) => s.count());
  },
};

/**
 * Shrink a picked image to fit within maxDim px and re-encode as JPEG.
 * A typical phone photo (3–5 MB) ends up around 80–150 KB.
 */
export async function compressImage(file, maxDim = 1080, quality = 0.72) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image'));
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
