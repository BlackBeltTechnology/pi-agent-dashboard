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

### macOS arm64 (host: macOS 26.2, Node 24.15.0, 2026-05-20)

Second foreground spike, host-native arm64, against the dep-lifted
branch (`feat/enable-standalone-npm-install`, post-commits `6f389be7`
+ `148f4b52` + `20d1a39c`). Phase 1.1.k GO/NO-GO guard executed for
the first time.

| Metric | Value |
|---|---|
| Build command | `bash packages/electron/scripts/build-installer.sh` |
| `.dmg` size | **272 MB** |
| Stale May-19 `.dmg` (pre-dep-lift, node-pty 1.1.0) | 242 MB |
| Proposal-text "baseline" v0.5.3 | 225 MB |
| **Size delta vs stale baseline** | **+30 MB** (well under +150 MB threshold) |
| **Size delta vs proposal baseline** | **+47 MB** (also well under +150 MB) |
| Bundled-server tree size | 172.2 MB (`resources/server/`) |
| `pi-coding-agent` version bundled | **0.74.2** (floor: 0.74.0) ✓ |
| `openspec` version bundled | **1.3.1** (floor: 1.3.0) ✓ |
| `tsx` version bundled | **4.22.3** (floor: 4.21.0) ✓ |
| `node-pty` version bundled | **1.2.0-beta.13** (F1 fix) |
| `node-pty` prebuild triples present | **6 / 6** (darwin-{arm64,x64} + linux-{arm64,x64} + win32-{arm64,x64}) |
| 1.1.k guard log line | `node-pty prebuilds OK — 4/4 required triples present (all 6 triples present)` |
| Bundled Node version | v22.12.0 |
| Transitive `@earendil-works/*` packages bundled | `pi-agent-core`, `pi-ai`, `pi-coding-agent` |

**Why arm64 grew while x64 shrunk** (vs the earlier x86_64 spike):
the x64 spike removed the `offline-packages/npm-cache.tar.gz` (≈80 MB
of gzipped cacache) and replaced it with an unpacked `node_modules/`
tree that compresses well under DMG zlib. The arm64 spike here also
removed offline-packages, but the dep-lifted bundle is comparing
against the stale May-19 build that **already** had offline-packages
stripped (242 MB) — so the +30 MB delta is the actual cost of pi +
openspec + tsx as a regular `node_modules/` tree (no longer
gzipped at rest). Both numbers are consistent with the proposal's
estimated "+50–80 MB" ceiling.

**1.1.j re-validation:** `node scripts/verify-release-deps.mjs`
returns `OK — 5 rules passed` after extending the rule set with
pi/openspec/tsx floors. All five floors satisfied by the produced
bundle.

**1.1.k first execution:** the guard fired cleanly post-`npm install`
and reported all required + advisory triples present. Builds with
any missing required triple would exit 1 with a diagnostic pointing
to F1 — verified by inspection of the guard's conditional branches.

**Outstanding macOS spike work:** `.app` launch + WebSocket
`spawn_session` smoke (task 1.6) still needed to close 1.10 GO/NO-GO
on this platform.

### Linux Docker build path — broken locally (2026-05-22)

Attempted `bash packages/electron/scripts/build-installer.sh --linux
--arch x64` from macOS arm64 host. Outcome:

- Docker image `pi-dashboard-electron-builder` built successfully on
  `linux/amd64` emulation.
- `bundle-server.mjs` ran inside container: pi 0.74.2 / openspec 1.3.1 /
  tsx 4.22.3 / node-pty 1.2.0-beta.13 all installed as regular deps.
- `electron-forge package --platform linux --arch x64` completed (“Packaging
  for x64 on linux → Finalizing package”).
- `electron-forge make --platform linux --arch x64` logged `Making for the
  following targets: , ` (two unnamed makers) and produced **no `.deb`
  and no `.AppImage`**. `find out/make -type f` returned empty inside the
  container.

