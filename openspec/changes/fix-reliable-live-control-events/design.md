## Context

See `proposal.md`. The gateway currently returns from `sendTo`/`fanout` whenever `bufferedAmount` exceeds `MAX_WS_BUFFER`. The browser remains connected, so no reconnect snapshot or selected-session replay occurs. Pending PromptBus requests are replayable, but a lost cancel/dismiss needs the client to discard its unconfirmed pending copy before server replay.

Git init routes call `resolveConfigRoot(cwd)`, which currently maps every linked worktree to the primary checkout through `resolveMainPath`. The repository hook already uses pnpm, but its final bare `npx kb index` can fetch an unrelated public package. Runtime alignment also exposed that the source-switch skill assumes every `packages[]` entry is a string, although pi supports structured object entries; its read-only `status` command crashes before it can verify source convergence.

## Goals / Non-Goals

**Goals:**
- Convert silent back-pressure loss into one bounded reconnect/replay recovery action per affected browser socket.
- Reconcile pending interactive state in both directions: restore still-pending requests and remove requests already cancelled or dismissed.
- Preserve the 4 MiB ceiling, healthy-socket fanout, and bounded memory.
- Make worktree hook/config and KB CLI resolution checkout-local and deterministic.
- Converge and verify the running local stack after code validation.

**Non-Goals:**
- Guarantee per-frame delivery for low-value streaming/tick updates.
- Add an unbounded priority queue or raise `MAX_WS_BUFFER`.
- Change PromptBus response semantics.
- Modify unrelated active worktrees or merge the pull request.

## Decisions

### D1. Terminate an over-cap browser socket instead of silently continuing

At the first attempted send over the ceiling, retain the existing drop counter, add a resynchronization counter, and terminate the affected socket. Track terminating sockets in a `WeakSet` so a drop storm requests termination once without retaining closed clients.

This uses the established client reconnect path, the on-connect `sessions_snapshot`, and selected-session subscribe/replay. It avoids a second queue, drain poller, or new recovery protocol. Merely prioritizing `prompt_request` was rejected because `prompt_cancel`, `prompt_dismiss`, and unrelated session state can still become stale. Raising the buffer was rejected because it delays the same failure and increases memory.

### D2. Clear only pending interactive client copies on reconnect

Export a pure reducer helper that removes `interactiveRequests` with `status:"pending"` and removes only transcript rows whose ids match those requests. Apply it to every retained session state on the `connected` transition before subscription replay.

Resolved/cancelled/dismissed rows remain transcript history. Notify rows remain because they do not have an `interactiveRequests` entry. Still-pending server requests are reconstructed by existing pending-request replay; absent requests remain removed. Clearing complete session state was rejected because delta cursors would then require an expensive full-history reset.

### D3. Extend existing dropped-frame health stats

Add `forcedReconnects` to the server-to-browser dropped-frame summary and include the forced-reconnect action in the existing rate-limited warning. The counter records one termination attempt per affected socket; it does not claim that reconnect/replay completed. No per-drop history is retained.

### D4. Resolve Git config roots to the target worktree top level

For any Git checkout, use `git rev-parse --show-toplevel` from the requested cwd. This returns the current linked worktree root rather than the common primary checkout. Missing target settings means no hook; there is no primary-checkout fallback. Trust hashing follows the target config root, so a branch-specific hook cannot inherit approval for different code.

### D5. Execute the built workspace KB CLI directly

Keep the declared `pnpm@11.15.1` install and `pnpm exec openspec` path. After the existing workspace KB build, run `node packages/kb/dist/cli.js index` with the required SQLite `NODE_OPTIONS`. This cannot resolve the unrelated registry `kb` package and adds no dependency.

### D6. Accept supported structured package entries in source-switch diagnostics

Filter package entries to strings before applying string-prefix checks. Match published sources with or without an explicit npm version and match local sources from any checkout by the package's `/packages/<dir>` suffix. Structured entries remain in configuration; status reports a matching object and mutation stops before discarding its filters. The public `status` and `local` commands are regression seams: mixed entries must not crash, and switching from versioned npm plus another checkout must leave exactly one current-checkout source.

### D7. Use repository-managed debug scripts for cross-platform first moves

