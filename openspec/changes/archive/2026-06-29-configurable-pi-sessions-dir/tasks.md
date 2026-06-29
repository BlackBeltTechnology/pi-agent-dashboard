# Tasks — configurable-pi-sessions-dir

## 1. Resolver (shared)

- [x] 1.1 Add `resolvePiSessionsDir(env?)` to `packages/shared/src/dashboard-paths.ts`. → verify: exported, returns string.
- [x] 1.2 Extend `DashboardPathsEnv` with `piSessionsDir?`, `sessionDirEnv?`, `agentDirEnv?`. → verify: type compiles.
- [x] 1.3 Implement precedence: config → env (`PI_CODING_AGENT_SESSION_DIR`) → env (`PI_CODING_AGENT_DIR`)+`/sessions` → literal `~/.pi/agent/sessions`. Trim, blank-as-unset, `~/` expansion against `homedir`. (Deviation: read `PI_CODING_AGENT_DIR` directly instead of importing pi-core `getSessionsDir` — pi-core `.d.ts` barrel unresolvable under `moduleResolution: bundler`; see design.md.) → verify: unit table (design.md) passes.
- [x] 1.4 Unit tests in `packages/shared` covering the 6-row table + tilde + absolute passthrough. → verify: `npm test` green for shared.

## 2. Config field

- [x] 2.1 Add optional `piSessionsDir?: string` to `src/shared/config.ts` (`DASHBOARD_CONFIG` type + `loadConfig` read, trim-aware). → verify: type-check.
- [x] 2.2 Do NOT add it to `ensureConfig` defaults (absent means "fall through"). → verify: fresh config.json has no `piSessionsDir` key.

## 3. Wire server call sites

- [x] 3.1 `packages/server/src/session-scanner.ts:15` — `getSessionsDir()` calls `resolvePiSessionsDir({ piSessionsDir: loadConfig().piSessionsDir })` (resolver reads `PI_CODING_AGENT_DIR` internally; no pi-core import — see 1.3 deviation). → verify: no literal `.pi/agent/sessions` left in file.
- [x] 3.2 `packages/server/src/session-discovery.ts:28` — same delegation. → verify: literal removed.
- [x] 3.3 `packages/server/src/migrate-persistence.ts:78` — default `sessionsScanDir` from resolver (keep `paths?.sessionsDir` override param). → verify: literal removed.
- [x] 3.4 `rg -n 'join\(os\.homedir\(\), ?"\.pi", ?"agent", ?"sessions"\)' packages/server/src` returns nothing. → verify: empty.

## 4. Tests

- [x] 4.1 Integration: temp fixture sessions tree + `piSessionsDir` override → `scanAllSessions()` discovers fixtures. → verify: test passes.
- [x] 4.2 Default regression: all unset → scan targets `~/.pi/agent/sessions` (mock homedir). → verify: test passes.
- [x] 4.3 `npm test` full suite green. → verify: `grep -nE 'FAIL|✗' /tmp/pi-test.log` empty.

## 5. Docs

- [x] 5.1 README Config section: document `piSessionsDir` + resolution order (config → env → `PI_CODING_AGENT_DIR` → default). Delegate `docs/` writes per AGENTS.md caveman rule.
- [x] 5.2 Add `resolvePiSessionsDir` row to `docs/file-index-shared.md`; update `src/shared/config.ts` row with `piSessionsDir`. Delegate to subagent.

## 6. Quality gates

- [x] 6.1 `npm run quality:changed` green. (Changed files biome-clean + tsc-clean; full `npm test` green — 8401 passed. Remaining biome warnings are pre-existing Tier B/C in `config.ts`/existing server files, not regressions.)
- [x] 6.2 Code-review gate on diff (`review-changes.ts`). 1 advisory finding, 0 Critical/Warning, exit 0.
