// scripts/reports/aggregate.js
// Pure aggregation helpers. No network, no fs.

// iRacing lap times are integer ten-thousandths of a second.
export function formatLap(tenThousandths) {
  if (tenThousandths == null || tenThousandths <= 0) return null;
  const totalSec = tenThousandths / 10000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

// Merge candidate rows into an existing leaderboard. Dedupe by custId, keep the
// lowest lapMs, sort ascending, keep a safety buffer (keepN, default 15) so later
// runs can still re-sort correctly.
export function mergeLeaderboard(existing, candidates, { keepN = 15 } = {}) {
  const byDriver = new Map();
  for (const e of existing) byDriver.set(e.custId, e);
  for (const c of candidates) {
    if (c.lapMs == null || c.lapMs <= 0) continue;
    const prev = byDriver.get(c.custId);
    if (!prev || c.lapMs < prev.lapMs) byDriver.set(c.custId, c);
  }
  return [...byDriver.values()]
    .sort((a, b) => a.lapMs - b.lapMs || (a.setAt || 0) - (b.setAt || 0))
    .slice(0, keepN);
}

// Like mergeLeaderboard but keyed by car model (best single lap set in each car).
export function mergeCarLeaderboard(existing, candidates, { keepN = 15 } = {}) {
  const byCar = new Map();
  for (const e of existing) byCar.set(e.car, e);
  for (const c of candidates) {
    if (c.lapMs == null || c.lapMs <= 0 || !c.car) continue;
    const prev = byCar.get(c.car);
    if (!prev || c.lapMs < prev.lapMs) byCar.set(c.car, c);
  }
  return [...byCar.values()]
    .sort((a, b) => a.lapMs - b.lapMs)
    .slice(0, keepN);
}

// Produce the public top-N rows: add rank + formatted lap string.
export function rankAndTrim(entries, n = 10) {
  return entries.slice(0, n).map((e, i) => ({
    rank: i + 1,
    lap: formatLap(e.lapMs),
    lapMs: e.lapMs,
    driver: e.driver,
    irating: e.irating,
    car: e.car,
  }));
}

export function weekId(seasonYear, seasonQuarter, raceWeekNum) {
  return `${seasonYear}-${seasonQuarter}-${raceWeekNum}`;
}
