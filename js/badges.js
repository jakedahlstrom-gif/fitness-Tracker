// Badge catalog. Pure data: rewards.js evaluates each badge's `measure` against
// facts computed from her data. Ids are permanent (they're stored in the ledger).
//
// measure kinds:
//   count  – F[key] is a sorted list of dates; earned on the target-th date
//   run    – F[key] lists the dates her longest streak first reached 1, 2, 3…;
//            locked progress shows the current streak (F[current])
//   cum    – F[key] is a running total [{ date, total }]; earned when it crosses target
//   max    – F[key] is [{ date, value }] per workout; earned on the first value ≥ target
//   allTypes / gm3 / crown – special rules in rewards.js

export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_LABEL = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

/** Families set the colors (b1 → b2) and default glyph; rarity sets the frame shape. */
export const FAMILIES = [
  { id: 'count', label: 'Milestones', b1: 'pink', b2: 'purple', glyph: 'bolt' },
  { id: 'weekly', label: 'Weekly streak', b1: 'pink', b2: 'orange', glyph: 'flame' },
  { id: 'daily', label: 'Daily streak', b1: 'cyan', b2: 'lime', glyph: 'sun' },
  { id: 'time', label: 'Time', b1: 'purple', b2: 'cyan', glyph: 'clock' },
  { id: 'records', label: 'Records', b1: 'yellow', b2: 'orange', glyph: 'trophy' },
  { id: 'goals', label: 'Goals & rings', b1: 'lime', b2: 'cyan', glyph: 'goals' },
  { id: 'explorer', label: 'Explorer', b1: 'cyan', b2: 'pink', glyph: 'sparkle' },
  { id: 'distance', label: 'Distance', b1: 'orange', b2: 'pink', glyph: 'route' },
  { id: 'challenges', label: 'Challenges', b1: 'orange', b2: 'yellow', glyph: 'medal' },
  { id: 'secret', label: 'Secret', b1: 'blue', b2: 'purple', glyph: 'sparkle' },
];

const B = (id, family, name, rarity, measure, extra) => ({ id, family, name, rarity, measure, ...extra });
const count = (key, target, unit) => ({ kind: 'count', key, target, unit });

