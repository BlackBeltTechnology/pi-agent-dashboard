> **STATUS: PLANNED. Do not apply before 2026-10-28 (Node 26 Active LTS).**
> `strip-only-native-ts-loader` shipped 2026-10-12. Open questions resolved 2026-10-13 (see
> `design.md` Decisions); spec deltas written and `openspec validate --strict` passes.

## Why

`default-node-24-keep-22-floor` (archived 2026-06-28) explicitly deferred raising the Node floor
to *"its own change"*, because it is a louder, user-facing decision. This is that change.

Node 26 becomes Active LTS on 2026-10-28; Node 24 enters maintenance on 2026-10-20, and Node 22 is
already in maintenance (EOL 2027-04-30). Source: `nodejs/Release` `schedule.json`. After
`strip-only-native-ts-loader`, the loader no longer *needs* Node 26. The remaining reasons are
maintenance benefits:

- One supported Node line instead of four (22/24/25/26) shrinks the smoke matrix, the CI
  surface and the version-gate surface.
- The server-side nodejs/node#58515 handling (`isAffectedNode` startup check,
  `buildNodeUpgradeMessage`) becomes dead: the affected ranges (22.0–22.18.x, 24.1–24.2.x) lie
  entirely below 26.

These are not user-facing gains; dropping Node 22/24/25 for npm installs is the accepted cost.

## What Changes

- **BREAKING:** root `engines.node` goes from `>=22.19.0 <27` to `>=26.0.0 <27`;
  `packages/server/package.json` from `>=22.19.0` to `>=26.0.0`; `node-guard` refuses older Node
  at startup, with remediation hints updated to Node 26.
- `node-version.ts` splits its single `MIN_SUPPORTED_NODE` into a **dashboard server floor**
  (`26.0.0`) and a **pi spawn floor** (`22.19.0`). The pi-session spawn ladder keeps the pi floor
  and its `isAffectedNode` exclusion, so pi sessions spawned by the dashboard still run on Node
  22.19+/24.
- **Server-spawn runtime resolution:** the existing shared ladder
  (`packages/shared/src/platform/spawn-runtime.ts`) gains a server-gated, non-total mode used by
  - the **bridge auto-start**, instead of always using pi's `process.execPath`; when nothing
    qualifies it refuses, logs via `appendAutoStartLog`, and shows one TUI notice per session;
  - the **Electron app when no bundled Node exists** (dev / localLink / overlay sources), before
    the `ELECTRON_RUN_AS_NODE` fallback. Electron 43 embeds Node 24.18.1, so that fallback is used
    only if it qualifies; otherwise the app shows an error.
  No login shell is probed.
- Electron bundled Node (`_node-version.sh` `BUNDLED_NODE_VERSION`) v24.15.0 → v26.x; Docker base
  `node:24-bookworm-slim` → `node:26-bookworm-slim`; every workflow `node-version` → 26;
  `_smoke.yml` drops the 22/24/25 legs and the EOL-23 server-boot job (the loader's old tiers move
  to unit-level coverage); the Claude-plugin bootstrap script's range constants follow.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `server-startup-node-version-guard`: guard requirement replaced (floor 26, no separate #58515 check, smoke matrix `[26]`); remediation message names Node 26 and gates the managed hint on its version; predicates module splits dashboard floor vs pi floor.
- `pi-core-version-check`: "floor tracks pi minimum" replaced by "floor ≥ pi minimum" (repo-lint against pi's `engines.node`); bundled-Node lint also checks the dashboard floor.
- `bundled-node-runtime`: bundled Node satisfies the server engines range (was "v22 LTS").
- `electron-node-runtime-selection`, `electron-launch-source`: system-Node rung before the Electron-executable fallback; fallback only when its embedded Node meets the floor; else refuse with an error.
- `managed-node-runtime`: pi-session ladder keeps pi's floor; new server-spawn resolution (server-gated, no shell, not total).
- `server-launch`: Electron's execPath fallback only when its embedded Node qualifies; the bridge passes an explicit resolved `nodeBin`.
- `bridge-extension`, `bridge-auto-start-lifecycle`: auto-start resolves a qualifying Node or refuses, logs and notifies.
- `doctor-diagnostic`: system-Node detection accept-set narrowed to `>=26.0.0 <27`.
- `ci-cd-pipeline`: every workflow on Node 26; smoke matrix Node 26 only.
- `docker-packaging`: image based on `node:26-bookworm-slim`.
- `claude-code-plugin`: `--install` prerequisite range `>=26.0.0 <27`, lint-pinned.
- `native-ts-loader`: server boots on Node 26 only; old loader tiers verified at unit level.

## Impact

- **Users:** anyone running `pi-dashboard` from npm on Node 22, 24 or 25 must upgrade Node.
  Packaged Electron users need no action: the bundled Node moves to 26 with the app. A pi session on Node 22/24 auto-starts
  the server only if a Node 26 is resolvable (override, `PATH`, version-manager default, managed).
- **Contributors:** Electron dev launches need a Node 26 on `PATH` / version manager.
- **Release:** a major version bump under SemVer. Release notes have to lead with it.
- **Code:** `packages/shared/src/node-version.ts`, `packages/shared/src/platform/spawn-runtime.ts`,
  `packages/server/src/auth/node-guard.ts`, `packages/extension/src/server-launcher.ts`,
  `packages/electron/src/lib/pick-node.ts`, `packages/electron/src/lib/launch-source.ts`,
  `packages/electron/src/lib/dependency-detector.ts`, `packages/electron/scripts/_node-version.sh`
  plus `packages/electron/scripts/Dockerfile.build` and test scripts, `docker/Dockerfile`,
  `packages/claude-plugin/skills/pi-dashboard-bootstrap/scripts/ensure-dashboard.sh`,
  `.github/workflows/*.yml`, `scripts/test-standalone-npm-install-docker.sh`.
- **Compatibility / rollback:** no data migration. Rollback = revert the release and restore
  `engines.node`; the floor split and the resolver are behaviour-neutral on their own.

## Discipline Skills

- `doubt-driven-review`: an irreversible, public, user-breaking support-policy change.
- `observability-instrumentation`: bridge → server runtime resolution needs a visible outcome
  (TUI notice, auto-start log line, Electron error) so a refused auto-start is diagnosable.
- `performance-optimization`: resolution runs on the auto-start path; probe count is bounded and
  the latency measured.
- `review-code`: before commit.
