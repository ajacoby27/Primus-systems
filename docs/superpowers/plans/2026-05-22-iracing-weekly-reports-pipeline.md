# iRacing Weekly Reports — Pipeline Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the GitHub Action data pipeline that logs into the iRacing /data API, aggregates the current race week's fastest qualifying/race/average laps (+ driver name, iRating, car) per sportscar series & class, and writes `data/weekly-reports.json` to the repo every 15 minutes.

**Architecture:** A dependency-free Node.js 20 script (`scripts/reports/`) runs in a scheduled GitHub Action inside the `ajacoby27/Primus-systems` repo. Pure aggregation logic is unit-tested with the built-in `node:test` runner; the iRacing API layer is integration code verified with live smoke runs. Output JSON is committed (only when changed) and served same-origin by GitHub Pages alongside `index.html`. The companion front-end is **Plan 2** and is out of scope here.

**Tech Stack:** Node.js 20 (built-in `fetch`, `node:crypto`, `node:test` — **zero npm dependencies**), GitHub Actions (cron), GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-05-22-iracing-weekly-reports-design.md`

---

## File Structure

```
scripts/reports/
  catalog.js          Series catalog (display names, categories, class lists, iRacing series-name matchers). Pure data + matchers.
  catalog.test.js     Tests for catalog matching.
  aggregate.js        Pure logic: formatLap, mergeLeaderboard, mergeCarLeaderboard, rankAndTrim, weekId. No I/O.
  aggregate.test.js   Tests for all pure aggregation logic.
  iracing-auth.js     encodePassword (pure) + login() -> session cookie.
  iracing-auth.test.js Tests for encodePassword properties.
  iracing-client.js   Authenticated client: follows /data link + chunk indirection, rate-limit backoff.
  resolve.js          Maps catalog -> series_id, active season_id, current race_week_num, track name.
  extract.js          Pure: turn one results/get payload into candidate leaderboard rows. No I/O.
  extract.test.js     Tests for extraction against a saved fixture.
  build-reports.js    Orchestrator (main entry): login -> resolve -> incremental fetch -> merge -> write JSON.
  fixtures/           Saved sample API payloads for tests + offline dev.
data/
  weekly-reports.json Output (committed by the Action).
.github/workflows/
  weekly-reports.yml  Scheduled workflow (*/15), runs the script, commits if changed.
package.json          type:module + test script. No dependencies.
```

**Decomposition rationale:** `catalog.js`, `aggregate.js`, `extract.js` are **pure** (no network) → fully unit-tested. `iracing-auth.js`, `iracing-client.js`, `resolve.js`, `build-reports.js` are **integration** → complete code + live smoke verification. The JSON shape (spec §7) is the contract Plan 2 consumes; nothing in Plan 2 is touched here.

---

## Conventions used across tasks

- **Lap times:** the iRacing API expresses lap times as integer **ten-thousandths of a second** (e.g. `1364210` = `2:16.421`). `-1` and `0` mean "no time."
- **Driver dedupe key:** `cust_id` (iRacing's unique customer id), surfaced as `custId` on candidate rows.
- **Leaderboard entry shape (internal):** `{ custId, driver, irating, car, lapMs, setAt }` where `setAt` is a UTC ms timestamp used as a tiebreaker.
- **Run from repo root.** All paths below are repo-root-relative.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `scripts/reports/fixtures/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "primus-reports-pipeline",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test scripts/reports/",
    "build": "node scripts/reports/build-reports.js"
  }
}
```

- [ ] **Step 2: Create an empty fixtures dir placeholder**

Create `scripts/reports/fixtures/.gitkeep` with empty content.

- [ ] **Step 3: Verify Node version + test runner work**

Run: `node --version`
Expected: `v20.x` or higher.

Run: `npm test`
Expected: exits 0 with "no tests found" style output (no test files yet) — confirms the runner is wired.

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/reports/fixtures/.gitkeep
git commit -m "chore: scaffold reports pipeline project"
```

---

### Task 2: Series catalog + matcher

**Files:**
- Create: `scripts/reports/catalog.js`
- Test: `scripts/reports/catalog.test.js`

- [ ] **Step 1: Write the failing test**

```js
// scripts/reports/catalog.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, matchSeriesName } from './catalog.js';

test('catalog has the expected ~12 entries with required fields', () => {
  assert.ok(CATALOG.length >= 12);
  for (const s of CATALOG) {
    assert.ok(s.key && s.displayName && s.category, `entry missing fields: ${JSON.stringify(s)}`);
    assert.ok(Array.isArray(s.classes) && s.classes.length >= 1);
    assert.ok(Array.isArray(s.match) && s.match.length >= 1);
  }
});

test('multiclass series declare multiple classes', () => {
  const imsaOpen = CATALOG.find(s => s.key === 'imsa-open');
  assert.deepEqual(imsaOpen.classes.sort(), ['GT3','GTP','LMP2'].sort());
  const scc = CATALOG.find(s => s.key === 'sports-car-challenge');
  assert.deepEqual(scc.classes.sort(), ['GT4','LMP3'].sort());
});

test('matchSeriesName maps real iRacing names to a catalog entry', () => {
  assert.equal(matchSeriesName('GT3 Regional Tour - Europe').key, 'gt3-regional-europe');
  assert.equal(matchSeriesName('iRacing Porsche Cup - Fixed by CONSPIT').key, 'porsche-cup-fixed');
  assert.equal(matchSeriesName('Sports Car Challenge by Falken Tyre').key, 'sports-car-challenge');
  assert.equal(matchSeriesName('Totally Unknown Oval Series'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/reports/catalog.test.js`
