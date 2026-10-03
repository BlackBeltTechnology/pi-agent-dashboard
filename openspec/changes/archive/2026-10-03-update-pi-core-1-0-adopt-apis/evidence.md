# Bump evidence — update-pi-core-1-0-adopt-apis

Recorded during implementation against installed pi 1.0.0 (pi-coding-agent, pi-ai, pi-tui, pi-agent-core all 1.0.0). Feeds the PR description.

## 5.1 In-memory draft-agent path (design D6)

- `SessionManager.inMemory(cwd?, options?, entries?)` — signature unchanged from 0.85.1+.
- Probe: `inMemory(cwd)` → `getSessionFile()` = `undefined`, 0 entries (fresh, fileless).
- `createAgentSession({ sessionManager, model, tools: [], cwd })` succeeds; `subscribe` / `prompt` / `dispose` present; dispose clean.
- `commit-draft-agent-session.test.ts` green.
- Restore-API decision: keep `inMemory(cwd)`. The `entries` restore param stays unused — the draft runner wants a throwaway session with no prior entries.

## 5.2 Added sub-dependencies (design D6)

- pi-coding-agent 1.0.0 adds `@earendil-works/pi-codemode`, `@earendil-works/pi-mcp`, `quickjs-wasi` (+ `@earendil-works/chord` already present); none removed since 0.86.1.
- `rg "@earendil-works/pi-codemode|@earendil-works/pi-mcp\b|quickjs-wasi" packages scripts docker` → 0 hits (`pi-mcp-adapter` hits are the unrelated third-party package).
- pi import specifiers unchanged: `@earendil-works/pi-coding-agent` (static 13, dynamic 6), `@earendil-works/pi-ai` (static 1, dynamic 3), `@earendil-works/pi-tui` (static 1). The `pi-ai/utils/transcript` match is a comment forbidding that bare import; the seam derives `dist/utils/transcript.js`, present in 1.0.0.
- `minimumReleaseAgeExclude` extended to the 1.0.0 set (pnpm 11.15.1 applies it; 1.0.0 published 2026-10-01).

## 1.5 `0.86.1` sweep — annotated hits

Updated: `scripts/verify-release-deps.mjs` (minVersion 1.0.0; evidence history kept), `packages/server/src/auth/locked-json-file.ts` (lock coupling re-verified on 1.0.0: `staleMs = 30_000`, `realpath: false`).

Historical / intentional (kept):
- `pnpm-workspace.yaml` `minimumReleaseAgeExclude` — version history, 1.0.0 appended.
- `scripts/verify-release-deps.mjs:68` — evidence text describing why 0.86.1 was once the floor.
- `scripts/__tests__/verify-release-deps-pi-coherence.test.mjs` — deliberate drift fixtures.
- `packages/server/src/__tests__/pi-version-skew.test.ts` — below-floor boundary values.
- `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts` — exact-key Node-floor table (row history; 1.0.0 row added).
- Lock-contention tests (`provider-auth-lock-*`, `internal-auth-storage-coordination`) — simulate pi's literal lock options, unchanged in 1.0.0.
- `runtime-doctor`, `runtime-stager`, `runtime-routes`, `health-endpoint`, `RuntimeUpdatesSection` tests — arbitrary version strings in fixtures, not pins.
- `docs/architecture.md:246` — "measured on a live 0.86.1 session" (historical measurement).
- `openspec/specs/*` hits — main specs; the bridge-extension / provider-auth-server requirements carrying them are replaced by this change's deltas at archive.
- `docs/*` floor/gate prose and `*.AGENTS.md` rows — updated by task 5.5 (DocScribe / closeout).

## Implementation-time findings (user decisions)

- pi 1.0.0 `getProviderAuthStatus().label` is set for EVERY environment credential, not only federation → `authenticated` promotion gated on "no `envVar`, not `ambient`" (design D7, spec amended).
- Sign in with ChatGPT (`openai`) rejects without `login(…, { getDeviceId })` → adapter passes pi's `SettingsManager.getOrCreateDeviceId` (design D7a). Real probe on 1.0.0 reaches `auth_url` → `manual_code`.
- 1.0.0 ships three classifier lazy apis (`{ classify }`, no `streamSimple`) → added to `NON_TEXT_LAZY_FILES`, asserted.

## No-weakening guard — accepted exceptions (human-approved)

`assertNoWeakening` flagged five test diffs; the user accepted them as spec-mandated retirements:

