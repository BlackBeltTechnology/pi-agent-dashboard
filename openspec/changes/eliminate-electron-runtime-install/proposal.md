## Why

The Electron arm of the dashboard currently does at runtime — inside a
sandboxed home directory `~/.pi-dashboard/` — most of what `npm i -g`
does natively on a developer machine. It ships an offline npm cache,
extracts it on first launch, runs `npm install --offline`, maintains a
hand-curated whitelist of "owned" packages, runs a preflight inventory
diff on every launch, and offers a force-reinstall recovery surface
when that machinery fails.

Investigation during a `/opsx-explore` session traced every piece of
that machinery to **a single load-bearing capability**:

> `/api/pi-core/update` — the ability to upgrade pi/openspec/tsx
> in place, inside a running dashboard, without re-downloading the
> Electron application.

Four candidate justifications for the runtime-install architecture
were evaluated against the actual code:

| Reason | Verdict |
|---|---|
| (a) Installer-size — pre-installed `node_modules` would balloon the .dmg | Rejected. Installer is already 225 MB (v0.5.3). Adding ~50–80 MB of pre-installed pi/openspec/tsx is not a step change. |
| (b) User-installed `pi-*` extensions coexist in the same `node_modules/` and must be preserved | **Partially rejected (corrected 2026-05-20).** Pi extensions installed via `pi install` while the bundled `~/.pi-dashboard/node/bin/` is on PATH do land in `~/.pi-dashboard/node/lib/node_modules/` (confirmed: `pi-model-proxy`, `pi-glm-via-anthropic`, `pi-subagents`, `pi-agent-browser`, each with nested `@mariozechner/pi-coding-agent@0.73.1`). The whitelist did defend against a real coexistence pattern. The **eliminate decision still stands** because the Electron arm under this proposal no longer puts a bundled Node on PATH — future `pi install` calls resolve against the user's own npm-global. Legacy `~/.pi-dashboard/` must be treated as **read-only user data** (see Migration). See design.md F7. |
| (c) `electron-updater` patches incrementally and benefits from a writable cache | Rejected. `electron-updater` performs **whole-`.app` replacement**. It cannot and does not patch `~/.pi-dashboard/`. |
| (d) Native dependencies (notably `node-pty`) need cross-platform resolution at install time | Rejected, **with one correction**. The pinned version `node-pty@1.1.0` ships prebuilds for `darwin-{arm64,x64}` + `win32-{arm64,x64}` ONLY — **no `linux-{arm64,x64}` prebuilds**. On clean linux (`node:22-bookworm-slim`), v0.5.3 installs trigger `node-gyp rebuild` and fail without Python + C++ toolchain. **The fix is to bump to `node-pty@1.2.0-beta.13`**, which ships all six prebuild triples. Reproduced end-to-end in `docs/repro/v0.5.3-clean-node22-linux-x64-2026-05-19.log`. The runtime-install-vs-build-time-install argument still holds (prebuilds load read-only either way), but the version pin must change first. See design.md → "Findings from enable-standalone-npm-install work (2026-05-20)". |

The decision captured in this proposal: **`/api/pi-core/update` is
replaceable by an `.app` update via `electron-updater`.** Once that is
accepted, the entire runtime-install pyramid sitting on top of it
collapses.

The Electron-owned set in `~/.pi-dashboard/node_modules/` is exactly
three packages today:

```
@earendil-works/pi-coding-agent
@fission-ai/openspec
tsx
```

Pre-installing these into `resources/server/node_modules/` at build
time — alongside everything else `bundle-server.mjs` already bundles —
is mechanically straightforward and removes the entire runtime-install
code path.

## What Changes

### Dependency layout (build time + npm install time)

**Mechanism: lift `pi`, `openspec`, `tsx` from optional peers to regular
`dependencies` in `packages/server/package.json` (and the root
`@blackbelt-technology/pi-agent-dashboard` package as needed for global
install reach).**

Consequences:

- **Standalone arm** (`npm i -g @blackbelt-technology/pi-agent-dashboard`):
  npm itself installs pi/openspec/tsx into the package's `node_modules/`
  at install time. No runtime install. No `~/.pi-dashboard/`.
- **Electron arm**: `bundle-server.mjs` already runs an `npm install`
  step that populates `resources/server/node_modules/`. With pi as a
  regular dep, that single step now also installs pi. No special-case
  bundling logic.
