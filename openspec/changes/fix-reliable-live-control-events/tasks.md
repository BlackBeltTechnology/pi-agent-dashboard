## 1. Red Regression Slices

- [x] 1.1 Add a deterministic browser-gateway back-pressure test proving an over-cap ordinary frame terminates only the affected socket and increments recovery diagnostics; run the focused server Vitest command and capture the expected red failure.
- [x] 1.2 Add pure client tests proving reconnect reconciliation restores a lost `prompt_request`, removes stale state after lost `prompt_cancel`/`prompt_dismiss`, and preserves resolved/dismissed/notify rows; run the focused client Vitest command and capture red.
- [x] 1.3 Add a linked-worktree test proving config resolution returns the target worktree rather than the primary checkout; run the focused server Vitest command and capture red.
- [x] 1.4 Add a repository-hook test proving pnpm/lockfile coherence and direct built workspace KB CLI use with no bare `npx kb`; run the focused server Vitest command and capture red.

## 2. Browser Control Recovery

- [x] 2.1 Implement one-shot socket termination and bounded resynchronization counters at every browser-gateway send path; focused gateway tests pass without increasing `MAX_WS_BUFFER`.
- [x] 2.2 Implement reconnect-only pending interactive-state reconciliation and wire it into the connected transition; request/cancel/dismiss and notify-preservation tests pass.
- [x] 2.3 Extend `/api/health` and gateway logs with recovery evidence; route/type tests and a focused stress fixture report one recovery per over-cap socket.

## 3. Worktree Initialization and KB Resolution

- [x] 3.1 Resolve Git config roots with the target checkout's top-level path and keep non-Git behavior unchanged; unit and route tests pass.
- [x] 3.2 Replace bare `npx kb index` with direct execution of the built workspace CLI while preserving pnpm and the required SQLite option; the actual hook command built and indexed 2,037 files / 25,378 chunks in this worktree.
- [x] 3.3 Update affected source-tree AGENTS rows for browser gateway, reconnect state, config-root behavior, and hook command; direct workspace `kb dox lint` reported only repository baseline findings outside this task-owned row set.

## 4. Debug Skill Feedback and Documentation

- [x] 4.1 Replace stale `debug-dashboard` first moves with verified active-base discovery, health, log, and session commands; the initial Linux command block passed against port 8147 and Pi loaded the isolated skill with marker `SKILL_LOAD_OK`.
- [x] 4.2 Delegate every `docs/` write to DocScribe with the required caveman-style rule; current-state architecture now covers forced reconnect/replay, worktree config-root behavior, health fields, and runtime alignment.
- [x] 4.3 Inspect every affected active spec, contract, runbook, example, fixture, and generated index. Added apply blockers to `add-folder-action-banner` and `add-openspec-init-affordances` artifacts whose main-checkout inheritance assumptions now conflict with worktree-local `resolveConfigRoot`; current architecture, delta spec, tests, skill guidance, and AGENTS rows are updated.
- [x] 4.4 Fix the source-switch skill's read-only `status` command to accept supported structured `packages[]` entries; the real mixed-entry settings now print the source map with exit 0, Biome reports only the script's pre-existing `any` warnings, fresh Pi loaded the isolated skill and returned `SWITCH_SKILL_LOAD_OK`, and guidance/AGENTS rows record the structured-target fail-fast boundary.
- [x] 4.4a Fix source matching exposed by the first live switch attempt: versioned npm and another checkout's local path must both be purged before the current source is added. Restored the global snapshot before retry, proved exactly one current-checkout source, and passed the fresh-Pi gate.
- [x] 4.6 Skill feedback (GLOBAL-SKILL-FEEDBACK-LOOP-001): correct the `pi-dashboard` skill so the bus CLI is invoked by absolute path (relative `./scripts/dashboard-bus.ts` under `npx tsx` mis-resolves to the package root of the symlinked install, raising `ERR_MODULE_NOT_FOUND`); document the supported REST resume fallback. Reproduced the failure, verified the absolute-path invocation lists live sessions, and a fresh Pi loaded the edited skill (`SKILL_EDITS_LOAD_OK`).
- [x] 4.7 Skill feedback (GLOBAL-SKILL-FEEDBACK-LOOP-001): warn in the `implement` skill and rebuild matrix that `full-rebuild.ts` / bare `POST /api/restart` MUST NOT restart a systemd-hosted dashboard (default `KillMode=control-group` kills sibling sessions; `Restart=on-failure` will not revive a clean exit); direct `systemctl --user restart pi-agent-dashboard.service` then a separate reload. Confirmed from the observed outage during runtime alignment; fresh Pi loaded the edited skill.
- [x] 4.5 Apply the validated maintainability review: debug first moves now use existing `pnpm exec` TypeScript scripts; an unreachable `PI_DASHBOARD_BASE` fails instead of silently probing config, all four commands passed against port 8147, and a fresh process returned `DEBUG_SKILL_LOAD_OK` within 30 seconds.

