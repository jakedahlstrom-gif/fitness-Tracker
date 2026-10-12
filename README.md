# Glow Fitness

A neon, mobile-first workout tracker built for Melinda. Hold the big pink button to log a workout, close your weekly rings, and keep your streak going.

Plain HTML, CSS and JavaScript (ES modules), with no build step and no dependencies. It installs to the home screen as a PWA and works offline.

## Build stages

- [x] **Stage 1: Core logging.** Hold-to-log button with ring fill, haptics, sound and confetti; quick details sheet (type, duration, distance, intensity, feel 1–5, mood, note, photo, date); weekly strip; editable history; weekly ring targets; settings; JSON backup.
- [x] **Stage 2: Goals and motivation.** Weekly / monthly / long-term goals with progress bars (create, edit, archive); weekly rings that pop when they close; weekly streak with freezes and a daily streak with rest days; five personal records flagged the moment you set them.
- [x] **Stage 3: Celebrations and rewards.** Celebrations sized to the win (a pop, confetti cannons, or full-screen fireworks), 50 badges in a Trophy Case, unlockable themes and hold-button styles in the Glow Studio, and a "Goal crushed!" share card.
- [x] **Stage 4: Insights.** A Glow calendar heatmap (month and year views), trends with Chart.js (minutes per week, workout mix), her best day and how each type feels, and a swipeable "Your Year in Glow" recap with a shareable card.
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
2. In `sw.js`, bump `CACHE_VERSION` (e.g. `glow-v1.2.0` → `glow-v1.2.1`), and update `APP_VERSION` in `js/views/profile.js` to match. If you added a new file, add it to `APP_SHELL` too.
3. Push to `claude/stage-1-core-logging`, the branch Pages deploys from (or to `main` once Pages uses `main`). The next time the app is opened, it downloads the new version in the background and shows **"A new version of Glow is ready ✨"** with an **Update** button.
4. The claude.ai preview is a separate copy, so pushing doesn't change it. Ask Claude to republish it to the same link. Its page is built from `index.html` and published with every file in `css/` and `js/`.

If you skip step 2, installed copies keep running the old cached files.

## How streaks, freezes and records work

- **Weekly streak:** weeks in a row where she hits the pink "workouts per week" ring. Changing a target only affects this week and later, so past weeks never change.
- **Freezes:** every 4 weeks in a row earns one (she can hold 2). A freeze covers a missed week automatically.
- **Daily streak:** days in a row with a workout. A **rest day** (tap an empty day on Home) bridges the gap but doesn't add to the count. Up to `7 − active-days target` rest days a week, marked up to 7 days back.
- **Personal records:** longest workout, most minutes in a week and in a month, longest daily and weekly streak. A save that beats one shows **New PR!** (after a little history, so the first workouts don't all count as records).

None of these numbers are stored. `js/progress.js` computes them from the workouts, goals, rest days and target history every time, so editing or deleting a workout, Undo and restoring a backup always give the right answer.

## How badges and unlocks work

- **Earned once, kept forever.** Wins (weeks, goals, PRs, freezes) and badges go into a ledger (`awards` in the data) the moment they happen, with the date they happened. Deleting or editing a workout later never takes one away. Only **Erase all** or restoring a backup replaces the ledger.
- **Weekly win:** a week where she hit her weekly workouts target, or crushed a weekly goal. Each calendar week counts once, even if she changes the week start. **Monthly win:** a month with a crushed monthly goal. **Long-term win:** a crushed long-term goal.
- **Unlocks come from wins:** 1/3/6/10 weekly wins, 1/2/4 monthly wins and 1/2 long-term wins unlock the themes and button styles (see the Rewards card on Goals). They're worked out from the ledger, never stored separately. **Never raise an unlock threshold in a later version**: that would lock things she already has.
- **No farming:** lowering a goal's target (or creating one that's already met) doesn't count as crushing it. A goal only counts if it wasn't already met by the workouts that existed when it was last edited. Workouts logged afterwards do count, including a backdated one that finishes last week's or last month's goal.
- **First launch of Stage 3:** her whole history is scanned once, and she gets a one-time "your Trophy Case is ready" gift with everything she already earned.
- **Celebration lab:** tap the version line at the bottom of Profile five times to replay every celebration and share card with sample data. Nothing there is saved.
- **Calm mode** (Profile → Celebrations) skips fireworks and halves the confetti. The phone's **Reduce Motion** setting turns off the particle effects and keeps simple fades.
- **Share card:** a 1080×1350 post (or 1920 tall story) image drawn on a canvas. On her phone it opens the share sheet. In the claude.ai preview, sharing and downloads are blocked by the frame, so press and hold the image to save it (or use Copy image).

