# Test Plan — update-pi-core-0-84-adopt-apis

Stage: design   Generated: 2026-08-07

Gate resolved: the Baseten observable was unfillable and is recorded as a
verification-only row (V1) by explicit decision — no product behavior asserted.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | pi-core-version-check · recommended tracks upstream | decision-table | L1 | automated | `packages/server/package.json` | read `piCompatibility` | `recommended === "0.84.1"` AND `minimum === "0.78.0"` AND `maximum === null` AND dependency pin `^0.84.1` |
| E3 | pi-core-version-check · pin coherence | decision-table | L1 | automated | server dep, `piCompatibility.recommended`, `docker/Dockerfile`, `verify-release-deps.mjs` `minVersion` | run `node scripts/verify-release-deps.mjs` | exit 0; all four report `0.84.1` |
| E4 | pi-core-version-check · pin divergence is caught | decision-table | L1 | automated | dep pinned `^0.84.1`, `minVersion` left `0.84.0` | run `verify-release-deps.mjs` | non-zero exit naming the pi pin-coherence rule |
| E5 | pi-core-version-check · upgrade hint boundary (BVA) | BVA | L1 | automated | running pi `0.84.0` / `0.84.1` | compute compatibility | `0.84.0` → `upgradeRecommended: true`, no `error`; `0.84.1` → `upgradeRecommended: false` |
| E6 | pi-core-version-check · blocking-error boundary (BVA) | BVA | L1 | automated | running pi `0.77.999` / `0.78.0` | compute compatibility | `0.77.999` → 503-blocking `error`; `0.78.0` → no `error`, `upgradeRecommended: true` |
| E7 | pi-api-feature-detection · in-process event shape unchanged | state-invariant | L1 | automated | installed `@earendil-works/pi-coding-agent` types | read `dist/core/extensions/types.d.ts` `MessageUpdateEvent` | interface declares `message: AgentMessage` (assertion fails if a future pi removes it) |
| E8 | pi-api-feature-detection · bridge uses the in-process surface | state-invariant | L1 | automated | `packages/extension/src/bridge.ts` | scan core-event subscription | subscribes via `pi.on(<type>, handler)`; zero references to `toJsonEvent` / `JsonAgentSessionEvent` |
| E9 | bridge-auto-session-namer · null header forwarded unchanged | EP | L1 | automated | `getApiKeyAndHeaders()` → `{ "x-del": null, "x-keep": "v" }` | build the `streamSimple` request | request carries `x-del` with value `null`; never the string `"null"` |
| E10 | bridge-auto-session-namer · null-only map counts as empty | BVA | L1 | automated | headers `{ "a": null, "b": null }` (key count 2, usable 0) | evaluate the non-empty-headers gate | gate reports "no usable headers"; NOT satisfied by the non-zero key count |
| E11 | bridge-auto-session-namer · mixed map counts as non-empty | BVA | L1 | automated | headers `{ "a": null, "b": "v" }` | evaluate the gate | gate reports usable headers present |
| E12 | custom-provider-model-registry · refresh result inspected | decision-table | L1 | automated | registry refresh returning a `ModelsRefreshResult` with one provider error | call the refresh site | return value is read; outcome is not reported as fully successful |
| E13 | custom-provider-model-registry · scoped provider refresh | EP | L1 | automated | one provider's credentials changed | trigger refresh | `ModelsRefreshOptions` names that provider only; other provider catalogs are not re-fetched |
| E14 | agent-session-context-injection · override shadows sibling | decision-table | L1 | automated | dir containing both `AGENTS.override.md` and `AGENTS.md` | resolve directory context | only the override's content applies; the sibling `AGENTS.md` is not also applied |
| E15 | agent-session-context-injection · no override → inheritance | decision-table | L1 | automated | dir containing only `AGENTS.md` | resolve directory context | normal ancestor inheritance, unchanged from pre-bump behavior |
| E16 | agent-session-context-injection · override classified as context resource | EP | L1 | automated | dir containing `AGENTS.override.md` | run the dashboard resource scanner | file is classified as a context resource, not an ordinary markdown file |
| E17 | pi-api-feature-detection · `tool_call` `terminate` has no consumer | state-invariant | L1 | automated | `packages/extension/src/bridge.ts` | scan the `tool_call` subscription | `tool_call` is in `passThroughEventTypes`; no handler returns `block` or `terminate` (assertion fails if a future blocking handler is introduced) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | pi-core-version-check · health surfaces compatibility | state-transition | L3 | automated | dashboard on pi 0.84.1 | `GET /api/health` | converges to `piVersion == 0.84.1` and `compatibility` with no `error` and no `upgradeRecommended` |
| F2 | pi-api-feature-detection · streaming unaffected by the bump | state-convergence | L3 | automated | a live session on pi 0.84.1 | send a prompt producing multi-chunk assistant text | transcript converges to the complete assistant text — no truncation, no duplication |
| F3 | pi-api-feature-detection · replay equivalence across the bump | state-convergence | L3 | automated | session with a finished multi-tool turn on pi 0.84.1 | reload the browser (cold replay) | replayed transcript is equivalent to the live-streamed one, including tool-flush row order |
| F4 | pi-api-feature-detection · TUI no-ops absent from the web client | decision-table | L3 | automated | dashboard settings on pi 0.84.1 | open Settings | no fullscreen-TUI control is rendered; KaTeX + Mermaid still render in the transcript |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | custom-provider-model-registry · provider error surfaced | fault-injection (abort) | L1 | automated | one provider's catalog fetch rejects | trigger a registry refresh | error is logged with the provider identity; refresh is not reported as fully successful |
| X2 | custom-provider-model-registry · refresh not swallowed by bare catch | fault-injection (abort) | L1 | automated | refresh throws | call the refresh site | failure is observable to the caller; no empty `catch {}` discards it |
| X3 | custom-provider-model-registry · cancellation propagated | fault-injection (delay) | L1 | automated | refresh stalls; supplied `AbortSignal` aborts | abort mid-refresh | refresh stops; aborted outcome is distinguishable from success |
| X4 | model-proxy-credential-routing · refresh invoked with a signal | fault-injection (abort) | L1 | automated | OAuth credential due for refresh | internal auth storage refreshes it | `refreshToken` receives a concrete `AbortSignal` as its second argument |
| X5 | model-proxy-credential-routing · aborted refresh persists nothing | fault-injection (abort) | L1 | automated | signal aborts mid-refresh | abort | no partially-refreshed credential is written to storage |
| X6 | model-proxy-credential-routing · failed refresh keeps prior credential | fault-injection (abort) | L1 | automated | `refreshToken` rejects | trigger refresh | previously stored credential is intact; failure surfaced, not swallowed |
| X7 | bridge-commit-draft · v4 lane API path | state-transition | L1 | automated | running pi exposes the v4 `Session`/`SessionStorage`/`SessionRepo` constructor | request a commit draft | draft produced via the v4 path; subscription unsubscribed and session disposed |
| X8 | bridge-commit-draft · pre-v4 fallback on floor pi | state-transition | L1 | automated | running pi exposes only `SessionManager.inMemory` | request a commit draft | draft produced via the legacy path; no crash, no behavior regression |
| X9 | bridge-commit-draft · disposal on every outcome | fault-injection (abort) | L1 | automated | the agent turn rejects mid-draft | request a commit draft | subscription unsubscribed and session disposed despite the failure |
| X10 | design risk · pi-ai symbol break hidden by mocks | fault-injection (real dependency) | L2 | automated | dashboard on pi 0.84.1, real credentials absent | spawn a real session from the dashboard | session reaches `active`; no unresolved-symbol error from `provider-register.ts` in `server.log` |
| X11 | design risk · unexported pi internals at `bridge.ts:426` | fault-injection (real dependency) | L2 | automated | dashboard on pi 0.84.1 | drive one real turn to completion in a spawned session | turn completes; no runtime error originating from the `pi-agent-core/agent.js` inline reference |
| X12 | migration · Dockerfile pin moved | state-transition | L3 | automated | `docker/Dockerfile` pinned `@0.84.1` | run the docker E2E harness | harness comes up on the port from `.pi-test-harness.json` (`dashboardPort`); dashboard reports `piVersion 0.84.1` |
| X13 | migration · drifted tree is repaired | state-invariant | L1 | automated | repo after `pnpm install` | read the resolved pi version in `node_modules` | resolved version satisfies the `packages/server` dependency range |

