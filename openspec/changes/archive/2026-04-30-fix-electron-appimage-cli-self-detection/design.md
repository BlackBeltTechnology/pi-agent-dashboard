## Context

The Electron app's power-user launch path (`ensureServer()` →
`detectPiDashboardCli()` → `launchViaCli()`) trusts the first hit of
`which pi-dashboard`. On Linux AppImage builds, the AppImage runtime
prepends the squashfs mount directory (e.g. `/tmp/.mount_PI-Das…/`) to
`PATH` of the Electron process before exec'ing the app. That mount
contains a binary literally named `pi-dashboard` because
`packagerConfig.executableName = "pi-dashboard"` in `forge.config.ts`.
So the first hit is the Electron launcher itself, and the dashboard
spawns a recursive Electron child that ignores its `start --port …` argv,
never opens :8000, and `waitForReady` polls until its 15-second deadline.

There is direct prior art in the codebase: when the unified tool-resolver
landed (commit `d75854a` / archived
`2026-04-19-consolidate-tool-resolution`), `detectPiDashboardCli`
shipped with this defensive filter:

```ts
// Excludes npx cache shims (.npm/_npx/) to avoid matching ephemeral installs.
if (cliPath.includes(".npm/_npx") || cliPath.includes(".npm\\_npx")) {
  return { found: false };
}
```

The pattern is established: *when resolving a CLI by name, filter known
bogus PATH shapes before trusting the result*. The `_npx` filter catches
ephemeral npx caches; this change adds a second filter for AppImage
self-hits, lifted to a shared helper so `whereStrategy` (the registry's
PATH walker) inherits it transparently.