Expected: FAIL — `Cannot find module './catalog.js'`.

- [ ] **Step 3: Write `scripts/reports/catalog.js`**

```js
// scripts/reports/catalog.js
// Single source of truth for which series/classes the pipeline aggregates.
// `match` holds lowercased substrings; the FIRST entry whose every token appears
// in the iRacing series_name wins. Ordered most-specific first to avoid collisions.
export const CATALOG = [
  { key:'imsa-open',  displayName:'IMSA — Open',  category:'IMSA',
    classes:['GTP','LMP2','GT3'], match:[['imsa'],['!fixed']] },
  { key:'imsa-fixed', displayName:'IMSA — Fixed', category:'IMSA',
    classes:['GTP','LMP2','GT3'], match:[['imsa','fixed']] },

  { key:'gt3-regional-americas', displayName:'GT3 Regional Tour — Americas', category:'GT3',
    classes:['GT3'], match:[['gt3','regional','americas']] },
  { key:'gt3-regional-europe', displayName:'GT3 Regional Tour — Europe', category:'GT3',
    classes:['GT3'], match:[['gt3','regional','europe']] },
  { key:'gt3-regional-asia', displayName:'GT3 Regional Tour — Asia Pacific', category:'GT3',
    classes:['GT3'], match:[['gt3','regional','asia']] },
  { key:'gt3-challenge-fixed', displayName:'GT3 Challenge — Fixed', category:'GT3',
    classes:['GT3'], match:[['gt3','challenge','fixed']] },
  { key:'gt-sprint', displayName:'GT Sprint Series', category:'GT3',
    classes:['GT3'], match:[['gt','sprint']] },

  { key:'porsche-cup-fixed', displayName:'Porsche Cup — Fixed', category:'Porsche Cup',
    classes:['Cup'], match:[['porsche','cup','fixed']] },
  { key:'porsche-cup', displayName:'Porsche Cup', category:'Porsche Cup',
    classes:['Cup'], match:[['porsche','cup']] },

  { key:'gt4-challenge', displayName:'GT4 Challenge', category:'GT4',
    classes:['GT4'], match:[['gt4','challenge']] },
  { key:'sports-car-challenge', displayName:'Sports Car Challenge', category:'GT4/LMP3',
    classes:['GT4','LMP3'], match:[['sports','car','challenge']] },

  { key:'lmp3-trophy', displayName:'LMP3 Trophy', category:'LMP3',
    classes:['LMP3'], match:[['lmp3','trophy']] },
];

// A match group is satisfied if every token appears in the name (tokens prefixed
// with '!' must be ABSENT). matchSeriesName returns the first catalog entry whose
// ANY match group is satisfied, else null.
export function matchSeriesName(seriesName) {
  const n = (seriesName || '').toLowerCase();
  for (const entry of CATALOG) {
    for (const group of entry.match) {
      const ok = group.every(tok =>
        tok.startsWith('!') ? !n.includes(tok.slice(1)) : n.includes(tok));
      if (ok) return entry;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/reports/catalog.test.js`
Expected: PASS (3 tests).

> Note: real iRacing `series_name` values are confirmed live in Task 7. If a name doesn't match, adjust that entry's `match` tokens — the tests above lock the intended behaviour.

- [ ] **Step 5: Commit**

```bash
git add scripts/reports/catalog.js scripts/reports/catalog.test.js
git commit -m "feat(reports): series catalog + name matcher"
```

---

### Task 3: Lap-time formatting

**Files:**
- Create: `scripts/reports/aggregate.js`
- Test: `scripts/reports/aggregate.test.js`

- [ ] **Step 1: Write the failing test**

```js
// scripts/reports/aggregate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLap } from './aggregate.js';

test('formatLap converts ten-thousandths of a second to m:ss.mmm', () => {
  assert.equal(formatLap(1364210), '2:16.421');
  assert.equal(formatLap(600000), '1:00.000');
  assert.equal(formatLap(64210), '0:06.421');
});

test('formatLap treats 0 / -1 / null as no time', () => {
  assert.equal(formatLap(0), null);
  assert.equal(formatLap(-1), null);
  assert.equal(formatLap(null), null);
  assert.equal(formatLap(undefined), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/reports/aggregate.test.js`
Expected: FAIL — `formatLap` is not exported / module missing.

- [ ] **Step 3: Write `scripts/reports/aggregate.js` (formatLap only for now)**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/reports/aggregate.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/reports/aggregate.js scripts/reports/aggregate.test.js
git commit -m "feat(reports): formatLap helper"
```

---

### Task 4: Leaderboard merging, car merging, ranking, weekId

**Files:**
- Modify: `scripts/reports/aggregate.js`
- Modify: `scripts/reports/aggregate.test.js`

- [ ] **Step 1: Add failing tests**

Append to `scripts/reports/aggregate.test.js`:

```js
import { mergeLeaderboard, mergeCarLeaderboard, rankAndTrim, weekId } from './aggregate.js';

const row = (custId, lapMs, extra = {}) =>
  ({ custId, driver:`D${custId}`, irating:3000, car:'Ferrari 296 GT3', lapMs, setAt:1000, ...extra });

test('mergeLeaderboard keeps each driver\'s best and sorts ascending', () => {
  const existing = [row(1, 1365000), row(2, 1366000)];
  const candidates = [row(1, 1364000), row(3, 1363000)]; // d1 improves, d3 new fastest
  const out = mergeLeaderboard(existing, candidates);
  assert.deepEqual(out.map(e => e.custId), [3, 1, 2]);
  assert.equal(out.find(e => e.custId === 1).lapMs, 1364000);
});