- **Bridge arm**: pi is by definition already present (the bridge runs
  inside a pi process). The bridge extension keeps pi as an
  optional peer; the dashboard-server it auto-starts finds pi via the
  same package-resolution path it would in any arm.
- `node-pty` prebuilds continue to ride along inside the resolved
  `node_modules` tree.
- The `.app` (or `.deb` / `.AppImage` / `.exe`) ships with a complete
  pre-installed runtime. No tarballs, no offline cacache, no extraction
  step beyond what the OS installer already does.
- The `npm i -g` published tarball gets ~10–15 MB heavier (pi + openspec).
  Accepted: the alternative is a broken first launch + runtime bootstrap.

**This subsumes** `enable-standalone-npm-install` — see the
Supersedes table below.

### Launch (runtime)

- `selectLaunchSource()` collapses from five strategies to two:
  `attach` (running server detected) and `bundled` (spawn the bundled
  server from `process.resourcesPath`). `npmGlobal`, `piExtension`,
  `devMonorepo`, `extracted` are removed from the Electron path
  (the `--dev` workflow uses `ELECTRON_DEV` which already bypasses
  this chain).
- `resolveClientDir()` collapses from six strategies to one: the
  bundled client lives at `<resources>/server/dist/client/`.
- Server spawn inherits a PATH containing the bundled Node bin and
  the user's login-shell PATH (for spawned pi sessions that need
  git/ripgrep/etc.). No `<managedDir>` prepending.

### Server (runtime)

- **Retain** `POST /api/pi-core/update`, `GET /api/pi-core/changelog`,
  `GET /api/pi-core/versions`, and the `pi-core-checker` /
  `pi-core-updater` / `changelog-parser` modules. These remain useful
  for the standalone (`npm i -g`) and bridge (pi-extension) arms,
  which have a writable npm target. The Electron arm has no writable
  target (bundled `node_modules` is inside the read-only `.app`/
  `.deb`/`.AppImage`/`.exe`) and therefore **hides** the pi-core UI
  via a new `launchSource` field on `/api/health` (see below). The
  Electron arm's pi-version update path is `electron-updater` whole-app
  replacement.
- Add `launchSource: "electron" | "standalone" | "bridge"` field to
  `GET /api/health`. Detection: `process.env.DASHBOARD_STARTER ===
  "Electron"` → `"electron"`; `"Bridge"` → `"bridge"`; else
  `"standalone"`. Single source of truth for the client-side gate.
- Remove the `/api/bootstrap/*` routes and `bootstrap-state` /
  `bootstrap-queue` / `bootstrap-install-from-list`. Drop the
  `bootstrapGate` `preHandler` from `pi-core-routes.ts` (pi-core
  endpoints become unconditionally available).
- Remove `pi-version-skew.ts` bootstrap-compatibility writer; keep
  only the pure `comparePiVersions` comparator for standalone arm.
- Remove `materializeWorkspaceSymlinks` rescue (Failure 1 of group 16
  goes away because the wipe it defends against no longer occurs).

### Wizard (renderer)

Collapse to a welcome screen with a single "Launch dashboard" CTA. No
package selection, no install progress, no completion step. Optional
"Advanced ▾" disclosure exposes "Connect to existing server: [URL]"
(the remote-mode pattern from `docker-packaging`).

The four-step wizard (welcome / select / progress / done) becomes a
one-step (welcome) or zero-step (auto-launch) flow.

### Loading page (renderer)

Loading page survives but loses every reinstall affordance. When the
server is unreachable, surface only:

- "Start server" (retry spawn)
- "Open Doctor"
- Server-log tail
- Known-servers list

Remove: inventory diagnostic IPC, reinstall button, force-reinstall
button, install-progress streaming.

### Doctor (renderer)

Slim to diagnostics only. Remove the force-reinstall section and the
managed-inventory probe. Keep all read-only checks (binary versions,
server status, log access).

### Build pipeline

- Remove `BUNDLE_OFFLINE_PACKAGES=1` opt-in. Bundling is now a single
  unconditional path: install everything at build time.
- Remove `bundle-offline-packages.sh`, `npm-cache.tar.gz`, the
  `offline-packages/manifest.json` resource, and `build-local.sh`'s
  offline-cache regeneration logic.
- `npm run build:local` simplifies to a thin wrapper that runs
  `bundle-server.mjs` + `electron-forge make`.

### Migration for existing installs

On first launch of a `.app` containing this change:

- If `~/.pi-dashboard/` exists from a prior install, **do not use it
  and do not delete it.** Use only the bundled resources.