The codebase lays out three layers where the guard could live:

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1 — Electron-only detector                               │
│    packages/electron/src/lib/dependency-detector.ts             │
│    detectPiDashboardCli() — already filters _npx                │
│                                                                  │
│  Layer 2 — Shared registry strategy                             │
│    packages/shared/src/tool-registry/strategies.ts              │
│    whereStrategy(name) — wraps ToolResolver.which               │
│                                                                  │
│  Layer 3 — Lowest primitive                                     │
│    packages/shared/src/platform/binary-lookup.ts                │
│    whichSync(cmd) — pure where/which exec wrapper               │
└─────────────────────────────────────────────────────────────────┘
```

The fix lives at Layers 1 and 2, NOT Layer 3.

## Goals / Non-Goals

**Goals:**

- Eliminate the AppImage CLI self-detection bug so power-user mode on
  AppImage falls through to the standalone tsx + cli.ts launch when no
  real `pi-dashboard` exists, and prefers the real one when it does.
- Lift the "filter bogus PATH shapes" pattern into the shared
  `whereStrategy` so every registered tool inherits it — defense-in-depth
  beyond just `pi-dashboard`.
- Keep the existing `_npx` filter intact; the new `appimage-self-hit`
  filter is its peer, not a replacement.
- Surface the AppImage layout collision in spec text so a future change
  to `executableName` (or a future Electron app sharing this codebase)
  can't silently re-introduce the bug.

**Non-Goals:**

- Renaming the AppImage launcher (`executableName: "pi-dashboard"`).
  That would break user-facing branding and existing `.desktop` files.
  The fix sits at the resolution layer where it belongs.
- Touching `whichSync` / `ToolResolver.which` (Layer 3). Those are pure
  PATH primitives; filtering belongs at the policy layer above them.
- Registering `pi-dashboard` as a tool in the registry. The
  `definitions.ts` design comment is explicit:
  *"`pi-dashboard` — that's the package this code is part of. 'Is it
  installed' is a bootstrap concern handled directly in
  `dependency-detector.ts`."* That decision stays.
- Adding new env vars or config knobs. The fix uses the env vars
  AppImage already exports (`APPDIR`, `APPIMAGE`) and the Node-provided
  `process.execPath`.
- Auto-detecting and warning the user about a self-hit before launch.
  Could be added later; this change limits scope to "make it not
  happen" + "if it ever happens despite the filter, give a useful
  error message."

## Decisions

### D1. Add a shared helper `isAppImageSelfHit(path)` in the shared package

**What:** Add `isAppImageSelfHit(candidatePath, opts?)` to
`packages/shared/src/platform/binary-lookup.ts` (alongside `whichSync`
and `whichViaLoginShell`). Pure function, takes an absolute path,
returns `true` if any of:

- `realpath(candidatePath) === realpath(process.execPath)`
- `candidatePath` starts with `realpath(process.env.APPDIR)` + path sep
- `realpath(candidatePath) === realpath(process.env.APPIMAGE)`

All `realpath` calls wrapped in try/catch — broken-symlink / ENOENT cases
fall back to the literal string compare so the helper never throws.

**Why here:** Both Layer-1 and Layer-2 callers need this logic. Putting
it in `platform/binary-lookup.ts` (the same file as `whichSync`) keeps
"PATH-resolution policy primitives" co-located. Making it a *helper*
rather than baking it into `whichSync` itself preserves the Layer-3
purity goal — `whichSync` stays a thin `where`/`which` wrapper.

**Alternatives considered:**

- *Bake into `whichSync`*: rejected — `whichSync` is consumed by
  `ToolResolver.which()`, which is in turn called by code paths that
  legitimately want `process.execPath` (e.g. `restart-helper.ts`). The
  policy doesn't belong at Layer 3.
- *Duplicate the logic in `dependency-detector.ts` and `strategies.ts`*:
  rejected — exactly the duplication the consolidate-tool-resolution
  archive was meant to prevent.
- *Inject via dependency rather than read `process.env` directly*: the
  helper accepts an optional `opts: { execPath?, appDir?, appImage? }`
  override so tests can exercise both branches without mutating
  `process.env`. Production callers omit `opts`.

### D2. Apply the helper in `whereStrategy` (Layer 2)

**What:** When `whichSync(name)` returns a path, run it through
`isAppImageSelfHit(path)`. If `true`, return
`{ ok: false, reason: "appimage-self-hit: <path>" }` so the registry's
`Resolution.tried` records the rejection in the diagnostic trail.
Otherwise return the path as-is.

**Why:** Every tool registered via `whereStrategy` (currently `node`,
`pi`, `openspec`, `npm`, `git`, `zrok`, `wt`, build-time `electron`/
`node-pty`) inherits the guard transparently. Future tool registrations
benefit by default.

**Alternatives considered:**

- *Extend `whereStrategy` signature with an opt-in flag*: rejected — the
  AppImage hit is *always* bogus for an external-tool lookup, never a
  legitimate hit. Opt-in adds API surface for no win.

### D3. Apply the helper in `detectPiDashboardCli` (Layer 1)

**What:** Add `isAppImageSelfHit` check after the existing `_npx` check.
Symmetrically, also apply it inside `detectPi()` and `detectSystemNode()`
on their resolved paths (their resolution flows through the registry,
which inherits Layer-2 — so this is belt-and-braces, not strictly
required).

**Why:** `pi-dashboard` is intentionally not a registered tool, so
Layer-2 doesn't cover it. The filter has to live at Layer 1 too. Adding
it to the other detectors is cheap and prevents regression if anyone
later tweaks the registry or detector flow.

### D4. Diagnostic-trail message format

**What:** When `whereStrategy` rejects an AppImage hit, the recorded
reason is `"appimage-self-hit: <path>"` (with the offending path).
When `detectPiDashboardCli` rejects one, log nothing — return
`{ found: false }` to match the existing `_npx` precedent (the
`_npx` rejection also returns silently, no log).

**Why:** Symmetry with the existing `_npx` filter for the detector layer
(silent skip). The registry layer already has structured diagnostics
(`Resolution.tried`), so the explicit reason is appropriate there.

### D5. Decorate the `launchViaCli` timeout error

**What:** When `waitForReady` deadlines out in `launchViaCli`, append to
the thrown error message: the resolved candidate path AND a
`readlink -f $(which pi-dashboard) — verify it points at a real CLI,
not the running Electron binary` hint.

**Why:** If a self-hit ever slips through (future regression, edge
case), the error dialog tells the user (or maintainer) exactly how to
diagnose it without reading code. Cheap insurance.

## Risks / Trade-offs

- **[Risk] False-positive AppImage rejection on dev machines**:
  someone who *legitimately* installs `pi-dashboard` into a directory
  whose path happens to match `APPDIR` (e.g. by setting `APPDIR` for
  unrelated reasons) would have it rejected. → **Mitigation**: only
  active when `APPDIR` and/or `APPIMAGE` are set, which AppImage's
  runtime sets automatically and almost no other tooling does. Trail
  reason makes the rejection visible. The realpath-equals-execPath
  check is unconditional but only fires for true self-hits.

- **[Risk] Symlinked Node binary on dev machines**: if the user's real
  `pi-dashboard` happens to be a symlink that resolves through
  `process.execPath` (e.g. some unusual nvm setup), the realpath check
  could reject it. → **Mitigation**: in practice `process.execPath` is
  the Electron binary, not a node binary; collision essentially
  impossible. Both `realpath` calls are independent — only an exact
  match rejects.

- **[Risk] `process.env.APPDIR` set by something other than AppImage**:
  → **Mitigation**: low likelihood; any tooling that sets `APPDIR`
  outside of AppImage is signalling "treat me like an AppImage mount,"
  which is precisely the policy we want. If a real bug surfaces, opt-out
  is one env-var unset away.

- **[Trade-off] Defense-in-depth vs. single-layer fix**: applying the
  guard at both Layer 1 and Layer 2 means duplicate calls on the
  detector path. Rejected concern: the helper is a few `realpath`
  comparisons; cost is negligible and the duplication makes each layer
  independently correct.

## Migration Plan

No data migration. No config migration. No persistence schema changes.

Rollout order:

1. Ship the shared helper and unit tests.
2. Wire `whereStrategy` and `detectPiDashboardCli` (and symmetry-only
   wiring in `detectPi` / `detectSystemNode`).
3. Decorate the `launchViaCli` error.
4. Add the integration test that mocks `process.env.APPDIR` and asserts
   the registry → detector → ensureServer fall-through chain.
5. Update `AGENTS.md` (one-line on the new helper) and
   `docs/architecture.md` (paragraph in the Electron section).
6. Land in a normal release. No rollback strategy needed beyond reverting
   the change — no persistent state is touched.

## Open Questions

- **None blocking.** The collision between AppImage's `executableName`
  and the dashboard CLI's name is permanent (renaming would be
  user-visible). The filter approach is the right shape.