## How Insights work

- **Where:** tap the Insights card on Home (or the chart icon / Trends card on Goals). It opens as its own page with a back button; the hold button still works there, and a new log lights up today's square while she watches.
- **Glow calendar:** squares fill at 1 minute and get brighter at three steps based on her own targets: half, one and one-and-a-half of her "minutes per active day" (weekly minutes ÷ active-days target, rounded to 5). With the default 150 min / 3 days that's 25, 50 and 75+ minutes. The steps follow her current targets.
- **Best day:** the weekday with the most minutes per occurrence in the chosen range (today only counts once she has logged). It appears after 8 active days.
- **Feel by type:** a type needs 3 rated workouts to be shown; "feels best" needs a lead of 0.3.
- **Years:** a week belongs to the year that holds its Thursday (Wednesday for Sunday-start weeks), so nothing is counted twice at New Year.
- **Year in Glow:** every year with a workout has a recap on the Insights page. It's offered on Home from December 1 to January 31 (for the year just ending), until she watches or dismisses it; that choice is saved with her data (`meta.recapSeen`), so it travels with backups.
- **Charts and offline:** Chart.js loads from jsDelivr (pinned version with an integrity hash) only when Insights opens. The service worker keeps a copy in a cache that survives updates, so charts work offline after the app has been online once. If it can't load, simple built-in charts show instead with a Retry link. The claude.ai preview has no service worker, so it fetches Chart.js once per visit.

## How challenges work

- **What they are:** a challenge is a long-term goal with a start and end date, tagged with its preset (or `custom`). Progress, celebrations, archiving and backups all reuse the goal code. Challenges live in their own card on Goals; the active ones also show on Home.
- **Presets:** 30-Day Core, 10 of one kind in a month, Seven-Day Spark, 1,000-Minute Month, 21 Days of Yoga, HIIT the Gas and Marathon Month (shown once she has a distance type). If a preset needs a workout type she doesn't have (like Core), starting it adds that type. Month presets offer next month when fewer than 12 days are left.
- **Her own:** pick a type (or any), what to count (workouts, minutes, active days or distance), a target, a length (7, 14, 21 or 30 days) and today or tomorrow as the start.
- **Badges:** every preset has its own badge, and any finished challenge counts toward Challenge Accepted (1), Triple Dare (3) and Challenge Champion (10). Challenges don't count toward Dream Chaser or the long-goal unlocks, so those still mean a big personal goal.

## Tests

The streak, goal and record logic has unit tests (no dependencies needed):

```sh
npm test               # runs node --test on tests/
```

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
| Workouts, goals, rest days, settings, wins and badges | `localStorage` (key `glow-fitness:data`) |
| Photos (compressed JPEGs, ~100 KB each) | IndexedDB, because `localStorage` only holds ~5 MB, about 50 photos |

**Backups:** Profile → Backup → **Export** saves one `.json` file with every workout, setting and photo. On a phone it opens the share sheet, so you can **Save to Files**, AirDrop or email it. **Import** restores a file and replaces what's on the device. (In the claude.ai preview, Export copies the backup as text instead; see above.) After 5 workouts, Home shows a gentle reminder if there's been no backup in 30 days.