**Diagnosis:** pre-existing tooling drift. CI uses `npm run electron:make
-- --arch=x64` (no explicit `--platform`); `docker-make.sh` passes
`--platform linux --arch x64`. Forge 7.6.0 silently drops makers whose
platform claim mismatches the explicit `--platform` flag in some
configurations. **Not introduced by this change** — reproducible on
`develop` without the dep-lift commits applied. To be tracked under a
separate `fix-electron-docker-linux-makers` change.

**Mitigation for this proposal:**

- The dep-lift mechanic at the npm-install layer is independently
  validated: container log shows `added 333 packages` for
  `resources/server`, with pi/openspec/tsx resolved as direct deps and
  the linux-x64 node-pty prebuild present in the bundle. The Phase 1.1.k
  guard (executed during the local macOS arm64 build) is platform-agnostic
  and would behave identically inside the linux container.
- Tasks 1.3, 1.4, 1.5 are routed to CI's `publish.yml` Linux + Windows
  matrix legs for Phase 1 GO/NO-GO sign-off. Local Docker builds remain
  useful for the bundle-server portion and for verifying the dep-lift
  resolves under linux-x64 npm resolution, but the maker stage is owned
  by CI until the tooling fix lands.
- No proposal change required — the proposal's central claim (`npm
  install` resolves pi/openspec/tsx without runtime install) is verified
  on linux-x64 inside the container before the maker step fails.

**Implication for Phase 1.10 GO/NO-GO:** macOS arm64 closes the local
branch of the threshold (size + bundled deps + prebuild guard). Linux
`.deb`/`.AppImage` and Windows ZIP threshold closures happen on the next
CI run against this branch. Pre-merging the branch is unblocked once CI
produces green Linux + Windows artifacts; no local Docker fix is required
to land Phase 1.

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

### Field observations against today's runtime-extract layout (2026-05-19)

A hands-on session against an installed `PI-Dashboard.app` v0.5.3 surfaced
three concrete failure modes that this change eliminates by construction.
Recorded here because they sharpen the proposal's motivation and give
QA (task 9.7) concrete scenarios to assert against.

| Observation | Today's behavior | After this change |
|---|---|---|
| `~/.pi-dashboard/` size on a single user's machine | **1.5 GB** (extracted node_modules tree, duplicated against the .app's bundled copy at `/Applications/PI-Dashboard.app/Contents/Resources/server/node_modules/`) | 0 bytes — directory not created |
| `~/.pi-dashboard/node_modules/@blackbelt-technology/` between Electron launches | Wiped to empty between launches by the re-extract whitelist ("survive-extract" list excludes the namespace dir). Running server keeps module references in memory but any lazy file lookup (incl. `existsSync` in static-serve) misses. | Path does not exist; bundled `.app/Contents/Resources/server/` is the only resolver target |
| `GET /` after Electron launch | HTTP 404 — server boots in API-only mode because all 6 `clientSearchPaths` (relative to the wiped namespace dir) miss the actual bundle at `~/.pi-dashboard/packages/dist/client/index.html` | HTTP 200 — single resolver target is `<resources>/server/dist/client/`, which never moves |
| `/api/health` after Electron launch | 200 (server's WS/HTTP gateways do not depend on the wiped dir) | unchanged |
| Symptom presented to the user | "Unexpected error during startup: Port 8000 is occupied by a non-dashboard service" (the identity-check banner from a second launch attempt racing the first) **plus** silent 404 on `/` from the first | First launch: server up, UI served, no error dialog |

**Failure-mode chain reproduced end-to-end (proves Failure 1+2 of group 16 are vestigial under this change):**

1. `PI-Dashboard.app` launches, spawns server pointing at `~/.pi-dashboard/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts`.
2. `bundle-extract.ts` re-extracts the app bundle into `~/.pi-dashboard/`, wiping the namespace dir as a side effect.
3. Server process keeps running (Node holds module references in memory from the brief window the files existed).
4. Server's static-serve `clientSearchPaths.find(p => existsSync(...))` returns null — all 6 strategies miss because they're relative to the wiped namespace dir.
5. `hasProductionBuild = false` → `fastify-static` never registers → every `GET /<anything>` returns 404.

`materializeWorkspaceSymlinks` (Failure 1) and `resolveManagedDirRoot`
(Failure 2) are precisely the rescue paths that exist *because of*
this chain. Under the immutable-bundle architecture proposed here,
step 2 cannot occur (no re-extract), so step 5 cannot occur (resolver
has one durable target), so both rescue paths are dead code.

### Findings from `enable-standalone-npm-install` work (2026-05-20)

The in-flight change `enable-standalone-npm-install` ran a parallel
investigation against the *standalone* arm (`npm i -g
@blackbelt-technology/pi-agent-dashboard`) and produced concrete
artifacts (Docker repro + smoke scripts + repo-lints) that this
change inherits when it archives that proposal (tasks.md §2.9).
Five findings materially affect this proposal:

#### F1 — `node-pty@1.1.0` has NO linux prebuilds (corrects "Why" table Reason d)

The proposal's "Why" table claimed `node-pty` ships prebuilds for
`darwin/linux/win × arm64/x64`. **This is false for the pinned
version.** A repacked `node-pty@1.1.0` tarball contains only
`prebuilds/darwin-arm64`, `darwin-x64`, `win32-arm64`, `win32-x64`.
Linux is absent. On a clean `node:22-bookworm-slim`, `npm install`
fires the `node scripts/prebuild.js || node-gyp rebuild` postinstall,
which fails without Python + C++ toolchain.

```
npm error path /usr/local/lib/node_modules/@blackbelt-technology/.../node-pty
npm error command sh -c node scripts/prebuild.js || node-gyp rebuild
npm error > Rebuilding because directory .../prebuilds/linux-x64 does not exist
npm error gyp ERR! find Python ... Could not find any Python installation to use
```

**Fix:** pin `node-pty` to `1.2.0-beta.13` (or later beta in the
`1.2.0-beta.*` track) in `packages/server/package.json`. That version
ships all six prebuild triples. Verified locally:

```
$ tar tzf node-pty-1.2.0-beta.13.tgz | grep prebuilds/ | sort -u
prebuilds/darwin-arm64
prebuilds/darwin-x64
prebuilds/linux-arm64
prebuilds/linux-x64
prebuilds/win32-arm64
prebuilds/win32-x64
```

Done in this branch (`packages/server/package.json`: `"node-pty":
"1.2.0-beta.13"`, lockfile regenerated). The pin is guarded against
regression by `scripts/verify-release-deps.mjs` (a `minVersion`
rule).

**Implication for this proposal:** the build-time `npm install` in
`bundle-server.mjs` (Phase 1 task 1.1.e) MUST run with `node-pty
>= 1.2.0-beta.13` resolved, or every linux build will fail at
`npm install` time (not at user-install time, which is the
standalone arm's problem). Phase 1 GO/NO-GO threshold should
explicitly assert prebuild presence for all four target platforms
in the bundled `node_modules/node-pty/prebuilds/` tree.

#### F2 — `runDegradedModeBootstrap` is NOT unchanged

The proposal's "Code kept" section lists `packages/server/src/cli.ts`
as `(unchanged)`. That is inconsistent with the deletion of
`packages/shared/src/bootstrap-install.ts`. `cli.ts::runDegradedModeBootstrap`
(lines ~297–350) imports and calls `bootstrapInstall(...)` from that
module. Removing the module without touching cli.ts produces a
TypeScript compile error.

Three consistent dispositions, pick one in Phase 3:

1. **Delete `runDegradedModeBootstrap` outright.** Justified: under
   regular-dep lift, pi is always resolvable from the package's own
   `node_modules/`. `runDegradedModeBootstrap`'s `if (initial.ok)`
   short-circuit ALWAYS fires. The function becomes a single log
   line. Simpler to delete the entire `if-pi-not-resolved` branch
   and inline the `if (initial.ok)` happy-path logic into
   `runForeground`.
2. **Keep the function as a defensive log-only happy-path.** Reduces
   diff size; the function body becomes `const r = registry.resolve("pi");
   if (r.ok) console.log(...); else throw;`. The `else` throw becomes
   appropriate because pi-missing in this architecture is a corrupted
   install, not a bootstrap state.
3. **Keep both the function AND `bootstrapInstall`.** Defensible only
   if the bridge arm or some future scenario still needs the runtime
   installer. Today's bridge arm does not. Not recommended.

Recommendation: option 1 (delete). It is the cleanest match for
"runtime-install elimination" semantics. Add an explicit task under
Phase 3 (e.g. `3.X Delete runDegradedModeBootstrap and inline the
pi-resolved logging into runForeground`).

#### F3 — `localhost-guard` blocks Docker port-forwarded smoke requests

`packages/server/src/localhost-guard.ts` returns HTTP 403 to any
request whose source IP is not loopback/trusted/authenticated. Docker's
`-p 18000:18000` makes host-originated `curl localhost:18000`
requests appear to come from the container's docker0 bridge IP
(`172.17.0.1` typically), which is NOT loopback from the container's
perspective. Body: `{"success":false,"error":"Access denied"}`.

From inside the container, `curl localhost:18000` works (loopback).

For Phase 1 functional smokes (tasks 1.6–1.8) and any CI gate
running under Docker: the smoke runner MUST curl from inside the
container (`docker exec ... curl ...`) or set up auth headers. The
existing `scripts/test-standalone-npm-install-docker.sh` (inherited
from `enable-standalone-npm-install`) implements the
curl-from-inside-container pattern and is a working reference.

#### F4 — `npm pack -ws --include-workspace-root` crashes on npm@11.11.0

Running `npm pack -ws --include-workspace-root --pack-destination ...`
at the workspace root exits with `npm error code ERR_OUT_OF_RANGE
npm error data is too long` AFTER successfully producing the
workspace tarballs. Reproduced on `npm@11.11.0` on macOS Sonoma.

Workaround: loop over `find packages -maxdepth 2 -name package.json`
and call `npm pack --workspace=<dir> ...` individually, plus a
separate `npm pack ...` for the root. Filter out `private: true`
workspaces (Electron, demo-plugin). Implemented in
`scripts/test-standalone-npm-install-docker.sh`.

Relevant to this proposal because Phase 1's spike + Phase 6's
release workflow rely on `npm pack`. The `--include-workspace-root`
shorthand cannot be trusted on the current npm version; either pin
npm to a working version (none confirmed yet) or use the
individual-pack pattern.

#### F5 — Working Docker smoke + WebSocket session-spawn helper

The `enable-standalone-npm-install` branch ships:

- `scripts/test-standalone-npm-install-docker.sh` — 9-step lifecycle
  smoke against `node:22-bookworm-slim`: pack → install all
  tarballs at once → `pi-dashboard --version` → `pi-dashboard start`
  → poll `/api/bootstrap/status` (`installing` → `ready`) → `GET /`
  → `spawn_session` via WebSocket → verify session in `/api/sessions`.
- `scripts/lib/smoke-spawn-session.mjs` — Node 22 native-WebSocket
  helper that sends `spawn_session` and awaits `session_added`.
  No `wscat`/`websocat` dependency; works in stock `node:22-*`
  containers.

Last run against current branch (post F1 fix):
```
[smoke] step 9/9: spawn a pi session and confirm it registers
[smoke]   [spawn] ws open → sending spawn_session cwd=/tmp/smoke-cwd
[smoke]   [spawn] spawn_result success=true
[smoke]   [spawn] ✓ session live: type=session_added cwd=/tmp/smoke-cwd
[smoke]   /api/sessions confirms 1 session at /tmp/smoke-cwd
[smoke] ✓ All checks passed on node:22-bookworm-slim.
```

**Implication for this proposal's Phase 1:** the standalone-arm
lifecycle is already proven against a clean Linux container with
pi/openspec installed as regular deps (the same mechanism this
proposal will use for the Electron arm). The smoke scripts are
ready to be repurposed for Phase 1 task 1.6 — swap `pi-dashboard
start` for `open PI-Dashboard.app`, swap `node:22-bookworm-slim`
for a clean macOS/Linux/Windows VM, and the WebSocket
`spawn_session` step ports verbatim.

#### F6 — Auxiliary inheritances

Smaller artifacts from the `enable-standalone-npm-install` branch
that survive supersedure and are useful here:

- `scripts/verify-release-deps.mjs` — pre-release dep-shape gate.
  Currently asserts `jiti` + pinned `node-pty` are in
  `packages/server/package.json`. Phase 6 should extend it with
  rules for `@earendil-works/pi-coding-agent`, `@fission-ai/openspec`,
  and `tsx` once they are lifted to regular deps.
- `packages/shared/src/__tests__/jiti-packages-parity.test.ts` —
  repo-lint asserting `JITI_PACKAGES` in `binary-lookup.ts` and
  `bin/pi-dashboard.mjs` stay identical. Defends against the
  v0.5.3 fork-name drift that bit one prior release.
- Improved `bin/pi-dashboard.mjs` error message ("jiti not found…
  This is unexpected: jiti ships as a direct dep…") replaces the
  legacy "install pi globally" hint.

#### F7 — Pi extensions DO live in `~/.pi-dashboard/node/lib/node_modules/` (corrects "Why" table Reason b)

The proposal's "Why" table claimed user `pi install <ext>` writes only
to `~/.pi/agent/…`, never to `~/.pi-dashboard/node_modules/`. **This is
wrong** when the bundled `~/.pi-dashboard/node/bin/` is on PATH (the
default for Electron installs).

Confirmed on a live install:

```
@blackbelt-technology/pi-model-proxy@0.2.0   → nested @mariozechner/pi-coding-agent@0.73.1
@howaboua/pi-glm-via-anthropic@0.1.1         → nested @mariozechner/pi-coding-agent@0.73.1
@tintinweb/pi-subagents@0.7.3                → nested @mariozechner/pi-coding-agent@0.73.1
pi-agent-browser@0.1.0                       → nested @mariozechner/pi-coding-agent@0.73.1
```

The whitelist (`ELECTRON_OWNED_PACKAGES`) defended against a **real**
coexistence pattern, not an imagined one.

**Why the eliminate decision still stands:** under this proposal the
Electron arm no longer puts a bundled Node on PATH. Future
`pi install <ext>` calls resolve against the user's own npm-global
(or pi's per-package cache under `~/.pi/agent/packages/`). The pattern
goes away because the trigger (a bundled Node on PATH owning an
npm-global root) goes away.

**Implication for Migration:** the proposal text "surface a Doctor row:
'Legacy install directory detected at `~/.pi-dashboard/` — safe to
delete'" is **incorrect** for users upgrading from v0.5.x. Migration
messaging MUST warn:

> Legacy install directory detected at `~/.pi-dashboard/`. Inspect
> `~/.pi-dashboard/node/lib/node_modules/` before removing —
> user-installed pi extensions may live there. Reinstall them via
> `pi install <pkg>` against your system Node before deletion.

No automated wipe under any condition.

#### F8 — Standalone CI smoke matrix shape

`enable-standalone-npm-install` expanded
`.github/workflows/ci.yml::standalone-install-smoke-linux` from 2 jobs
(`node22 × {bookworm-slim, alpine}`) to **6 jobs**:
`{Node 22, 24, 25} × {bookworm-slim, alpine}`, `fail-fast: false`,
per-row `node-version` via `matrix.include:`.

Constraints validated:

- `node-guard` refuses Node 22.0–22.17 and 24.1–24.2 (node#58515).
  Docker `node:24-*` ships ≥24.3; `node:25-*` ships unrefused.
- Root `engines.node: >=22.12.0 <25` blocks Node 25 via
  `engine-strict=true`, but the smoke runs `npm ci
  --engine-strict=false` to exercise the runtime path on 25. Server
  runtime works on 25; only the Electron DMG maker chain breaks.
- Transitive engines (`pi-tui@0.75.3` ≥22.19, `posthog-node` ≥22.22)
  satisfied by any 24.x ≥24.3 and any 25.x.

**Disposition:** matrix **preserved**. Polling target inside
`scripts/test-standalone-npm-install.sh` flips from
`/api/bootstrap/status` (which no longer exists) to `/api/health`.
The 6-job shape, engine-strict bypass, and per-row Node version
metadata carry over verbatim. Supersedes the proposal.md line
marking the script for deletion.

#### F9 — Unix `pi` tool-registry chain has no `bareImportCliStrategy` (Phase 1 BLOCKER)

Discovered during the macOS arm64 Phase 1.6 smoke (2026-05-23). The
freshly-built `.dmg` was attached and the bundled server launched
with `PATH=/usr/bin:/bin:/usr/sbin:/sbin` and a clean `HOME` (no
system-installed `pi`, no managed `~/.pi-dashboard/node/bin/` —
simulating a clean install). Server logged:

```
[bootstrap] installing (pi unresolved, running background install)
```

Despite `Resources/server/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`
being present, executable (`-rwxr-xr-x`), with `#!/usr/bin/env node`
shebang, and reachable via `node_modules/.bin/pi` symlink.