test('mergeLeaderboard ignores no-time candidates and respects keepN', () => {
  const existing = [];
  const candidates = [row(1,0), row(2,-1), row(3,1364000), row(4,1365000)];
  const out = mergeLeaderboard(existing, candidates, { keepN: 1 });
  assert.equal(out.length, 1);
  assert.equal(out[0].custId, 3);
});

test('mergeCarLeaderboard keeps best lap per car model', () => {
  const cands = [
    row(1,1364000,{car:'Ferrari 296 GT3'}),
    row(2,1363000,{car:'Porsche 911 GT3 R'}),
    row(3,1362000,{car:'Ferrari 296 GT3'}), // faster Ferrari, same model -> replaces
  ];
  const out = mergeCarLeaderboard([], cands);
  assert.equal(out.length, 2);
  assert.equal(out[0].car, 'Ferrari 296 GT3');
  assert.equal(out[0].lapMs, 1362000);
});

test('rankAndTrim adds rank + formatted lap and caps at n', () => {
  const out = rankAndTrim([row(3,1363000), row(1,1364000)], 10);
  assert.equal(out[0].rank, 1);
  assert.equal(out[0].lap, '2:16.300');
  assert.equal(out.length, 2);
});

test('weekId is stable from season identifiers', () => {
  assert.equal(weekId(2026, 2, 7), '2026-2-7');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/reports/aggregate.test.js`
Expected: FAIL — `mergeLeaderboard`/etc. not exported.

- [ ] **Step 3: Add the implementations to `scripts/reports/aggregate.js`**

Append:

```js
// Merge candidate rows (best-per-driver-per-batch already not required; we dedupe here)
// into an existing leaderboard. Dedupe by custId, keep the lowest lapMs, sort ascending,
// keep a safety buffer (keepN, default 15) so later weeks/runs can still re-sort correctly.
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/reports/aggregate.test.js`
Expected: PASS (all aggregate tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/reports/aggregate.js scripts/reports/aggregate.test.js
git commit -m "feat(reports): leaderboard merge/rank/weekId logic"
```

---

### Task 5: iRacing auth

**Files:**
- Create: `scripts/reports/iracing-auth.js`
- Test: `scripts/reports/iracing-auth.test.js`

- [ ] **Step 1: Write the failing test (encodePassword is pure → testable)**

```js
// scripts/reports/iracing-auth.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePassword } from './iracing-auth.js';

test('encodePassword lowercases the email before hashing', () => {
  assert.equal(encodePassword('Foo@Bar.com', 'pw123'), encodePassword('foo@bar.com', 'pw123'));
});

test('encodePassword is deterministic and base64 sha256 (44 chars)', () => {
  const a = encodePassword('foo@bar.com', 'pw123');
  const b = encodePassword('foo@bar.com', 'pw123');
  assert.equal(a, b);
  assert.match(a, /^[A-Za-z0-9+/]{43}=$/);
});

test('encodePassword changes with a different password', () => {
  assert.notEqual(encodePassword('foo@bar.com', 'pw123'), encodePassword('foo@bar.com', 'pw124'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/reports/iracing-auth.test.js`
Expected: FAIL — module/function missing.

- [ ] **Step 3: Write `scripts/reports/iracing-auth.js`**

```js
// scripts/reports/iracing-auth.js
import { createHash } from 'node:crypto';

// iRacing /auth expects base64( sha256( password + lowercase(email) ) ).
export function encodePassword(email, password) {
  return createHash('sha256')
    .update(password + String(email).toLowerCase())
    .digest('base64');
}

// Logs in and returns a Cookie header string for subsequent /data requests.
export async function login(email, password) {
  const res = await fetch('https://members-ng.iracing.com/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: encodePassword(email, password) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`iRacing auth HTTP ${res.status}: ${text.slice(0, 200)}`);
  let body = {};
  try { body = JSON.parse(text); } catch { /* some errors return non-JSON */ }
  if (body.authcode === 0 || body.authcode === '0') {
    throw new Error(`iRacing auth rejected: ${body.message || 'check creds / 2FA / verification'}`);
  }
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie()
                    : [res.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookies.map(c => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('iRacing auth returned no cookie');
  return cookie;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/reports/iracing-auth.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Live smoke test (requires creds)**

Create a throwaway `scripts/reports/_smoke-auth.js`:

```js
import { login } from './iracing-auth.js';
const cookie = await login(process.env.IRACING_EMAIL, process.env.IRACING_PASSWORD);
console.log('OK, cookie length:', cookie.length);
```

Run (PowerShell): `$env:IRACING_EMAIL='you@x.com'; $env:IRACING_PASSWORD='...'; node scripts/reports/_smoke-auth.js`
Expected: `OK, cookie length: <n>`. If it throws about authcode/verification, the account likely needs the 2FA/legacy-auth fix (spec §6) — resolve before continuing. Delete `_smoke-auth.js` after.

- [ ] **Step 6: Commit**

```bash
git add scripts/reports/iracing-auth.js scripts/reports/iracing-auth.test.js
git commit -m "feat(reports): iRacing auth (hash + login)"
```

---

### Task 6: iRacing data client (link + chunk indirection, rate-limit backoff)

**Files:**
- Create: `scripts/reports/iracing-client.js`

- [ ] **Step 1: Write `scripts/reports/iracing-client.js`**

```js
// scripts/reports/iracing-client.js
// Authenticated client for the iRacing /data API.
// Most endpoints return { link } pointing at the real JSON on S3; some return
// chunked data via data.chunk_info. This wraps both, plus 429 backoff.
const BASE = 'https://members-ng.iracing.com';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function createClient(cookie) {
  async function raw(path, params = {}) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Cookie: cookie } });
    if (res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset')) || 0;
      const waitMs = Math.max(2000, reset * 1000 - Date.now());
      console.warn(`rate-limited on ${path}, waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      return raw(path, params);
    }
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    return res.json();
  }

  // Follow the single-link indirection.
  async function get(path, params) {
    const j = await raw(path, params);
    if (j && j.link) {
      const r = await fetch(j.link);
      if (!r.ok) throw new Error(`link fetch ${path} -> HTTP ${r.status}`);
      return r.json();
    }
    return j;
  }

  // Follow chunked results. Returns a flat array of rows. If the payload is not
  // chunked, returns whatever `data` array is present (or the object itself).
  async function getChunked(path, params) {
    const j = await get(path, params);
    const data = j && j.data ? j.data : j;
    const ci = data && data.chunk_info;
    if (!ci || !Array.isArray(ci.chunk_file_names) || ci.chunk_file_names.length === 0) {
      return Array.isArray(data) ? data : (Array.isArray(j) ? j : []);
    }
    const out = [];
    for (const name of ci.chunk_file_names) {
      const r = await fetch(ci.base_download_url + name);
      if (!r.ok) throw new Error(`chunk fetch -> HTTP ${r.status}`);
      out.push(...await r.json());
      await sleep(150);
    }
    return out;
  }

  return { raw, get, getChunked };
}
```

- [ ] **Step 2: Live smoke test**

Create throwaway `scripts/reports/_smoke-client.js`:

```js
import { login } from './iracing-auth.js';
import { createClient } from './iracing-client.js';
const c = createClient(await login(process.env.IRACING_EMAIL, process.env.IRACING_PASSWORD));
const series = await c.get('/data/series/get');
console.log('series count:', series.length);
console.log('sample:', series.slice(0, 3).map(s => s.series_name));
```

Run: `node scripts/reports/_smoke-client.js`
Expected: a count and 3 real series names printed. Confirms link-indirection works. Delete the file after.

- [ ] **Step 3: Commit**

```bash
git add scripts/reports/iracing-client.js
git commit -m "feat(reports): iRacing data client (link/chunk/backoff)"
```

---

### Task 7: Resolve catalog → series_id / season / current week / track

**Files:**
- Create: `scripts/reports/resolve.js`

- [ ] **Step 1: Write `scripts/reports/resolve.js`**

```js
// scripts/reports/resolve.js
import { matchSeriesName, CATALOG } from './catalog.js';

// Returns a Map: catalog key -> { entry, seriesId, seasonId, seasonYear,
// seasonQuarter, raceWeekNum, track }. Skips catalog entries with no active season.
export async function resolveSeasons(client) {
  // 1. series_id by name
  const allSeries = await client.get('/data/series/get');           // [{series_id, series_name,...}]
  const keyToSeriesId = new Map();
  for (const s of allSeries) {
    const m = matchSeriesName(s.series_name);
    if (m && !keyToSeriesId.has(m.key)) keyToSeriesId.set(m.key, s.series_id);
  }

  // 2. active seasons (include schedules to find the current week + track)
  const seasons = await client.get('/data/series/seasons', { include_series: false }); // [{season_id, series_id, season_year, season_quarter, schedules:[...]}]
  const bySeriesId = new Map();
  for (const sn of seasons) if (sn.active !== false) bySeriesId.set(sn.series_id, sn);

  const now = Date.now();
  const out = new Map();
  for (const entry of CATALOG) {
    const seriesId = keyToSeriesId.get(entry.key);
    if (seriesId == null) { console.warn(`no series_id for ${entry.key}`); continue; }
    const season = bySeriesId.get(seriesId);
    if (!season) { console.warn(`no active season for ${entry.key}`); continue; }
    const cur = currentWeek(season.schedules, now);
    if (!cur) { console.warn(`no current week for ${entry.key}`); continue; }
    out.set(entry.key, {
      entry, seriesId, seasonId: season.season_id,
      seasonYear: season.season_year, seasonQuarter: season.season_quarter,
      raceWeekNum: cur.race_week_num, track: trackName(cur),
    });
  }
  return out;
}

// Pick the schedule row whose start_date window contains `now` (each week is 7 days).
function currentWeek(schedules, now) {
  if (!Array.isArray(schedules)) return null;
  const withDates = schedules
    .filter(s => s.start_date)
    .map(s => ({ ...s, _start: Date.parse(s.start_date + 'T00:00:00Z') }))
    .sort((a, b) => a._start - b._start);
  let pick = null;
  for (const s of withDates) {
    if (s._start <= now && now < s._start + 7 * 24 * 3600 * 1000) { pick = s; break; }
  }
  // fallback: most recent started week
  if (!pick) for (const s of withDates) if (s._start <= now) pick = s;
  return pick;
}

function trackName(scheduleRow) {
  return scheduleRow.track?.track_name
      || scheduleRow.track_name
      || `track ${scheduleRow.track?.track_id ?? '?'}`;
}
```

- [ ] **Step 2: Live smoke test + lock catalog names**

Create throwaway `scripts/reports/_smoke-resolve.js`:

```js
import { login } from './iracing-auth.js';
import { createClient } from './iracing-client.js';
import { resolveSeasons } from './resolve.js';
const c = createClient(await login(process.env.IRACING_EMAIL, process.env.IRACING_PASSWORD));
const map = await resolveSeasons(c);
for (const [k, v] of map) console.log(k, '=> week', v.raceWeekNum, '@', v.track, '(series', v.seriesId + ')');
console.log('resolved', map.size, 'of', '12 catalog entries');
```

Run: `node scripts/reports/_smoke-resolve.js`
Expected: most/all 12 catalog keys resolve to a week + track. **If any are missing**, read the warnings, find the real `series_name` (from the Task 6 smoke output) and fix that entry's `match` tokens in `catalog.js`, re-run Task 2 tests, re-run this smoke. Delete the smoke file when all resolve.

- [ ] **Step 3: Commit**

```bash
git add scripts/reports/resolve.js scripts/reports/catalog.js
git commit -m "feat(reports): resolve series/season/week/track"
```

---

### Task 8: Extract candidate rows from a results payload (pure, fixture-tested)

**Files:**
- Create: `scripts/reports/extract.js`
- Create: `scripts/reports/fixtures/results-get.sample.json` (captured live)
- Test: `scripts/reports/extract.test.js`

- [ ] **Step 1: Capture a real `results/get` payload as a fixture**

Create throwaway `scripts/reports/_capture.js`:

```js
import { login } from './iracing-auth.js';
import { createClient } from './iracing-client.js';
import { resolveSeasons } from './resolve.js';
import { writeFileSync } from 'node:fs';
const c = createClient(await login(process.env.IRACING_EMAIL, process.env.IRACING_PASSWORD));
const map = await resolveSeasons(c);
const first = [...map.values()][0];
const subs = await c.getChunked('/data/results/search_series', {
  season_id: first.seasonId, race_week_num: first.raceWeekNum,
});
console.log('subsessions found:', subs.length);
const sub = subs[0];
const full = await c.get('/data/results/get', { subsession_id: sub.subsession_id });
writeFileSync('scripts/reports/fixtures/results-get.sample.json', JSON.stringify(full, null, 2));
console.log('saved fixture for subsession', sub.subsession_id);
console.log('top-level keys:', Object.keys(full));
console.log('session_results simsession types:', (full.session_results||[]).map(s=>s.simsession_type_name||s.simsession_type));
```

Run: `node scripts/reports/_capture.js`
Expected: a fixture file written. **Inspect it** — confirm the field names used in Step 3 below (`session_results[].results[]` rows with `cust_id`, `display_name`, `best_lap_time`, `average_lap`, `newi_rating`/`oldi_rating`, `car_id`; and which simsession is QUALIFY vs RACE). Adjust Step 3 field names to match the fixture if they differ. Delete `_capture.js` after.

- [ ] **Step 2: Write the failing test against the fixture**

```js
// scripts/reports/extract.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractCandidates } from './extract.js';

const sample = JSON.parse(readFileSync(new URL('./fixtures/results-get.sample.json', import.meta.url)));
const carName = (id) => `car${id}`;

test('extractCandidates returns qual/race/avg rows with required fields', () => {
  const { qualifying, raceLap, raceAvg } = extractCandidates(sample, carName);
  for (const list of [qualifying, raceLap, raceAvg]) {
    assert.ok(Array.isArray(list));
    for (const r of list) {
      assert.equal(typeof r.custId, 'number');
      assert.equal(typeof r.driver, 'string');
      assert.equal(typeof r.lapMs, 'number');
      assert.ok(r.lapMs > 0);
      assert.ok(typeof r.car === 'string');
    }
  }
  // a populated race session should yield at least one race lap
  assert.ok(raceLap.length >= 1);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test scripts/reports/extract.test.js`
Expected: FAIL — `extractCandidates` missing.

- [ ] **Step 4: Write `scripts/reports/extract.js` (verify field names against the fixture)**

```js
// scripts/reports/extract.js
// Pure: turn one results/get payload into candidate rows per category.
// Field names below match the iRacing results/get shape; confirm against the
// captured fixture and adjust if a name differs.

const isRace = (s) => /race/i.test(s.simsession_type_name || '') || s.simsession_type === 6;
const isQual = (s) => /qual/i.test(s.simsession_type_name || '') || s.simsession_type === 5;

function rowFrom(r, carName, lapField, useAvg = false) {
  const lapMs = useAvg ? r.average_lap : r.best_lap_time;
  return {
    custId: r.cust_id,
    driver: r.display_name,
    irating: r.newi_rating ?? r.oldi_rating ?? r.irating ?? 0,
    car: carName(r.car_id),
    lapMs: typeof lapMs === 'number' ? lapMs : -1,
    setAt: Date.now(),
  };
}

export function extractCandidates(payload, carName) {
  const sessions = payload.session_results || [];
  const qualS = sessions.find(isQual);
  const raceS = sessions.find(isRace);
  const qualifying = (qualS?.results || []).map(r => rowFrom(r, carName, 'best_lap_time'))
    .filter(r => r.lapMs > 0);
  const raceLap = (raceS?.results || []).map(r => rowFrom(r, carName, 'best_lap_time'))
    .filter(r => r.lapMs > 0);
  const raceAvg = (raceS?.results || []).map(r => rowFrom(r, carName, 'average_lap', true))
    .filter(r => r.lapMs > 0);
  return { qualifying, raceLap, raceAvg };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test scripts/reports/extract.test.js`
Expected: PASS. If fields were named differently in the fixture, fix `rowFrom`/selectors and re-run.

- [ ] **Step 6: Commit**

```bash
git add scripts/reports/extract.js scripts/reports/extract.test.js scripts/reports/fixtures/results-get.sample.json
git commit -m "feat(reports): extract candidate rows from results payload"
```

---

### Task 9: Orchestrator — build-reports.js

**Files:**
- Create: `scripts/reports/build-reports.js`
- Create (first run): `data/weekly-reports.json`

- [ ] **Step 1: Write `scripts/reports/build-reports.js`**

```js
// scripts/reports/build-reports.js
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { login } from './iracing-auth.js';
import { createClient } from './iracing-client.js';
import { resolveSeasons } from './resolve.js';
import { extractCandidates } from './extract.js';
import { mergeLeaderboard, mergeCarLeaderboard, rankAndTrim, weekId } from './aggregate.js';
import { CATALOG } from './catalog.js';

const OUT = 'data/weekly-reports.json';
const MAX_SUBSESSIONS_PER_RUN = 80; // cap per series/run; backlog picked up next run

function loadExisting() {
  try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return { series: {} }; }
}

async function main() {
  const email = process.env.IRACING_EMAIL, password = process.env.IRACING_PASSWORD;
  if (!email || !password) throw new Error('IRACING_EMAIL / IRACING_PASSWORD not set');

  const client = createClient(await login(email, password));

  // car_id -> name
  const cars = await client.get('/data/car/get');
  const carMap = new Map(cars.map(c => [c.car_id, c.car_name]));
  const carName = (id) => carMap.get(id) || `car ${id}`;

  const resolved = await resolveSeasons(client);
  const prev = loadExisting();
  const next = { generatedUtc: new Date().toISOString(), series: {} };

  for (const entry of CATALOG) {
    const info = resolved.get(entry.key);
    const prevSeries = prev.series?.[entry.key];
    // carry forward previous data even if this run can't resolve (off-season safety)
    next.series[entry.key] = prevSeries
      ? structuredClone(prevSeries)
      : { displayName: entry.displayName, category: entry.category,
          multiclass: entry.classes.length > 1, classes: {} };
    if (!info) continue;

    const wid = weekId(info.seasonYear, info.seasonQuarter, info.raceWeekNum);
    const sNode = next.series[entry.key];
    sNode.displayName = entry.displayName;
    sNode.category = entry.category;
    sNode.multiclass = entry.classes.length > 1;

    // Pull NEW subsessions since the earliest class lastFetched (per series).
    const sinceList = entry.classes.map(cl => sNode.classes?.[cl]?.lastFetchedUtc).filter(Boolean);
    const since = sinceList.length ? sinceList.sort()[0] : undefined;
    const searchParams = { season_id: info.seasonId, race_week_num: info.raceWeekNum };
    if (since) searchParams.finish_range_begin = since;
    let subs = [];
    try { subs = await client.getChunked('/data/results/search_series', searchParams); }
    catch (e) { console.warn(`search ${entry.key}:`, e.message); }
    subs = subs.slice(-MAX_SUBSESSIONS_PER_RUN); // newest by default order; cap

    // Accumulate candidates per class for this run.
    const perClass = {};
    for (const cl of entry.classes) perClass[cl] = { qualifying: [], raceLap: [], raceAvg: [] };

    for (const sub of subs) {
      let full;
      try { full = await client.get('/data/results/get', { subsession_id: sub.subsession_id }); }
      catch (e) { console.warn(`results ${sub.subsession_id}:`, e.message); continue; }
      const cand = extractCandidates(full, carName);
      // Route each row to its class by car. For single-class series everything is that class.
      for (const cl of entry.classes) {
        const inClass = (r) => entry.classes.length === 1 ? true : carInClass(r.car, cl);
        perClass[cl].qualifying.push(...cand.qualifying.filter(inClass));
        perClass[cl].raceLap.push(...cand.raceLap.filter(inClass));
        perClass[cl].raceAvg.push(...cand.raceAvg.filter(inClass));
      }
    }

    // Merge into each class node (reset on week change).
    for (const cl of entry.classes) {
      const old = sNode.classes[cl];
      const sameWeek = old && old.weekId === wid;
      const base = sameWeek ? old : { qualifying: [], raceLap: [], raceAvg: [], cars: [] };
      const c = perClass[cl];
      const node = {
        weekId: wid, weekNum: info.raceWeekNum, track: info.track,
        lastFetchedUtc: next.generatedUtc,
        qualifying: mergeLeaderboard(toInternal(base.qualifying), c.qualifying),
        raceLap: mergeLeaderboard(toInternal(base.raceLap), c.raceLap),
        raceAvg: mergeLeaderboard(toInternal(base.raceAvg), c.raceAvg),
      };
      if (sNode.multiclass || entry.classes[0] !== 'Cup' && entry.classes[0] !== 'LMP3') {
        node.cars = mergeCarLeaderboard(toInternal(base.cars), c.raceLap.concat(c.qualifying));
      }
      sNode.classes[cl] = publicizeNode(node);
    }
  }

  mkdirSync('data', { recursive: true });
  writeFileSync(OUT, JSON.stringify(next, null, 2));
  console.log('wrote', OUT);
}

// Single-car classes that should NOT have a cars leaderboard.
const SINGLE_CAR_CLASSES = new Set(['Cup', 'LMP3']);

// Convert public top-N rows back to internal rows for re-merging across runs.
function toInternal(rows) {
  return (rows || []).map(r => ({
    custId: r.custId ?? r._custId ?? hashDriver(r.driver),
    driver: r.driver, irating: r.irating, car: r.car, lapMs: r.lapMs, setAt: r.setAt || 0,
  }));
}
function hashDriver(name) { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }

// Add rank + formatted lap for the file; retain custId/setAt for next run's merge.
function publicizeNode(node) {
  const pub = (list) => rankAndTrim(list, 10).map((r, i) => ({
    ...r, _custId: list[i].custId, setAt: list[i].setAt,
  }));
  const out = {
    weekId: node.weekId, weekNum: node.weekNum, track: node.track,
    lastFetchedUtc: node.lastFetchedUtc,
    qualifying: pub(node.qualifying), raceLap: pub(node.raceLap), raceAvg: pub(node.raceAvg),
  };
  if (node.cars) out.cars = rankAndTrim(node.cars, 10).map((r, i) => ({ ...r, setAt: node.cars[i].setAt }));
  return out;
}

// Placeholder class router for multiclass: map a car model name to a class.
// Implemented properly in Task 10 (uses the resolved car class ids); for now,
// single-class series (the majority) work without it.
function carInClass(_carName, _cl) { return true; }

main().catch(e => { console.error(e); process.exit(1); });
```

> Note: `carInClass` is a deliberate stub here so single-class series work end-to-end first; Task 10 replaces it with real multiclass routing. The two multiclass series (IMSA, Sports Car Challenge) will lump classes together until Task 10 — acceptable for the first live run.

- [ ] **Step 2: First live run (single-class correctness)**

Run: `node scripts/reports/build-reports.js`
Expected: `wrote data/weekly-reports.json`. Open the file; for a single-class series (e.g. `gt3-regional-europe`) confirm `classes.GT3` has a `track`, a `weekId`, and populated `qualifying`/`raceLap`/`raceAvg` arrays with `rank/lap/driver/irating/car`, and `cars` present. Confirm `porsche-cup`/`lmp3-trophy` have **no** `cars` array.

- [ ] **Step 3: Idempotency / incremental run**

Run it again immediately: `node scripts/reports/build-reports.js`
Expected: completes; leaderboards unchanged or only minor additions (it fetched only sessions finished since `lastFetchedUtc`). Confirms incremental fetch + merge don't corrupt or duplicate drivers.

- [ ] **Step 4: Commit**

```bash
git add scripts/reports/build-reports.js data/weekly-reports.json
git commit -m "feat(reports): orchestrator builds weekly-reports.json (single-class)"
```

---

### Task 10: Multiclass car-class routing

**Files:**
- Modify: `scripts/reports/resolve.js`
- Modify: `scripts/reports/build-reports.js`

- [ ] **Step 1: Capture the car-class mapping**

Each iRacing season exposes its `car_class_ids` and there is `/data/carclass/get` (car_class_id → {name, cars_in_class:[{car_id}]}). Add to `resolveSeasons` output a per-series `carClasses` map of `className -> Set(car_id)` derived from `/data/carclass/get` filtered to the season's classes. Verify names map to our labels (`GTP`, `LMP2`, `GT3`, `GT4`, `LMP3`).

Create throwaway `scripts/reports/_smoke-carclass.js`:

```js
import { login } from './iracing-auth.js';
import { createClient } from './iracing-client.js';
const c = createClient(await login(process.env.IRACING_EMAIL, process.env.IRACING_PASSWORD));
const cc = await c.get('/data/carclass/get');
for (const k of cc) console.log(k.car_class_id, k.name, k.short_name, '-', (k.cars_in_class||[]).length, 'cars');
```

Run it; note the `name`/`short_name` for GTP, LMP2, GT3, GT4, LMP3. Delete after.

- [ ] **Step 2: Add a label→car_id resolver to `resolve.js`**

Append to `resolve.js`:

```js
// Maps our class labels to the set of car_ids in that iRacing car class.
const LABEL_ALIASES = {
  GTP: ['gtp', 'gt1'], LMP2: ['lmp2'], GT3: ['gt3'], GT4: ['gt4'], LMP3: ['lmp3'],
  Cup: ['porsche 911', 'cup'],
};
export async function resolveCarClasses(client) {
  const cc = await client.get('/data/carclass/get'); // [{name, short_name, cars_in_class:[{car_id}]}]
  const labelToCarIds = {};
  for (const [label, aliases] of Object.entries(LABEL_ALIASES)) {
    const ids = new Set();
    for (const k of cc) {
      const hay = `${k.name} ${k.short_name}`.toLowerCase();
      if (aliases.some(a => hay.includes(a))) for (const c of (k.cars_in_class || [])) ids.add(c.car_id);
    }
    labelToCarIds[label] = ids;
  }
  return labelToCarIds; // { GT3: Set(...), GTP: Set(...), ... }
}
```

- [ ] **Step 3: Wire real class routing into `build-reports.js`**

In `build-reports.js`: import `resolveCarClasses`, build `const labelToCarIds = await resolveCarClasses(client);` after creating the client, store `car_id` on candidate rows, and replace the stub:

```js
// at top of main(), after client:
import { resolveCarClasses } from './resolve.js'; // add to imports
// ...
const labelToCarIds = await resolveCarClasses(client);
```

Change `extract.js` `rowFrom` to also keep `carId: r.car_id` (add the field), then replace `carInClass`:

```js
function carInClass(row, cl) {
  const ids = labelToCarIds[cl];
  return ids ? ids.has(row.carId) : true;
}
```

Update the two `.filter(inClass)` call sites to pass the row (they already do) and ensure `perClass[cl].*.push(...cand.X.filter(r => carInClass(r, cl)))`.

- [ ] **Step 4: Live run — verify multiclass split**

Run: `node scripts/reports/build-reports.js`
Expected: `imsa-open` now has distinct `classes.GTP`, `classes.LMP2`, `classes.GT3`, each with class-appropriate cars (no GT3 cars in the GTP leaderboard). `sports-car-challenge` splits into `GT4` and `LMP3`.

- [ ] **Step 5: Commit**

```bash
git add scripts/reports/resolve.js scripts/reports/build-reports.js scripts/reports/extract.js scripts/reports/extract.test.js
git commit -m "feat(reports): multiclass car-class routing"
```

---

### Task 11: GitHub Action workflow (schedule + commit-if-changed)

**Files:**
- Create: `.github/workflows/weekly-reports.yml`

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/weekly-reports.yml
name: weekly-reports
on:
  schedule:
    - cron: '*/15 * * * *'   # every 15 min (GitHub best-effort)
  workflow_dispatch:          # manual "Run workflow" button
concurrency:
  group: weekly-reports
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Run pure-logic tests
        run: npm test
      - name: Build weekly reports
        env:
          IRACING_EMAIL: ${{ secrets.IRACING_EMAIL }}
          IRACING_PASSWORD: ${{ secrets.IRACING_PASSWORD }}
        run: node scripts/reports/build-reports.js
      - name: Commit if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/weekly-reports.json
          if git diff --staged --quiet; then
            echo "No changes to commit."
          else
            git commit -m "chore: update weekly reports [skip ci]"
            git push
          fi
```

- [ ] **Step 2: Commit + push**

```bash
git add .github/workflows/weekly-reports.yml
git commit -m "ci(reports): scheduled weekly-reports workflow"
git push
```

- [ ] **Step 3: Manual trigger test**

In GitHub → **Actions** tab → **weekly-reports** → **Run workflow** → Run.
Expected: green run; the "Build weekly reports" step logs `wrote data/weekly-reports.json`; the commit step either commits an update or says "No changes to commit." Confirm `data/weekly-reports.json` in the repo shows a recent `generatedUtc`.

- [ ] **Step 4: Confirm secrets are set**

If the run fails at "Build weekly reports" with a creds error, add the repo secrets `IRACING_EMAIL` / `IRACING_PASSWORD` (Settings → Secrets and variables → Actions) and re-run.

- [ ] **Step 5: Verify it's reachable from the live site**

In a browser: open `https://ajacoby27.github.io/Primus-systems/data/weekly-reports.json`
Expected: the JSON loads (proves Pages serves it same-origin for Plan 2's `fetch`).

---

### Task 12: Hardening + housekeeping

**Files:**
- Modify: `scripts/reports/build-reports.js`
- Modify: `.gitignore` (create if absent)

- [ ] **Step 1: Add a global guard so one bad series can't fail the whole run**

In `build-reports.js`, wrap the per-`entry` body of the `for (const entry of CATALOG)` loop in `try { ... } catch (e) { console.warn(\`series \${entry.key} failed:\`, e.message); }` so a single failing series logs and continues (the others still publish).

- [ ] **Step 2: Confirm off-hours no-op produces no commit**

Run locally twice with no new sessions (e.g. immediately back-to-back): `node scripts/reports/build-reports.js`
Then: `git diff --stat data/weekly-reports.json`
Expected: only `generatedUtc` differs (or nothing). Acceptable. (The workflow's `git diff --staged --quiet` already skips commits when only whitespace/nothing changed; if you want to also skip on `generatedUtc`-only diffs, that's a future optimization — not required.)

- [ ] **Step 3: Add `.gitignore` for throwaway smoke files**

Create/append `.gitignore`:

```
node_modules/
scripts/reports/_smoke-*.js
scripts/reports/_capture.js
```

- [ ] **Step 4: Commit**

```bash
git add scripts/reports/build-reports.js .gitignore
git commit -m "chore(reports): per-series error isolation + gitignore"
git push
```

- [ ] **Step 5: Final verification**

- `npm test` → all pure-logic tests pass.
- Actions → manual run → green, JSON updated.
- `https://ajacoby27.github.io/Primus-systems/data/weekly-reports.json` → loads with all resolved series, correct multiclass split, single-car classes without `cars`.

The pipeline is complete. **Plan 2 (the Primus Reports view)** consumes this JSON.

---

## Self-Review

**Spec coverage:**
- §2 architecture (Action → JSON, same-origin) → Tasks 11, 9.
- §3 catalog + class selection → Task 2 (catalog), Task 10 (multiclass routing).
- §4 top-10 leaderboards (qual/race/avg/cars) + single-car-class hides cars → Tasks 4, 8, 9 (`SINGLE_CAR_CLASSES`/cars omission).
- §5 incremental running tally, week rollover, commit-if-changed, SOF cap → Task 9 (`since`, `weekId` reset, `MAX_SUBSESSIONS_PER_RUN`), Task 11 (commit-if-changed).
- §6 auth/link/chunk/lap-units/secrets → Tasks 5, 6, 3, 11.
- §7 JSON shape → Task 9 (`publicizeNode`).
- §8 UI → **Plan 2** (intentionally out of scope).
- §9 edge cases (rollover, off-season carry-forward, missing car name, ties) → Tasks 9, 12, 4 (tie tiebreaker `setAt`).

**Placeholder scan:** `carInClass` is an intentional, clearly-labelled stub in Task 9 that Task 10 replaces — not a hidden TODO. No other placeholders.

**Type consistency:** internal row shape `{custId, driver, irating, car, lapMs, setAt}` is consistent across `aggregate.js`, `extract.js`, `build-reports.js`. `weekId(year,quarter,week)` signature consistent. `publicizeNode`/`toInternal` round-trip retains `custId`/`setAt` via `_custId`. Task 10 adds `carId` to the row shape and to `extract.js` — noted explicitly.

**Known live-verification points** (flagged in-task, expected for an external API): exact iRacing field names in `extract.js` (Task 8 fixture step), real `series_name` strings for catalog matching (Task 7), and car-class label aliases (Task 10).
