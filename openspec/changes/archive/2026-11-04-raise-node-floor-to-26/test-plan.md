# Test Plan — raise-node-floor-to-26

Stage: design   Generated: 2026-10-13

Hard gate: no unfillable slots. The Electron "user-facing error" maps to the existing launch-failure
path (`requestServerLaunch()` → `{ kind: "failed", reason }`, supervision `failed` phase).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | server-startup-node-version-guard: Refuse server start on Node outside the Node 26 engines range | BVA | L1 | automated | versions `v22.19.0`, `v24.15.0`, `v25.9.0`, `v26.0.0`, `v26.11.1`, `v27.0.0` | `isOutOfEnginesRange(v)` / `isUsableNodeVersion(v)` | out-of-range = true for 22.19.0, 24.15.0, 25.9.0, 27.0.0; false for 26.0.0, 26.11.1; `isUsableNodeVersion("garbage")` = false |
| E2 | server-startup-node-version-guard: Single-source Node-version predicates | equivalence partition | L1 | automated | the two exported floor constants | read them from `node-version.ts` | dashboard server floor = `26.0.0`; pi spawn floor = `22.19.0`; `node-guard.ts` re-exports the same `isOutOfEnginesRange` reference |
| E3 | server-startup-node-version-guard: Refuse server start… (startup) | state-transition | L1 | automated | `process.version` stubbed to `v24.15.0`, then `v26.0.0` | `assertNodeVersionSupported()` | 24.15.0 → `process.exit(1)`, stderr contains `Required: >=26.0.0 <27`, no `58515` text; 26.0.0 → returns normally |
| E4 | server-startup-node-version-guard: Engines-range message references bundled-Node remediation | decision table | L1 | automated | `<managedDir>/node/.version` absent / `v24.15.0` / unreadable / `v26.1.0` | `buildEnginesRangeMessage("v24.15.0", { managedDir })` | `.pi-dashboard` hint present only for `v26.1.0`; every variant contains `nvm install 26` and `brew install node`, none contains `node@24`; no Node process spawned |
| E5 | managed-node-runtime: Spawn-runtime resolution ladder (pi floor fallback) | equivalence partition | L1 | automated | spawned pi `engines.node` unreadable; only user Node `v24.15.0` | pi-session ladder resolves | selected runtime = the `v24.15.0` Node (gated on pi floor `22.19.0`, not `26.0.0`) |
| E6 | managed-node-runtime: Server-spawn runtime resolution | decision table | L1 | automated | override absent; `PATH` Node `v26.1.0`; own runtime `v24.15.0` | server-mode resolve | result = `PATH` Node `v26.1.0`, step `path` |
| E7 | managed-node-runtime: Server-spawn runtime resolution (version managers) | decision table | L1 | automated | override/`PATH` fail; nvm default `v24.15.0`; volta shim `v26.0.0` | server-mode resolve | result = volta Node; nvm candidate recorded as skipped with reason |
| E8 | managed-node-runtime: Server-spawn runtime resolution (own runtime) | BVA | L1 | automated | all earlier candidates fail; own runtime `v26.2.0`, then `v24.18.1` | server-mode resolve | 26.2.0 → own runtime selected; 24.18.1 → unresolved with own runtime skipped and reason recorded |
| E9 | managed-node-runtime: Server-spawn runtime resolution (none qualify) | equivalence partition | L1 | automated | pi `v22.19.0`, `PATH` `v24.15.0`, no managed, no VM Node 26 | server-mode resolve | unresolved result lists every candidate with version + skip reason |
| E10 | managed-node-runtime: Server-spawn runtime resolution (unparseable) | equivalence partition | L1 | automated | `PATH` candidate whose `--version` prints `node-nightly-xyz` | server-mode resolve | candidate skipped with reason; resolution continues to next step |
| E11 | managed-node-runtime: No shell invocation + bounded probe cost | invariant | L1 | automated | every candidate present (override, `PATH`, nvm + volta defaults, managed) and failing | server-mode resolve with a spawn spy | no `sh`/`bash`/`zsh`/`cmd.exe`/PowerShell spawned; `node --version` spawns ≤ distinct candidate paths (5); 0 for own runtime |
| E12 | electron-node-runtime-selection + electron-launch-source: pickNodeForServer order | decision table | L1 | automated | (bundled present) / (bundled missing, system `v26.1.0`) / (missing, no system, embedded `26.0.0`) / (missing, no system, embedded `24.18.1`) | `pickNodeForServer(input)` | `bundled` / `system` without `ELECTRON_RUN_AS_NODE` / `execpath-fallback` with flag / `unavailable` naming `24.18.1` and `>=26.0.0 <27` |
| E13 | doctor-diagnostic: System Node detection matches the Node 26 server accept-set | BVA | L1 | automated | resolved system Node `v24.15.0`, `v25.9.0`, `v26.0.0`, `v27.0.0`; on-disk nvm dir with `v24.15.0` + `v26.0.0` | `detectSystemNode()` | found only for `v26.0.0`; on-disk scan returns the `v26.0.0` path |
| E14 | pi-core-version-check: Node engines floor is at or above pi minimum supported Node | equivalence partition | L1 | automated | root + server `package.json`, installed pi `engines.node` | repo-lint | root `>=26.0.0 <27`, server `>=26.0.0`; lint fails when a fixture floor is set below pi's `22.19.0` |
| E15 | pi-core-version-check: Bundled Node version meets pi minimum Node | BVA | L1 | automated | `BUNDLED_NODE_VERSION` `v26.x` vs fixture `v24.15.0` | repo-lint | passes for v26.x; fails for v24.15.0 naming both versions and `_node-version.sh` |
| E16 | server-startup-node-version-guard: Single-source (scan + mirrors) | invariant | L1 | automated | `packages/*/src/**/*.ts`; non-TS mirrors | scan for `major >= 27`, `26.0.0`, `22.19.0` comparisons | only `node-version.ts` defines them; each mirror (engines, `ensure-dashboard.sh`, `BUNDLED_NODE_VERSION`, workflows, Docker base) pinned by a lint |
| E17 | ci-cd-pipeline: CI and publish workflows run on the supported Node line | invariant | L1 | automated | `.github/workflows/*.yml` except `deploy-site.yml`, `sync-release-version.yml` | repo-lint over `node-version:` | every value `26` or `26.x` |
| E18 | ci-cd-pipeline: Reusable standalone-install-smoke workflow + guard CI lockstep | invariant | L1 | automated | `_smoke.yml` | repo-lint (`smoke-node-matrix`) | Linux matrix majors = `[26]`, Windows leg = 26, no `standalone-install-smoke-eol-node23` job |
| E19 | claude-code-plugin: Consented install of the latest release | BVA | L1 | automated | resolved Node `v24.15.0`, `v25.9.0`, `v26.0.0`, `v27.0.0`; `ensure-dashboard.sh` constants | `ensure-dashboard.sh --install` (PIDB_TEST=1) | 24.15.0/25.9.0/27.0.0 → `STATUS=failed`, exit 1, no npm/npx run; 26.0.0 passes the gate; constants pinned to `engines.node` |
| E20 | native-ts-loader: register module tiers on a stubbed `node:module` | decision table | L1 | automated | stubbed module API: (no `registerHooks`, no `stripTypeScriptTypes`) / (`stripTypeScriptTypes`, no `registerHooks`) | import the register module | tier 3 → `module.register` + bundled `amaro`; tier 2 → `module.register` + native strip; no `PI_DASHBOARD_TS_LOADER`/jiti in errors |
| E21 | server-launch: Electron-host callers MUST supply an explicit Node binary | invariant | L1 | automated | `packages/electron/src/lib/**` + an `unavailable` pick | `no-electron-execpath-spawn` lint; `spawnFromSource` with unavailable pick | lint green (allowlist = `pick-node.ts`); `launchDashboardServer` not called; `requestServerLaunch()` returns `{ kind: "failed" }` with reason naming `>=26.0.0 <27` |
| E22 | bundled-node-runtime: Bundled Node satisfies the server engines range | invariant | electron | automated | packaged app (macOS/Linux/Windows build) | run `<resources>/node/bin/node --version` and start the server | version within `>=26.0.0 <27`; server reaches serving state, guard does not refuse |
| E23 | docker-packaging: Dockerfile builds a self-contained Node 26 image | invariant | ci | automated | `docker compose build` | `node --version` in image; spawn a PTY via node-pty | reports `v26.x`; PTY allocates and echoes shell I/O |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design D5 (server-mode resolution cost) | tail-latency measurement | — | manual-only | worst case: 5 failing candidates on macOS + Linux | record p95 wall time in `design.md`; no gate (spec bounds probe count via E11) | 20 runs per OS |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | bridge-extension: Resolution skipped when a server is reachable | state-transition | L1 | automated | dashboard answering on resolved port | `autoStartServer` on session start | resolver spy called 0 times; bridge connects |
| F2 | bridge-extension: Selected runtime is logged and used | state-transition | L1 | automated | no server; resolver returns nvm `v26.0.0` path | `autoStartServer` | one `appendAutoStartLog` line with path, `v26.0.0`, version-manager step; `launchDashboardServer` called with that `nodeBin` |
| F3 | bridge-extension: pi session keeps working without a server | state-transition | L1 | automated | auto-start refused (unresolved) | a server later becomes reachable via discovery | session stays usable; bridge connects to the new server |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | bridge-extension + bridge-auto-start-lifecycle: refusal | fault-injection (abort) | L1 | automated | resolver unresolved (pi `v22.19.0`, no Node 26) | `autoStartServer` with no server | no spawn; one auto-start log line naming port, `>=26.0.0 <27` and skipped candidates; `ui.notify` warning contains `Node >=26.0.0 <27`, `v22.19.0`, Node 26 / desktop-app hint, absolute `server.log` path |
| X2 | bridge-extension: Notice shown once per session | fault-injection (repeat) | L1 | automated | resolver stays unresolved | auto-start path invoked 3× in one session | `ui.notify` called exactly once |
| X3 | bridge-extension: Server started during resolution suppresses the notice | fault-injection (delay) | L1 | automated | resolver delayed; port starts answering mid-resolution | `autoStartServer` | bridge connects; no refusal `ui.notify` |
| X4 | bridge-extension: Concurrent sessions resolve once | fault-injection (race) | L1 | automated | two sessions, no server, shared lock dir | both call `autoStartServer` concurrently | resolver runs once (lock holder); one selection/refusal log line |
| X5 | server-startup-node-version-guard + ci-cd-pipeline smoke | fault-injection (boundary runtime) | ci | automated | packed tarballs installed on `node:26-bookworm-slim`, `node:26-alpine`, Windows Node 26, and Node `26.0.0` exactly | `_smoke.yml` boot | `/api/health` 200 on every leg, no EBADENGINE |
| X6 | bundled-node-runtime (ABI) | fault-injection (ABI change) | electron | automated | packaged app with bundled Node 26 | start server + run doctor | `node-pty` loads; doctor native-ABI check reports no mismatch |

---

## Coverage summary

- Requirements covered: 21/21 live delta requirements (every MODIFIED/ADDED requirement has ≥1 row; 5 REMOVED requirements are replaced by covered ADDED ones)
- Scenarios by class: edge 23 · perf 1 · frontend 3 · error 6
- Scenarios by level: L1 27 · ci 2 · electron 2 · — 1
- Scenarios by disposition: automated 32 · manual-only 1

## New infra needed

- none (E20 needs a stubbed `node:module` seam in the register module's unit test; E11 a spawn spy — both within existing vitest suites)