export const BADGES = [
  // Milestones
  B('w1', 'count', 'First Spark', 'common', count('nth', 1, 'workouts'), { plate: '1', flavor: 'Every glow starts with a single spark.', how: 'Log your first workout' }),
  B('w5', 'count', 'High Five', 'common', count('nth', 5, 'workouts'), { plate: '5', flavor: 'Five workouts in. Up top!', how: 'Log 5 workouts' }),
  B('w10', 'count', 'Double Digits', 'common', count('nth', 10, 'workouts'), { plate: '10', flavor: "Ten down. You're officially a regular.", how: 'Log 10 workouts' }),
  B('w25', 'count', 'Quarter Century', 'rare', count('nth', 25, 'workouts'), { plate: '25', flavor: 'Twenty-five workouts. This is who you are now.', how: 'Log 25 workouts' }),
  B('w50', 'count', 'Fifty Fierce', 'rare', count('nth', 50, 'workouts'), { plate: '50', flavor: 'Half a hundred, all heart.', how: 'Log 50 workouts' }),
  B('w100', 'count', 'Century Club', 'epic', count('nth', 100, 'workouts'), { plate: '100', flavor: 'Triple digits. Welcome to the club, {name}.', how: 'Log 100 workouts' }),
  B('w250', 'count', 'Living Legend', 'legendary', count('nth', 250, 'workouts'), { plate: '250', flavor: 'Legends are made, not born.', how: 'Log 250 workouts' }),

  // Weekly streak + freezes
  B('ws2', 'weekly', 'Back to Back', 'common', { kind: 'run', key: 'weekRun', current: 'weekCur', target: 2, unit: 'weeks' }, { plate: '2W', flavor: 'Two weeks in a row. A habit is forming.', how: 'Hit your weekly goal 2 weeks in a row' }),
  B('ws4', 'weekly', 'Month Strong', 'rare', { kind: 'run', key: 'weekRun', current: 'weekCur', target: 4, unit: 'weeks' }, { plate: '4W', flavor: 'Four weeks, zero excuses.', how: 'Hit your weekly goal 4 weeks in a row' }),
  B('ws12', 'weekly', 'Season Slayer', 'epic', { kind: 'run', key: 'weekRun', current: 'weekCur', target: 12, unit: 'weeks' }, { plate: '12W', flavor: 'A whole season of showing up.', how: '12 weeks in a row' }),
  B('ws26', 'weekly', 'Half-Year Hero', 'epic', { kind: 'run', key: 'weekRun', current: 'weekCur', target: 26, unit: 'weeks' }, { plate: '26W', flavor: 'Six months straight. Unreal.', how: '26 weeks in a row' }),
  B('ws52', 'weekly', 'Year of Glow', 'legendary', { kind: 'run', key: 'weekRun', current: 'weekCur', target: 52, unit: 'weeks' }, { plate: '52W', flavor: 'Fifty-two weeks. A whole year of glow.', how: '52 weeks in a row' }),
  B('f1', 'weekly', 'Ice Ice Baby', 'rare', count('freezeEarned', 1, 'freezes'), { glyph: 'snowflake', colors: ['blue', 'cyan'], flavor: 'Your first streak freeze, banked.', how: 'Earn a streak freeze (4 weeks in a row)' }),
  B('f2', 'weekly', 'Saved by the Freeze', 'common', count('freezeUsed', 1, 'freezes'), { glyph: 'snowflake', colors: ['blue', 'cyan'], flavor: 'Missed a week, kept the glow.', how: 'Let a freeze save a missed week' }),

  // Daily streak
  B('ds3', 'daily', 'Hat Trick', 'common', { kind: 'run', key: 'dayRun', current: 'dayCur', target: 3, unit: 'days' }, { plate: '3D', flavor: 'Three days running. Literally, maybe.', how: 'Work out 3 days in a row' }),
  B('ds7', 'daily', 'Seven Heaven', 'rare', { kind: 'run', key: 'dayRun', current: 'dayCur', target: 7, unit: 'days' }, { plate: '7D', flavor: 'A full week, every single day.', how: '7 days in a row' }),
  B('ds14', 'daily', 'Fortnight on Fire', 'epic', { kind: 'run', key: 'dayRun', current: 'dayCur', target: 14, unit: 'days' }, { plate: '14D', flavor: 'Two weeks of daily fire.', how: '14 days in a row' }),
  B('ds30', 'daily', 'Thirty-Day Blaze', 'legendary', { kind: 'run', key: 'dayRun', current: 'dayCur', target: 30, unit: 'days' }, { plate: '30D', flavor: 'Thirty days. The blaze is real.', how: '30 days in a row' }),

  // Time
  B('m600', 'time', 'Ten-Hour Tour', 'common', { kind: 'cum', key: 'minutesCum', target: 600, unit: 'min' }, { plate: '10h', flavor: 'Ten hours invested in you.', how: 'Log 10 hours in total' }),
  B('m3000', 'time', 'Fifty Hours Strong', 'rare', { kind: 'cum', key: 'minutesCum', target: 3000, unit: 'min' }, { plate: '50h', flavor: 'Fifty hours. That is a lot of glow.', how: 'Log 50 hours in total' }),
  B('m6000', 'time', 'Hundred-Hour Hero', 'epic', { kind: 'cum', key: 'minutesCum', target: 6000, unit: 'min' }, { plate: '100h', flavor: 'One hundred hours of pure effort.', how: 'Log 100 hours in total' }),
  B('long60', 'time', 'Hour of Power', 'common', { kind: 'max', key: 'durMax', target: 60, unit: 'min' }, { plate: '60′', flavor: 'A full hour. Power move.', how: 'One workout of 60 minutes or more' }),
  B('long90', 'time', 'Marathon Session', 'rare', { kind: 'max', key: 'durMax', target: 90, unit: 'min' }, { plate: '90′', flavor: 'Ninety minutes of nonstop you.', how: 'One workout of 90 minutes or more' }),

  // Records
  B('pr1', 'records', 'Record Breaker', 'common', count('prs', 1, 'PRs'), { flavor: 'First personal record. Many more to come.', how: 'Set a personal record' }),
  B('pr5', 'records', 'PR Machine', 'rare', count('prs', 5, 'PRs'), { plate: '5', flavor: 'Five records. You keep raising the bar.', how: 'Set 5 personal records' }),
  B('pr15', 'records', 'Record Collector', 'epic', count('prs', 15, 'PRs'), { plate: '15', flavor: 'Fifteen records and counting.', how: 'Set 15 personal records' }),

  // Goals & rings
  B('g1', 'goals', 'Goal Getter', 'common', count('goalWins', 1, 'goals'), { flavor: 'Said it. Did it.', how: 'Complete any goal' }),
  B('gw10', 'goals', 'Weekly Warrior', 'rare', count('weeklyWins', 10, 'wins'), { plate: '10', flavor: 'Ten winning weeks.', how: 'Win 10 weeks', winTier: 'short' }),
  B('gm1', 'goals', 'Month Maven', 'rare', count('monthlyWins', 1, 'wins'), { glyph: 'calendar', flavor: 'A whole month, conquered.', how: 'Complete a monthly goal', winTier: 'medium' }),
  B('gm3', 'goals', 'Three-Peat', 'epic', { kind: 'gm3', target: 3, unit: 'months' }, { glyph: 'calendar', plate: '3', flavor: 'Three months in a row. Unstoppable.', how: 'Win monthly goals 3 months in a row' }),
  B('gl1', 'goals', 'Dream Chaser', 'legendary', count('longWins', 1, 'wins'), { glyph: 'mountain', flavor: 'Said it. Did it. Dreamed it.', how: 'Complete a long-term goal', winTier: 'long' }),
  B('crown', 'goals', 'Triple Crown', 'epic', { kind: 'crown', target: 3, unit: 'tiers' }, { glyph: 'crown', flavor: 'Week, month and long-term. All three.', how: 'Win a weekly, a monthly and a long-term goal' }),
  B('r1', 'goals', 'Ring Leader', 'common', count('ringWeeks', 1, 'weeks'), { flavor: 'All three rings, closed in one week.', how: 'Close all 3 rings in a week' }),
  B('r10', 'goals', 'Ring Master', 'epic', count('ringWeeks', 10, 'weeks'), { plate: '10', flavor: 'Ten weeks of closed rings.', how: 'Close all 3 rings in 10 weeks' }),

  // Explorer
  B('mix3', 'explorer', 'Mix It Up', 'common', count('mix3', 1, 'weeks'), { flavor: 'Three different workouts in one week.', how: 'Do 3 different workout types in one week' }),
  B('allTypes', 'explorer', 'Full Spectrum', 'epic', { kind: 'allTypes', unit: 'types' }, { flavor: 'Every kind of workout. All of them.', how: 'Try every workout type' }),
  B('feel5', 'explorer', 'Good Vibes Only', 'common', count('feel5', 5, 'workouts'), { glyph: 'heart', flavor: 'Five workouts that felt amazing.', how: 'Rate 5 workouts "Amazing"' }),
  B('photo1', 'explorer', 'Photo Finish', 'common', count('photo', 1, 'photos'), { glyph: 'camera', flavor: 'Proof of glow.', how: 'Add a photo to a workout' }),
  B('hard10', 'explorer', 'Beast Mode', 'rare', count('hard', 10, 'workouts'), { glyph: 'bolt', flavor: 'Ten hard ones. Beast mode on.', how: 'Log 10 Hard-intensity workouts' }),
  B('rest5', 'explorer', 'Rest Is Best', 'common', count('rest', 5, 'rest days'), { glyph: 'moon', flavor: 'Recovery is training too.', how: 'Mark 5 rest days' }),

  // Distance (hidden when she has no distance workouts or types)
  B('d5k', 'distance', '5K Finisher', 'rare', { kind: 'max', key: 'kmMax', target: 5, unit: 'km', tol: true }, { plate: '5K', flavor: '3.1 miles of pure glow.', how: 'One workout of 5 km (3.1 mi)' }),
  B('d10k', 'distance', '10K Club', 'epic', { kind: 'max', key: 'kmMax', target: 10, unit: 'km', tol: true }, { plate: '10K', flavor: 'Ten kilometers. Club member.', how: 'One workout of 10 km (6.2 mi)' }),
  B('dhalf', 'distance', 'Half-Marathon Hero', 'legendary', { kind: 'max', key: 'kmMax', target: 21.0975, unit: 'km', tol: true }, { plate: '21K', flavor: '13.1 miles. Hero status.', how: 'One workout of a half marathon' }),
  B('d100mi', 'distance', 'Hundred Miler', 'epic', { kind: 'cum', key: 'kmCum', target: 160.934, unit: 'km', tol: true }, { plate: '100mi', flavor: 'A hundred miles, one workout at a time.', how: '100 miles (161 km) in total' }),

  // Challenges (Stage 5): the ladder, plus one badge per preset (ids match challenges.js)
  B('ch1', 'challenges', 'Challenge Accepted', 'common', count('challengeWins', 1, 'challenges'), { flavor: 'Took it on. Finished it.', how: 'Complete any challenge' }),
  B('ch3', 'challenges', 'Triple Dare', 'rare', count('challengeWins', 3, 'challenges'), { plate: '3', flavor: 'Three challenges, three wins.', how: 'Complete 3 challenges' }),
  B('ch10', 'challenges', 'Challenge Champion', 'legendary', count('challengeWins', 10, 'challenges'), { glyph: 'crown', plate: '10', flavor: 'Ten challenges. Nothing scares you now.', how: 'Complete 10 challenges' }),
  B('cp-core30', 'challenges', 'Core of Steel', 'rare', count('ch:core30', 1, 'challenges'), { glyph: 'flame', plate: '30', flavor: 'Thirty days of core. Rock solid.', how: 'Complete the 30-Day Core challenge' }),
  B('cp-month10', 'challenges', 'Ten Out of Ten', 'common', count('ch:month10', 1, 'challenges'), { glyph: 'calendar', plate: '10', flavor: 'Ten in a month, every one counted.', how: 'Complete a 10-in-a-month challenge' }),
  B('cp-spark7', 'challenges', 'Seven Sparks', 'rare', count('ch:spark7', 1, 'challenges'), { glyph: 'sparkle', plate: '7', flavor: 'Seven days, seven sparks.', how: 'Complete the Seven-Day Spark' }),
  B('cp-min1000', 'challenges', 'Thousand-Minute Club', 'epic', count('ch:min1000', 1, 'challenges'), { glyph: 'clock', plate: '1K', flavor: 'A thousand minutes in a month. Wow.', how: 'Complete the 1,000-Minute Month' }),
  B('cp-yoga21', 'challenges', 'Zen Streak', 'rare', count('ch:yoga21', 1, 'challenges'), { glyph: 'yoga', plate: '21', flavor: 'Breathe in. Breathe out. Badge in.', how: 'Complete 21 Days of Yoga' }),
  B('cp-hiit12', 'challenges', 'Full Throttle', 'rare', count('ch:hiit12', 1, 'challenges'), { glyph: 'bolt', plate: '12', flavor: 'Twelve HIIT sessions, gas pedal down.', how: 'Complete HIIT the Gas' }),
  B('cp-marathon', 'challenges', 'Marathon Month', 'epic', count('ch:marathon', 1, 'challenges'), { glyph: 'route', plate: '26.2', flavor: '26.2 miles, one run at a time.', how: 'Complete the Marathon Month' }),

  // Secret
  B('early5', 'secret', 'Rise & Shine', 'rare', count('early', 5, 'workouts'), { glyph: 'sun', secret: true, hint: 'Some glows start before sunrise.', flavor: 'Five sunrise sessions. Morning legend.', how: '5 workouts between 4 and 7 a.m.' }),
  B('owl5', 'secret', 'Night Owl', 'rare', count('owl', 5, 'workouts'), { glyph: 'moon', secret: true, hint: 'The moon likes company.', flavor: 'The moon has seen you work.', how: '5 workouts after 9 p.m.' }),
  B('weekend', 'secret', 'Weekend Warrior', 'common', count('weekend', 1, 'weekends'), { glyph: 'calendar', secret: true, hint: 'Saturday and Sunday walk into a gym…', flavor: 'Saturday and Sunday, both owned.', how: 'Work out on a Saturday and the next Sunday' }),
  B('comeback', 'secret', 'Comeback Queen', 'rare', count('comeback', 1, 'comebacks'), { glyph: 'heart', secret: true, hint: 'Every return is a win.', flavor: 'Two weeks off, and right back at it.', how: 'Work out after a 2-week break' }),
  B('jan1', 'secret', 'New Year, Same Glow', 'rare', count('jan1', 1, 'workouts'), { glyph: 'sparkle', secret: true, hint: 'Start the year the way you mean to go on.', flavor: 'Started the year glowing.', how: 'Work out on January 1' }),
  B('feb14', 'secret', 'Heart Rate Up', 'rare', count('feb14', 1, 'workouts'), { glyph: 'heart', secret: true, hint: 'A day for hearts.', flavor: 'Valentine, meet cardio.', how: "Work out on Valentine's Day" }),
];

export const BADGE_BY_ID = new Map(BADGES.map((b) => [b.id, b]));
export const FAMILY_BY_ID = new Map(FAMILIES.map((f) => [f.id, f]));

/** b1/b2 color names for a badge (its own override, else the family's). */
export function badgeColors(def) {
  const fam = FAMILY_BY_ID.get(def.family);
  return def.colors || [fam.b1, fam.b2];
}

export function badgeGlyph(def) {
  return def.glyph || FAMILY_BY_ID.get(def.family).glyph;
}
