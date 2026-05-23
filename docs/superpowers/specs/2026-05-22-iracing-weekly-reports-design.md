# iRacing Weekly Reports — Design Spec

**Date:** 2026-05-22
**Project:** Primus Systems (a.k.a. "Jacoby Setup Engineering") — single-file iRacing setup tool
**Feature:** A "Reports" view that shows the current race week's fastest laps (with driver name + iRating) for the sportscar series the tool covers, in the style of iracingreports.com.

---

## 1. Goal

Let a Primus user pick an iRacing sportscar series (and class, when the series is multiclass) and see **top-10 leaderboards** for the **current race week**:

- Top 10 **Fastest Qualifying** laps
- Top 10 **Fastest Race** laps
- Top 10 **Best Race Average** laps
- Top 10 **Fastest Cars** (car models ranked by best lap) — multi-car classes only

Every leaderboard row shows: **rank · lap time · driver name · iRating · car model**. Each report is for the **one track** running that series' current week.

---

## 2. Architecture (decided)

```
GitHub Action (cron, every 15 min, in the ajacoby27/Primus-systems repo)
   ├─ logs into iRacing /data API (creds from GitHub Secrets)
   ├─ for each series+class: pulls NEW finished sessions since last run
   ├─ merges each driver's best qual/race/avg lap into a running weekly tally
   ├─ resets the tally when the race week rolls over
   └─ writes data/weekly-reports.json   (commit only if changed)

GitHub Pages (same repo) serves both:
   ├─ index.html  (Primus)  ──fetch('data/weekly-reports.json')──┐
   └─ data/weekly-reports.json  ◄───────────────────────────────┘  (same-origin, no CORS)
```

> **Pages path gotcha:** the site is served from a subpath (`https://ajacoby27.github.io/Primus-systems/`), so Primus must fetch the JSON with a **relative** path (`data/weekly-reports.json`), NOT a leading-slash absolute path (`/data/...` would resolve to `ajacoby27.github.io/data/...` and 404).

- **Cost:** $0 (public repo → free unlimited Actions + free Pages). iRacing API is free with membership.
- **No backend, no server to keep alive.** Primus stays a static page that fetches one JSON file.
- **Why this and not an always-on backend:** for weekly data the user experience is identical (fetch a JSON), and there's nothing to host/patch. An always-on backend is only worth it later for live, on-demand, per-user lookups (see §10, out of scope).

---

## 3. Series catalog + selection model

The user drills in: **series → class (only if multiclass) → report**. ~12 distinct series:

| Category | Series (display name) | iRacing series | Class selection |
|---|---|---|---|
| IMSA | IMSA — Open | IMSA iRacing Series (open) | **GT3 / LMP2 / GTP** |
| IMSA | IMSA — Fixed | IMSA iRacing Series — Fixed | **GT3 / LMP2 / GTP** |
| GT3 | GT3 Regional Tour — Americas | GT3 Regional Tour - Americas | — (GT3) |
| GT3 | GT3 Regional Tour — Europe | GT3 Regional Tour - Europe | — (GT3) |
| GT3 | GT3 Regional Tour — Asia Pacific | GT3 Regional Tour - Asia Pacific | — (GT3) |
| GT3 | GT3 Challenge — Fixed | GT3 Challenge Fixed by Fanatec | — (GT3) |
| GT3 | GT Sprint Series | GT Sprint Series by Simucube | — (GT3) |
| Porsche Cup | Porsche Cup | iRacing Porsche Cup by CONSPIT | — (992 Cup) |
| Porsche Cup | Porsche Cup — Fixed | iRacing Porsche Cup - Fixed by CONSPIT | — (992 Cup) |
| GT4 | GT4 Challenge | GT4 Challenge by Falken Tyre | — (GT4) |
| GT4 / LMP3 | Sports Car Challenge | Sports Car Challenge by Falken Tyre | **GT4 / LMP3** (multiclass) |
| LMP3 | LMP3 Trophy | LMP3 Trophy | — (LMP3) |

Notes:
- **Sports Car Challenge** is one multiclass series; it appears under both the GT4 and LMP3 categories in the picker, and the user picks the class. Internally it is one series with two class views.
- Exact iRacing `series_id` / `season_id` values are resolved at build time from `/data/series/get` + `/data/season/list` (see §6); the catalog above is keyed by series name and category so the Action can map them.
- The picker UI mirrors the existing two-level car picker style (category → series, then class pills if multiclass).

---

## 4. Report content (top-10 leaderboard model)