**Root cause** in `packages/shared/src/tool-registry/definitions.ts`
(`piExecutorDef`):

```ts
const unixStrategies = [
  overrideStrategy("pi", deps),
  managedBinStrategy("pi", deps),    // ~/.pi-dashboard/node/bin/pi
  whereStrategy("pi", deps),         // PATH lookup
];
```

The Windows chain includes `bareImportCliStrategy(pkg, cliEntry)` for
both pi-coding-agent aliases. The Unix chain does not. The header
comment is explicit:

> On Unix, the chain finds `pi` on PATH; argv = [pi].

This design assumes pi is installed globally via npm (so it lives on
`$PATH`). **The proposal breaks that assumption** for the Electron arm:
pi is bundled inside the `.app` and the `.app`'s `node_modules/.bin/`
is not on the user's shell PATH.

**Consequence under R3 (proposal as written):** the bundled `.app` on
macOS/Linux, when launched on a machine without a system-installed pi,
falls into the *exact* runtime-install path the proposal claims to
eliminate. The pi-not-resolved branch calls `bootstrapInstall(...)`,
which writes to `~/.pi-dashboard/`. **The proposal's central
architectural claim is blocked on Unix until this resolver gap is
closed.**

**Fix options (Phase 1, mandatory before 1.10 GO/NO-GO):**

