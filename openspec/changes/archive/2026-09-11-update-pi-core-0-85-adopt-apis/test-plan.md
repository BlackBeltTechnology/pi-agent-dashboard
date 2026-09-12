# Test Plan — update-pi-core-0-85-adopt-apis

Stage: apply   Generated: 2026-09-11

## Clarifications — resolved (1)

- [x] **C1** — *Is there a perf threshold for session spawn against the bumped runtime?* **Resolved: no.** This change claims no perf surface (a pinned-runtime bump with zero upstream breaking changes), so no threshold is invented and the perf class is empty. Recorded so a later reader sees the omission was a decision, not an oversight.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | `pi-core-version-check` — six governed pins resolve to one version | decision-table | L1 | automated | `serverPkg` fixture with dep `^0.85.1`, `recommended` `0.85.1`, `minimum` `0.85.1`, Dockerfile text `@0.85.1`, workspace override `0.85.1`, checker `minVersion` `0.85.1` | `checkPiPinCoherence(...)` runs | returns falsy (no drift) |
| E2 | same | decision-table (one-cell-flipped, 6 cases) | L1 | automated | the E1 fixture with exactly ONE pin reverted to `0.84.4` — once per pin | `checkPiPinCoherence(...)` runs | returns a truthy message that NAMES the drifted location; 6/6 cases fail, none silently passes |
| E3 | same — lagging `minimum` is a spec violation | decision-table | L1 | automated | `recommended` `0.85.1`, `minimum` `0.78.0`, all other pins `0.85.1` | checker runs | fails and names `piCompatibility.minimum` specifically |
| E4 | same — existing fixtures keep their original failure reason | regression | L1 | automated | both `pi-version-skew.test.ts` `checkPiPinCoherence` fixtures (`~:59-70` drift, `~:79-90` stale-`minVersion`) after being given a `minimum` field | each fixture runs | each still fails for its ORIGINAL reason (`/pi pin drift/i`, stale `minVersion`) — NOT a new "missing pin" error |
| E5 | `pi-core-version-check` — below-floor pi is hard-blocked | BVA on version | L1 | automated | range `{minimum:"0.85.1", recommended:"0.85.1", maximum:null}`; versions `0.78.0`, `0.84.4`, `0.85.0`, `0.85.1`, `0.86.0` | `computeCompatibility(range, v)` | `0.78.0`/`0.84.4`/`0.85.0` → populated `error` naming BOTH the running version and `0.85.1`; `0.85.1`/`0.86.0` → `error` undefined and `upgradeRecommended` falsy |
| E6 | `pi-core-version-check` — hint band empty under lockstep, branch retained | EP | L1 | automated | shipped range `minimum == recommended == "0.85.1"` | enumerate `0.78.0`→`0.86.0` | NO version yields `upgradeRecommended === true` with `error === undefined`; the branch itself still fires for the synthetic range `{minimum:"0.78.0", recommended:"0.84.1"}` at `0.84.0` (`pi-version-skew-recommended-0-84.test.ts` stays green untouched) |
| E7 | `pi-core-version-check` — `minimum` is a Node-floor table key | boundary | L1 | automated | `packages/server/package.json` `piCompatibility.minimum` = `0.85.1` | `bundled-node-meets-pi-floor.test.ts` runs | `PI_MIN_TO_NODE_FLOOR["0.85.1"]` is defined AND `BUNDLED_NODE_VERSION` ≥ that floor; the test fails with "Add a row" if the row is omitted |
| E8 | `pi-runtime-selection` — below-floor candidate is enumerated but unselectable | decision-table | L1 | automated | candidate set: one `0.84.4` install, one `0.85.1` install, one whose `--version` probe fails (unknown) | `GET /api/pi/installs` | `0.84.4` present in the list, flagged floor-failing, `selectable: false`; `0.85.1` selectable; unknown-version candidate NOT floor-failed and still selectable |
| E9 | `model-proxy-credential-routing` — no provider-key remap for Codex | decision-table | L1 | automated | catalog with `gpt-6-astra` published under `openai`, `openai-codex`, `github-copilot`, `azure-openai-responses`; credential store holding ONLY an `openai-codex` entry | model list is filtered for that credential | the `openai-codex` Astra entry is listed; the `openai` / `github-copilot` / `azure-openai-responses` entries of the SAME model id are NOT — proving equality matching, not prefix/substring |
| E10 | `model-proxy-credential-routing` — a client-version gate is not an OAuth incompatibility | regression | L1 | automated | `OAUTH_INCOMPATIBLE.anthropic` as shipped | assert its contents | contains only the pre-4.x snapshot ids; `claude-fable-5-1` is absent |
| E11 | `pi-core-version-check` — publishable peer ranges are out of the governed set | regression | L1 | automated | the eight `packages/*/package.json` declaring `@earendil-works/pi-coding-agent` peers | assert each peer range | each is still `>=0.80.10` (none raised incidentally), and the coherence checker does not read them |

### Performance

