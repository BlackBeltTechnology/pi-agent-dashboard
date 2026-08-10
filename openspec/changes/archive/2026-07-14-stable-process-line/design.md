# Design — stable-process-line

## Context

The PROCESS subcard today (post `redesign-process-list-activity-bar` + `persist-process-drawer-collapse`) is:

```
ProcessSubcard(activity, processes)             // SessionCard.tsx
  if (!hasActivity && !hasProcesses) return null // ← full unmount = grid reflow
  <SessionSubcard title="PROCESS">
    <SessionActivityBar tools/>                   // always-open, 0..N raw rows
    <ProcessList expanded={…} onToggle/>          // own ⚠N summary + collapsible body
```

`ProcessList` already owns the pattern we want (one summary line → expand, per-session persisted collapse via `useDrawerExpansion` → `processDrawerCollapsed`). The instability comes from (a) the `return null` full unmount and (b) `SessionActivityBar` rendering raw rows with no fixed reservation.

Mockup (approved): `openspec/changes/stable-process-line/mockups/index.html` — BEFORE 134px (jumps) vs AFTER 83px stable; toggle `reserveProcessLineAtIdle` to compare idle policies.

## Goals

1. Tool start/stop never reflows the grid (height is not a function of tool count).
2. One line by default; full detail on demand; expand state remembered per session.
3. Idle reservation is a user preference, not a hardcoded pick.
4. Reuse existing persistence + collapse machinery; no new server surface.

## Decisions

### D1 — Unified summary line, not two stacked surfaces
Collapse `SessionActivityBar` + `ProcessList` into ONE summary line inside `ProcessSubcard`. Collapsed line:

```
▸ ⏵ <primary running cmd>   [N running · ⚠M]   <elapsed>
```

- Primary command = newest in-flight bash (matches `selectInflightBashTools` newest-first). When zero bash running but bg processes exist: `▸ ⚠ M background process(es)`. When fully idle: `▸ ⏵ idle`.
- Counts pill is stable-width-ish and only shows segments that apply (`2 running`, `⚠1`, or both).
- Expanded body (below the line): all in-flight bash rows (each `⏹` → session abort, as today) then all bg-process rows (each `✕` → `killProcess(pgid)`, as today). Verbs and their targets are unchanged from the prior redesign — only the container changes.

### D2 — Reuse `useDrawerExpansion` for the whole region
The one expand/collapse toggle drives the whole PROCESS body and persists via the existing `processDrawerCollapsed` meta field. No new persistence key. The contextual default (open when activity empty) is dropped in favour of "collapsed by default, remembered per session" — simpler and matches the persisted value's intent.

### D3 — `reserveProcessLineAtIdle` as a global DisplayPref
Add to `DisplayPrefs` exactly like `contextUsageBar`:

```ts
// display-prefs.ts
interface DisplayPrefs { … reserveProcessLineAtIdle: boolean }
DISPLAY_PRESETS: simple=false, standard=false, everything=true
mergeDisplayPrefs: override.reserveProcessLineAtIdle ?? global.reserveProcessLineAtIdle
```

Consumer:
```ts
const prefs = useDisplayPrefs(session.id);          // global ⊕ per-session override
// ProcessSubcard:
if (!hasActivity && !hasProcesses && !prefs.reserveProcessLineAtIdle) return null;
// else render the reserved one line (idle text when both empty)
```

- OFF (default for simple/standard): behaves like today between runs — subcard mounts on first tool (one jump), then stable for the run's duration. This already removes the per-tool flicker (the worst part) because the line is fixed-height during the run.
- ON (everything preset): the line is reserved even at idle → zero jump ever, at the cost of a permanent thin line on quiet cards.
- Global toggle in `SettingsPanel`; per-session override row in `ChatViewMenu` (marked when overridden), mirroring `contextUsageBar` wiring one-for-one.

### D4 — Extract a shared `collapse-summary` helper (DRY)
`ProcessList` already has the summary-row + `+N overflow` logic (`computeVisibleRows`). Extract the summary-row primitive so the activity rows and the bg rows share one collapse presentation instead of two hand-rolled ones.

### D5 — Mobile unchanged in spirit
`MobileProcessSubcard` already uses a compact activity bar + a `⚠ N` chip → bottom-sheet, which does not reflow the grid the way the desktop stack does. Scope the reserve-at-idle behaviour to desktop; mobile keeps its chip/sheet. (Revisit only if the compact activity bar itself is shown to jump.)

## Non-Goals

- Per-toolCall abort wire protocol (still Phase-2 of the prior change; `⏹` stays session-abort).
- PGID↔toolCall dedup (Phase-2); an active bash may still appear in both the activity rows and the bg rows when expanded — unchanged known cosmetic issue.
- Any bridge / server change.

## Risks

- **Idle text noise.** A permanent `⏵ idle` line on every card (when pref ON) could feel noisy. Mitigated by defaulting OFF for simple/standard; ON only for the opt-in "everything" preset.
- **Snapshot churn.** `SessionCard.test.tsx` snapshots change. Acceptable; update in the same change.
- **Counts-pill width jitter** (`1 running` → `2 running`) is sub-pixel vs the row-count reflow it replaces; acceptable, and the pill can be min-width'd if needed.

## Test Strategy

- Unit: `mergeDisplayPrefs` carries the new field; presets have expected values.
- Component: `SessionActivityBar` contributes running count + rows; `ProcessList` contributes bg count + rows; shared collapse-summary renders summary vs expanded.
- Regression (the point of the change): render `ProcessSubcard`, measure/assert the collapsed subcard height is invariant across `activity=[]`, `activity=[1]`, `activity=[1,2,3]` when the summary is collapsed (height must not depend on tool count).
- Pref gating: with `reserveProcessLineAtIdle=false` and both surfaces empty → returns null; with `true` → renders the reserved idle line.
