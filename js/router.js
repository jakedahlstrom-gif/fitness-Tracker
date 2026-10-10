// Tiny tab router. app.js registers the real handler; views call navigate().

let handler = () => {};

export function setNavigator(fn) { handler = fn; }

/** Switch tabs, e.g. navigate('history', { day: '2026-10-07' }). */
export function navigate(view, params = {}) { handler(view, params); }