- Surface a Doctor row: "Legacy install directory detected at
  `~/.pi-dashboard/` — may contain pi extensions installed via the
  bundled Node (check `node/lib/node_modules/` before removing).
  Manual review recommended." User-driven cleanup, no automated
  wipe. (Wording reflects F7 — see design.md.)
- `~/.pi/dashboard/config.json`, `~/.pi/agent/sessions/`, and
  `~/.pi/agent/settings.json` are unaffected and continue to work.

## Capabilities

### Modified Capabilities

- `electron-bootstrap-flow` — state machine collapses. `T1` always
  routes through `attach` → `launch-server` → `health-wait` → `done`
  (or via `wizard-welcome` on truly first launch). `preflight-inventory`,
  `silent-install`, `reinstall-managed`, `force-reinstall`,
  `version-skew-banner` states are removed.
- `electron-wizard` — collapses to one welcome step (or zero on auto-launch).
- `dashboard-recovery` (loading-page surface) — collapses to "retry +
  Doctor + log + known-servers". Reinstall affordances removed.
- `dashboard-server` — `GET /api/health` gains a `launchSource:
  "electron" | "standalone" | "bridge"` field. Single source of truth
  for arm-aware client gating.
- `pi-core-version-ui` — the Core sub-group of the Pi Ecosystem
  settings panel and the `PiUpdateBadge` header element SHALL be
  hidden when `launchSource === "electron"`. Recommended Extensions
  and Other Packages sub-groups continue to render in all arms.
  Backing endpoints, hooks, and components are otherwise unchanged.

### Removed Capabilities

- `bootstrap-preflight` — every-launch inventory diff against pin floor.
- `loading-page-recovery` — inventory probe + reinstall/force-reinstall
  buttons. Recovery is now Doctor + electron-updater.
- `doctor-force-reinstall` — surgical safe-wipe surface in Doctor.
- `installable-catalog` — `installable.json` v2 schema and three-tier
  catalog assembly.
- `managed-package-whitelist` — `ELECTRON_OWNED_PACKAGES` set and the
  parity regression test.
- `build-local` — `BUNDLE_OFFLINE_PACKAGES` opt-in and stale-pin
  invalidation. Replaced by a thin always-on bundling step.

> **Note:** the `pi-core-update` capability is **retained** (not
> removed). The pi-core update path is hidden under Electron but
> remains live for the standalone and bridge arms. See the `Server
> (runtime)` section above.

## Supersedes / interacts with in-flight work

| Change | Status | Disposition |
|---|---|---|
| `streamline-electron-bootstrap-and-recovery` | 91/97 | **Supersedes (mostly).** Group 16 Failures 3, 4, 5 (dashboard-paths split, server-identity retry, watchdog respawn) survive and are inherited by this change. Failures 1 and 2 (workspace-materialize, managed-dir-root resolver) become obsolete because the wipe they defend against and the layout they probe no longer exist. Recommended: archive `streamline-electron-bootstrap-and-recovery` as-is (it landed real fixes), then this change subtracts the now-vestigial parts. |
| `fix-stale-bundled-server-cache` | 0/16 | **Supersedes entirely.** The stale-cache problem is a property of runtime extraction; with no runtime extraction the failure mode cannot occur. Recommended: close without implementing. |
| `fix-electron-wizard-npm-root-enoent` | 23/25 | **Supersedes entirely.** The error is from a runtime `npm root -g` probe inside the wizard's install flow. With no wizard install flow, the probe is gone. Recommended: complete the 2 outstanding tasks only if they affect the standalone arm; otherwise close. |
| `skip-affected-bundled-node` | 12/17 | **Partially supersedes.** The bundled-Node version skipping mostly relates to runtime install behavior. Read each remaining task; salvage anything that affects the standalone arm. |
| `fix-electron-server-launch-node-bin` | 28/34 | **Simplifies.** The node-binary resolution chain in `pick-node.ts` collapses because there is only one node binary (bundled inside .app). Finish in this change's scope. |
| `fix-build-installer-stale-server-bundle` | 21/22 | **Independent — keep.** The fix concerns build-pipeline staleness and applies regardless of this change. |
| `docker-packaging` | in-progress | **Independent — keep.** The standalone (Docker) arm is untouched; in fact this change reinforces its position as the reference deployment. |
| `npm-publish-first-party-extensions` | 30/32 | **Independent — keep.** Unrelated to bootstrap layout. |
| `enable-standalone-npm-install` | 0/N | **Supersedes entirely.** That proposal solves "npm-global install needs runtime bootstrap of pi via existing bootstrap-install machinery into `~/.pi-dashboard/`." This proposal solves the same problem by **lifting pi/openspec/tsx from optional peers to regular `dependencies`**, so `npm install` itself handles it. The jiti direct-dep fix from that proposal is salvaged into Phase 1 of this change (small, orthogonal, genuinely correct). The bootstrap-from-empty-list / `useBootstrapStatus` polling / managed-dir-on-the-standalone-arm story all becomes unnecessary. Recommended: archive `enable-standalone-npm-install` with a supersede note pointing here. |

