## 1. Repair the dependency tree (must precede everything)

- [ ] 1.1 Run `pnpm install` to resolve the drifted tree to a coherent pinned 0.83.0 baseline. Never `npm install` — `pnpm-workspace.yaml` sets `nodeLinker: hoisted`.
- [ ] 1.2 Run the full suite on the repaired 0.83.0 tree to establish a clean pre-bump baseline: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`.
- [ ] 1.3 Add an L1 test asserting the resolved pi version in `node_modules` satisfies the `packages/server` dependency range — input: repo after `pnpm install`; trigger: read resolved pi version; observable: version satisfies the declared range (test-plan #X13). See `packages/server/src/__tests__/pi-version-skew.test.ts`.

## 2. Move the governed pins together

- [ ] 2.1 Bump `packages/server/package.json` dependency `@earendil-works/pi-coding-agent` to `^0.84.0` and `piCompatibility.recommended` to `0.84.0`. Leave `minimum` at `0.78.0` and `maximum` at `null`.
- [ ] 2.2 Bump the `docker/Dockerfile` global install to `@earendil-works/pi-coding-agent@0.84.0`.
- [ ] 2.3 Bump `scripts/verify-release-deps.mjs` pi rule `minVersion` to `0.84.0` and update its evidence note to reference this change.
- [ ] 2.4 Confirm the bundled-extension peer-deps in `packages/electron/resources/bundled-extensions/*/package.json` stay unchanged (`>=0.75.0` / `^0.75.0`) because `minimum` did not move.
- [ ] 2.5 Run `pnpm install` again to resolve the 0.84.0 tree.
- [ ] 2.6 Rename/retarget `packages/server/src/__tests__/pi-version-skew-recommended-0-83.test.ts` for the 0.84.0 recommended version.
- [ ] 2.7 Add an L1 test for the pin block — input: `packages/server/package.json`; trigger: read `piCompatibility`; observable: `recommended === "0.84.0"`, `minimum === "0.78.0"`, `maximum === null`, dependency pin `^0.84.0` (test-plan #E1). See `packages/server/src/__tests__/pi-version-skew.test.ts`.
- [ ] 2.8 Add an L1 test that the floor did not rise — input: bundled-extension package.json files; trigger: read peer-deps after the bump; observable: `pi-anthropic-messages` stays `>=0.75.0` and `pi-flows` stays `^0.75.0` (test-plan #E2). See `packages/server/src/__tests__/pi-version-skew.test.ts`.
- [ ] 2.9 Add an L1 test for pin coherence — input: server dep, `piCompatibility.recommended`, `docker/Dockerfile`, `verify-release-deps.mjs` `minVersion`; trigger: run `node scripts/verify-release-deps.mjs`; observable: exit 0 and all four report `0.84.0` (test-plan #E3). See `packages/server/src/__tests__/pi-version-skew.test.ts`.
- [ ] 2.10 Add an L1 test that divergence is caught — input: dep `^0.84.0` with `minVersion` left at `0.83.0`; trigger: run `verify-release-deps.mjs`; observable: non-zero exit naming the pi pin-coherence rule (test-plan #E4). See `packages/server/src/__tests__/pi-version-skew.test.ts`.
- [ ] 2.11 Add an L1 BVA test for the upgrade-hint boundary — input: running pi `0.83.999` / `0.84.0`; trigger: compute compatibility; observable: `0.83.999` → `upgradeRecommended: true` with no `error`; `0.84.0` → `upgradeRecommended: false` (test-plan #E5). See `packages/server/src/__tests__/health-compatibility.test.ts`.
- [ ] 2.12 Add an L1 BVA test for the blocking-error boundary — input: running pi `0.77.999` / `0.78.0`; trigger: compute compatibility; observable: `0.77.999` → 503-blocking `error`; `0.78.0` → no `error` with `upgradeRecommended: true` (test-plan #E6). See `packages/server/src/__tests__/health-compatibility.test.ts`.

## 3. Record the not-applicable streaming break as testable assertions

- [ ] 3.1 Add an L1 test pinning the in-process event shape — input: installed pi types; trigger: read `dist/core/extensions/types.d.ts` `MessageUpdateEvent`; observable: the interface declares `message: AgentMessage`, so a future pi that removes it fails loudly (test-plan #E7). See `packages/extension/src/__tests__/pi-version-tracker.test.ts`.
- [ ] 3.2 Add an L1 test pinning the bridge's event surface — input: `packages/extension/src/bridge.ts`; trigger: scan core-event subscription; observable: subscribes via `pi.on(<type>, handler)` with zero references to `toJsonEvent` / `JsonAgentSessionEvent` (test-plan #E8). See `packages/extension/src/__tests__/pi-version-tracker.test.ts`.

## 4. Provider headers — null deletion markers

- [ ] 4.1 Widen the header type in `packages/extension/src/auto-session-namer.ts` to `string | null` and forward null markers to pi-ai unchanged.
- [ ] 4.2 Replace the `Object.keys(headers).length > 0` gate with a usable-value check that ignores null-only maps.
- [ ] 4.3 Add an L1 test that nulls are forwarded — input: `getApiKeyAndHeaders()` → `{ "x-del": null, "x-keep": "v" }`; trigger: build the `streamSimple` request; observable: request carries `x-del` with value `null`, never the string `"null"` (test-plan #E9). See `packages/extension/src/__tests__/auto-session-namer.test.ts`.
- [ ] 4.4 Add an L1 BVA test that a null-only map counts as empty — input: headers `{ "a": null, "b": null }` (key count 2, usable 0); trigger: evaluate the gate; observable: gate reports no usable headers and is not satisfied by the key count (test-plan #E10). See `packages/extension/src/__tests__/auto-session-namer.test.ts`.
- [ ] 4.5 Add an L1 BVA test that a mixed map counts as non-empty — input: headers `{ "a": null, "b": "v" }`; trigger: evaluate the gate; observable: gate reports usable headers present (test-plan #E11). See `packages/extension/src/__tests__/auto-session-namer.test.ts`.

## 5. Model-registry refresh — options and results

- [ ] 5.1 Update the refresh call site in `packages/extension/src/command-handler.ts` to pass `ModelsRefreshOptions` and inspect the `ModelsRefreshResult`; remove the bare `catch {}`.
- [ ] 5.2 Update the fire-and-forget refresh in `packages/extension/src/bridge.ts` to inspect its result.
- [ ] 5.3 Add an L1 test that the result is inspected — input: refresh returning a result with one provider error; trigger: call the refresh site; observable: return value is read and the outcome is not reported as fully successful (test-plan #E12). See `packages/extension/src/__tests__/provider-register-reload.test.ts`.
- [ ] 5.4 Add an L1 test for scoped refresh — input: one provider's credentials changed; trigger: trigger refresh; observable: `ModelsRefreshOptions` names that provider only and other catalogs are not re-fetched (test-plan #E13). See `packages/extension/src/__tests__/provider-register-reload.test.ts`.
- [ ] 5.5 Add an L1 fault-injection test that a provider error is surfaced — input: one provider's catalog fetch rejects; trigger: trigger a refresh; observable: error logged with the provider identity and refresh not reported as fully successful (test-plan #X1). See `packages/extension/src/__tests__/provider-register-reload.test.ts`.
- [ ] 5.6 Add an L1 test that refresh failure is not swallowed — input: refresh throws; trigger: call the refresh site; observable: failure is observable to the caller with no empty `catch {}` discarding it (test-plan #X2). See `packages/extension/src/__tests__/provider-register-reload.test.ts`.
- [ ] 5.7 Add an L1 fault-injection test for cancellation — input: refresh stalls with a supplied `AbortSignal`; trigger: abort mid-refresh; observable: refresh stops and the aborted outcome is distinguishable from success (test-plan #X3). See `packages/extension/src/__tests__/provider-register-reload.test.ts`.

## 6. OAuth refresh — concrete abort signal

- [ ] 6.1 Pass a concrete `AbortSignal` on every `refreshToken` call in `packages/server/src/model-proxy/internal-auth-storage.ts` (lines ~129 and ~137).
- [ ] 6.2 Add an L1 test that the signal is supplied — input: an OAuth credential due for refresh; trigger: internal auth storage refreshes it; observable: `refreshToken` receives a concrete `AbortSignal` as its second argument (test-plan #X4). See `packages/server/src/__tests__/provider-auth-storage.test.ts`.
- [ ] 6.3 Add an L1 fault-injection test that an aborted refresh persists nothing — input: signal aborts mid-refresh; trigger: abort; observable: no partially-refreshed credential is written to storage (test-plan #X5). See `packages/server/src/__tests__/provider-auth-storage.test.ts`.
- [ ] 6.4 Add an L1 fault-injection test that a failed refresh keeps the prior credential — input: `refreshToken` rejects; trigger: trigger refresh; observable: previously stored credential intact and the failure surfaced, not swallowed (test-plan #X6). See `packages/server/src/model-proxy/__tests__/oauth-compat.test.ts`.

## 7. v4 lane-based session model

- [ ] 7.1 Audit `packages/extension/src/commit-draft-agent.ts` against the v4 `Session` / `SessionStorage` / `SessionRepo` APIs and add constructor-shape feature detection with a pre-0.84 `SessionManager.inMemory` fallback.
- [ ] 7.2 Audit the inline reference at `packages/extension/src/bridge.ts:426` into `pi-agent-core/agent.js:307-330` against the v4 session model and record the finding.
- [ ] 7.3 Add an L1 state-transition test for the v4 path — input: running pi exposes the v4 constructor; trigger: request a commit draft; observable: draft produced via the v4 path with the subscription unsubscribed and the session disposed (test-plan #X7). See `packages/extension/src/__tests__/commit-draft.test.ts`.
- [ ] 7.4 Add an L1 state-transition test for the floor-pi fallback — input: running pi exposes only `SessionManager.inMemory`; trigger: request a commit draft; observable: draft produced via the legacy path with no crash and no behavior regression (test-plan #X8). See `packages/extension/src/__tests__/commit-draft.test.ts`.
- [ ] 7.5 Add an L1 fault-injection test for disposal — input: the agent turn rejects mid-draft; trigger: request a commit draft; observable: subscription unsubscribed and session disposed despite the failure (test-plan #X9). See `packages/extension/src/__tests__/commit-draft.test.ts`.

## 8. Adopt AGENTS.override.md and samplingParams

- [ ] 8.1 Implement `AGENTS.override.md` shadowing in the dashboard's directory-context resolution, behind runtime feature-detection with an `AGENTS.md`-inheritance fallback.
- [ ] 8.2 Classify `AGENTS.override.md` as a context resource in the dashboard resource scanner.
- [ ] 8.3 Support arbitrary `samplingParams` on custom-model configuration behind runtime feature-detection, omitting the field on floor pi.
- [ ] 8.4 Add an L1 test that the override shadows its sibling — input: a directory containing both `AGENTS.override.md` and `AGENTS.md`; trigger: resolve directory context; observable: only the override's content applies and the sibling is not also applied (test-plan #E14). See `packages/extension/src/__tests__/dashboard-context-injector.test.ts`.
- [ ] 8.5 Add an L1 test that absence leaves inheritance untouched — input: a directory containing only `AGENTS.md`; trigger: resolve directory context; observable: normal ancestor inheritance, unchanged from pre-bump behavior (test-plan #E15). See `packages/extension/src/__tests__/dashboard-context-injector.test.ts`.
- [ ] 8.6 Add an L1 test that the override is classified as a context resource — input: a directory containing `AGENTS.override.md`; trigger: run the resource scanner; observable: classified as a context resource, not an ordinary markdown file (test-plan #E16). See `packages/server/src/__tests__/resource-activation-toggle.test.ts`.

## 9. Runtime verification against real pi 0.84.0

- [ ] 9.1 Restart the server and confirm `curl -s http://localhost:8000/api/health | jq '.piVersion, .compatibility'` reports 0.84.0 with no skew error.
- [ ] 9.2 Add an L2 smoke covering a real session spawn — input: dashboard on pi 0.84.0; trigger: spawn a real session from the dashboard; observable: session reaches `active` with no unresolved-symbol error from `provider-register.ts` in `server.log` (test-plan #X10). See `qa/tests/02-server-start.sh`.
- [ ] 9.3 Add an L2 smoke covering a real turn — input: dashboard on pi 0.84.0; trigger: drive one real turn to completion in a spawned session; observable: turn completes with no runtime error from the `pi-agent-core/agent.js` inline reference (test-plan #X11). See `qa/tests/02-server-start.sh`.
- [ ] 9.4 Add an L3 spec for health compatibility — input: dashboard on pi 0.84.0; trigger: `GET /api/health`; observable: converges to `piVersion == 0.84.0` with no `error` and no `upgradeRecommended` (test-plan #F1). See `tests/e2e/anthropic-bridge-activation.spec.ts`.
- [ ] 9.5 Add an L3 spec that streaming is unaffected — input: a live session on pi 0.84.0; trigger: send a prompt producing multi-chunk assistant text; observable: transcript converges to the complete text with no truncation and no duplication (test-plan #F2). See `tests/e2e/chat-render-fx.spec.ts`.
- [ ] 9.6 Add an L3 spec for replay equivalence — input: a session with a finished multi-tool turn on pi 0.84.0; trigger: reload the browser for a cold replay; observable: replayed transcript equivalent to the live-streamed one including tool-flush row order (test-plan #F3). See `tests/e2e/chat-render-fx.spec.ts`.
- [ ] 9.7 Add an L3 spec that the TUI features stay absent from the web client — input: dashboard settings on pi 0.84.0; trigger: open Settings; observable: no fullscreen-TUI control rendered and KaTeX + Mermaid still render in the transcript (test-plan #F4). See `tests/e2e/change-summary-table.spec.ts`.
- [ ] 9.8 Add an L3 spec for the moved Dockerfile pin — input: `docker/Dockerfile` pinned `@0.84.0`; trigger: run the docker E2E harness; observable: harness comes up on the port from `.pi-test-harness.json` (`dashboardPort`) and reports `piVersion 0.84.0` (test-plan #X12). See `tests/e2e/anthropic-bridge-activation.spec.ts`.

## 10. Verification-only and documentation

- [ ] 10.1 Evaluate whether Baseten needs dashboard provider-auth wiring and record a written finding in this change; assert no product behavior (test-plan: manual-only).
- [ ] 10.2 Run `node scripts/verify-release-deps.mjs` and confirm exit 0.
- [ ] 10.3 Run the full suite and confirm the `pi-version-skew`, `agent-settled`, `provider-register`, `bundled-node-meets-pi-floor`, and `replay-compaction-equivalence` suites pass.
- [ ] 10.4 Run the doctor skill's `--regenerate pi-resolution` to refresh derived version tables; confirm the proposed prose edits rather than silently overwriting.
- [ ] 10.5 Update the `@earendil-works/pi-coding-agent@X` version in `docker/AGENTS.md` (delegate the `docs/`-style prose to DocScribe) and add a `## [Unreleased]` CHANGELOG entry.
