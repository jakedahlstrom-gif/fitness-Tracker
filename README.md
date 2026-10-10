# Glow Fitness

A neon, mobile-first workout tracker built for Melinda. Hold the big pink button to log a workout, close your weekly rings, and keep your streak going.

Plain HTML, CSS and JavaScript (ES modules), with no build step and no dependencies. It installs to the home screen as a PWA and works offline.

## Build stages

- [x] **Stage 1: Core logging.** Hold-to-log button with ring fill, haptics, sound and confetti; quick details sheet (type, duration, distance, intensity, feel 1–5, mood, note, photo, date); weekly strip; editable history; weekly ring targets; settings; JSON backup.
- [ ] **Stage 2: Goals and motivation.** Tiered goals, streaks with freezes and rest days, personal records.
- [ ] **Stage 3: Celebrations and rewards.** Tiered celebrations, badges, unlockable themes, share card.
- [ ] **Stage 4: Insights.** Heatmap, trends (Chart.js), year in review.
- [ ] **Stage 5: Extras.** Reminders, challenges, couple mode.

## Deploy to GitHub Pages

1. Push this repo to GitHub (it's already set up as `fitness-Tracker`).
2. On GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and the `/ (root)` folder, then click **Save**.
4. After a minute the site is live at `https://<your-username>.github.io/fitness-Tracker/`.
5. On her iPhone, open that link in **Safari**, tap **Share → Add to Home Screen**. (On Android/Chrome, use **Install app** from the menu, or the Install button on the Profile tab.)

The empty `.nojekyll` file tells GitHub Pages to serve the files as-is.

### Shipping an update

1. Make your changes.
2. In `sw.js`, bump `CACHE_VERSION` (e.g. `glow-v1.0.0` → `glow-v1.0.1`). If you added a new file, add it to `APP_SHELL` too.
3. Push. The next time the app is opened, it downloads the new version in the background and shows a **"New version ready → Update"** prompt.

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

**Backups:** Profile → Backup → **Export** saves one `.json` file with every workout, setting and photo. On a phone it opens the share sheet, so you can **Save to Files**, AirDrop or email it. **Import** restores a file and replaces what's on the device. After 5 workouts, Home shows a gentle reminder if there's been no backup in 30 days.

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
  backup.js             JSON export / import
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
