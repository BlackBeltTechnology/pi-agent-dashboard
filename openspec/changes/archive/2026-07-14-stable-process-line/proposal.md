## Why

During a run the session card's **PROCESS subcard changes height constantly**. It mounts when the first `bash` tool starts, grows a row per concurrent tool, shrinks as tools finish, and unmounts entirely when the session goes idle. Because the card is a grid `<li>`, every mount/unmount reflows the whole column — neighbouring cards jump up and down while the user is trying to read them.

This is the residual cost of the prior redesign (`redesign-process-list-activity-bar`), which explicitly deemed the drawer's "height bounces acceptable" because the activity bar was supposed to be the stable surface. In practice the activity bar is the *least* stable surface: it renders raw rows that appear and disappear with each tool, and returns `null` between runs.

Two surfaces stacked (in-flight bash `SessionActivityBar` + background-process `ProcessList` drawer) both fluctuate independently, and the subcard itself fully unmounts when both are empty. The result reads as flicker.

## What Changes

Fold **both** PROCESS surfaces into **one collapsible summary line** that reserves a fixed height, so tool start/stop no longer reflows the grid.

- **Unified summary line.** One line replaces the always-open activity bar + separate drawer summary. Collapsed it shows the primary running command, a stable-width counts pill (`N running · ⚠M`), and elapsed time: `▸ ⏵ npm run build   [2 running · ⚠1]   6s`. Idle it shows `▸ ⏵ idle`.
- **Expand reveals everything.** Clicking the line expands in place to the full body: every in-flight bash row (each with its own `⏹` abort), then the background-process rows (each with its `✕` PGID kill). Expand/collapse **reuses the existing** `useDrawerExpansion` / `processDrawerCollapsed` per-session persistence — no new persistence path.
- **Configurable idle reservation.** A new **global** `DisplayPrefs.reserveProcessLineAtIdle` decides whether the one line stays reserved when the session is idle (zero jump, ever) or the subcard mounts on the first tool of a run (one jump, then stable). Global default via `~/.pi/dashboard/preferences.json`, per-session override free via `mergeDisplayPrefs` — identical mechanism to `contextUsageBar`. Preset defaults: `simple`/`standard` = `false`, `everything` = `true`.
- **DRY.** The summary-row + `+N overflow` collapse pattern already exists in `ProcessList`; extract a shared `collapse-summary` helper and use it for the activity rows too.

Explicitly a **client-only, core** change: no plugin slot (`ProcessList`/`SessionActivityBar` are core `packages/client`, not a `session-card-*` slot), no bridge change, no wire-protocol change beyond the additive `DisplayPrefs` field already carried by the existing prefs channel.

## Capabilities

### Modified Capabilities

- `chat-display-preferences`: add `reserveProcessLineAtIdle: boolean` to `DisplayPrefs`, to all three presets, and to `mergeDisplayPrefs`. Surfaced as a global toggle in `SettingsPanel` and a per-session override row in `ChatViewMenu`.
- `session-activity-bar`: no longer renders as an always-open stack of raw rows. Its rows become the expanded body of the unified summary line; when collapsed, its content is represented by the running-command text + counts pill.
- `session-process-tracking`: the background-process drawer's summary folds into the same unified line rather than rendering its own separate `⚠ N` summary row; its rows join the expanded body below the activity rows.
- `session-card-subcards`: the PROCESS subcard reserves one line of height. It stays mounted while the session is live, and — when `reserveProcessLineAtIdle` is true — while idle, instead of unmounting whenever both surfaces are empty.

## Impact

**Code touched (all `packages/client` + `packages/shared`):**
- `packages/shared/src/display-prefs.ts` — new field, presets, merge line.
- `packages/client/src/components/SettingsPanel.tsx` — global `ToggleField`.
- `packages/client/src/components/ChatViewMenu.tsx` — per-session override `Row` (marked when overridden).
- `packages/client/src/components/SessionCard.tsx` — `ProcessSubcard` renders the unified summary line; gates idle reservation on `useDisplayPrefs(session.id).reserveProcessLineAtIdle`; `MobileProcessSubcard` unchanged in spirit (already chip+sheet).
- `packages/client/src/components/SessionActivityBar.tsx` — feed rows into the shared collapse-summary; contribute running-count to the collapsed line.
- `packages/client/src/components/ProcessList.tsx` — extract/consume shared `collapse-summary` helper; contribute bg-count to the collapsed line.
- Tests: `SessionActivityBar.test.tsx`, `ProcessList.test.tsx`, `SessionCard.test.tsx`, `display-prefs` merge test, plus a new stable-height regression test.

**Not touched:**
- `src/extension/*` — bridge stays scan-only.
- `packages/server/*` — abort path + prefs persistence reused, not introduced.
- Wire protocol — only the additive `DisplayPrefs` field, carried by the existing prefs message.

## Discipline Skills

- `code-simplification` — the change collapses two independently-fluctuating surfaces into one and extracts a shared collapse-summary helper (DRY); a deliberate complexity-reduction pass belongs here.
- `doubt-driven-review` — the idle-reservation default is a cross-cutting UX choice touching every card; stress-test the default before it stands.

## Open Questions

None blocking. Prior-art threads (per-toolCall abort wire, PGID dedup) remain the Phase-2 follow-up owned by `redesign-process-list-activity-bar`; this change does not depend on them and keeps the activity `⏹` mapped to session-level abort as today.
