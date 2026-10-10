# Glow Fitness

A neon, mobile-first workout tracker built for Melinda. Hold the big pink button to log a workout, close your weekly rings, and keep your streak going.

Plain HTML, CSS and JavaScript (ES modules), with no build step and no dependencies. It installs to the home screen as a PWA and works offline.

## Build stages

- [x] **Stage 1: Core logging.** Hold-to-log button with ring fill, haptics, sound and confetti; quick details sheet (type, duration, distance, intensity, feel 1–5, mood, note, photo, date); weekly strip; editable history; weekly ring targets; settings; JSON backup.
- [ ] **Stage 2: Goals and motivation.** Tiered goals, streaks with freezes and rest days, personal records.
- [ ] **Stage 3: Celebrations and rewards.** Tiered celebrations, badges, unlockable themes, share card.
- [ ] **Stage 4: Insights.** Heatmap, trends (Chart.js), year in review.
- [ ] **Stage 5: Extras.** Reminders, challenges, couple mode.

## Open it

**Live app:** https://jakedahlstrom-gif.github.io/fitness-Tracker/

GitHub Pages deploys the `claude/stage-1-core-logging` branch (`/ (root)` folder). `main` still only has the first commit, so merge this branch into `main` before pointing Pages at `main`.

On her iPhone, open the link in **Safari** and tap **Share → Add to Home Screen** (on newer iOS, Share may be under the **•••** button). On Android/Chrome, use **Install app** from the menu, or the Install button on the Profile tab.

To set Pages up from scratch: **Settings → Pages → Build and deployment → Deploy from a branch**, pick the branch that has the app and the `/ (root)` folder, then **Save**. The site is live about a minute later. The empty `.nojekyll` file tells GitHub Pages to serve the files as-is.

### Preview link on claude.ai

There is also a private preview at https://claude.ai/artifact/DaKy8VYDtCdFhwaTtdAKtF (open it while signed in to claude.ai, or share it from the page's Share menu). It runs inside claude.ai's frame, so a few things differ:

- No install to the home screen and no offline mode.
- Backup is copy/paste: **Export** copies the backup as text and has a box to paste one back in. Importing a `.json` file still works.
- Its data is separate from the GitHub Pages app. Move it between them with a backup.

### Shipping an update

1. Make your changes.
2. In `sw.js`, bump `CACHE_VERSION` (e.g. `glow-v1.0.2` → `glow-v1.0.3`), and update `APP_VERSION` in `js/views/profile.js` to match. If you added a new file, add it to `APP_SHELL` too.
3. Push to `claude/stage-1-core-logging`, the branch Pages deploys from (or to `main` once Pages uses `main`). The next time the app is opened, it downloads the new version in the background and shows **"A new version of Glow is ready ✨"** with an **Update** button.
4. The claude.ai preview is a separate copy, so pushing doesn't change it. Ask Claude to republish it to the same link. Its page is built from `index.html` and published with `css/` and `js/`.

If you skip step 2, installed copies keep running the old cached files.

## Run it locally

ES modules and the service worker need a real web server (opening `index.html` as a file won't work):

```sh
npx serve .            # or: python3 -m http.server 8000
```

Then open the printed URL. To try it on a phone on the same Wi-Fi, use your computer's IP address. Note that the service worker and install prompt only work on `localhost` or HTTPS.

## Where the data lives

Everything stays on her phone. There are no accounts and no servers.

| What | Where |
|---|---|
| Workouts, settings, goals | `localStorage` (key `glow-fitness:data`) |
| Photos (compressed JPEGs, ~100 KB each) | IndexedDB, because `localStorage` only holds ~5 MB, about 50 photos |

**Backups:** Profile → Backup → **Export** saves one `.json` file with every workout, setting and photo. On a phone it opens the share sheet, so you can **Save to Files**, AirDrop or email it. **Import** restores a file and replaces what's on the device. (In the claude.ai preview, Export copies the backup as text instead; see above.) After 5 workouts, Home shows a gentle reminder if there's been no backup in 30 days.

> **iPhone tip:** Safari can clear a website's saved data if the site isn't opened for about a week, but home-screen apps are exempt. Add it to the home screen and export a backup now and then.

## Project layout

```
index.html              App shell: views, tab bar, hold button
manifest.webmanifest    PWA name, colors, icons
sw.js                   Offline cache + update flow
css/styles.css          All styles; dark/light theme tokens at the top
icons/                  App icons (PNG + SVG)
js/
  app.js                Entry point: tabs, hold-to-log wiring, service worker
  store.js              Data model, localStorage persistence, change events
  photos.js             IndexedDB photo storage + image compression
  backup.js             Build, save, parse and restore a JSON backup
  backupFlow.js         Export/restore flows; copy/paste when running in a frame
  theme.js              Dark / light / auto theme (sets data-glow-theme)
  router.js, util.js    Tab navigation; shared helpers (incl. isEmbedded)
  holdButton.js         Press-and-hold interaction
  logSheet.js           Workout details sheet (log / edit / delete)
  effects.js            Haptics, Web Audio sounds, confetti
  sheet.js, toast.js    Bottom sheets, dialogs, toasts
  components.js         Rings, badges, segmented controls, switches
  stats.js, dates.js    Week/month math, streaks, date formatting
  icons.js              Inline SVG icon set
  views/                Home, History, Goals, Profile screens
```

## Notes

- **Haptics:** Android vibrates via `navigator.vibrate`. iPhone Safari has no vibration API; on iOS 18+ the app uses a system "switch" tick as a best-effort substitute, which may not fire every time.
- **Sounds** are synthesized with the Web Audio API (no audio files). They respect the iPhone's silent switch and can be turned off in Profile.
- Respects **Reduce Motion**: animations shorten and confetti is toned down.
