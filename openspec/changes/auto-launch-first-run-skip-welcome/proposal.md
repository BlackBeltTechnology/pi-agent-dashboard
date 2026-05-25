# Auto-launch on first run; remove the welcome-click gate

## Why

The first-run wizard is currently a single screen with a single button (`[Launch dashboard]`) and an `Advanced` disclosure for connecting to a remote server. Reading `packages/electron/src/renderer/wizard.html`:

- The primary button does nothing functional except writing the first-run marker and closing the window. The actual server spawn happens in `main.ts` *after* `await showWelcomeStep()` returns. So the user clicks a button to … unblock a `Promise.resolve`.
- The `Advanced` disclosure offers "connect to an existing server" — but this duplicates `packages/client/src/components/KnownServersSection.tsx` (Settings → Network → Known Servers), which the user can reach any time post-launch. The wizard's remote-attach path doesn't even persist to known-servers; it just sets a one-shot `lastVerifiedUrl` in renderer state.

Net effect: every fresh install forces a click that 99% of users don't think about, and 1% who want remote-attach get a second, more capable UI in Settings anyway. The wizard is friction without value.

Two concrete pain-points the wizard's existence amplifies:

1. **`fix-wizard-occluded-by-splash` exists at all.** That whole class of bug (alwaysOnTop splash hiding the wizard) only matters because the wizard is in the critical path. Remove the wizard from the critical path and the splash can stay as a pure progress indicator with no overlap.
2. **Defender first-launch scan timing.** Currently: splash flashes "Preparing first launch…", wizard appears, user clicks, splash flashes "Launching dashboard server…", server boots over 60-120s. With auto-launch: splash shows continuous progress through the same period. Same wall time, dramatically better UX — the user perceives the app as "starting" instead of "interrupting".

## What Changes

- **Remove the `wizard-welcome` state** from the 6-state startup machine in `packages/electron/src/main.ts`. The state machine collapses from `check-health → (attach | wizard → spawn) → health-wait → done` to `check-health → (attach | spawn) → health-wait → done`.
- **Delete `showWelcomeStep()`** and its call site at `main.ts:418-424`.
- **Move first-run-marker write** to post-`done` (right before the existing defensive write at `main.ts:469-477` — that block already handles it; just keep it as the sole writer).
- **Keep the marker file** at `~/.pi/dashboard/first-run-done` for backwards compatibility (Doctor reads it; other tooling MAY rely on it). Semantics change from "user clicked Launch" to "first successful launch completed".
- **Delete the wizard window infrastructure**:
  - `packages/electron/src/lib/wizard-window.ts` — no longer needed.
  - `packages/electron/src/lib/wizard-ipc.ts` (`registerWizardIpc`, `writeFirstRunMarker` exports) — the marker writer moves to `main.ts` directly or to a new tiny helper module. The `wizard:complete` IPC handler disappears.
  - `packages/electron/src/renderer/wizard.html` — deleted.
  - `packages/electron/src/preload.ts` — remove the `wizardApi` / `completeWizard` exposure. Other surfaces on `preload.ts` (loading-page IPC `piDashboard`) stay.
- **Splash stays exactly as it is** post `fix-wizard-occluded-by-splash`. Status text now flows uninterrupted: `"Starting…"` → `"Launching dashboard server…"` → `"Opening dashboard…"`. The "Preparing first launch…" status string disappears (it was a wizard-gate label; now nothing waits for user input).
- **Re-home the `Advanced: connect to an existing server` path**:
  - The known-servers UI in Settings already covers this functionally. Add a one-line callout link in the loading-page (`resources/loading.html`) — only visible when the loading page sits open for >5 seconds — saying "Connect to an existing dashboard instead → Settings → Network". (Out of scope for this proposal — tracked as `add-loading-page-remote-attach-link`.)
- **Update tests**:
  - Delete `packages/electron/src/__tests__/wizard-launch-ordering.test.ts` — the invariant it pinned (close-splash-before-open-wizard) becomes vacuously true (no wizard to occlude).
  - Update `docs/electron-bootstrap-flow.md` state diagram + table (delegated to subagent per AGENTS.md).
- **Sequencing**: lands cleanly on top of `fix-wizard-occluded-by-splash`. If we land both in the same release, the world-line is: `fix-wizard-occluded-by-splash` ships a working wizard, then `auto-launch-first-run-skip-welcome` deletes it. Some might call this wasteful; the alternative is shipping the bug-fix as part of the deletion. Splitting reduces risk: each PR has a single concern, and if the deletion needs to be reverted for any reason (e.g. someone discovers a legitimate use of the wizard in beta testing), reverting just this proposal leaves the splash-occlusion fix in place.

## Capabilities

### Modified Capabilities

- `first-run-wizard`: most of its requirements are REMOVED. Two requirements survive in spirit but reattach to the loading-page surface: "first-run marker is written on first successful launch" and "remote-attach is reachable via Settings/known-servers". A migration note in the spec spells out the removal.

### Modified (renamed) Capability

- `first-run-wizard` is effectively dissolved by this change. Its surviving requirements migrate to:
  - `electron-launch-source` — first-run marker write semantics
  - `dashboard-server` / `electron-shell` — splash status text contract

  For now the capability is left as a stub with all-REMOVED requirements; a follow-on cleanup change can delete the spec dir entirely once nothing references it.

## Impact

- **User-visible**: fresh install → splash appears → server starts → dashboard window opens. No click required. Wall-clock time identical to today (still bounded by Defender scan + jiti boot), but perceived as one continuous flow instead of "wait → click → wait".
- **Code scope**: net deletion. Lines removed: ~180 (wizard.html) + ~60 (wizard-window.ts) + ~40 (wizard-ipc.ts) + ~15 (main.ts wizard arm + showWelcomeStep) + ~30 (preload.ts wizardApi block) + ~150 (`fix-wizard-occluded-by-splash`'s test that's now obsolete). Lines added: ~10 (move marker write inline in main.ts done-state). Net ≈ −465 LOC.
- **Risk**: low — the wizard's only functional output (the marker) is preserved, just written one step later. The remote-attach UI it offered is already duplicated in Settings.
- **Backwards compatibility**: the `~/.pi/dashboard/first-run-done` marker remains a stable contract. Users with the marker already present see no behavioural change. Users without it on a fresh install now get it written automatically post-launch instead of via the wizard click.
- **Telemetry / Doctor**: Doctor's `Managed install` row reads the marker; still works. No other consumers in the repo per grep.
- **Out of scope**:
  - The loading-page "Connect to existing dashboard" callout — its own follow-up.
  - Deleting the `first-run-wizard` spec dir — a follow-up sweep change.
  - Any change to the splash window's appearance or status strings beyond removing "Preparing first launch…".
- **Sequencing notes**:
  - Depends on `fix-wizard-occluded-by-splash` being landed first (so production isn't broken on Windows while this change is in review).
  - Does NOT depend on `add-wizard-launch-progress-log` — that proposal targets the splash's status feedback. The splash continues to exist; only the wizard goes away. The two proposals are independent and `add-wizard-launch-progress-log` becomes simpler (no wizard window to also stream into).