## Impact

### Code deleted (Electron + server + client + shared)

```
packages/electron/offline-packages.json
packages/electron/scripts/bundle-offline-packages.sh
packages/electron/scripts/bundle-recommended-extensions.sh
packages/electron/resources/offline-packages/
packages/electron/src/lib/offline-packages.ts
packages/electron/src/lib/dependency-installer.ts
packages/electron/src/lib/preflight-reconcile.ts
packages/electron/src/lib/force-reinstall.ts
packages/electron/src/lib/power-user-install.ts
packages/electron/src/lib/installable-catalog.ts
packages/electron/src/lib/wizard-badge.ts
packages/electron/scripts/build-local.sh         (or simplified)
packages/shared/src/managed-package-whitelist.ts
packages/shared/src/installable-list.ts
packages/shared/src/managed-workspace-materialize.ts
packages/shared/src/recommended-extensions.ts
packages/server/src/bootstrap-install-from-list.ts
packages/server/src/bootstrap-state.ts
packages/server/src/bootstrap-queue.ts
packages/server/src/pi-core-checker.ts
packages/server/src/pi-core-updater.ts
packages/server/src/pi-version-skew.ts           (bootstrap-writer part)
packages/server/src/routes/bootstrap-routes.ts
packages/shared/src/bootstrap-install.ts                             (runtime installer into ~/.pi-dashboard/)
packages/client/src/hooks/useBootstrapStatus.ts
packages/client/src/components/BootstrapBanner.tsx
```

**Pi-core machinery is retained** for the standalone and bridge arms:
`pi-core-routes.ts`, `pi-core-checker.ts`, `pi-core-updater.ts`,
`changelog-parser.ts`, `usePiCoreVersions`, `usePiChangelog`,
`pi-core-api.ts`, `PiUpdateBadge`, `WhatsNewDialog`, and the `Core`
sub-group of `UnifiedPackagesSection` all survive. They are gated
off in the client when `launchSource === "electron"`.

### Code simplified

```
packages/electron/src/main.ts                        (preflight branches removed)
packages/electron/src/lib/launch-source.ts           (5 strategies → 2)
packages/electron/src/lib/server-lifecycle.ts        (mode branches collapse)
packages/electron/src/lib/wizard-window.ts           (one step or removed)
packages/electron/src/renderer/wizard.html           (~620 → ~100 LOC)
packages/electron/src/renderer/loading.html          (reinstall buttons removed)
packages/electron/src/lib/doctor.ts                  (force-reinstall removed)
packages/electron/src/lib/doctor-window.ts           (force-reinstall IPC removed)
packages/electron/src/renderer/doctor.html           (force-reinstall UI removed)
packages/electron/scripts/bundle-server.mjs          (extended to include pi/openspec/tsx)
packages/server/src/cli.ts                          (drop `maybeSeedDefaultInstallableList` + bootstrap-install orchestration block + `server.bootstrapState` field; CLI no longer installs anything at startup)
packages/server/src/server.ts                        (client-dir resolver: 6 → 1; drop bootstrap route wiring + `bootstrapState.subscribe` hook + bootstrap-state gate plumbing)
packages/server/src/routes/system-routes.ts          (add launchSource field to /api/health)
packages/server/src/routes/pi-core-routes.ts         (drop bootstrapGate preHandler; pi-core endpoints become unconditional)
packages/server/src/resolve-client-dir.ts            (single strategy)
packages/electron/src/lib/pick-node.ts               (single bundled node)
packages/server/src/pi-version-skew.ts               (trim to pure `comparePiVersions`; drop bootstrap-compat writer)
packages/shared/src/rest-api.ts                      (HealthResponse gains launchSource)
packages/client/src/App.tsx                          (drop BootstrapBanner / useBootstrapStatus mounts; gate <PiUpdateBadge /> on launchSource !== "electron")
packages/client/src/hooks/useMessageHandler.ts       (drop bootstrap_status_update / bootstrap_ticket_complete branches; keep pi_core_event)
packages/client/src/components/UnifiedPackagesSection.tsx  (gate Core sub-group rendering on launchSource !== "electron"; Recommended/Other survive in all arms)
```

