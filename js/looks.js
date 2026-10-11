// Unlockable looks: color palettes and hold-button skins, plus the ladders that
// unlock them. Data is pure (tests import it in Node); applyLook() touches the DOM
// only when called.

// ---- Palettes ----
// A = --pink (workouts ring), B = --cyan (days ring), C = --purple (minutes ring), D = --lime.
// Every palette has a dark and a light set. --ambient-a tints the page background.

const VARS = ['--bg', '--card', '--card-2', '--card-3', '--pink', '--cyan', '--purple', '--lime', '--on-accent', '--ambient-a'];

function set(bg, card, card2, card3, a, b, c, d, onAccent, ambient) {
  return { '--bg': bg, '--card': card, '--card-2': card2, '--card-3': card3, '--pink': a, '--cyan': b, '--purple': c, '--lime': d, '--on-accent': onAccent, '--ambient-a': ambient };
}

export const PALETTES = {
  glow: {
    name: 'Glow',
    dark: set('#0B0D12', '#161A22', '#1D222C', '#252B37', '#FF2D78', '#22E4F0', '#A77BFF', '#B6F23C', '#FFFFFF', '0'),
    light: set('#F2F4F8', '#FFFFFF', '#F1F3F8', '#E6E9F0', '#EC1468', '#00A9BA', '#7E4FF0', '#5F9200', '#FFFFFF', '0'),
  },
  sunset: {
    name: 'Sunset Drive',
    dark: set('#120A15', '#1F1424', '#281A2E', '#332139', '#FF3D7F', '#FFB13D', '#9D6BFF', '#5CF2B5', '#FFFFFF', '.10'),
    light: set('#FFF5F0', '#FFFFFF', '#FBEFEA', '#F2E1DA', '#D61C62', '#B36200', '#6C43D9', '#0B8A5C', '#FFFFFF', '.06'),
  },
  aurora: {
    name: 'Aurora',
    dark: set('#07110F', '#101C19', '#162522', '#1E2F2B', '#2DF5A8', '#8F7BFF', '#FF5FB0', '#5CE1FF', '#04140D', '.10'),
    light: set('#EEF6F2', '#FFFFFF', '#EAF3EF', '#DCEAE4', '#00875A', '#6A47E8', '#D81F78', '#00809E', '#FFFFFF', '.06'),
  },
  ultraviolet: {
    name: 'Ultraviolet',
    dark: set('#0C0A14', '#171524', '#1F1C2F', '#282439', '#B44BFF', '#FF4FD8', '#29D8FF', '#B6F23C', '#FFFFFF', '.10'),
    light: set('#F4F2FA', '#FFFFFF', '#F0EDF9', '#E5E0F3', '#8A1FE0', '#C8108F', '#0087AB', '#5F9200', '#FFFFFF', '.06'),
  },
  gold: {
    name: 'Gold Rush',
    dark: set('#0F0C06', '#1B170E', '#231E13', '#2D271A', '#FFC53D', '#4FE3D0', '#FF7A6B', '#C3E86B', '#1A1405', '.10'),
    light: set('#FFF9EC', '#FFFFFF', '#FBF3E2', '#F1E6CC', '#A87300', '#00897B', '#CC4A3B', '#5E8A00', '#FFFFFF', '.06'),
  },
  cosmic: {
    name: 'Cosmic',
    dark: set('#07061A', '#121031', '#19163F', '#221E4F', '#FF5CE1', '#5CE1FF', '#8F7BFF', '#7CFFCB', '#1A0716', '.12'),
    light: set('#F4F2FF', '#FFFFFF', '#EFEDFC', '#E2DFF7', '#C21FA6', '#0085AD', '#5741DB', '#00916A', '#FFFFFF', '.06'),
  },
};

// ---- Skins (hold-button looks; the CSS lives in styles.css under [data-glow-skin]) ----

export const SKINS = {
  classic: {
    name: 'Classic Glow', icon: 'plus', sound: 'success',
    confetti: { shapes: ['rect', 'circle'], colors: null }, // null = palette accents
  },
  heartbeat: {
    name: 'Heartbeat', icon: 'heart', sound: 'heartbeat',
    confetti: { shapes: ['heart', 'circle'], colors: ['#FF2D55', '#FF8FA3', '#FFD1DC', 'A'] },
  },
  frost: {
    name: 'Frost', icon: 'snowflake', sound: 'ice',
    confetti: { shapes: ['snow', 'circle'], colors: ['#E8FBFF', '#9BE7FF', '#5B8CFF'] },
  },
  disco: {
    name: 'Disco Ball', icon: 'star', sound: 'shimmer',
    confetti: { shapes: ['star', 'rect'], colors: ['#DDE3EA', '#FFD27A', 'A', 'B', 'C'] },
  },
  lava: {
    name: 'Lava Lamp', icon: 'flame', sound: 'lava',
    confetti: { shapes: ['blob', 'circle'], colors: ['#FF6B4A', '#FF3D8B', '#9D6BFF', '#FFB13D'] },
  },
  holo: {
    name: 'Holo', icon: 'sparkle', sound: 'holo',
    confetti: { shapes: ['streamer', 'rect', 'star'], colors: ['#FF5CC8', '#FFC85C', '#5CF2FF', '#B98CFF'] },
  },
  galaxy: {
    name: 'Galaxy', icon: 'moon', sound: 'galaxy',
    confetti: { shapes: ['star', 'circle'], colors: ['#FF5CE1', '#5CE1FF', '#FFFFFF', '#B9A6FF'] },
  },
};

