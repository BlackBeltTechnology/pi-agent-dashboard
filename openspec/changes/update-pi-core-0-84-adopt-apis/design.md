## Context

The repo pins pi `^0.83.0`; 0.84.1 is published (0.84.0 is superseded). Two conditions shape this change.

**The tree is drifted.** `node_modules` resolves pi **0.80.10** against the pinned `^0.83.0` — a range that version does not satisfy. Nothing about 0.84.1 can be validated until the tree matches the pins. `pnpm-workspace.yaml` sets `nodeLinker: hoisted`, so the repair is `pnpm install`; `npm install` re-drifts it.

**The headline break does not apply here.** pi exposes two event surfaces:

| Surface | Types | Consumer |
|---|---|---|
| In-process `ExtensionAPI` | `dist/core/extensions/types.d.ts` | the dashboard bridge, via `pi.on(...)` |
| JSON / RPC **stdout** protocol | `dist/modes/json-event.d.ts`, `toJsonEvent()` | not consumed by the dashboard |

pi#7290 removed the cumulative `message` snapshot from `message_update` on the **stdout** surface only. `MessageUpdateEvent` in the in-process surface is byte-identical between 0.83.0 and 0.84.1 and still declares `message: AgentMessage`. The bridge subscribes in-process (`bridge.ts:1492`); the RPC keeper writes command lines to a UDS and never reads pi stdout as an event stream. The replay, compaction, and reducer stack is therefore untouched.

This distinction was not obvious: the CHANGELOG describes the change without naming which surface, and the repo greps positive for `message_update` in exactly the files that would have been affected had it been the other surface.

## Goals / Non-Goals

**Goals:**
- Land pi 0.84.1 as the pinned/recommended runtime with a coherent dependency tree.
- Resolve the four upstream breaks that reach dashboard code: null-bearing provider headers, `refresh()` options/results, OAuth abort signal, v4 harness session model.
- Adopt `AGENTS.override.md` and `samplingParams` behind runtime feature-detection.
- Leave durable, checkable evidence for every break judged not-applicable, so a future reader can distinguish "audited" from "not checked".

**Non-Goals:**
- Any delta-accumulation, dual-shape reduction, or replay/compaction rework.
- Raising `piCompatibility.minimum` (see Decisions).
- Browser-skill / agent-browser work — owned by `ship-browser-skill-and-electron-cdp`.
- Adopting fullscreen TUI mode or TUI Mermaid/LaTeX as dashboard features.

## Decisions

**D1 — Repair the tree before touching pins.** Sequencing matters: bumping pins on a drifted tree means the first `pnpm install` resolves two changes at once and a failure cannot be attributed. Repair to a coherent 0.83.0 baseline, confirm green, then bump. *Alternative rejected:* bump and install once — faster, but conflates a pre-existing bug with the upgrade.

**D2 — Keep `piCompatibility.minimum` at `0.78.0`; move only `recommended`.** The `pi-core-version-check` spec states `minimum` is an independent broad-support floor that SHALL NOT be raised merely because the pinned runtime moved. No 0.84.1 break reaches a surface the dashboard consumes, so nothing forces the floor up. *Alternative rejected:* lockstep `minimum == recommended == 0.84.1`, which would drop 0.78–0.83 users and require rewriting a `SHALL NOT` for no functional gain.

**D2a — The bundled-extensions floor anchor is a phantom; drop it rather than test it.** D2 originally rested on "the bundled-extension peer-deps (`>=0.75.0` / `^0.75.0`) stay frozen — the same spec ties them to `minimum`". Implementation disproved this: `packages/electron/resources/bundled-extensions/` does not exist and never has (`git log --all` on the path is empty), it is `.gitignore`d as a build artifact, and `forge.config.ts:109` records that change `eliminate-electron-runtime-install` (task 5.7) removed it — the same change that removed the offline cache. The main spec's floor-anchor clause is stale text that survived an archive sync. Task 2.4 (confirm the peer-deps) and its test (E2) were therefore unsatisfiable: no path, no such values anywhere in the repo. Both are dropped and the delta spec corrects the clause, which repairs the main spec on archive. *Alternative rejected:* author E2 anyway with a skip-if-absent guard — a vacuous test that reports green while asserting nothing.

