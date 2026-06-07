## Why

The vitest suite runs effectively single-threaded. Every `packages/*/vitest.config.ts` pins `pool: "forks"` + `maxWorkers: 1`, so each project executes its test files one at a time. On a 16-logical-core box (8 physical), ~858 non-electron test files run with one worker while 15 cores sit idle. Full runs take minutes that should take tens of seconds.

`maxWorkers: 1` is a blanket workaround. The actual shared-state hazards it papers over are small and enumerable — confirmed by audit, not assumption.

## What the audit found

Two heaviest packages, 449 test files:

- **server (231):** 141 pure + 37 self-isolating = **178 (77%) already parallel-safe**. 28 boot a real server. 25 flagged for shared HOME — triaged to ~6 real-risk (read+write under `$HOME/.pi`), ~5 read-only, ~14 false positives (string matches on `persist`/`.pi/`).
- **client (218):** 198 pure + 6 localStorage (jsdom, per-fork) = **204 (94%) safe**. Client never reads `$HOME`.

The real blocker is **hardcoded ports**, not HOME. Of 28 server-boot files, **18 use fixed ports**; 6 collide outright today:
- port `19200` → `last-activity-broadcast`, `auto-attach-slug-defense`, `session-api`
- port `19700` → `worktree-base-spawn-flow`, `event-wiring-resume-clear`, `event-wiring-process-classify`

10 boot files already use the `createTestServer()` / `port: 0` contract (locked by `test-server-canary.test.ts`). The fix is mechanical: port the other 18 to the same helper.

## What Changes

- **Phase 1 — free win.** Raise `maxWorkers` from `1` to `"50%"` on the pure/low-risk projects: `shared`, `extension`, `client-utils`, and the plugin packages (`dashboard-plugin-runtime`, `flows-plugin`, `flows-anthropic-bridge-plugin`, `jj-plugin`, `honcho-plugin`, `roles-plugin`, `subagents-plugin`, `scripts`). No port or HOME hazards in these. Measure.
- **Phase 2 — client.** Raise `maxWorkers` to `"50%"` for `packages/client`. Add a `beforeEach`/`afterEach` localStorage reset to the 6 storage-touching client tests (jsdom isolates per fork; this guards intra-fork ordering).
- **Phase 3 — server (the long pole).**
  - **3a. Per-file HOME hook.** Add a `setupFiles` (runs per test file inside each fork, before the file's imports) that assigns `process.env.HOME = mkdtempSync(...)` and pre-creates `.pi/agent/sessions` + `.pi/dashboard`. Covers the ~6 real-risk HOME files without touching them. Keep the `globalSetup` tripwire as the safety net.
  - **3b. Port migration.** Migrate the 18 fixed-port server-boot files to `createTestServer()` / `port: 0`, starting with the 6 outright collisions. Resolve OS-assigned ports via the existing `httpPort()`/`piPort()` getters.
  - **3c.** Raise `packages/server` `maxWorkers` to `"50%"`.
- **Per-fork localStorage file.** The root `npm test` script sets a single `--localstorage-file`. Make it per-fork (or confirm node-env tests don't contend) so parallel forks don't corrupt one file.
- **Non-goals**:
  - Do NOT change `packages/electron` test wiring (already excluded from the main run).
  - Do NOT rewrite tests beyond port/HOME isolation needed for parallelism.
  - Do NOT switch `pool` away from `forks`.
  - Do NOT chase a specific wall-clock number; success is "dramatically faster, still green and non-flaky".

## Capabilities

### New Capabilities

- `parallel-test-execution`: the vitest suite runs test files concurrently across worker forks (`maxWorkers > 1`) with per-file filesystem isolation (own HOME) and OS-assigned ports, instead of one serial worker per project. Phased rollout keeps each step independently green and non-flaky.