The first-move sequence invokes the existing health, current-run log, and session scripts through `pnpm exec tsx`, plus `pnpm exec pi-dashboard status`. `health-probe.ts` resolves `PI_DASHBOARD_BASE` first, then `PI_DASHBOARD_PORT`, then dashboard config/default port. This keeps non-default instances selectable without Bash, `curl`, or `jq`, and works in a dependency-installed checkout whose global CLI is not linked.

### D7a. Skill feedback captured from runtime alignment (GLOBAL-SKILL-FEEDBACK-LOOP-001)

Two confirmed operational failures surfaced while aligning the running stack, and are folded into the canonical repository skills:

- **`pi-dashboard` bus CLI path.** Under `npx tsx`, a relative `./scripts/dashboard-bus.ts` resolves against the nearest package root, not the skill directory. Through the symlinked install (`packages/extension`, whose root has no `scripts/`) this raises `ERR_MODULE_NOT_FOUND`. The skill now instructs invoking the script by its absolute path and names `POST /api/session/<id>/resume` as the supported REST fallback. Verified: absolute-path invocation lists live sessions; a fresh Pi loads the edited skill.
- **Systemd restart safety.** `full-rebuild.ts` issues `POST /api/restart`; under the `systemd --user` unit's default `KillMode=control-group` this tore down sibling pi sessions, and `Restart=on-failure` did not revive the clean exit. The `implement` skill and rebuild matrix now forbid `full-rebuild.ts` / bare `POST /api/restart` for a systemd-hosted instance and direct `systemctl --user restart pi-agent-dashboard.service` followed by a separate reload.

### D8. Align runtime only after repository validation

Use the existing `/api/pi/installs` and `/api/pi/runtime` controls, dashboard config/plugin controls, project build/reload scripts, and systemd service. Preserve ports 8147/10099. Inspect and snapshot global settings before mutation. After any global Pi mutation, start a disposable normal Pi process and require a marker within 30 seconds; restore the snapshot on failure.

## Impact and Boundaries

- Server: browser gateway send paths, drop stats, health serialization, worktree config-root resolution.
- Client: reconnect-only pending interactive-state reconciliation.
- Config: repository worktree hook KB command only.
- Skill: repository-owned debug guidance and source-switch status handling, validated through the skill validator and live commands. The health script gains active-base environment precedence.
- Runtime: local service/config/source alignment after tests; no production deployment.

## Quality Plan

- **TDD:** focused server drop/reconnect test, pure client reconciliation tests for request/cancel/dismiss/notify preservation, linked-worktree config test, repository-hook command test, and captured source-switch status crash must fail before implementation.
- **Correctness:** focused Vitest projects, full `npm test`, TypeScript, E2E typecheck, Biome changed-files, convention checks, and production client build.
- **Performance and bounds:** deterministic draining socket stress proves one termination per socket and no increased ceiling; health counters prove recovery activation.
- **Runtime:** full rebuild/restart/reload, then live Tailscale UI ask_user and back-pressure stress without refresh; verify health, versions, plugin sources, ports, systemd, and current conversation visibility.
- **Review:** code-simplifier after green validation, then fresh read-only correctness, validation, and maintainability reviews. Fix only validated findings and rerun affected checks.

## Risks / Trade-offs

- [A persistently slow browser may reconnect repeatedly] → existing exponential backoff limits churn; one termination per socket and drop counters expose recurrence.
- [Reconnect briefly removes a still-pending prompt before replay restores it] → replay follows immediately on selected-session subscribe; tests require convergence, not uninterrupted rendering during a broken transport.
- [Worktree-local trust prompts increase] → safer than authorizing a branch-specific command with the primary checkout's hash.
- [Global runtime alignment can disrupt active sessions] → snapshot settings, use supported controls, preserve service ports, apply the fresh-process gate, and validate this conversation after reload.

## Migration Plan

1. Land code/config/skill updates with tests.
2. Build and restart the local service from this checkout, preserving 8147/10099.
3. Align runtime/plugin sources and reload active sessions.
4. Verify live control recovery and health.
5. Roll back code via service checkout/commit and restore captured global config if startup or runtime validation fails.
