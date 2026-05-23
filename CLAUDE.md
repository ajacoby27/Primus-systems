# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Primus Systems is a standalone iRacing car setup tuning tool. It analyzes setup parameters, interprets handling complaints, and outputs specific adjustment recommendations per car class and track condition.

**There is no build system.** The entire application is a single self-contained file: `primus-v17 (1).html`. Open it in any modern browser to run. No npm, no compilation, no dependencies.

## Architecture

### Single-File Structure

All HTML, CSS, and JavaScript live in `primus-v17 (1).html`. The file is organized into sections:

- **CSS block** — custom theme using CSS variables, Barlow/Barlow Condensed fonts (Google Fonts CDN)
- **Data layer** — `SETUP_SCHEMA`, `tracks[]`, `allIssues[]` hardcoded at the top of the script
- **Core logic functions** — parsing, adjustment, conflict resolution
- **UI functions** — wizard navigation, form building, file handling
- **Event wiring** — at the bottom of the script

### Wizard Flow (4 Panels)

1. **Track & Car** — user selects track (autocomplete from `tracks[]`), car class, specific car, and conditions
2. **Current Setup** — drag-drop iRacing HTML export or manual entry; `parseSetup()` populates the form; `buildSetupGrid(carClass)` renders fields from `SETUP_SCHEMA`
3. **Issues & Style** — user adds handling complaints (understeer, oversteer, etc.) with severity and corner location
4. **Results** — `generate()` runs the full pipeline and renders the recommendation report

### Key Data Structures

- **`SETUP_SCHEMA`** — per-car-class field definitions: name, units, min/max, step, format type, default. Car class keys: `P992`, `F296`, `AMGT3`, `CORVGT3`, `MERGT3`, `BMWGT3`, `FORDGT3`, `MCLGT3`, `LAMBOGT3`, `ACRGT3`, `AUDIIGT3`, `LMP2`, `F499P`, `P963GTP`
- **`tracks[]`** — 30+ track objects with surface type, downforce level, corner definitions, and temperature metadata
- **`allIssues[]`** — issue library mapping complaint keywords → adjustment rules per car class and corner

### Adjustment Pipeline (`generate()`)

1. `readCurrent(carClass)` — reads form values into a setup object `v`
2. `processIssues(issues, v, track, cc)` — iterates issues, calls `applyOneIssue()` per issue
3. `applyOneIssue()` — maps issue + car class + corner → delta values
4. `detectConflicts()` / `resolveConflicts()` — finds contradictory deltas and prioritizes them
5. `limitCheck(changes, v, cc)` — clamps adjustments to per-field min/max from `SETUP_SCHEMA`
6. Renders HTML result table with before/after values

### Parsing iRacing Exports

`parseSetup(content, filename)` uses regex-based extraction to pull values from iRacing's HTML setup export format. Each car class has its own extraction patterns. Falls back to manual input if parsing fails.

### Unit System

`setUnits(u)` toggles globally between metric and imperial. `fmt(val, type)` and `fmtTemp(celsius)` handle per-field formatting with conversion. All internal values are stored in metric; conversion happens at display time.

### Formatting Types

Fields in `SETUP_SCHEMA` declare a `fmt` type that controls how values are rendered: `arb` (ARB click positions), `spring`, `pressure`, `camber`, `toe`, `clicks`, `deg`, etc.

## Making Changes

When editing setup adjustment logic, changes must be made in both the `allIssues[]` data and in `applyOneIssue()` if a new issue category is added.

When adding a new car class:
1. Add its schema to `SETUP_SCHEMA`
2. Add parsing patterns in `parseSetup()`
3. Add adjustment rules to `allIssues[]` entries for that class key
4. Register the car in `buildCarPicker()` and the car class selector UI

The tyre pressure fields are intentionally excluded from adjustment output — the tool deliberately does not recommend tyre pressure changes.