### Reverting / unwinding `enable-standalone-npm-install`

That change (mostly implemented, not yet archived) integrated bootstrap-install
into the CLI startup path: `cli.ts maybeSeedDefaultInstallableList()` writes
`~/.pi/dashboard/installable.json` with pi + openspec on first run when the
file is absent, then `bootstrapInstallFromList` fetches them into
`~/.pi-dashboard/` in the background while the server runs in degraded mode.

Under R3 (pi/openspec/tsx as regular `dependencies` of
`@blackbelt-technology/pi-dashboard-server`), the entire degraded-mode dance
is unnecessary — `npm install -g @blackbelt-technology/pi-agent-dashboard`
brings pi/openspec/tsx in via the normal dep tree, so the server starts
ready.

Specific code paths added by `enable-standalone-npm-install` that this change
undoes:

- `cli.ts` `maybeSeedDefaultInstallableList()` function — removed.
- `cli.ts` import of `defaultInstallableList`, `bootstrapInstallFromList`,
  `updateBootstrapCompatibility`, `logCompatibilityWarning` — removed.
- `cli.ts` bootstrap-install orchestration block (≈ 165 LOC managing
  `server.bootstrapState`, `installPackages`, the `bootstrapInstall` call,
  version-skew compat warnings, subscription propagation) — removed.
- `packages/shared/src/installable-list.ts` (including the new
  `defaultInstallableList` helper) — deleted with the rest of the
  installable-list module.
- `scripts/test-standalone-npm-install.sh` — **converted, not deleted.**
  Polling target moves from `/api/bootstrap/status` → `/api/health`
  (`bootstrap.state` no longer exists). The 6-job CI matrix
  ({Node 22, 24, 25} × {bookworm-slim, alpine}) introduced by
  `enable-standalone-npm-install` (commits 8e890823 → 4dba29f9) is
  preserved — its purpose (validate `npm i -g` produces a runnable
  server) is more valuable post-elimination, not less. See design.md F8.
- `packages/server/src/__tests__/cli-seed-installable-list.test.ts` —
  deleted (tests an absent feature).
- `docs/service-bootstrap.md` "Standalone npm install" subsection — rewritten.
- `docs/faq.md` "How do I install pi-dashboard without Electron?" entry — rewritten.
- `CHANGELOG.md ## [Unreleased]` entry for the standalone-install flow — rewritten.

What survives from `enable-standalone-npm-install`:

- `jiti` as a direct dep of `packages/server/package.json` (task 1.1.c).
- `packages/server/bin/pi-dashboard.mjs` improved error message (task 1.1.f).
- `packages/shared/src/__tests__/binary-lookup-resolveJiti.test.ts` "own-tree, no pi" scenario (task 1.1.g).
- **`.github/workflows/ci.yml` standalone-install-smoke-linux matrix**
  — 6 jobs ({Node 22, 24, 25} × {bookworm-slim, alpine}). Polling
  endpoint flips to `/api/health` under this proposal; matrix shape
  preserved.
- **`scripts/verify-release-deps.mjs`** — pre-release dep-shape gate;
  extended in Phase 1 with rules for pi/openspec/tsx and node-pty
  pinned floor (5 rules total as of 2026-05-22).
- **`scripts/test-standalone-npm-install-docker.sh`** +
  **`scripts/lib/smoke-spawn-session.mjs`** — Docker lifecycle smoke +
  WebSocket spawn-session helper (see design.md F5). Repurposed as
  the Phase 1 reference smoke.
- **`engines.node: >=22.12.0 <25`** ceiling — Node 25 incompatible
  with Electron DMG maker (`macos-alias` → `appdmg`); server itself
  works on 25.

Those survive intact as genuinely orthogonal improvements.

New files:
```
packages/client/src/hooks/useLaunchSource.ts         (one-shot /api/health probe; module-level cache)
```

### Code kept (load-bearing for standalone arm and Electron-app lifecycle)

