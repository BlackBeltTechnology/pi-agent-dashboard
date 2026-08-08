## 1. Repair the dependency tree (must precede everything)

- [x] 1.1 Run `pnpm install` to resolve the drifted tree to a coherent pinned 0.83.0 baseline. Never `npm install` — `pnpm-workspace.yaml` sets `nodeLinker: hoisted`.
- [x] 1.2 Run the full suite on the repaired 0.83.0 tree to establish a clean pre-bump baseline: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`.
- [x] 1.3 Add an L1 test asserting the resolved pi version in `node_modules` satisfies the `packages/server` dependency range — input: repo after `pnpm install`; trigger: read resolved pi version; observable: version satisfies the declared range (test-plan #X13). See `packages/server/src/__tests__/pi-version-skew.test.ts`.

## 2. Move the governed pins together

> Tasks 2.4 and 2.8 were DROPPED during implementation: they targeted
> `packages/electron/resources/bundled-extensions/*/package.json`, a path that
> does not exist and never has (removed under `eliminate-electron-runtime-install`
> task 5.7; see `forge.config.ts:109`). Rationale: design.md D2a. Test-plan row
> E2 is dropped with them. Numbering is left intact so the remaining task
> numbers keep matching the test-plan references.

- [x] 2.1 Bump `packages/server/package.json` dependency `@earendil-works/pi-coding-agent` to `^0.84.1` and `piCompatibility.recommended` to `0.84.1`. Leave `minimum` at `0.78.0` and `maximum` at `null`.
- [x] 2.2 Bump the `docker/Dockerfile` global install to `@earendil-works/pi-coding-agent@0.84.1`.
- [x] 2.3 Bump `scripts/verify-release-deps.mjs` pi rule `minVersion` to `0.84.1` and update its evidence note to reference this change.
- [x] 2.5 Run `pnpm install` again to resolve the 0.84.1 tree.
- [x] 2.6 Rename/retarget `packages/server/src/__tests__/pi-version-skew-recommended-0-83.test.ts` to `pi-version-skew-recommended-0-84.test.ts` for the 0.84.1 recommended version.
- [x] 2.7 Add an L1 test for the pin block — input: `packages/server/package.json`; trigger: read `piCompatibility`; observable: `recommended === "0.84.1"`, `minimum === "0.78.0"`, `maximum === null`, dependency pin `^0.84.1` (test-plan #E1). See `packages/server/src/__tests__/pi-version-skew.test.ts`.
- [x] 2.9 Add an L1 test for pin coherence — input: server dep, `piCompatibility.recommended`, `docker/Dockerfile`, `verify-release-deps.mjs` `minVersion`; trigger: run `node scripts/verify-release-deps.mjs`; observable: exit 0 and all four report `0.84.1` (test-plan #E3). See `packages/server/src/__tests__/pi-version-skew.test.ts`.
- [x] 2.10 Add an L1 test that divergence is caught — input: dep `^0.84.1` with `minVersion` left at `0.84.0`; trigger: run `verify-release-deps.mjs`; observable: non-zero exit naming the pi pin-coherence rule (test-plan #E4). See `packages/server/src/__tests__/pi-version-skew.test.ts`.
- [x] 2.11 Add an L1 BVA test for the upgrade-hint boundary — input: running pi `0.84.0` / `0.84.1`; trigger: compute compatibility; observable: `0.84.0` → `upgradeRecommended: true` with no `error`; `0.84.1` → `upgradeRecommended: false` (test-plan #E5). See `packages/server/src/__tests__/health-compatibility.test.ts`.
- [x] 2.12 Add an L1 BVA test for the blocking-error boundary — input: running pi `0.77.999` / `0.78.0`; trigger: compute compatibility; observable: `0.77.999` → 503-blocking `error`; `0.78.0` → no `error` with `upgradeRecommended: true` (test-plan #E6). See `packages/server/src/__tests__/health-compatibility.test.ts`.

## 3. Record the not-applicable streaming break as testable assertions

- [x] 3.1 Add an L1 test pinning the in-process event shape — input: installed pi types; trigger: read `dist/core/extensions/types.d.ts` `MessageUpdateEvent`; observable: the interface declares `message: AgentMessage`, so a future pi that removes it fails loudly (test-plan #E7). See `packages/extension/src/__tests__/pi-version-tracker.test.ts`.
- [x] 3.2 Add an L1 test pinning the bridge's event surface — input: `packages/extension/src/bridge.ts`; trigger: scan core-event subscription; observable: subscribes via `pi.on(<type>, handler)` with zero references to `toJsonEvent` / `JsonAgentSessionEvent` (test-plan #E8). See `packages/extension/src/__tests__/pi-version-tracker.test.ts`.
- [x] 3.3 Add an L1 test recording that `tool_call` `terminate` has no consumer — input: `packages/extension/src/bridge.ts`; trigger: scan the `tool_call` subscription; observable: `tool_call` is in `passThroughEventTypes` and no handler returns `block` or `terminate`, so a future blocking handler fails this assertion and forces the requirement to be revisited (test-plan #E17). See `packages/extension/src/__tests__/pi-version-tracker.test.ts`.

## 4. Provider headers — null deletion markers

- [x] 4.1 Widen the header type in `packages/extension/src/auto-session-namer.ts` to `string | null` and forward null markers to pi-ai unchanged.
- [x] 4.2 Replace the `Object.keys(headers).length > 0` gate with a usable-value check that ignores null-only maps.
- [x] 4.3 Add an L1 test that nulls are forwarded — input: `getApiKeyAndHeaders()` → `{ "x-del": null, "x-keep": "v" }`; trigger: build the `streamSimple` request; observable: request carries `x-del` with value `null`, never the string `"null"` (test-plan #E9). See `packages/extension/src/__tests__/auto-session-namer.test.ts`.
- [x] 4.4 Add an L1 BVA test that a null-only map counts as empty — input: headers `{ "a": null, "b": null }` (key count 2, usable 0); trigger: evaluate the gate; observable: gate reports no usable headers and is not satisfied by the key count (test-plan #E10). See `packages/extension/src/__tests__/auto-session-namer.test.ts`.
- [x] 4.5 Add an L1 BVA test that a mixed map counts as non-empty — input: headers `{ "a": null, "b": "v" }`; trigger: evaluate the gate; observable: gate reports usable headers present (test-plan #E11). See `packages/extension/src/__tests__/auto-session-namer.test.ts`.

## 5. Model-registry refresh — options and results

- [x] 5.1 Update the refresh call site in `packages/extension/src/command-handler.ts` to pass `ModelsRefreshOptions` and inspect the `ModelsRefreshResult`; remove the bare `catch {}`.
- [x] 5.2 Update the fire-and-forget refresh in `packages/extension/src/bridge.ts` to inspect its result.
- [x] 5.3 Add an L1 test that the result is inspected — input: refresh returning a result with one provider error; trigger: call the refresh site; observable: return value is read and the outcome is not reported as fully successful (test-plan #E12). See `packages/extension/src/__tests__/provider-register-reload.test.ts`.
- [x] 5.4 Add an L1 test for scoped refresh — input: one provider's credentials changed; trigger: trigger refresh; observable: `ModelsRefreshOptions` names that provider only and other catalogs are not re-fetched (test-plan #E13). See `packages/extension/src/__tests__/provider-register-reload.test.ts`.
- [x] 5.5 Add an L1 fault-injection test that a provider error is surfaced — input: one provider's catalog fetch rejects; trigger: trigger a refresh; observable: error logged with the provider identity and refresh not reported as fully successful (test-plan #X1). See `packages/extension/src/__tests__/provider-register-reload.test.ts`.
- [x] 5.6 Add an L1 test that refresh failure is not swallowed — input: refresh throws; trigger: call the refresh site; observable: failure is observable to the caller with no empty `catch {}` discarding it (test-plan #X2). See `packages/extension/src/__tests__/provider-register-reload.test.ts`.
- [x] 5.7 Add an L1 fault-injection test for cancellation — input: refresh stalls with a supplied `AbortSignal`; trigger: abort mid-refresh; observable: refresh stops and the aborted outcome is distinguishable from success (test-plan #X3). See `packages/extension/src/__tests__/provider-register-reload.test.ts`.

## 6. OAuth refresh — concrete abort signal

- [x] 6.1 Pass a concrete `AbortSignal` on every `refreshToken` call in `packages/server/src/model-proxy/internal-auth-storage.ts` (lines ~129 and ~137).
- [x] 6.2 Add an L1 test that the signal is supplied — input: an OAuth credential due for refresh; trigger: internal auth storage refreshes it; observable: `refreshToken` receives a concrete `AbortSignal` as its second argument (test-plan #X4). See `packages/server/src/__tests__/provider-auth-storage.test.ts`.
- [x] 6.3 Add an L1 fault-injection test that an aborted refresh persists nothing — input: signal aborts mid-refresh; trigger: abort; observable: no partially-refreshed credential is written to storage (test-plan #X5). See `packages/server/src/__tests__/provider-auth-storage.test.ts`.
- [x] 6.4 Add an L1 fault-injection test that a failed refresh keeps the prior credential — input: `refreshToken` rejects; trigger: trigger refresh; observable: previously stored credential intact and the failure surfaced, not swallowed (test-plan #X6). See `packages/server/src/model-proxy/__tests__/oauth-compat.test.ts`.

## 7. v4 lane-based session model

> Section 7 was RETARGETED during implementation. The v4 break lands on
> pi-agent-core, not the `pi-coding-agent` SDK surface the dashboard calls:
> `createAgentSession`, `SessionManager`, and `SessionManager.inMemory` are all
> still exported and callable in 0.84.1, and `sdk.d.ts:101` still documents the
> exact call `commit-draft-agent.ts` makes. The tasked feature-detection branch
> would be unreachable. Rationale: design.md D3a/D3b.

- [x] 7.1 Audit `packages/extension/src/commit-draft-agent.ts` against the v4 `Session` / `SessionStorage` / `SessionRepo` APIs. FINDING: the SDK session surface is unchanged in 0.84.1 — no migration and no feature-detection branch needed (design D3a).
- [x] 7.2 Audit the inline reference at `packages/extension/src/bridge.ts:426` into `pi-agent-core/agent.js` and record the finding. FINDING: it is a COMMENT, not a call — the code uses public `pi.sendUserMessage` / `pi.isStreaming`. The cited behaviour still holds in 0.84.1; only the line numbers moved, and the citation is updated (design D3b).
- [x] 7.3 Add an L1 state-transition test for the real session path — input: a commit draft request; trigger: run the fork subagent; observable: draft produced via `createAgentSession` + `SessionManager.inMemory` with `tools: []`, the subscription unsubscribed and the session disposed (test-plan #X7). See `packages/extension/src/__tests__/commit-draft-agent-session.test.ts`.
- [x] 7.4 Add an L1 test pinning the SDK session surface — input: the pinned pi 0.84.1; trigger: load the SDK entrypoint; observable: `createAgentSession`, `SessionManager`, and `SessionManager.inMemory` are all callable, so a future pi that collapses them into the v4 lane API fails loudly and forces D3a to be revisited (test-plan #X8). See `packages/extension/src/__tests__/commit-draft-agent-session.test.ts`.
- [x] 7.5 Add an L1 fault-injection test for disposal — input: the agent turn rejects mid-draft; trigger: request a commit draft; observable: subscription unsubscribed and session disposed despite the failure (test-plan #X9). See `packages/extension/src/__tests__/commit-draft-agent-session.test.ts`.

## 8. Adopt AGENTS.override.md and samplingParams

> Section 8 was RETARGETED during implementation. pi owns context-file
> resolution end-to-end (`dist/core/resource-loader.js:32` lists
> `AGENTS.override.md` FIRST and returns on first match), so the dashboard has
> nothing to implement there. `pi-resource-scanner.ts` only emits `skill` /
> `agent` and never classified `AGENTS.md` either. The dashboard's real
> "which files are context files" logic lives in the kb tooling. Rationale:
> design.md D7a.

- [x] 8.1 `AGENTS.override.md` shadowing in directory-context resolution. FINDING: pi-owned no-op — `loadContextFileFromDir` already returns the override first, shadowing the sibling. No dashboard implementation, and no feature-detection branch (an older pi simply never sees such a file).
- [x] 8.2 Classify `AGENTS.override.md` as a context resource. FINDING: retargeted — `pi-resource-scanner.ts` classifies skills/agents, not context files. The real sites are `packages/kb/src/dox.ts` (`agentsChain`), `packages/kb/src/indexer.ts` (`docTypeOf`), and `packages/kb-extension/src/extension.ts` (`AGENTS_NAMES`); all three now recognize the override.
- [x] 8.3 Support arbitrary `samplingParams` on custom-model configuration, omitting the field when absent. Added to `NativeModelEntry` (`packages/shared/src/models-json-reader.ts`) and forwarded by BOTH whitelisting consumers: `metadataFromNative` (`packages/extension/src/provider-register.ts`) and the server model build (`packages/server/src/model-proxy/internal-registry.ts`).
- [x] 8.4 Add an L1 test that the override shadows its sibling — input: a directory containing both `AGENTS.override.md` and `AGENTS.md`; trigger: walk the agents chain; observable: only the override applies for that directory, ancestors still inherit (test-plan #E14). See `packages/kb/src/__tests__/agents-override.test.ts`.
- [x] 8.5 Add an L1 test that absence leaves inheritance untouched — input: a directory containing only `AGENTS.md`; trigger: walk the agents chain; observable: normal ancestor inheritance, unchanged from pre-bump behavior (test-plan #E15). See `packages/kb/src/__tests__/agents-override.test.ts`.
- [x] 8.6 Add an L1 test that the override is doc-typed as a context file — input: `AGENTS.override.md`; trigger: `docTypeOf`; observable: classified `agents`, not an ordinary `doc` (test-plan #E16). See `packages/kb/src/__tests__/agents-override.test.ts`.

## 9. Runtime verification against real pi 0.84.1

> Executed against the `docker/test-up.sh` all-in-one harness (port read from
> `.pi-test-harness.json`, 18315 this run) rebuilt on the moved Dockerfile pin.
> The harness caught a REAL regression the unit suite missed — a two-copy pi
> tree made `/api/health` report the wrong running version with a spurious
> upgrade hint (design D8). F2/F3 ride the existing L3 suites (design D9).

- [x] 9.1 Confirmed against the docker harness (not the live dashboard): `curl -s http://localhost:8000/api/health | jq '.piVersion, .compatibility'` reports 0.84.1 with no skew error.
- [x] 9.2 Add an L2 smoke covering a real session spawn — input: dashboard on pi 0.84.1; trigger: spawn a real session from the dashboard; observable: session reaches `active` with no unresolved-symbol error from `provider-register.ts` in `server.log` (test-plan #X10). See `qa/tests/02-server-start.sh`.
- [x] 9.3 Add an L2 smoke covering a real turn — input: dashboard on pi 0.84.1; trigger: drive one real turn to completion in a spawned session; observable: turn completes with no runtime error from the `pi-agent-core/agent.js` inline reference (test-plan #X11). See `qa/tests/02-server-start.sh`.
- [x] 9.4 Add an L3 spec for health compatibility — input: dashboard on pi 0.84.1; trigger: `GET /api/health`; observable: converges to `piVersion == 0.84.1` with no `error` and no `upgradeRecommended` (test-plan #F1). See `tests/e2e/pi-084-runtime.spec.ts`.
- [x] 9.5 Add an L3 spec that streaming is unaffected — input: a live session on pi 0.84.1; trigger: send a prompt producing multi-chunk assistant text; observable: transcript converges to the complete text with no truncation and no duplication (test-plan #F2). COVERED BY the existing `chat-render-fx.spec.ts` + `chat-transcript-virtualization.spec.ts`, run green against the 0.84.1 harness (13 passed).
- [x] 9.6 Add an L3 spec for replay equivalence — input: a session with a finished multi-tool turn on pi 0.84.1; trigger: reload the browser for a cold replay; observable: replayed transcript equivalent to the live-streamed one including tool-flush row order (test-plan #F3). COVERED BY the existing `chat-transcript-virtualization.spec.ts` switch-and-restore + `enhance-tool-call-grouping.spec.ts` burst round-trip, run green against the 0.84.1 harness (13 + 3 passed).
- [x] 9.7 Add an L3 spec that the TUI features stay absent from the web client — input: dashboard settings on pi 0.84.1; trigger: open Settings; observable: no fullscreen-TUI control rendered and KaTeX + Mermaid still render in the transcript (test-plan #F4). See `tests/e2e/pi-084-runtime.spec.ts`.
- [x] 9.8 Add an L3 spec for the moved Dockerfile pin — input: `docker/Dockerfile` pinned `@0.84.1`; trigger: run the docker E2E harness; observable: harness comes up on the port from `.pi-test-harness.json` (`dashboardPort`) and reports `piVersion 0.84.1` (test-plan #X12). See `tests/e2e/pi-084-runtime.spec.ts`, which also guards D8's one-pi-version invariant.

## 10. Verification-only and documentation

- [x] 10.1 Baseten provider-auth wiring. FINDING: NOT needed. `_buildProviderCatalogue` (`provider-register.ts:577`) derives the catalogue generically from pi's `modelRegistry` + `authStorage.getOAuthProviders()`; `packages/{server,shared,extension}/src` contain zero `baseten` references. A new built-in pi provider appears automatically. No product behavior asserted (test-plan V1).
- [x] 10.1a Qwen Token Plan Individual (`qwen-token-plan-individual`, shared `QWEN_TOKEN_PLAN_API_KEY`). FINDING: NOT needed — same generic path as Baseten. Confirmed present in the pinned runtime (`dist/core/model-resolver.js`) and zero `qwen` references in dashboard source (test-plan V2).
- [x] 10.1b `pi auth check` adoption by the doctor skill. FINDING: NOT adopted in this change. The subcommand is not discoverable from the packaged `dist/cli/args.d.ts` surface, so gating would require shelling out and parsing help text — a behavior change to the doctor skill that this pin-bump change does not own. The doctor skill continues to derive auth state from its own probes. Recorded as a follow-up (test-plan V3).
- [x] 10.1c TypeBox fidelity CONFIRMED post-install: the pinned pi bundles `typebox@1.3.7` and the extension devDependency stays `^1.3.7` (test-plan V4).
- [x] 10.2 `node scripts/verify-release-deps.mjs` → exit 0, 11 rules passed.
- [x] 10.3 Run the full suite and confirm the `pi-version-skew`, `agent-settled`, `provider-register`, `bundled-node-meets-pi-floor`, and `replay-compaction-equivalence` suites pass.
- [x] 10.4 Doctor `--regenerate pi-resolution`. FINDING: verified NO-OP. The `pi-resolution` module derives every fact live (CLI binary, repo/managed package.json, cwd `createRequire`) and its floor from `piCompatibility.minimum`; it carries no hardcoded version table, and the committed knowledge-hash sidecars pass their freshness tests in the full suite. Nothing to regenerate.
- [x] 10.5 Updated the pi pin in the `docker/AGENTS.md` Dockerfile row to `@0.84.1` (a non-`docs/` directory tree file, so edited directly per the Documentation Update Protocol) and added `## [Unreleased]` CHANGELOG entries under Changed (pin bump, samplingParams, AGENTS.override.md) and Fixed (health ghost-version, null header markers, refresh contract, OAuth abort signal).
