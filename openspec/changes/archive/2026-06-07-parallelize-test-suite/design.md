# Design

## Context

- Vitest 4. Root `vitest.config.ts` lists 14 projects under `test.projects`; each project carries its own `vitest.config.ts` with `pool: "forks"` + `maxWorkers: 1`.
- Isolation today (commit `6a1b1d82`): root `npm test` sets `HOME=$(mktemp -d)` once for the whole run + a single `--localstorage-file`; `globalSetup` (`packages/shared/src/test-support/setup-home.ts`) is a tripwire that throws if `HOME` is the real user home and pre-creates `.pi` subdirs.
- `createTestServer()` (`packages/server/src/test-support/`) boots a real server on `port: 0` with safe defaults; `DashboardServer.httpPort()/piPort()` + `PiGateway.address()` resolve OS-assigned ports. `test-server-canary.test.ts` locks the `port: 0` contract.

## Why maxWorkers:1 exists (root cause, audited)

```
npm test → ONE HOME (mktemp) + ONE --localstorage-file
              ↓ shared by every fork
   server tests write $HOME/.pi/dashboard/*.json, hold server.lock,
   AND bind hardcoded ports (8000, 19xxx, …)
              ↓ run in parallel forks
   → port EADDRINUSE collisions  (the real blocker)
   → file/lock contention on shared HOME  (smaller, ~6 files)
   → maxWorkers:1 sidesteps all of it
```

Audit numbers (server 231 / client 218):

| bucket | server | client |
|---|---|---|
| pure (no HOME, no boot) | 141 | 198 |
| self-isolating (own mkdtemp) | 37 | 0 |
| server-boot | 28 | 0 |
| localStorage (jsdom) | — | 6 |
| flagged shared-HOME (→ ~6 real) | 25 | — |

Server-boot port split: **10 dynamic (`port:0`/`createTestServer`) safe**, **18 fixed-port**. Outright collisions: port `19200` (3 files), port `19700` (3 files).

## Decisions

### Decision 1: per-file HOME via setupFiles, not per-run

`setupFiles` runs inside each worker fork, before the test file's module imports execute. Assigning `process.env.HOME = mkdtempSync(os.tmpdir()+'/pi-test-')` there gives each file a private HOME before any production code calls `os.homedir()`/reads `$HOME`. With `pool: "forks"` + default `isolate: true`, each file gets a fresh module registry, so no cross-file singleton leak.

- Pre-create `.pi/agent/sessions` + `.pi/dashboard` in the hook (mirrors current globalSetup bootstrap).
- Keep `globalSetup` tripwire unchanged as the second-line guard.
- Alternative rejected: keep one shared HOME and serialize — that is the status quo we are removing.

### Decision 2: ports via createTestServer/port:0, not a port allocator

Migrate the 18 fixed-port server-boot files to `createTestServer()` (or `port: 0` + `httpPort()`/`piPort()` getters). This is the contract already proven by 10 files and the canary test. A bespoke port-allocator/range-leasing layer is rejected — more code, same outcome, and `port: 0` already delegates allocation to the OS atomically.

Migration order: the 6 collision files first (port `19200`, `19700` clusters), then the remaining 12 unique-but-fixed ports.

### Decision 3: per-fork localStorage file

Root `npm test` sets `NODE_OPTIONS="--localstorage-file=$(mktemp ...)"` once. Parallel forks writing one file can corrupt it. Options:
- (a) Make it per-fork: set/override `--localstorage-file` in the same per-file `setupFiles` to a unique temp path. Preferred — symmetric with Decision 1.
- (b) Confirm only node-env tests use the global localStorage and serialize just those.

Decision: (a), set a per-file localStorage path in the setup hook.

### Decision 4: maxWorkers = "50%"

`"50%"` of 16 logical cores ≈ 8 workers — matches physical core count, leaves headroom, avoids oversubscription thrash on fork-heavy server boots. Tunable later; not hardcoded to a CI-specific number.

### Decision 5: phased, independently-green rollout

Order chosen by risk, lowest first:
1. pure/plugin projects (zero hazard)
2. client (jsdom-isolated; 6 localStorage guards)
3. server 3a HOME hook → 3b port migration → 3c maxWorkers

Each phase must stay green and non-flaky (run 3×) before the next. Server is gated behind 3a+3b because raising its `maxWorkers` before port migration reintroduces the `19200`/`19700` collisions.

## Risks

- **Module-level HOME capture in a singleton** that survives across files in one fork → mitigated by `isolate: true` (fresh registry per file). Spot-check the ~6 real-risk files after the hook lands.
- **Hidden ordering deps** in "pure" tests surfacing as flakes under parallelism → fix by self-isolating the offender; run each phase 3×.
- **node-pty / process-spawning tests** oversubscribing CPU → `"50%"` cap + keep any genuinely serial file on its own (`describe.sequential` or a per-file `maxWorkers` override) if found.

## Open question

Confirm jsdom localStorage is per-fork in-memory (not the global `--localstorage-file`); if so, Phase 2's 6-file guard is belt-and-suspenders rather than required. Verify before finalizing Phase 2 scope.

## File lists

**Phase 1 configs:** `packages/{shared,extension,client-utils,dashboard-plugin-runtime,flows-plugin,flows-anthropic-bridge-plugin,jj-plugin,honcho-plugin,roles-plugin,subagents-plugin}/vitest.config.ts`, `scripts/vitest.config.ts`.

**Phase 2:** `packages/client/vitest.config.ts` + 6 localStorage tests (`InstallBanner`, `MissingRequiredBanner`, `chat-input-draft-integration`, `useSidebarState`, `useTheme`, `draft-storage`).

**Phase 3b — 18 fixed-port files** (`packages/server/src/__tests__/` unless noted):
- collisions first: `last-activity-broadcast`, `auto-attach-slug-defense`, `session-api` (19200); `worktree-base-spawn-flow`, `event-wiring-resume-clear`, `event-wiring-process-classify` (19700)
- remaining: `event-wiring-queue-state` (19800), `auto-shutdown` (18700), `recovery-server` (8000), `event-wiring-source-stamp` (19900), `unread-trigger-wiring` (19400), `spa-fallback` (19100/01), `auto-attach` (18800/900), `event-wiring-providers-list` (19500), `headless-shutdown-fallback` (19190/91), `oauth-callback-server` (19876), `shutdown-endpoint` (19080/81), `editor-keeper/__tests__/keeper-manager` (65500-535)