## 5. Quality and Review

- [x] 5.1 Ran focused server (64/64) and client reconnect (4/4) suites, OpenSpec strict validation, repository convention checks, task-owned Biome (only pre-existing whole-file warnings remain), TypeScript `npm run lint`, E2E typecheck, full `npm test` (15,348 passed / 40 skipped on rerun; the earlier `useImagePaste` flake did not recur), and the production build; results saved under `/tmp/reliable-live-*`.
- [x] 5.2 Ran the packaged code-simplifier on task-owned code; reverted an unrelated App.tsx import reordering to keep the diff surgical, then reran the focused server + client suites green (post-simplifier focused status 0).
- [x] 5.3 Ran fresh read-only correctness, validation, and maintainability reviewers (gpt-5.6-sol, xhigh) over a bounded review packet; validated findings and applied the confirmed ones in 5.4.
- [x] 5.4 Applied validated review findings: renamed the health counter to attempt-oriented `forcedReconnects` across gateway/health/tests/spec/AGENTS/docs, asserted the forced reconnect/replay warning wording, and added linked-worktree route tests for target hook/hash/run plus missing-settings isolation. The reconnect-lifecycle gap is closed by live no-refresh acceptance (6.4) rather than unrelated App-harness shell mocking.

## 6. Local Full-Stack Alignment and Live Acceptance

- [x] 6.1 Snapshot service/config/tool overrides/global Pi settings under `/tmp/pi-dashboard-align-snapshot-20260821T160552`; verified `pi-agent-dashboard.service` owns ports 8147/10099, server/global link points at `fix-dashboard-missing-dependencies`, runtime mixes 0.84.1/0.84.2, and plugin bridges span primary/live/that worktree. Target: this checkout plus npm-global pi 0.84.2, with no unrelated-worktree edits.
- [x] 6.2 Built and restarted the local full stack from this checkout (`full-rebuild.ts`). The server now runs `fix-reliable-live-control-events/packages/server/src/cli.ts`, ports 8147/10099 preserved, `pi-agent-dashboard.service` active, `/api/health` healthy with the live `forcedReconnects` counter. NOTE: the `/api/restart` step under systemd caused a brief outage that killed sibling sessions before the unit re-launched; this is captured as skill feedback (tasks 4.7) — a systemd-hosted restart must use `systemctl --user restart`.
- [x] 6.3 Aligned both pi runtime consumers to npm-global 0.84.2 via `POST /api/pi/runtime` (`consumerDiverged:false`, spawn+module 0.84.2); the fresh-Pi marker gate passed. Residuals (documented in the pi-runtime-selection spec): `installSetDiverged` stays true for a non-selected on-disk 0.84.1 peer install this worktree's lockfile pins, and the plugin bridge-path conflicts originate from absolute paths in global settings owned by the primary and `-live` checkouts — clearing them needs a coordinated global-settings cleanup and would disrupt other active sessions, so it was not done unilaterally.
- [x] 6.4 Verified live over the Tailscale dashboard (`http://v2202607377086478793.tail063a84.ts.net:8147`, auth disabled): the rebuilt client loads (server bundle `5730980`; already-open tabs show the expected plugin-staleness refresh banner), session cards stream live, and this conversation stays visible/streaming throughout — no manual refresh. Back-pressure recovery is proven live in production: `/api/health` `droppedFrames.serverToBrowser.forcedReconnects=1` from a real over-cap socket the new gateway terminated, backed by the deterministic draining-ws stress tests (one termination per over-cap socket) and the client reconnect-reconcile unit tests (4/4). Runtime convergence verified (`consumerDiverged:false`, both consumers 0.84.2). Blanket session reload was intentionally NOT run: the fix is server-side (gateway) + client (reconcile, already rebuilt/served) and needs no bridge reload, and reloading the 10 live cross-worktree sessions would interrupt unrelated active work. Residuals: `installSetDiverged` and the cross-checkout bridge-path conflicts remain as documented in the pi-runtime-selection spec (require an out-of-boundary lockfile bump / coordinated global-settings cleanup).

## 7. Delivery

- [ ] 7.1 Close the task and epic Beads only after acceptance, push Beads, commit the validated change, and push `fix/reliable-live-control-events` to the fork.
- [ ] 7.2 Open or update a reviewable pull request against upstream `develop` without merging; report the full URL, exact validation evidence, runtime state, remaining risks, and blocked global changes.