For the selected **series + class**, the report shows the current week's track and four toggleable leaderboards:

```
GT3 Regional Tour — Europe   ·   Week 7   ·   Spa-Francorchamps     updated 12 min ago

[ Fastest Qualifying ]  [ Fastest Race Lap ]  [ Best Race Avg ]  [ Fastest Cars ]

Top 10 — Fastest Qualifying Laps (this week)
 1.  2:16.421   J. Verstappen    iR 4820    Ferrari 296 GT3
 2.  2:16.510   M. Rossi         iR 3990    Porsche 911 GT3 R
 ...
 10. 2:17.044   ...
```

- Each toggle swaps the table for that category's top 10.
- Row = **rank · lap time · driver name · iRating · car model**.
- **Best Race Average** = the 10 lowest race average-lap times of the week (per driver, deduped to their best).
- **Fastest Cars** = car models ranked by the best single lap set in that car this week, each tagged with the driver who set it. **Hidden for single-car classes** (Porsche Cup, LMP3 Trophy) — only the lap leaderboards show there.
- All leaderboards dedupe by driver to that driver's **best** value for the week (a driver appears at most once per leaderboard).

---

## 5. Data pipeline (the GitHub Action)

**Cadence:** every 15 minutes (`*/15` cron). GitHub schedules are best-effort, so real freshness is "usually ~15 min, occasionally 25–30 min when GitHub delays the run." End-to-end latency ≈ cron interval + ~5 min (aggregate + commit + Pages redeploy + cache-bust).