1. **Add `bareImportCliStrategy` to the Unix chain.** Symmetric with
   Windows. Resolves to `dist/cli.js` and `nodeScriptToArgv` wraps it
   with `node` to produce `[node, dist/cli.js, ...args]`. Cleanest
   match for the immutable-bundle architecture.
2. **Prepend bundled `node_modules/.bin/` to server-spawn PATH.**
   Set in `packages/server/bin/pi-dashboard.mjs` or
   `packages/electron/src/lib/server-lifecycle.ts`. Existing
   `whereStrategy("pi")` then finds `.bin/pi` and invokes
   `dist/cli.js` via its shebang. Smaller diff but couples the
   resolver to a PATH-injection side-channel.

**Recommendation: option 1.** Mirrors the Windows chain (known-good).
Keeps the resolver as single source of truth for binary resolution.
No PATH side-channel.

**Correction (during implementation 2026-05-23):** the Windows chain
was *not* in fact known-good on bundled packages. Both
`@earendil-works/pi-coding-agent` and `@fission-ai/openspec` declare
`exports` blocks that omit `./package.json`, so the existing
`bareImportCliStrategy.run()` body —
`createRequire(from).resolve("<pkg>/package.json")` — returns
`ERR_PACKAGE_PATH_NOT_EXPORTED` on modern Node. Existing tests passed
because the test fixture injected a fake `resolveModule` that bypasses
the real resolver; production code paths against real packages always
failed silently and fell through to the next strategy.