| File | Flag | Reason |
|---|---|---|
| `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts` | deleted assertions | 0.84.2 gate BVA tests retired (task 2.1); replaced by E7 (no version read, dispatch) + E8 (ungated reload). |
| `packages/extension/src/__tests__/terminal-reload.test.ts` | deleted assertions | "pi < 0.84.2 → error" retired (task 2.2); replaced by E2 "self-dispatches immediately and arms the slot". |
| `packages/shared/src/piai-compat/__tests__/adapt.test.ts` | deleted assertions | legacy passthrough (#E1) retired (task 2.3); replaced by E9 legacy-rejected + partial-rejected. |
| `packages/shared/src/piai-compat/__tests__/oauth-facade.test.ts` | deleted assertions | legacy `dist/oauth.js` preference retired (task 2.3); replaced by "usable legacy oauth.js is never consulted" + loaders-preferred. |
| `packages/server/src/__tests__/pi-version-skew.test.ts` | strong→permissive (heuristic) | file-level heuristic: new E5 tests assert the exact `null` return with `toBeNull()`; X13 moved to the stricter `rangeIsSatisfiable(...).toBe(true)`. |

## Step 4.4 enforcers

All green except `knip-ratchet.mjs`, which is red on `origin/develop` itself (user-approved as pre-existing):

| Tree | files | exports | types | duplicates |
|---|---|---|---|---|
| baseline | 10 | 234 | 193 | 12 |
| `origin/develop` (pristine worktree) | over (same 15 unused files; earlier `tail` hid the line) | 245 | 195 | 14 |
| this branch | 15 — none touched by this change (identity e2e setup #697, deck3d fixtures, client/electron files) | 244 | 195 | 14 |

This change is net −1 export: its two new findings (`NO_RELOAD_PATH_REASON` orphaned export, `LoginOptions` type) were un-exported. `--check-baseline-diff origin/develop` passes (no baseline raised).

## Full suite (5.3)

`npm test`: 2222 files passed. Failures triaged:
- fixed (caused by the 1.0.0 floor): `health-compatibility.test.ts` fixture `0.99.0` ("above minimum") now derived from the floor; `async-semantics-guards` E3 — `void tr.reload()` replaced by an awaited promise.
- pre-existing / environmental, unchanged files: `scripts/__tests__/test-selection-data.test.mjs` (`git ls-files` output 1,048,727 B > Node's 1 MiB `execFileSync` default → `ENOBUFS`), `packages/system-one-plugin/src/server/__tests__/supervisor.test.ts` X12 (sources byte-identical to `origin/develop`; fake-engine shim, no pi import).

## Harness (step 3) — docker, pi 1.0.0

Run via `PI_E2E_SEED=1` + a `docker exec … node` loopback forwarder (host traffic over the Docker bridge is refused ticket minting; known local-harness limitation).

- `/api/health`: `compatibility.current = 1.0.0`, min = rec = `1.0.0`; providerAuth ok.
- `/api/provider-auth/providers`: 8 ids incl. `openai`; `openrouter` `subscription:false`, others `true`.
- e2e (`extension-slash-inprocess`, `dashboard-slash`, `headless-reload-dispatch`, `delegate-provider-oauth-flow`, `resource-activation-trust`, `mcp-session-token`, `mcp-client-harness-integration`): all pass; 2 skips = pre-existing `test.fixme` quarantine (#683).
- First run found design D7b (built-in MCP "pi-dashboard: needs sign-in"); after the fix the bundled adapter is 5.0.0, Pi's `mcp.json` holds no `pi-dashboard` key, #F1 passes.

## Full suite on the final tree (after review round 4)

`npm test`: 2222 files passed, 4 failed — none attributable to this change:
- `test-selection-data` (`ENOBUFS`) and system-one `supervisor` X12 — pre-existing, as above.
- `client SessionCard.test.tsx` "notifyLog invariance" — the two renders differ only in the `Started …` tooltip second (`Date.now()` crossed a second boundary under load); 145/145 in isolation.
- `server host-gate-upgrade.test.ts` #X7 — bootstrap frame index 9 vs 10 under load; untouched file; 4/4 in isolation.

## Local review (step 4.5)

`@review` = `openai-codex/gpt-6-sol:medium`, isolated `CodeReviewer`. Rounds: r1 block (B1 pre-release below floor, B2 version dedup across reconnect/switch) → r2 block (malformed prefix, health advisory pre-release) → human-approved r3 block (SemVer identifiers, pre-release ordering) → human-approved r4 **pass** (floor checks on `semver.valid`/`semver.lt`). Remaining non-blocking: `computeCompatibility` recommended-hint branch keeps the triplet comparator (only matters for synthetic pre-release `recommended`; shipped min = rec = `1.0.0`).

## 5.4 live smoke — isolated instance (not docker)

This worktree's server on `:8100`/`:9100`, isolated `HOME` (`/private/tmp/pi-smoke-*`), inherited `PI_*` env cleared; the live `:8000` instance untouched. Real pi 1.0.0 spawns (worktree `node_modules`), real global pi 0.99.1 for the user-launched case.

- `/api/health`: `current 1.0.0`, `minimum 1.0.0`, no error; bridge registered from the worktree `packages/extension`; agent dir got `mcp-adapter.json` (D7b path on a real start).
- headless spawn: registered `piVersion 1.0.0`, `piBelowFloor null`; `/dashboard-where` accepted (HTTP 200), tokens unchanged; `/reload` → same session id alive afterwards.
- tmux spawn (`spawnStrategy: tmux` at boot): ran in tmux, `piVersion 1.0.0`; `/dashboard-where` accepted; `/reload` → in-process reload, session re-registered (2 `session registered` lines, same id) — the ungated `/__dashboard_reload` self-dispatch.
- user-launched **pi 0.99.1** (tmux, worktree bridge): `piVersion 0.99.1`, `piBelowFloor {"minimum":"1.0.0"}` — the argv-anchored below-floor signal end to end (X3 data path; visual legibility stays manual, task 6.18).
- Not covered here: model list (isolated `HOME` has no credentials → empty list; E13/E14 unit-covered), and real-account sign-ins (tasks 6.17, 6.24).
- Cleanup verified: no smoke tmux windows or processes left.

## Incident during 5.4 prep (disclosed)

`node packages/server/bin/pi-dashboard.mjs --help` is not a help flag: it started a server from this worktree against the real `HOME` (inherited `PI_DASHBOARD_*` env from the Electron-spawned session). It exited on its own (gateway socket held by the live instance). Before exiting it ran startup side effects: `registerBridgeExtension` wrote `~/.pi/agent/settings.json` with the same Electron bridge path the live server registers (server.log line 288055 vs 316567), and the archive pass migrated 1 entry using develop's code (untouched by this change). Live `:8000` stayed healthy throughout. No pre-run copy of `settings.json` exists, so "no net change" is inferred, not proven.
