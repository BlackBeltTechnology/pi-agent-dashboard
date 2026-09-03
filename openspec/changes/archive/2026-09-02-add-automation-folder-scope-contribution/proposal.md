# Add an automation folder-scope contribution axis

> Grounding: verified against upstream `develop` automation-plugin —
> `folderScopeBases()` (`index.ts:257`), `listScopes()` (`index.ts:271`),
> `attachWatchers()` (`index.ts:297`), `engine.refresh()` (`engine.ts:909`),
> `reapStaleRuns()` (`engine.ts:412`), the `automation.action.` axis it mirrors
> (`action-registry.ts:242`/`:251`, `ctx.consumeAll`), and the host
> `provide`/`consumeAll` contract (`server.ts:2375`).

## Why

`folderScopeBases()` derives folder scopes **only from live session cwds**
(`ctx.sessionManager.listAll()`). `listScopes()` — the single input to arming
(`engine.refresh()` → `scheduler.armAll`), reaping (`reapStaleRuns`), and watching
(`attachWatchers` → `reconcileWatchers`) — hangs entirely off it. So a repo with an
**enabled `automation.yaml` but no live session** is never scanned, armed, or
watched. Arming is accidentally coupled to a human opening a session in that cwd.

The only broken thing is **reachability of the scope**, not the automation lifecycle.
An automation instance already lives correctly on disk (board-managed, toggleable via
`disabled:`, run-history/lease keyed on the file). The fix must add reachability
**without** forking the file → scan → arm → board → toggle → persist machinery.

## What Changes

- **Add a second dynamic contribution axis** `automation.folderscope.`, mirroring the
  one existing dynamic axis (`automation.action.`). A plugin/host publishes
  `ctx.provide("automation.folderscope.<id>", { base })`.
- **Union contributed bases into `folderScopeBases()`.** It already runs on every
  `listScopes()` read; it additionally collects
  `ctx.consumeAll("automation.folderscope.")` and unions the valid, resolved bases
  into its session-derived `Set`. `listScopes()`, `engine.refresh()`,
  `reapStaleRuns()`, `attachWatchers()` are **unchanged** — contributed scopes are
  scanned, armed, reaped, and watched for free.
- **Boot-time arm anchor (fork a).** The contributed scope is armed + watched when the
  engine first reads scopes (`engine.start()` → `refresh()` + initial
  `attachWatchers()`, `index.ts:302`). **Collection** is load-order independent
  (`consumeAll` re-reads each `listScopes()`), but the **boot arm** is a one-shot,
  anchored to automation's `ENGINE_INIT_DELAY_MS` (~1s) engine-init timer while the
  loader awaits each plugin's `registerPlugin` sequentially. Guarantee: a contribution
  present in the registry when that timer fires is armed at boot; a contributor whose
  `ctx.provide` lands *after* the window is not a boot race to win — it falls into the
  documented post-boot non-goal (re-arms only on a later session/file trigger). The
  intended contributor publishes from its own `registerPlugin`. Smallest-perf shape:
  no new timer, nothing added to steady state.
- **Boundary validation (fail-open, warn-once).** A contribution value is accepted
  only when it is a plain, non-null, non-array object with a **trimmed non-empty**
  string `base` that `path.resolve` accepts; anything else is ignored and the remaining
  valid contributions still collect. Because `folderScopeBases()` runs on every
  `listScopes()` read (refresh, watcher reconcile, and the stale-run reaper's
  interval), a malformed entry is warned **once per key**, never per read. Dedup is by
  resolved path (matching the existing session-cwd `path.resolve`, not `realpath`);
  symlink aliases are not canonicalized, consistent with current behavior. A
  contributed base equal to the global home dir is dropped (the `global` scope owns it —
  otherwise the same file arms as both `folder:name` and `global:name`). The registry
  value is read live on each collect (last-write-wins per key, treated immutable).
  Arming spawns background sessions, so the axis is **opt-in and explicit** — navigation
  pins / `knownFolderCwds` are deliberately NOT consumed (a view preference must not
  become an execution trigger); arming is gated only by plugin-trust (a loaded plugin
  is trusted in-process code), the same trust boundary every `ctx.provide` axis uses.

## Non-Goals

- **Runtime zero-session live-add.** A contribution published *after* boot with zero
  sessions ever and no watched-file activity has no re-arm trigger and is out of scope
  (deferred to a future re-arm trigger — a periodic tick or a host nudge). Chosen for
  smallest performance impact.
- **Withdrawal / unregister.** The host exposes `provide` + `consume`/`consumeAll` but
  **no `unprovide`/retract** (`server.ts:2375`). A contributed scope is therefore
  **process-lifetime** — exactly like `automation.action.`, which no plugin retracts.
  Adding a retract API is a host change, out of scope here.
- No direct in-memory automation-*instance* registration. Instances stay on-disk files
  (`writeAutomation`) so the board can read/edit/toggle/persist them.
- No REST endpoint, no config-schema change, no route change.
- No consumption of `knownFolderCwds` / pinned directories.

## Capabilities

- `automation-folder-scope-contribution` (new): in-process contribution axis that
  expands the set of folder scopes the engine scans/arms/watches, beyond
  session-derived cwds.

## Discipline Skills

- **security-hardening** — the axis is an execution-arming surface; tasks validate the
  contributed `base` at the boundary and deliberately decline the nav-pin signal so a
  view preference cannot arm cron sessions.
- **doubt-driven-review** — the publish/collect contract + boot-arm-only decision is a
  standing public seam; stress-test the load-order guarantee and the non-goal boundary
  before it lands.
- **review-code** — non-trivial change touching scope discovery; review the union edit
  + collector before commit.