_Empty by decision (C1). No requirement in this change states a latency, throughput, memory, or soak threshold, and none is invented._

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | `pi-core-version-check` — advisory names the required version | state-transition | L3 | automated | harness dashboard whose reported pi is below the floor | load the dashboard | `PiVersionAdvisory` renders the red "below minimum" state AND the copy contains the literal `0.85.1` and the running version — not a generic "below minimum" string; HTTP status of `/api/health` is unchanged (no 503) |
| F2 | `pi-core-version-check` — health reports the governed pin and floor | state-convergence | L3 | automated | docker harness at the port from `.pi-test-harness.json` (`dashboardPort`), never a hardcoded `:18000` | `GET /api/health` | `compatibility.current` == `compatibility.recommended` == `compatibility.minimum` == the version read from `packages/server/package.json`; no literal appears in the spec file |
| F3 | `pi-core-version-check` — one pi copy in the tree (ghost-version guard) | state-convergence | L3 | automated | tree installed with the bumped `pnpm-workspace.yaml` override | probe every resolved `@earendil-works/pi-coding-agent/package.json` in root + workspace `node_modules` | every resolved copy reports `0.85.1`; the version `/api/health` reports equals the version the server actually loads |
| F4 | `bridge-extension` — exactly one terminal settle, never synthesized | state-transition | L1 | automated | a bridge run over a native `agent_start`→`agent_end`→`agent_settled` sequence | the run completes | exactly ONE `agent_settled` reaches the wire, it is the forwarded native event, it carries no `retryPending`, and `isAgentStreaming` is `false` afterwards |
| F5 | `bridge-extension` — retry chain still closes on the native settle | state-transition (illegal-edge) | L1 | automated | a retry sequence: `agent_end`(error) → `auto_retry_waiting` → `agent_start` → `agent_end`(ok) → native `agent_settled` | the sequence replays through the bridge with the floor-retry block deleted | `auto_retry_end` is emitted exactly once, on the native settle; `abortLatch` is cleared; no `setTimeout`-driven synthetic settle fires |
| F6 | `pi-api-feature-detection` — the removed client fallback has no producer | regression | L1 | automated | the client reducer after the `retryPending` branch is removed | replay an `agent_settled` with no `retryPending` field | the reducer converges to the terminal state; `grep -rn "retryPending" packages/` returns zero hits repo-wide |
| F7 | proposal § Why — fable 5.1 works on a Max subscription | end-to-end | — | manual-only | a real Claude Pro/Max OAuth credential (cannot exist in CI) | prompt `claude-fable-5-1` through a live session on the bumped pin | returns 200, not 400 `claude_code_version_too_old`; `claude-fable-5`, `claude-opus-4-5`, `claude-sonnet-4-5` still return 200 |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | design §8 — abort must not strand the `compacting` latch | fault-injection (abort) | L1 | automated | a session in `compacting` state | an `abort` that cancels the compaction and emits NEITHER `session_compact` nor `session_compact_failed` | the latch clears; a subsequent prompt is accepted rather than rejected as "already compacting" |
| X2 | design §8 — same, end-to-end | fault-injection (abort) | L3 | automated | live harness session mid manual-compaction | press abort, then send a new prompt | the new prompt starts a turn (transcript grows); the session never re-enters a stuck `compacting` badge |
| X3 | design §7 — unexported pi internals break at runtime, not build time | fault-injection (real spawn) | L3 | automated | a real spawned session on the bumped pin | exercise the draft-agent path (`SessionManager.inMemory`) and toggle a project resource | both complete with no runtime symbol/shape error; `ProjectTrustStore` + `hasTrustRequiringProjectResources` resolve through the exports map |
| X4 | design §7 — resource-activation semantics survive the bump | fault-injection (property re-verification) | L1 | automated | the four enumerated properties: agent-dir layout, `matchesAnyPattern` vs `matchesAnyExactPattern` + excludes→force-includes→force-excludes precedence, `getPackageIdentity` normalisation, `findAutoloadDeltaBase` engaging only for `scope==="project" && autoload===false` | `resource-activation-toggle.test.ts` runs against 0.85.1 | all four hold; a violation names which property moved |
| X5 | design §3 — unknown-version pi loses synthesized settles (accepted residual) | fault-injection (degraded input) | L1 | automated | a runtime whose version probe returns `undefined`/unparseable | a run completes on it | the bridge does NOT synthesize; the documented consequence (no terminal settle if that runtime predates `0.80.4`) is asserted as the accepted behavior, so a future change cannot restore synthesis by accident |
| X6 | design §5 — the no-remap conclusion must not be "fixed" later | regression | L1 | automated | an `openai-codex` credential and an `openai`-provider model whose id matches an Astra entry | the credential filter runs | the `openai` model is NOT granted the Codex credential — asserting the prohibition on prefix/substring provider matching |
| X7 | tooling — `ctx.cwd` is honoured by dashboard-registered tools | fault-injection (divergent cwd) | L1 | automated | a `ctx.cwd` that differs from `process.cwd()`, plus a relative path argument | invoke each tool changed by task 5.1 | the relative path resolves against `ctx.cwd`, not the host process cwd; tools recorded as cwd-independent assert that independence explicitly |
| X8 | `doctor-skill` — derived pi tables are regenerated, not hand-edited | regression | ci | automated | the doctor `pi-resolution` module after `doctor --regenerate pi-resolution` | re-run the regenerator | output is byte-identical (idempotent) and its per-module knowledge hash matches — a hand-edit is detected as drift |

---

## Coverage summary

- Requirements covered: 11 of the 12 delta requirement blocks across the 6 capabilities (the `pi-api-feature-detection` TUI no-op rows are documented non-behaviour and carry no scenario by construction)
- Scenarios by class: edge 11 · perf 0 (C1) · frontend 7 · error 8
- Scenarios by level: L1 16 · L3 6 · ci 1 · manual-only 1
- Scenarios by disposition: automated 25 · manual-only 1

## New infra needed

None. Every automated row lands in an existing tier: vitest (`packages/*/src/**/__tests__/`) and the Playwright docker harness (`tests/e2e/`), plus the doctor regenerator already invoked in CI.