**Known follow-up, deliberately out of scope:** the real workspace extension peer-deps are `>=0.80.10`, ABOVE `piCompatibility.minimum` (`0.78.0`). Under the old clause that would have been a floor violation. It is pre-existing on `develop`, unrelated to the 0.84.1 bump, and reconciling it (raise the floor, or declare the surfaces independent) belongs to its own change.

**D3 — SUPERSEDED by D3a.** Originally: feature-detect the v4 session API by constructor shape and keep a pre-0.84 `SessionManager.inMemory` fallback. Verification showed there is nothing to detect.

**D3a — The v4 session-model break does not reach the dashboard; record it, add no branch.** The 0.84.0 CHANGELOG entry reads "Replaced the **inherited pi-agent-core** harness session model with the v4 lane-based `Session`, `SessionStorage`, `SessionRepo` APIs" — pi-agent-core, not the `pi-coding-agent` SDK the dashboard imports. Verified against the installed 0.84.1 tarball: `createAgentSession`, `SessionManager`, and `SessionManager.inMemory` are all still exported and callable (`typeof === "function"`), `CreateAgentSessionOptions.sessionManager` still exists, and `dist/core/sdk.d.ts:101` still documents the exact `SessionManager.inMemory()` call `commit-draft-agent.ts` makes. This is the same shape as the `message_update` finding (D5): a real upstream break that misses the surface the dashboard consumes. Building the tasked feature-detection branch would add a path that can never be taken. *Alternative rejected:* implement it anyway as future-proofing — speculative complexity for a migration that has not happened.

**D3b — `bridge.ts:426` is a comment, not a call.** The design listed it as the change's largest runtime risk ("depends on pi internals that are not exported and will not fail at build time"). It is a prose citation explaining WHY the follow-up drain uses a fresh-turn `sendUserMessage` rather than `deliverAs`; the code itself uses only public `pi.sendUserMessage` / `pi.isStreaming`. The cited behaviour still holds in 0.84.1 — `finishRun()` sets `isStreaming = false` and clears `activeRun`, and `getFollowUpMessages` is only supplied while a run is active — so anything queued after `agent_end` still never drains. Only the line numbers moved (307-330 → ~323 and ~366-371); the citation is updated. The risk was overstated: there is no unexported-symbol dependency to break.

**D4 — Treat a null-only header map as empty.** The namer's gate is `Object.keys(headers).length > 0`, which stays true when every value is a `null` deletion marker. Emptiness must be judged on usable values, not key count. The two concerns are distinct: *forwarding* nulls to pi-ai unchanged (correctness) and *counting* them as absent (the gate).

**D5 — Record not-applicable breaks as testable requirements, not prose.** The `message_update` finding is encoded as scenarios asserting the in-process interface is unchanged and that the bridge uses `pi.on`. A future pi release that moves the in-process surface will fail those assertions instead of silently invalidating this analysis.

**D6 — Verify Baseten and Qwen Token Plan Individual before tasking them.** Baseten appears in 0.84.1 only as a `thinkingFormat` literal in `model-config.d.ts`. Qwen Token Plan Individual is new in 0.84.1 (`qwen-token-plan-individual`, shared `QWEN_TOKEN_PLAN_API_KEY`); the dashboard has zero `qwen` references in `packages/{server,client,shared}/src`. Whether either needs dashboard provider-auth wiring is unknown; `provider-auth-*` requirements are provider-generic today. Verification precedes any spec delta for both.