> **iPhone tip:** Safari can clear a website's saved data if the site isn't opened for about a week, but home-screen apps are exempt. Add it to the home screen and export a backup now and then.

## Project layout

```
index.html              App shell: views, tab bar, hold button
manifest.webmanifest    PWA name, colors, icons
sw.js                   Offline cache + update flow
css/styles.css          Core styles; dark/light theme tokens at the top
css/celebrate.css       Celebration overlays (pill, banner, finale, reveal, intro)
css/looks.css           Button skins, Glow Studio, Rewards card, palette ambience
css/trophies.css        Trophy Case and badge detail
css/share.css           Share sheet
css/insights.css        Insights page and Glow calendar
css/charts.css          Chart cards and their fallbacks
css/recap.css           Year in Glow story
icons/                  App icons (PNG + SVG)
js/
  app.js                Entry point: tabs, hold-to-log wiring, service worker
  store.js              localStorage persistence, change events, cached derived numbers
  schema.js             Data shape, defaults and migration from older versions
  progress.js           Streaks, freezes, rest days, goal progress, records (pure, unit-tested)
  rewards.js            Wins ledger, badge rules, unlocks, celebration plans (pure, unit-tested)
  badges.js, looks.js   Badge catalog; palettes, button skins and unlock ladders (data)
  rewardsFlow.js        First-launch backfill, quiet catch-up passes, applying the equipped look
  celebrate.js          The celebration director (pop, cannons, finale, badge reveal, intro)
  fireworks.js          Canvas fireworks engine
  badgeArt.js           Badge artwork (SVG)
  shareCard.js          "Goal crushed!" share image + share sheet
  studio.js, lookParts.js  Glow Studio, Rewards card, mini hold buttons
  lab.js                Celebration lab (5 taps on the version line)
  challenges.js         Challenge presets and helpers (pure, unit-tested)
  challengeSheet.js     Challenge picker, preset start sheet and the build-your-own sheet
  insights.js           Insights stats: heatmap levels, trends, best day, feel, year recap (pure, unit-tested)
  heatmap.js            Glow calendar markup (month pages, mini months, week strip)
  charts.js             Chart.js loader, theme and the two chart cards, with built-in fallbacks
  recap.js              "Your Year in Glow" story player
  photos.js             IndexedDB photo storage + image compression
  backup.js             Build, save, parse and restore a JSON backup
  backupFlow.js         Export/restore flows; copy/paste when running in a frame
  theme.js              Dark / light / auto theme (sets data-glow-theme)
  router.js, util.js    Tab navigation; shared helpers (incl. isEmbedded)
  holdButton.js         Press-and-hold interaction
  logSheet.js           Workout details sheet (log / edit / delete)
  effects.js            Haptics, Web Audio sounds (one compressed bus), confetti shapes
  sheet.js, toast.js    Bottom sheets, dialogs, toasts
  components.js         Rings, badges, segmented controls, switches
  stats.js, dates.js    Week/month math, streaks, date formatting
  icons.js              Inline SVG icon set
  views/                Home, History, Goals, Profile screens; trophies.js (Trophy Case); insights.js (Insights page)
tests/                  Unit tests for progress.js, rewards.js, insights.js, challenges.js and schema.js (npm test; npm run test:tz checks other time zones)
package.json            Only for `npm test`; the app itself has no build step
```

## Notes

- **Haptics:** Android vibrates via `navigator.vibrate`. iPhone Safari has no vibration API; on iOS 18+ the app uses a system "switch" tick as a best-effort substitute, which may not fire every time.
- **Sounds** are synthesized with the Web Audio API (no audio files). They respect the iPhone's silent switch, mix with her music instead of pausing it, and can be turned off in Profile.
- Respects **Reduce Motion**: animations shorten, celebration particles are skipped and overlays simply fade.