```
packages/electron/src/lib/app-updater.ts             (electron-updater — now sole update path)
packages/electron/src/lib/server-lifecycle.ts        (watchdog respawn — Failure 5)
packages/electron/src/lib/dependency-detector.ts     (login-shell PATH detection — still needed for spawned-session tool resolution)
packages/electron/src/lib/bundled-node.ts            (bundled node still needed)
packages/electron/src/lib/app-menu.ts                (kept, "Run Setup Wizard" item becomes optional)
packages/electron/src/lib/tray.ts
packages/electron/src/lib/doctor.ts                  (read-only diagnostics kept)
packages/shared/src/dashboard-paths.ts               (Failure 3 — log path single source of truth)
packages/shared/src/server-identity.ts               (Failure 4 — retry loop)
packages/server/src/cli.ts                           (NOT unchanged — see design.md "Findings from enable-standalone-npm-install work". `runDegradedModeBootstrap` calls `bootstrapInstall` from `packages/shared/src/bootstrap-install.ts`, which is in the delete list. Two options: (a) delete `runDegradedModeBootstrap` and the import — pi is always resolvable under regular-dep lift; (b) keep the function but have it noop when pi resolves successfully (it already does). Phase 3 of tasks.md must pick one explicitly.)
packages/server/src/process-manager.ts               (unchanged)
packages/extension/src/bridge.ts                     (bridge arm untouched)
```

### Net change

- **Deleted:** ~3500 LOC across Electron + server + client + shared.
- **Added:** ~150 LOC (bundle-server.mjs extension, migration Doctor row,
  loading-page slim, wizard slim).
- **Net reduction:** ~3350 LOC. One bootstrap surface area instead of
  three. One install path per arm.

### Installer size

Estimated `+50–80 MB` to the `.dmg` / `.exe` / `.deb` / `.AppImage` from
pre-installing pi/openspec/tsx as `node_modules` instead of shipping
their gzipped tarballs. Current 225 MB → estimated 275–305 MB. Below
Slack-class installer sizes; not perceived as a regression.

### Pi version upgrades

Today: `POST /api/pi-core/update` in-place upgrades pi independently.

After: pi version bumps ride a normal Electron release. Process:

1. Maintainer bumps pi pin in `bundle-server.mjs` (the new single
   source of truth for "what version of pi this .app ships with").
2. Maintainer cuts a dashboard release (`release-cut` skill).
3. `electron-updater` notifies users.
4. User clicks "Update" → new `.app` is downloaded and replaces the old.
5. On next launch, the new pi version is in use.

Power users who want pi-version flexibility independent of dashboard
releases continue to have it via the **standalone arm**
(`npm i -g @blackbelt-technology/pi-dashboard` plus their own pi
install). That arm self-selects the right user.

### Documentation impact

- `docs/electron-bootstrap-flow.md` — large rewrite. State machine
  collapses to four states (`checking-server-health`, `wizard-welcome`,
  `launch-server`, `health-wait`) plus `attach`/`done` terminals.
- `docs/service-bootstrap.md` — Chain 1 (Electron) section rewritten to
  remove `installable.json`, preflight, and silent-install language.
- `docs/architecture.md` — Electron-bootstrap section rewritten.
- `docs/file-index-electron.md` — many rows removed; survivors
  re-annotated.
- New: `docs/electron-immutable-bundle.md` — short doc explaining the
  immutable-bundle property and why it holds.

### Backward compatibility

- **Existing `~/.pi-dashboard/` directories** — not used, not deleted.
  Doctor surfaces an advisory row.
- **Existing `~/.pi/dashboard/config.json`** — fully compatible; no
  schema change.
- **Existing pi sessions in `~/.pi/agent/sessions/`** — unaffected.
- **User-installed pi extensions** — unaffected (they live in pi's
  own cache, not in `~/.pi-dashboard/`).
- **Bridge arm** — unaffected.
- **Standalone (npm-global / Docker) arm** — unaffected.

### Risk

- **Larger installer.** Accepted; quantified above.
- **Slower pi-version updates for .app users.** Accepted; the value
  exchanged is a smaller architectural footprint. Power users have
  the standalone arm.
- **One-way decision.** Once `/api/pi-core/update` is removed, restoring
  in-place pi upgrades would require rebuilding most of the deleted
  machinery. Acceptable because the alternative path
  (`electron-updater`) is already in place and tested.
- **Migration noise** for users who have `~/.pi-dashboard/` from prior
  versions. Mitigated by the advisory-only Doctor row; no
  silent deletes.