**D7 — Target 0.84.1, not 0.84.0.** 0.84.1 carries no breaking changes over 0.84.0, so every audit in this change holds for both; landing on 0.84.0 would pin an already-superseded version and force a second bump. Verified against the published tarball: `MessageUpdateEvent` in `dist/core/extensions/types.d.ts` still declares `message: AgentMessage` at 0.84.1, and the bundled TypeBox is still `1.3.7`.

**D8 — `terminate` on blocked `tool_call` has no consumer; record, do not adopt.** `ToolCallEventResult.terminate?: boolean` (`types.d.ts:786`) only takes effect for a handler that returns `block`. The bridge lists `tool_call` in `passThroughEventTypes` (`bridge.ts:1470`) and never blocks, so the field is unreachable from the dashboard. Recorded as audited-not-applicable under D5. *Alternative rejected:* wire a blocking handler to use it — that invents a tool-approval feature this change does not own.

## Risks / Trade-offs

- ~~**The v4 session-model audit touches unexported pi internals.**~~ **Retired — see D3a/D3b.** `bridge.ts:426` turned out to be a comment, and the SDK session API the dashboard calls is unchanged in 0.84.1. The residual risk is ordinary: exercise a real commit-draft and a real spawned session against 0.84.1 rather than trusting a green typecheck (still tasked as X10/X11).
- **Mocked tests can hide a pi-ai symbol break.** The `bump-pi-version` skill records this: catalog probes are mocked, so `provider-register.ts` can pass tests and fail on a live spawn. → Smoke-test a real dashboard session spawn as an explicit gate.
- **`minimum` stays 0.78.0, so every adopted surface needs a live fallback path.** More conditional code than a lockstep bump. → Accepted: the alternative drops supported users, and each fallback is asserted by a floor-pi scenario.
- **Not-applicable is a judgement about today's consumers.** If a future change makes the dashboard read pi's JSON/RPC stdout event stream, the delta shape becomes live. → D5's scenarios encode the assumption so it fails loudly.
- **TypeBox pin fidelity.** `pi-core-version-check` pins the extension devDependency `typebox` to match pi's bundled runtime. If 0.84.1 ships a newer TypeBox, the extension suite validates against the wrong version. → Verify the bundled version during the bump.

## Migration Plan

1. `pnpm install` → coherent 0.83.0 tree. Run the suite to establish a clean pre-bump baseline.
2. Move the pins together: server `dependencies`, `piCompatibility.recommended`, `docker/Dockerfile`, `verify-release-deps.mjs` `minVersion` + evidence note. `verify-release-deps.mjs` fails if these diverge.
3. `pnpm install` → 0.84.1. Apply the four code fixes.
4. Verify: `node scripts/verify-release-deps.mjs`; full suite; `curl /api/health | jq '.piVersion, .compatibility'`; a real session spawn; a real commit-draft.
5. Docker E2E, since the `Dockerfile` pin moved.

**Rollback:** the pin bump is one commit and every pin is declarative — revert and `pnpm install`. No data migration, no persisted-format change.

## Open Questions

- ~~Is the bundled-extensions peer-dep floor anchor real?~~ **Resolved: no** — the path never existed; see D2a. Tasks 2.4 / 2.8 and test-plan E2 are dropped.
- ~~Does pi 0.84.1 bundle a TypeBox newer than `1.3.7`?~~ **Resolved: no.** The published 0.84.1 `package.json` and `npm-shrinkwrap.json` both pin `typebox: 1.3.7`; the extension devDependency `^1.3.7` is correct as-is.
- Do Baseten or Qwen Token Plan Individual require dashboard provider-auth wiring, or does the generic API-key path already cover them?
- Should the doctor skill's auth diagnostics call `pi auth check` instead of inferring credential state, and what is the floor-pi fallback when the subcommand is absent?
- Does the v4 lane-based API change what `bridge.ts:426` reads out of `pi-agent-core/agent.js`?
- Is `AGENTS.override.md` recognized by pi's context loader alone, or does the dashboard's own resource scanner also need to classify it?