export const DEFAULT_LOOK = { palette: 'glow', skin: 'classic' };

// ---- Ladders: wins per goal tier unlock looks. Never raise a threshold in a later version. ----

export const LADDERS = {
  short: {
    label: 'Weekly wins', color: 'cyan', what: 'weekly win',
    rungs: [
      { at: 1, items: ['skin:heartbeat'] },
      { at: 3, items: ['palette:sunset'] },
      { at: 6, items: ['skin:frost'] },
      { at: 10, items: ['skin:disco'] },
    ],
  },
  medium: {
    label: 'Monthly wins', color: 'purple', what: 'monthly win',
    rungs: [
      { at: 1, items: ['palette:aurora'] },
      { at: 2, items: ['skin:lava'] },
      { at: 4, items: ['palette:ultraviolet'] },
    ],
  },
  long: {
    label: 'Long-term wins', color: 'pink', what: 'long-term goal',
    rungs: [
      { at: 1, items: ['palette:gold', 'skin:holo'], set: 'Champion set' },
      { at: 2, items: ['palette:cosmic', 'skin:galaxy'], set: 'Cosmic set' },
    ],
  },
};

export const ALL_UNLOCKABLES = Object.values(LADDERS).flatMap((l) => l.rungs.flatMap((r) => r.items));

/** "palette:sunset" → { type: 'palette', id: 'sunset', name: 'Sunset Drive' } */
export function unlockInfo(uid) {
  const [type, id] = uid.split(':');
  const def = type === 'palette' ? PALETTES[id] : SKINS[id];
  return { uid, type, id, name: def ? def.name : id };
}

/** Which ladder rung unlocks an item, e.g. { tier: 'short', at: 3 }. */
export function unlockRule(uid) {
  for (const [tier, l] of Object.entries(LADDERS)) {
    for (const r of l.rungs) if (r.items.includes(uid)) return { tier, at: r.at, what: l.what };
  }
  return null;
}

// ---- Applying a look (DOM) ----

let current = { ...DEFAULT_LOOK };
let onChange = () => {};

/** effects.js registers this so it can rebuild cached sprites when colors change. */
export function onLookChange(fn) { onChange = fn; }

export function currentLook() { return current; }

/**
 * Apply a palette + skin for the current light/dark theme. `look` must already be
 * resolved (unlocked + known); settings are never rewritten here.
 */
export function applyLook(look = current, theme = document.documentElement.dataset.glowTheme || 'dark') {
  current = { palette: PALETTES[look.palette] ? look.palette : 'glow', skin: SKINS[look.skin] ? look.skin : 'classic' };
  const root = document.documentElement;
  const vars = PALETTES[current.palette][theme === 'light' ? 'light' : 'dark'];
  for (const v of VARS) {
    if (current.palette === 'glow') root.style.removeProperty(v);
    else root.style.setProperty(v, vars[v]);
  }
  root.dataset.glowPalette = current.palette;
  root.dataset.glowSkin = current.skin;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--bg']);
  // Mirror the effective look so index.html can paint it before the app loads.
  try {
    localStorage.setItem('glow-fitness:look', JSON.stringify({
      palette: current.palette, skin: current.skin,
      dark: current.palette === 'glow' ? null : PALETTES[current.palette].dark,
      light: current.palette === 'glow' ? null : PALETTES[current.palette].light,
    }));
  } catch { /* storage blocked */ }
  onChange(current);
  // Anything drawn with colors outside CSS (charts, canvases) listens for this to recolor.
  if (typeof CustomEvent === 'function') document.dispatchEvent(new CustomEvent('glow:look', { detail: current }));
  return current;
}

/** Inline CSS variables for previewing a palette inside one element (Studio cards, share sheet). */
export function paletteStyle(id, theme = 'dark') {
  const vars = (PALETTES[id] || PALETTES.glow)[theme === 'light' ? 'light' : 'dark'];
  return VARS.map((v) => `${v}:${vars[v]}`).join(';');
}
