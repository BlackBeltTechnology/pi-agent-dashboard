# Fix Electron AppImage CLI self-detection on Linux (power-user mode)

## Why

This is a **global PATH-wiring problem**, not a one-off Electron bug. The
codebase already has prior art for it: when the `consolidate-tool-resolution`
work landed (commit `d75854a`, archived as
`2026-04-19-consolidate-tool-resolution`), `detectPiDashboardCli()` shipped
with this defensive comment in `packages/electron/src/lib/dependency-detector.ts`:

```ts
/**
 * Detect the pi-dashboard CLI on PATH.
 * Excludes npx cache shims (.npm/_npx/) to avoid matching ephemeral installs.
 */
```

The pattern is: *trusting whatever `which`/`where` returns first is unsafe*
because PATH can carry **bogus shapes** that look like a real CLI but aren't.
The original case was `~/.npm/_npx/<hash>/...` — a stale npx cache shim. The
new case is the **AppImage's own launcher executable**, which is named
`pi-dashboard` (matches `packagerConfig.executableName` in `forge.config.ts`)
and lives under the squashfs mount that AppImage's runtime prepends to
`PATH` before exec'ing Electron.

### Symptom in production

```
$ tail ~/.pi-dashboard/server.log
[2026-04-30T08:16:13.782Z] Launching via CLI:
  /tmp/.mount_PI-DasbBMuqg/pi-dashboard start --port 8000 --pi-port 9999
```

`launchViaCli()` spawned the AppImage's own launcher binary thinking it
was the CLI. Electron-as-CLI silently ignores `start --port 8000`, never
opens :8000, and `waitForReady` polls until its 15-second deadline expires.
User sees "loading forever," then on the dialog flash from a previous
deadline.

The user's *real* `pi-dashboard` (`~/.nvm/.../bin/pi-dashboard` →
`packages/server/src/cli.ts`, fully reachable from a shell) was later in
PATH but `which` simply returns the first hit.

### Why this is global, not local

The `tool-registry` introduced by `consolidate-tool-resolution` resolves
external tools through an ordered strategy chain. The terminal strategy is
`whereStrategy(name)` — a thin wrapper around `ToolResolver.which`. Today
**neither `whereStrategy` nor the underlying `whichSync` filters anything**.
The only filter for bogus shapes lives in the Electron-only
`detectPiDashboardCli()` (and only catches `_npx`, not AppImage). That
means:

- **The bug class is one strategy away from re-emerging** for any tool
  whose name happens to match the Electron launcher (`pi-dashboard` today;
  could be `pi-agent-dashboard`, `node`, etc., for hypothetical future
  layouts).
- **Other AppImage-shipped Electron apps in this ecosystem (none today,
  but…) would have the identical failure mode** if they registered any
  tool with `whereStrategy`.
- **Tests that exercise the registry don't see this** because they don't
  set `APPDIR` / `APPIMAGE` env vars.

### Spec sweep — additional gaps

A pass through `openspec/specs/` surfaced two gaps in the current
contracts that this fix should close:

1. **`electron-shell/spec.md`** specs the tsx launch path
   ("Server launch via tsx binary") but **not** the power-user CLI path
   (`launchViaCli()`). The branch the bug rides on is undocumented.
2. **`dependency-installer/spec.md`** specs `detectPi`, `detectOpenSpec`,
   `detectDashboardPackage`, but **not** `detectPiDashboardCli`. The
   detector at the heart of the bug isn't part of the documented
   contract — its `_npx` filter, source ordering, and (with this change)
   AppImage filter are not specced anywhere.

A third spec — `command-executor` — owns the platform-level resolution
contract via `ToolResolver.which`. Adding the AppImage filter there as
defense-in-depth keeps the fix consistent with the registry design
(strategies are the documented contract layer).

## What Changes

The fix has three layers, mirroring the npx-filter precedent's "filter
known-bogus shapes from PATH lookup":