**Running weekly tally (incremental):**
1. Read the existing `weekly-reports.json` (it doubles as the Action's state — it holds each leaderboard plus `lastFetchedUtc` and the current `weekId` per series+class).
2. For each series+class, determine the current `season_id` + `race_week_num` + track from the season schedule.
3. If the week changed since last run → **reset** that series+class's tally to the new week/track (empty leaderboards).
4. Query `/data/results/search_series` for sessions **finished since `lastFetchedUtc`** (only-new), for this season + race week.
5. For each new subsession, fetch `/data/results/get` and read every driver's best qual lap, best race lap, average lap, iRating, car, and name.
6. Merge candidates into the leaderboards (dedupe by driver, keep best; retain a small buffer of ~15 internally for safety, expose top 10).
7. Update `lastFetchedUtc`, write the file. **Commit only if the JSON actually changed** (avoids ~96 empty commits/day; during off-hours with no new sessions, nothing is committed).

**Load management / rate limits:**
- Incremental fetching keeps each run's batch small.
- Prioritize higher-strength-of-field splits (where the fastest laps essentially always are). Cap sessions processed per run if a backlog appears; the next run picks up the rest.
- Respect iRacing rate-limit headers (`x-ratelimit-remaining` / reset) with backoff.
- **Honest caveat:** results are "top-10 **observed**," which in practice equals the true top 10, but we do not claim to read literally every backmarker split.

---

## 6. iRacing /data API specifics (known gotchas for implementation)

- **Auth:** `POST https://members-ng.iracing.com/auth` with `{email, password}`, where `password = base64( SHA256( plaintextPassword + email.toLowerCase() ) )`. Returns an auth cookie used on subsequent requests.
- **Indirection:** most `/data/...` endpoints return a JSON containing a `link` to a signed S3/CDN URL that holds the real payload; some return **chunked** data (`data.chunk_info` listing chunk file URLs to fetch + concatenate). The client must follow these.
- **Endpoints used:**
  - `/data/series/get` — all series → map catalog names to `series_id`.
  - `/data/season/list?season_year=&season_quarter=` (and/or `/data/series/seasons`) — active `season_id`, `race_week_num`, and the week's track per series.
  - `/data/results/search_series` — list subsessions for a season + race week; supports `finish_range_begin/end` for only-new fetching; chunked.
  - `/data/results/get?subsession_id=` — per-driver results: best qual lap, best (race) lap, average lap, iRating, `car_id`, `display_name`.
  - `/data/car/get` — `car_id` → friendly car name.
- **Lap-time units:** lap times come as integer 10,000ths of a second → divide by 10000, format `m:ss.mmm`. Handle `-1`/`0` as "no time."
- **Credentials:** stored as **GitHub Secrets** (`IRACING_EMAIL`, `IRACING_PASSWORD`); never in the client, never committed.

---

## 7. JSON data shape (`data/weekly-reports.json`)

Compact map the page reads directly:

```json
{
  "generatedUtc": "2026-05-22T14:15:00Z",
  "series": {
    "gt3-regional-europe": {
      "displayName": "GT3 Regional Tour — Europe",
      "category": "GT3",
      "multiclass": false,
      "classes": {
        "GT3": {
          "weekId": "2026-2-7",
          "weekNum": 7,
          "track": "Spa-Francorchamps",
          "lastFetchedUtc": "2026-05-22T14:14:30Z",
          "qualifying": [
            { "rank": 1, "lapMs": 1364210, "lap": "2:16.421",
              "driver": "J. Verstappen", "irating": 4820, "car": "Ferrari 296 GT3" }
          ],
          "raceLap": [ ... ],
          "raceAvg": [ ... ],
          "cars":   [ ... ]
        }
      }
    },
    "imsa-open": {
      "displayName": "IMSA — Open", "category": "IMSA", "multiclass": true,
      "classes": { "GTP": { ... }, "LMP2": { ... }, "GT3": { ... } }
    }
  }
}
```

- Single-car classes omit the `cars` array.
- Pre-formatted `lap` string is included for display; `lapMs` retained for sorting/robustness.

---

## 8. Primus "Reports" view (UI)

- **Placement:** a new top-level view, reachable from the app header, **separate from the 4-panel setup wizard** (Track & Car → Current Setup → Issues & Style → Results). It does not interfere with the existing setup flow. (Confirm placement in review.)
- **Controls:** a **series search box with autocomplete/typeahead** — the user starts typing and the ~12 series filter live (e.g. "spa"… "gt3"… "porsche"), exactly like the existing **track selector** in the setup wizard. Reuse that same autocomplete logic for consistency. Selecting a series reveals **class pills only when the series is multiclass** (IMSA, Sports Car Challenge). Matching is forgiving (case-insensitive, matches on series name, category, and class keywords).
- **Report card:** header (series · week · track · "updated N min ago"), the four toggles, and the active top-10 table.
- **States:**
  - **Loading** — while fetching the JSON.
  - **Empty / early week** — "No laps recorded yet for this week" (week just rolled over, tally still filling).
  - **Stale** — if `generatedUtc` is old (e.g. > a few hours), show a subtle "data may be delayed" note.
  - **Error** — "Couldn't load reports right now" if the fetch fails.
- **Cache-busting:** fetch with a `?t=<timestamp>` query (or `cache: 'no-store'`) so users aren't stuck on a stale CDN/browser copy.
- **Styling:** matches the existing Primus theme (Barlow fonts, CSS variables) and stays inside the single HTML file — no new dependencies.

---

## 9. Edge cases

- **Week rollover** mid-day → tally resets to the new week/track; old leaderboards discarded.
- **Off-season / no active week** for a series → report shows the empty state for that series.
- **Driver name privacy:** display names come straight from results; no extra handling.
- **Ties** on lap time → stable order by earliest-set, then driver name.
- **Missing car name** (new car not yet in the `car_id` map) → fall back to the raw `car_id` label; refresh the map.
- **JSON missing/204 on first ever run** → page shows the empty/error state gracefully.

---

## 10. Out of scope (v1) / future

- **Always-on backend** + live, on-demand per-driver lookups (the only reason to pay ~$5/mo later).
- **Expanding coverage** beyond the sportscar catalog to all road series (formula, touring, etc.).
- **History / trends** across weeks (v1 is current week only).
- **Filtering by region/SOF/license** within a leaderboard.
- **Hooking reports into the setup engine** (e.g., "fastest car this week → load its setup").

---

## 11. Key risks

1. **Aggregation volume / rate limits** — busy series have many sessions/week. Mitigated by incremental fetching, SOF prioritization, per-run caps, and backoff. This is the main engineering risk and the reason v1 seeds a few series before scaling the catalog.
2. **GitHub cron reliability** — best-effort; freshness can occasionally slip past 15 min. Accepted.
3. **iRacing API shape changes** — endpoints/auth can change; isolate API access behind one module so fixes are localized.
4. **Series/season ID drift** each season — resolve IDs dynamically by name each run rather than hard-coding.

---

## 12. Build order (for the implementation plan)

1. Stand up the Action skeleton: auth + a single `/data/series/get` call → commit a tiny JSON, prove the pipeline end-to-end on **one** series+class.
2. Add schedule/week + `search_series` (incremental) + `results/get` aggregation for that one series.
3. Add the running weekly tally + week rollover + commit-if-changed + 15-min cron.
4. Build the Primus Reports view against the JSON (one series first).
5. Scale the catalog to all ~12 series, add multiclass class handling.
6. Polish: states, cache-busting, "updated N min ago", styling.