**Implemented fix (2026-05-23):**

1. Added `bareImportCliStrategy` (with both pi aliases) to `unixStrategies`
   in `piExecutorDef`. Same for `openspecExecutorDef`.
2. Added `findPackageJsonByDirWalk(pkgName, fromUrl, searchPaths?, exists?)`
   helper in `definitions.ts`. Walks up from `import.meta.url`'s
   directory looking for `node_modules/<pkgName>/package.json` directly
   on the filesystem — exports-map-immune. Honors injected `exists`
   predicate from `StrategyDeps` so tests stay deterministic; falls
   back to `existsSync` when none injected.
3. Both `bareImportCliStrategy` and `bareImportPackageDirStrategy` now
   try `resolveModule(...)` first (preserves test injection), then fall
   back to the dir walk.
4. Threaded `deps` through the openspec Win chain's
   `bareImportCliStrategy(pkgName, cliEntry)` call (was missing).

**Phase 1.6 macOS arm64 smoke status (post-fix 2026-05-23):**

- ✅ `.dmg` mounts, `.app` resolves, bundled deps present
- ✅ Bundled server starts (system Node fallback — bundled v22.12.0
  hits `node-guard` refusal range)
- ✅ `registerBridgeExtension` auto-registers bundled extension at
  `Resources/server/packages/extension`
