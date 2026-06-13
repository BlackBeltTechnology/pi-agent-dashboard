## Context

`packages/server/src/editor-manager.ts` already writes a `settings.json` per
editor data dir via `writeVscodeThemeSettings`. The function currently writes
only theme keys. The data dir is keyed deterministically on `cwd`
(`sha256(cwd).slice(0,12)`), so VS Code's `workspaceStorage/` already survives
across restarts on disk — the user just doesn't see it surface in the iframe.

Three independent gaps cause the "fresh editor" feeling:

1. VS Code does not auto-restore editors / view state without
   `window.restoreWindows` + `workbench.editor.restoreViewState`.
2. Workspace Trust dialog re-prompts on every workspaceStorage init for a
   folder it has not yet seen, and we never seed trust state.
3. `editor-manager.stop()` calls `killProcess(pid, { timeoutMs: 2000 })` —
   2 s is sometimes too short for VS Code to flush extension state +
   workspaceStorage before SIGKILL of the process group.

## Goals / Non-Goals

**Goals**
- Tabs + layout reopen after `pi-dashboard restart`.
- No Workspace Trust dialog on re-open of a previously-opened folder.
- Dirty buffers reliably flushed before SIGKILL.
- Zero protocol / API / client changes.

**Non-Goals**
- Surviving a dashboard restart without losing the iframe (covered by
  `add-editor-keeper-sidecar`).
- Cross-folder global state sharing.
- Migrating existing data dirs (next spawn re-seeds keys via merge).

## Decisions

### Decision 1: Disable Workspace Trust globally per data dir
Rationale: every data dir is owned by the dashboard and only ever opens one
folder (`cwd`). Trust prompts add zero security value here and break the UX.
Alternative considered: write a pre-trusted entry into
`globalStorage/state.vscdb`. Rejected — SQLite blob, fragile across VS Code
versions. `security.workspace.trust.enabled: false` is the documented kill
switch.

### Decision 2: Disable update + extension auto-check
Rationale: `--disable-update-check` is already passed on argv, but the
extensions gallery still nags. `extensions.autoCheckUpdates: false` plus
`update.mode: "none"` silences both.

### Decision 3: Merge, don't overwrite
Existing `writeVscodeThemeSettings` already merges with prior `settings.json`.
Keep that contract: any key the user has set survives. Only seed defaults
when the key is absent. (Current impl uses spread with seeded values last —
flip the order so user values win.)

### Decision 4: Bump graceful-stop 2 s → 5 s
Rationale: VS Code's "before-shutdown" hook waits on extension host flush
which routinely takes 2–4 s on first close. 5 s matches VS Code Desktop's
default. Cost: a stop call that used to return in 2 s now waits up to 5 s
before SIGKILL — only matters on a deliberately wedged code-server.
Alternative considered: send `code-server`'s `/healthz/shutdown` HTTP probe
first. Rejected — endpoint not stable across code-server versions, SIGTERM
is the documented contract.

### Decision 5: Rename `writeVscodeThemeSettings` → `writeVscodeUserSettings`
Function now seeds more than theme. Rename clarifies intent. Call sites
inside `editor-manager.ts` updated; no external callers.

## Risks / Trade-offs

- **Risk**: A user who *wants* the trust prompt loses it. → Mitigation: merge
  semantics — set `security.workspace.trust.enabled: true` in your data dir's
  `settings.json` and it sticks.
- **Risk**: 5 s stop window slows down `stopAll()` on shutdown for N idle
  editors. → Mitigation: `stopAll()` fires `stop()` for each instance
  synchronously and `killProcess` runs asynchronously, so the 5 s timers run
  concurrently, not in series. No user-visible delay.
- **Risk**: Future VS Code rename of a setting key. → Mitigation: settings
  unknown to VS Code are ignored silently; merge logic is forward-compatible.

## Migration Plan

None. On the next `start(cwd)` for each folder, the merged settings are
written. Existing user customizations pass through. No data migration, no
rollback steps — revert the diff if the change misbehaves.

## Open Questions

- Should we also seed `"workbench.startupEditor": "none"` to skip the welcome
  page on first-ever open? (Probably yes — defer to specs review.)
