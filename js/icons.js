// Inline SVG icon set. 24×24, stroke-based, so every icon takes its color from
// CSS `color` and can be given a neon glow with a drop-shadow filter.

const PATHS = {
  // UI
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v10.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9"/>',
  history: '<path d="M3.6 12a8.4 8.4 0 1 0 2.5-6"/><path d="M3.5 3.5V8H8"/><path d="M12 7.5V12l3 2"/>',
  goals: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.8 3.9-6 7.5-6s6.7 2.2 7.5 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>',
  download: '<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 20h14"/>',
  trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 14v3.5M8.5 20.5h7M9.5 17.5h5"/>',
  flame: '<path d="M12 3c.5 3 4.5 5 4.5 10a4.5 4.5 0 0 1-9 0c0-2.2 1.2-3.8 2.3-4.8.2 1.8 1 2.8 2.2 3-.8-2.7-.6-5.6 0-8.2z"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  snowflake: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="m9.5 4.5 2.5 2 2.5-2M9.5 19.5l2.5-2 2.5 2M4.6 11l1.3 2.9L3 15.4M21 8.6l-2.9 1.5 1.3 2.9"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  sparkle: '<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8-1.8 5.2-1.8-5.2L5 10.5l5.2-1.8z"/><path d="M18.5 16v4M16.5 18h4"/>',
  share: '<path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M7 10.5H5.5v10h13v-10H17"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H16a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h7.5"/>',
  note: '<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5M8.5 9h7M8.5 12.5h4"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  vibrate: '<rect x="8" y="4" width="8" height="16" rx="1.5"/><path d="M4.5 8v8M19.5 8v8M2 10v4M22 10v4"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.3 3.5-5.5 7-5.5s6.3 2.2 7 5.5"/>',
  ruler: '<path d="M3.5 15.5 15.5 3.5l5 5-12 12z"/><path d="M7.5 11.5 9.5 13.5M10.5 8.5l2 2M13.5 5.5l2 2"/>',

  // Workout types
  bike: '<circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16 9 9.5l3 6.5H5.5M9 9.5h6.5L12 16M15.5 9.5l3 6.5M9 9.5 8.3 7M6.8 7h3M15.5 9.5l-.7-3h2.4"/>',
  run: '<circle cx="15" cy="4.5" r="2"/><path d="M8 9.8 10.8 8l3.7.2 2 3.3 3 .8"/><path d="M14.5 8.2 12 13l3 3-1 5"/><path d="M12 13l-2 3.5H5.5"/>',
  walk: '<circle cx="12.5" cy="4.5" r="2"/><path d="M12.3 8.2 11.2 14l-2.4 6.5"/><path d="M11.2 14l3 3 1.2 3.5"/><path d="M12.3 8.6 9 11.5l-.6 3M12.3 8.6l2.4 3 2.8.9"/>',
  dumbbell: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  yoga: '<circle cx="12" cy="4.8" r="2"/><path d="M12 8v5.5"/><path d="M12 9 8.3 11.5 5 13M12 9l3.7 2.5L19 13"/><path d="M4.5 18c2.2-2 4.8-2.6 7.5-1.6 2.7-1 5.3-.4 7.5 1.6"/><path d="M7 19.5h10"/>',
  bolt: '<path d="M13 2.5 4.5 13.5h7l-1 8 8.5-11h-7z"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  swim: '<circle cx="16.5" cy="6.5" r="2"/><path d="M3.5 12.5 8 9.5l3.5 2 3-2"/><path d="M2.5 16.5c1.6 0 1.6-1.2 3.2-1.2s1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2"/><path d="M2.5 20.5c1.6 0 1.6-1.2 3.2-1.2s1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2"/>',
  mountain: '<path d="M2.5 20 9 8.5l4 7 2.5-4 6 8.5z"/><path d="M7.2 11.7 9 13l1.6-1.2"/>',
  music: '<path d="M9 17.5V5.5l10-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
  heart: '<path d="M12 20s-7.5-4.5-8.8-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8.8 3.5C19.5 15.5 12 20 12 20z"/>',
  ball: '<circle cx="12" cy="12" r="8.5"/><path d="M5.8 6.2c2.9 2.6 2.9 9 0 11.6M18.2 6.2c-2.9 2.6-2.9 9 0 11.6"/>',
};

/** Icon names offered when creating/editing a workout type. */
export const TYPE_ICONS = ['bike', 'run', 'walk', 'dumbbell', 'yoga', 'bolt', 'swim', 'mountain', 'music', 'heart', 'ball', 'flame', 'star'];

/** Returns an inline <svg> string. */
export function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || PATHS.star}</svg>`;
}