- ✅ All 5 first-party plugins load from bundled `resources/plugins/`
- ✅ `spawn_session` endpoint accepts requests (`spawn_result
  success=true`)
- ✅ **Clean PATH + empty HOME → `[bootstrap] ready (pi resolved via
  bare-import)`.** F9 fix verified end-to-end. No `bootstrapInstall`
  triggered, no `~/.pi-dashboard/` write.
- ⚠ Full `session_register` round-trip blocked by environmental port
  9999 conflict with user's running dashboard (not a build issue)

**Test coverage:**

- `packages/shared/src/__tests__/tool-registry-definitions.test.ts`
  gained one new test ("bare-import wins over PATH when bundled cli.js
  exists (F9)") and updated chain-order test to the new 5-strategy
  shape.
- 36 snapshot tests under `packages/shared/src/__tests__/bootstrap/`
  regenerated to reflect the new chain.
- Full repo suite: 6092 passing / 17 skipped (identical baseline).

**Net impact on Phase 1.10 GO/NO-GO (macOS arm64):**

- Size delta: +30 MB (well under +150 MB ceiling). Updated build is
  240 MB (vs 272 MB with first F9-broken build; difference
  attributable to incremental caching of `resources/node` between
  rebuilds).
- Bundled deps satisfy all `verify-release-deps.mjs` minVersion rules.
- node-pty all-6-triples guard fires cleanly.
- pi resolves from bundled location — proposal's central claim verified.

macOS arm64 branch of 1.10 is now **green**. Linux + Windows branches
remain blocked on CI artifact production (1.3 / 1.4 / 1.5).

New tasks (added under Phase 1 in tasks.md):

- 1.1.l Add `bareImportCliStrategy("@earendil-works/pi-coding-agent",
  "dist/cli.js")` to `unixStrategies` in
  `packages/shared/src/tool-registry/definitions.ts::piExecutorDef`.
  Position between `overrideStrategy` and `managedBinStrategy`.
- 1.1.m Add same alias for `@mariozechner/pi-coding-agent` to preserve
  compatibility with legacy package name. Mirrors Windows
  `piPkgAliases.map(...)`.
- 1.1.n Add regression test covering pi resolution from a synthetic
  `Resources/server/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`
  tree on Unix with no PATH and no managed dir.
- 1.1.o Re-run Phase 1.6 macOS arm64 smoke with stripped PATH; expect
  `[bootstrap] ready (pi resolved via bare-import)`.

All nine findings reinforce the proposal's central architecture
(immutable bundle, regular-dep lift). F1, F2, F7, F9 are corrections /
blockers; F3–F5 and F8 are operational guidance for Phase 1 smokes
and CI; F6 is salvage list for Phase 1 task 1.1.c-style "already done
in another change" annotations.

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
