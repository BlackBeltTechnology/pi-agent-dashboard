## Background — how the exploration arrived here

This change is the artifact of an `/opsx-explore` session that started
from the observation:

> "Currently the bootstrap is a mess. 3 ways of installation currently
> exist: 1. pi install, 2. npm install, 3. electron."

The exploration's first move was to verify whether "three install
methods" was the right cleavage. It is not — at the **runtime** layer,
all three converge on the same Node process running TypeScript via
`jiti`. They differ only in:

1. Who starts the server (bridge auto-launcher / user CLI /
   Electron `spawnFromSource`).
2. Where dependencies live (pi's package cache / npm global /
   `~/.pi-dashboard/`).
3. Where `node` comes from (user's shell PATH / user's shell PATH /
   Electron's bundled Node).
4. Whether there is a TUI alongside (yes / no / no).
5. Who owns lifecycle (`DASHBOARD_STARTER` =
   `Bridge` / `Standalone` / `Electron`).

Counting in-flight changes by arm:

| Arm | In-flight bootstrap changes |
|---|---|
| Bridge (pi-extension) | 0 |
| Standalone (`npm i -g` / Docker) | 0 |
| Electron | 9+ (`streamline-electron-bootstrap-and-recovery`, `fix-stale-bundled-server-cache`, `fix-electron-wizard-npm-root-enoent`, `fix-electron-server-launch-node-bin`, `skip-affected-bundled-node`, `fix-resolve-client-dir-prefers-durable-managed-path`, `fix-is-npm-package-installed-exports-map`, `fix-build-installer-stale-server-bundle`, `fix-darwin-dmg-maker-macos-alias`) |

The pattern was unambiguous: the bootstrap mess is **one arm**, and
that arm is reimplementing inside a sandbox what the other two arms
get for free from the user's shell.

## The dependency pyramid that the analysis uncovered

```
              ┌──────────────────────────────────────────────┐
              │   /api/pi-core/update                        │
              │   "upgrade pi inside the running dashboard"  │
              └──────────────────────────────────────────────┘
                                │ depends on
                                ▼
              ┌──────────────────────────────────────────────┐
              │   ~/.pi-dashboard/ must be writable + mutable │
              └──────────────────────────────────────────────┘
                                │ depends on
                                ▼
     ┌──────────────────────────────────────────────────────────┐
     │  Bootstrap machinery (only on Electron arm):             │
     │  - ELECTRON_OWNED_PACKAGES whitelist                     │
     │  - offline cacache + manifest                            │
     │  - installable.json v2 + kind/source/required            │
     │  - preflight-reconcile every launch                      │
     │  - installStandalone w/ skipPackages=upToDate            │
     │  - planSafeWipe + force-reinstall                        │
     │  - materializeWorkspaceSymlinks rescue                   │
     │  - version-skew banner                                   │
     │  - resolveManagedDirRoot + 6-strategy client-dir         │
     │  - loading-page-error reinstall surface                  │
     │  - Doctor force-reinstall                                │
     └──────────────────────────────────────────────────────────┘
```

The single value at the top is what holds the rest up. Once the user
confirmed "`/api/pi-core/update` is replaceable by .app update," the
pyramid lost its base.

## Architectural principle (post-change)

```
   ┌────────────────────────────────────────────────────────────────┐
   │                                                                │
   │   THREE BOOTSTRAPPERS, ONE SERVER, ZERO RUNTIME INSTALL        │
   │                                                                │
   ├────────────────────────────────────────────────────────────────┤
   │                                                                │
   │   npm-global                                                   │
   │     install:  `npm i -g @blackbelt-technology/pi-dashboard`    │
   │     launch:   `pi-dashboard start`                             │
   │     update:   `npm update -g`                                  │
   │                                                                │
   │   pi-extension (bridge)                                        │
   │     install:  `pi install <bridge-ref>`                        │
   │     launch:   runs `pi` → bridge auto-starts server            │
   │     update:   bridge auto-update via pi's package manager      │
   │                                                                │
   │   electron                                                     │
   │     install:  download .dmg/.exe/.deb/.AppImage → double-click │
   │     launch:   server launches from immutable .app resources    │
   │     update:   electron-updater whole-app replacement           │
   │                                                                │
   │   ~/.pi-dashboard/ no longer exists for new installs.          │
   │   No arm has more bootstrap machinery than another.            │
   │                                                                │
   └────────────────────────────────────────────────────────────────┘
```

The standalone (`npm i -g`) arm becomes the **reference deployment**.
Docker, bare-metal VPS, and systemd-on-Debian are subcases of it.
Electron and bridge are **launchers** that satisfy different user
ergonomics; neither implements its own package manager.

## State machine — before and after

```
   ── BEFORE (current `docs/electron-bootstrap-flow.md`) ──
   
   12 states, 7 triggers, 10 end states (E1–E10).
   Recovery surfaces in three places (wizard error, loading-page,
   Doctor).
   
   States: checking-server-health, version-skew-banner, attach,
           preflight-inventory, wizard-welcome, wizard-select,
           wizard-progress, wizard-done, silent-install,
           reinstall-managed, force-reinstall, launch-server,
           health-wait, loading-page-error, done.
   
   
   ── AFTER ──
   
   6 states, 3 triggers, 3 end states.
   
   Triggers:
     T1  app.whenReady()
     T2  Tray "Start server"
     T3  Loading-page "Start server" (retry)
   
   States:
     checking-server-health  — health probe of configured port
     attach                  — running server detected → main window
     wizard-welcome          — only when first launch detected;
                               one-step welcome with Launch CTA
     launch-server           — selectLaunchSource() (attach | bundled)
     health-wait             — poll /api/health ~15s
     loading-page-error      — health timeout; offers retry +
                               Doctor + log + known-servers
   
   End states:
     E1  attach — connected to running server
     E2  done   — bundled server spawned successfully
     E3  loading-page-error persistent — user picks Doctor or
         remote-server option
```

## File-by-file disposition

This section names every file touched by today's bootstrap machinery
and what happens to it.

### Delete (runtime install)

- `packages/electron/offline-packages.json` — pinned versions list, no
  longer needed since build-time install resolves at build time.
- `packages/electron/scripts/bundle-offline-packages.sh` — packs
  tarballs into cacache, obsolete.
- `packages/electron/resources/offline-packages/` — gzipped npm cache
  and manifest, obsolete.
- `packages/electron/src/lib/offline-packages.ts` — runtime helpers to
  parse/verify/extract the cache, obsolete.
- `packages/electron/src/lib/dependency-installer.ts` —
  `installStandalone`, the central runtime npm-install routine.
- `packages/electron/src/lib/preflight-reconcile.ts` — every-launch
  inventory diff.
- `packages/electron/src/lib/force-reinstall.ts` — safe-wipe orchestrator.
- `packages/electron/src/lib/power-user-install.ts` — every-launch entry
  point routing to skip/install/wizard.
- `packages/electron/src/lib/installable-catalog.ts` — three-tier
  catalog assembly.
- `packages/electron/src/lib/wizard-badge.ts` — visual indicator that
  classified install-progress lines as "bundled" vs "system".
- `packages/shared/src/managed-package-whitelist.ts` — three-name set
  plus parity test.
- `packages/shared/src/installable-list.ts` — v1/v2 schema, reader,
  writer, merger.
- `packages/shared/src/managed-workspace-materialize.ts` — Failure 1 of
  group 16; the problem it defends against (workspace symlinks wiped by
  bootstrap's npm install) cannot occur once the bootstrap npm install
  is gone.
- `packages/shared/src/recommended-extensions.ts` — `BUNDLED_EXTENSION_IDS`
  list; bundled extensions are installed at build time into the same
  tree as the server.
- `packages/server/src/bootstrap-install-from-list.ts` — per-package
  reconcile loop.
- `packages/server/src/bootstrap-state.ts` + `bootstrap-queue.ts` —
  in-memory state for the bootstrap progress UI.
- `packages/server/src/pi-core-checker.ts` + `pi-core-updater.ts` —
  in-place pi-version updater (the load-bearing capability that
  motivated the entire pyramid).
- `packages/server/src/routes/pi-core-routes.ts` + `bootstrap-routes.ts`
  — REST endpoints.
- `packages/client/src/hooks/useBootstrapStatus.ts` +
  `components/BootstrapBanner.tsx` — UI for bootstrap state.

### Simplify

- `packages/electron/src/main.ts` — startup flow collapses. Remove
  preflight branches, silent-install branch, version-skew banner wiring,
  reinstall IPC handlers.
- `packages/electron/src/lib/launch-source.ts` — `selectLaunchSource`
  collapses to two strategies: `attach` (probe configured port for
  running server) and `bundled` (spawn from `process.resourcesPath`).
- `packages/electron/src/lib/server-lifecycle.ts` — `ensureServer`
  loses install-progress orchestration; keeps watchdog respawn and
  health probe.
- `packages/electron/src/lib/wizard-window.ts` — single-step welcome
  window or removed entirely (auto-launch on first run is acceptable
  given there is nothing to configure).
- `packages/electron/src/renderer/wizard.html` — ~620 LOC → ~100 LOC
  (welcome + advanced disclosure).
- `packages/electron/src/renderer/loading.html` — remove reinstall +
  force-reinstall buttons and the inventory diagnostic.
- `packages/electron/src/lib/doctor.ts` and `doctor-window.ts` and
  `renderer/doctor.html` — remove force-reinstall section, audit panel,
  reinstall confirmation dialog. Keep all read-only diagnostics.
- `packages/electron/scripts/bundle-server.mjs` — extend to install pi,
  openspec, tsx into `resources/server/node_modules/` at build time
  (the only addition; everything else is pure deletion).
- `packages/electron/scripts/build-installer.sh` — simplify; remove
  offline-cache regeneration logic.
- `packages/server/src/server.ts` + `resolve-client-dir.ts` — client-dir
  resolver collapses to one strategy. Failure 2 of group 16 disappears.
- `packages/electron/src/lib/pick-node.ts` — single bundled node; no
  preference logic needed.

### Keep (load-bearing for other reasons)

- `packages/electron/src/lib/app-updater.ts` — `electron-updater` is now
  the sole pi-version update path. Becomes more important, not less.
- `packages/electron/src/lib/server-lifecycle.ts::makeServerWatchdog`
  — Failure 5 from group 16. Independent of bootstrap layout.
- `packages/electron/src/lib/dependency-detector.ts` — still used by
  Doctor to surface "user has X installed at Y" diagnostics, and by
  `buildSpawnEnv` to give spawned pi sessions a PATH that includes the
  user's tools (git, ripgrep, etc.). The "login shell fallback"
  primitive stays.
- `packages/electron/src/lib/bundled-node.ts` — bundled node binary
  still needed (Electron arm assumes no host Node).
- `packages/shared/src/dashboard-paths.ts` — Failure 3 from group 16.
  Single source of truth for `~/.pi/dashboard/` paths. Keep.
- `packages/shared/src/server-identity.ts` — Failure 4 from group 16.
  Retry-loop health probe. Keep.
- `packages/extension/src/bridge.ts` and everything around it — bridge
  arm is unaffected by this change.
- `packages/server/src/process-manager.ts` — server's pi-session spawn
  logic is unaffected. `buildSpawnEnv` may simplify slightly because
  `~/.pi-dashboard/node/bin/` is no longer a candidate for PATH
  injection on the Electron arm, but the function itself stays.

## Migration strategy

A user upgrades from a `.app` that uses the old layout to one that
uses the new layout. On first launch of the new `.app`:

1. **Detect** `~/.pi-dashboard/` presence.
2. **Do nothing automatic.** The server launches from bundled
   resources regardless of what is in `~/.pi-dashboard/`.
3. **Surface** a Doctor row: "Legacy install directory detected at
   `~/.pi-dashboard/`. This directory is no longer used. Click to copy
   the path; you may delete it manually if desired."
4. **No silent deletes, no consent dialogs at launch.** The directory
   is harmless and may contain user-installed packages from the prior
   layout that the user can recover from manually if they care.

This is conservative on purpose: an automated delete would be the kind
of decision that earns a bug report from someone who had something
important in there. The Doctor row carries the message without taking
action.

## What about the bridge arm?

The bridge arm is the only one not addressed by this change. It still
auto-starts the server when `pi` runs, using `process.execPath` and a
relative path to `cli.ts` inside the bridge package.

Two observations from the exploration that are *not* addressed here
but are worth noting:

1. **The bridge is both an install channel and a launcher.** Installing
   the bridge via `pi install <ref>` ships the server inside the
   bridge's package. The bridge then launches that server. This
   conflates concerns.

2. **The bridge owns the server's lifecycle for the session that started
   it.** When the pi session exits, the server it spawned today keeps
   running (no shutdown — `DASHBOARD_STARTER=Bridge` does not auto-shut
   in `decideShutdownOnQuit`). This is correct behavior but
   conceptually the inverse of Electron's `DASHBOARD_STARTER=Electron`,
   which does own lifecycle.

Neither is broken; both are out of scope for this change. A follow-up
exploration could ask whether the bridge should be a pure launcher
that requires the user to install `pi-dashboard` separately (the way
this change makes Electron a pure launcher conceptually). That is
*not* proposed here.

## Why this change is one-way

After this change ships, restoring `/api/pi-core/update` would require
rebuilding most of the deleted machinery:

- A writable directory for installed packages.
- An offline cache or registry connection.
- A reconcile loop.
- Recovery surfaces for the inevitable failure modes.

This is acceptable because:

1. The alternative path (`electron-updater` whole-app replacement) is
   already implemented, used in production, and tested across all four
   distribution channels.
2. Users who need pi-version flexibility independent of dashboard
   releases have the standalone arm available today and that arm
   becomes *more* reliable, not less, after this change (it stops being
   the orphan and becomes the reference).

## What this change is not

- Not a deletion of the Electron arm. The .app stays. The wizard stays
  (in collapsed form). The tray, app menu, single-instance logic,
  Doctor, watchdog — all stay.
- Not a deprecation of pi-version updates. Pi versions still update;
  the path is `electron-updater` instead of in-process npm install.
- Not a change to the standalone or bridge arms. Both are untouched.
- Not a removal of `~/.pi-dashboard/` from existing users' disks. The
  directory is left alone; Doctor surfaces an advisory.

## Spike results (Phase 1)

Foreground build spike to validate task 1.1 (extended `bundle-server.mjs`)
and the GO/NO-GO threshold (size delta ≤ 150 MB on every platform,
pi resolves to bundled copy with no `~/.pi-dashboard/` access).

### macOS x86_64 (host: Sonoma 14.6.1, Node 24.15.0)

| Metric | Value |
|---|---|
| Build command | `bash packages/electron/scripts/build-installer.sh` |
| `.app` size | 634 MB (extracted) |
| `.dmg` size | **209.9 MB** |
| Baseline `.dmg` (v0.5.3, runtime-install arch) | 225.2 MB |
| **Size delta** | **−15.3 MB** (smaller, well under +150 MB threshold) |
| `pi` bundled at | `Resources/server/node_modules/@earendil-works/pi-coding-agent` |
| `openspec` bundled at | `Resources/server/node_modules/@fission-ai/openspec` |
| `tsx` bundled at | `Resources/server/node_modules/tsx` |
| Pi version | 0.74.0 (matches `offline-packages.json` pin) |
| Openspec version | 1.3.0 (matches pin) |
| Tsx version | 4.21.0 (matches pin) |
| Transitive pi deps | `pi-agent-core`, `pi-ai`, `pi-tui` (all in bundled tree) |
| Mach-O arch | `x86_64` (host-native) |
| Legacy `offline-packages/` in .app | absent (`BUNDLE_OFFLINE_PACKAGES` unset) |

The **size reduction** is counter-intuitive but expected: the old
architecture shipped pi/openspec/tsx as a gzipped npm cacache tarball
(`offline-packages/npm-cache.tar.gz`) at ~80 MB and the DMG's outer zlib
compression cannot meaningfully re-compress an already-gzipped payload.
The new architecture ships the same packages as an unpacked
`node_modules/` tree, which the DMG's zlib layer compresses
significantly more effectively. Net: the on-disk-after-install footprint
grows (no longer compressed at rest), but the over-the-wire installer
is a touch smaller.

### Build host gotchas

`electron-installer-dmg`'s native sub-deps (`macos-alias`, `fs-xattr`)
did not ship prebuilt binaries compatible with Node 24. `volume.node`
and `xattr.node` had to be built locally:

```
npm rebuild macos-alias fs-xattr
```

This is **not specific to this change** — it's an existing host-env
issue tracked separately by change
`fix-darwin-dmg-maker-macos-alias`. Phase 1 is unblocked once the
rebuild is run; CI runners pin a tested Node + npm combination that
produces working prebuilds.

### Outstanding spike work

Tasks 1.2 (macOS arm64), 1.3 (Linux .deb), 1.4 (Windows .exe), and
1.5 (Linux AppImage) need build hosts with the right toolchains. Tasks
1.6–1.8 (functional smokes: launch + spawn pi + openspec) need a
clean target machine for each platform. The macOS x86_64 result above
satisfies the size half of 1.10 on one of four platforms.

## Decisions ratified

Three open questions surfaced during exploration. All three are ratified
as stated below; tasks 0.1–0.4 in `tasks.md` reference this section.

### Q1 — Disposition of `streamline-electron-bootstrap-and-recovery` (91/97)

**Ratified:** Archive the in-flight change as-is. Group 16 Failures 1–5
are retained where they have already landed on `develop`. Under this
change, Failures 1 and 2 (workspace-materialize rescue, managed-dir-root
resolver) become **vestigial** — the wipe scenarios they defend against
and the layout they probe no longer exist once `~/.pi-dashboard/` is
eliminated from the runtime path. Failures 3, 4, 5 (dashboard-paths
split, server-identity retry, watchdog respawn) remain load-bearing and
are inherited by this change. The vestigial Failures 1 and 2 modules
are deleted in Phases 3 and 5.

Rationale: the 91 landed tasks shipped real fixes (log-path single
source of truth, identity-verified health check, watchdog respawn) that
stand on their own merit independent of the runtime-install
architecture. Reverting them to delete the two vestigial pieces would
be more invasive than leaving them archived and subtracting the
vestigial modules under this change's scope.

### Q2 — Wizard end-state: one welcome step or zero

**Ratified:** One welcome step on first launch, zero on subsequent
launches. A first-run marker at `~/.pi/dashboard/first-run-done` (new
helper `getFirstRunMarkerPath()` in `packages/shared/src/dashboard-paths.ts`)
is written when the wizard completes. `packages/electron/src/main.ts`
skips wizard rendering when the marker is present.

Rationale: a one-shot welcome gives the user (a) a clear "the app is
installed and ready" signal, (b) the `Advanced ▾` disclosure to switch
to remote-server mode before the local server is launched (the
`docker-packaging` pattern), and (c) a place to surface bundled-pi /
bundled-openspec version info. Zero steps on relaunch keeps the
day-two experience friction-free.

### Q3 — Bridge arm parity

**Ratified:** Out of scope for this change. The bridge arm
(`pi install <bridge>` then `pi` auto-starts the dashboard server) is
unaffected by this change and continues to work against the new
immutable-bundle server build. A follow-up `/opsx-explore` will
evaluate whether the bridge arm benefits from the same
runtime-install elimination — likely yes for symmetry, but the
analysis is independent and gated on this change shipping first.

Rationale: the bridge arm does not own a `node_modules/` directory
separate from pi's; it spawns the dashboard server out of the npm
package that pi resolved. There is no offline-cache, no preflight,
no installable.json. The bridge arm is already closer to the
immutable-bundle ideal than the Electron arm. Treating it now would
dilute this change's diff and delay the value of collapsing the
Electron pyramid.