1. **`detectPiDashboardCli()`** in
   `packages/electron/src/lib/dependency-detector.ts` rejects any
   candidate whose realpath equals `process.execPath`, lives under
   `process.env.APPDIR` (AppImage mount), or equals
   `process.env.APPIMAGE`. Returns `{ found: false }` so `ensureServer()`
   falls through to `launchServer()` (tsx + `cli.ts`).
2. **`detectPi()` and `detectSystemNode()`** get the same guard
   symmetrically — future-proofing against an AppImage layout that ever
   exposes a `node` or `pi` binary alongside the launcher.
3. **`whereStrategy()`** in `packages/shared/src/tool-registry/strategies.ts`
   gets a shared `isAppImageSelfHit(path)` helper applied to the
   `whichSync` result. Any tool registered via `whereStrategy` therefore
   inherits the guard transparently — the existing `_npx` rule is the
   precedent for "filter known-bogus shapes at the lowest reusable
   layer."

A small ergonomic improvement:

4. **`launchViaCli()`** in `server-lifecycle.ts` decorates the
   `waitForReady` timeout error with the resolved candidate path AND a
   `readlink -f $(which pi-dashboard)` hint so future failures (real CLI
   bug vs. slipped-through self-recursion) are easy to triage from the
   error dialog alone.

### Spec deltas

- **`electron-shell`** — adds *Power-user mode CLI launch path* (records
  the previously-undocumented branch and its fall-through), and
  *CLI launch rejects AppImage self-recursion* (the bug contract).
- **`dependency-installer`** — adds *Detect pi-dashboard CLI binary*
  (precedence: managed → system PATH; rejects npx + AppImage hits) and
  *AppImage self-recursion guard for binary-name detectors*.
- **`command-executor`** — adds *whereStrategy filters AppImage
  self-hits* (defense-in-depth at the registry-strategy layer).

### Tests (TDD)

- Unit: `detectPiDashboardCli`
  - Real CLI on PATH → returned
  - AppImage self-hit (mock `APPDIR` + `whichSync` returning a path
    under it) → rejected, falls through
  - `process.execPath` self-hit → rejected
  - npm `_npx` cache hit (existing rule) → still rejected
- Unit: `detectPi`, `detectSystemNode` AppImage symmetry cases
- Unit: `whereStrategy` filters AppImage paths (mock `which` →
  `{ ok: false, reason: "appimage-self-hit" }` recorded in the diagnostic
  trail)
- Integration: a `dependency-detector.test.ts` case that mocks
  `process.env.APPDIR` and asserts the *full chain*
  (registry → detector → ensureServer fall-through) does the right
  thing.

## Impact

- Affected files:
  - `packages/electron/src/lib/dependency-detector.ts` — guard logic +
    `detectPiDashboardCli` filter (extends existing `_npx` rule)
  - `packages/shared/src/tool-registry/strategies.ts` — `whereStrategy`
    inherits the guard
  - `packages/electron/src/lib/server-lifecycle.ts` — error-message hint
    only
  - `packages/electron/src/__tests__/dependency-detector.test.ts` — new
    cases (file already exists per existing `_npx` test, just adds cases)
  - `packages/shared/src/__tests__/tool-registry/strategies.test.ts` —
    new `whereStrategy` AppImage rejection case
- Affected specs:
  - `openspec/specs/electron-shell/spec.md` (additive, two requirements)
  - `openspec/specs/dependency-installer/spec.md` (additive, two
    requirements)
  - `openspec/specs/command-executor/spec.md` (additive, one requirement)
- No protocol or schema changes.
- No persistence changes.
- No build-pipeline changes — the AppImage maker stays as-is; the
  `executableName: "pi-dashboard"` collision is **left in place** because
  renaming it would break user-facing branding and existing desktop
  files. The fix sits at the resolution layer where it belongs.
- **Cross-reference**: the `consolidate-tool-resolution` archived change
  established the registry as the contract layer for tool resolution.
  This change extends that layer's behavior, not its shape.
