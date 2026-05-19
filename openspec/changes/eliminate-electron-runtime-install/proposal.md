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
| (b) User-installed `pi-*` extensions coexist in the same `node_modules/` and must be preserved | Rejected. User `pi install <ext>` writes to **pi's own cache under `~/.pi/agent/…`**, not to `~/.pi-dashboard/node_modules/`. The whitelist defends against a coexistence pattern that does not exist. |
| (c) `electron-updater` patches incrementally and benefits from a writable cache | Rejected. `electron-updater` performs **whole-`.app` replacement**. It cannot and does not patch `~/.pi-dashboard/`. |
| (d) Native dependencies (notably `node-pty`) need cross-platform resolution at install time | Rejected. `node-pty` ships prebuilds for darwin/linux/win × arm64/x64; these are loaded at runtime from a read-only location with no compile step. |

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

### Bundle layout (build time)

- Extend `bundle-server.mjs` to install `pi`, `openspec`, `tsx` into
  `packages/electron/resources/server/node_modules/` at build time
  (alongside the dashboard server's own `node_modules`).
- `node-pty` prebuilds continue to ride along inside this tree.
- The `.app` (or `.deb` / `.AppImage` / `.exe`) ships with a complete
  pre-installed runtime. No tarballs, no offline cacache, no extraction
  step beyond what the OS installer already does.

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

- Remove `POST /api/pi-core/update`, `GET /api/pi-core/changelog`, and
  the `pi-core-checker` + `pi-core-updater` modules.
- Remove the `/api/bootstrap/*` routes and `bootstrap-state` /
  `bootstrap-queue` / `bootstrap-install-from-list`.
- Remove `pi-version-skew.ts` bootstrap-compatibility writer; keep
  only the pure comparator if standalone arm needs it.
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
  `~/.pi-dashboard/` — safe to delete". User-driven cleanup, no
  automated wipe.
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

### Removed Capabilities

- `bootstrap-preflight` — every-launch inventory diff against pin floor.
- `loading-page-recovery` — inventory probe + reinstall/force-reinstall
  buttons. Recovery is now Doctor + electron-updater.
- `doctor-force-reinstall` — surgical safe-wipe surface in Doctor.
- `installable-catalog` — `installable.json` v2 schema and three-tier
  catalog assembly.
- `managed-package-whitelist` — `ELECTRON_OWNED_PACKAGES` set and the
  parity regression test.
- `pi-core-update` — `/api/pi-core/update` + `/api/pi-core/changelog`
  endpoints and the checker/updater modules.
- `build-local` — `BUNDLE_OFFLINE_PACKAGES` opt-in and stale-pin
  invalidation. Replaced by a thin always-on bundling step.

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
packages/server/src/routes/pi-core-routes.ts
packages/server/src/routes/bootstrap-routes.ts
packages/client/src/hooks/useBootstrapStatus.ts
packages/client/src/components/BootstrapBanner.tsx
```

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
packages/server/src/server.ts                        (client-dir resolver: 6 → 1)
packages/server/src/resolve-client-dir.ts            (single strategy)
packages/electron/src/lib/pick-node.ts               (single bundled node)
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
packages/server/src/cli.ts                           (unchanged)
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