### Verification-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| V1 | proposal · Baseten evaluation | evidence-gathering | — | manual-only | pi 0.84.1 `model-config.d.ts` + `provider-auth-*` handlers | inspect whether Baseten needs dashboard provider-auth wiring | [judgment: a written finding recorded in the change — no product behavior asserted, by explicit decision at the design gate] |
| V2 | proposal · Qwen Token Plan Individual evaluation | evidence-gathering | — | manual-only | pi 0.84.1 provider `qwen-token-plan-individual` + `QWEN_TOKEN_PLAN_API_KEY` + `provider-auth-*` handlers | inspect whether it needs dashboard provider-auth wiring or is covered by the provider-generic API-key path | [judgment: a written finding recorded in the change — no product behavior asserted] |
| V3 | proposal · `pi auth check` adoption evaluation | evidence-gathering | — | manual-only | pi 0.84.1 `pi auth check` + the doctor skill's auth diagnostics | inspect whether the doctor skill should call the preflight instead of inferring credential state | [judgment: a written finding recorded in the change; if adopted, gated on subcommand presence with the current inference as floor-pi fallback] |
| V4 | pi-core-version-check · bundled TypeBox fidelity | evidence-gathering | — | manual-only | installed pi 0.84.1 `package.json` / `npm-shrinkwrap.json` | read the bundled `typebox` version | [judgment: confirmed `1.3.7` pre-flight; extension devDependency stays `^1.3.7`] |

---

## Coverage summary

- Requirements covered: 14/14 (7 spec deltas, all requirements)
- Scenarios by class: edge 16 · perf 0 · frontend 4 · error 13 · verification 4
- Scenarios by level: L1 26 · L2 2 · L3 5 · — 4
- Scenarios by disposition: automated 33 · manual-only 4

Row E2 (bundled-extension peer-deps) was DROPPED during implementation — it
targeted a path that does not exist. See design.md D2a. Its id is retired, not
reused, so the remaining ids keep matching their task references.

No performance scenarios: this change introduces no latency, throughput, or
memory requirement. Inventing a threshold would violate the skill's
never-invent-a-missing-value rule.

## New infra needed

None. Every row lands in an existing tier: vitest `__tests__` (L1), `qa/tests`
(L2), and Playwright `tests/e2e` against the docker harness (L3).
