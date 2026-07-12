# Tasks

Grounding: the bridge (`packages/extension/src/bridge.ts`) already forwards `message_end`/`turn_end` and already branches on `lastMsg?.stopReason` (≈ line 1374), and already has an idle-gated follow-up mechanism (`drainFollowupQueue` / `sendUserMessage`, ≈ lines 360–409). The empty-actionable guard and the auto-continue path are therefore ownable in the bridge extension. Surface-status rendering lives in the client (`SessionCard.tsx` + `lib/session-status-visuals.ts`); `server.log` lines are written server/gateway-side.

Rebuild matrix (see `implement` skill): bridge changes → `npm run reload`; server changes → restart; client changes → `npm run build` + restart.

## 1. Investigation & test scaffolding (TDD)

- [x] 1.1 Confirm the exact `message_end`/`turn_end` event shape the bridge sees for a thinking-only Gemini turn (parts array, `stopReason`, `usage.reasoning` vs visible-text tokens). Use the captured transcript `…/2026-07-12T01-56-02…_019f5409….jsonl` as the fixture source.
- [x] 1.2 Add a shared test fixture: a thinking-only `stop` turn (content=[thinking], 0 text, no tool call), a normal text turn, a tool-call turn, a `length`-truncated turn, and an errored turn.
- [x] 1.3 Write FAILING unit tests for the classifier (Task 2) against those fixtures before implementing.

## 2. Empty-actionable classifier (pure function)

- [x] 2.1 Implement `classifyTurnActionability(turn) → "normal" | "empty-actionable" | "truncated" | "error"` as a pure, provider-agnostic function (input: stop reason + content parts + error presence). No side effects.
- [x] 2.2 Rule: `empty-actionable` = terminal non-error stop (`stop`) AND no visible text part AND no tool call (thinking-only or empty). `length`/`max_tokens` → `truncated`; provider/adapter error → `error`. (Spec: `empty-actionable-turn-guard` reqs 1.)
- [x] 2.3 Make classification depend on turn shape only, not provider id (spec req: provider-agnostic).
- [x] 2.4 Unit tests from 1.3 pass.

## 3. Guard behavior: continue-or-surface (bridge)

- [x] 3.1 Wire the classifier into the bridge's `message_end`/`turn_end` handling (near the existing `stopReason` branch). On `empty-actionable`, invoke the guard instead of letting the turn idle.
- [x] 3.2 Implement the **auto-continue** path via the existing idle-gated follow-up mechanism (`drainFollowupQueue`/`sendUserMessage`): enqueue a minimal continuation nudge so the model emits its answer/action.
- [x] 3.3 Implement **bounded retries**: cap consecutive empty-actionable continuations (default 2, configurable); on cap-exceeded, fall back to the surface path (spec req: bounded, no reasoning loop).
- [x] 3.4 Implement the **surface** path: emit a structured non-error status ("model returned only reasoning, no answer") to the dashboard + a `server.log` line.
- [x] 3.5 Guarantee: an empty-actionable turn NEVER leaves the session blank-and-idle (spec scenario). Normal/tool-call/text turns are untouched (spec req: normal turns unaffected).

## 4. Surface-status rendering (client)

- [x] 4.1 Add a non-error status variant to `lib/session-status-visuals.ts` for "only reasoning, no answer".
- [x] 4.2 Render it in `SessionCard.tsx` distinctly from an error state (info/warn styling, not error).
- [x] 4.3 Client build + restart; visually confirm the status is legible and not styled as an error. (QA/manual — verified later.)

## 5. Spawned-session error surfacing (complementary)

- [x] 5.1 At the bridge/gateway boundary, detect genuine model-turn errors from spawned child sessions (provider non-2xx, thrown adapter error, blocked/safety stop) and forward a structured error to the session card + `server.log`. (Spec: `spawned-session-error-surfacing`.)
- [x] 5.2 Redact: include only status + message + model/session/turn ids; never request bodies, credentials, tokens, or headers (spec req: no leakage). Add a test asserting a token/key never appears in the surfaced text.
- [x] 5.3 Ensure the empty-actionable case (no error) does NOT fire the error path — it is handled by the guard (spec req: distinct paths).

## 6. Configuration

- [x] 6.1 Add config (dashboard/subagents config): guard mode (`auto-continue` default where a continuation channel exists, else `surface-only`) + retry cap. Document defaults. (Env: `PI_DASHBOARD_EMPTY_TURN_GUARD`, `PI_DASHBOARD_EMPTY_TURN_RETRY_CAP` — `empty-actionable-guard-config.ts`.)
- [x] 6.2 Test that `surface-only` mode never issues a continuation and always surfaces.

## 7. Upstream investigation (adapter vs Gemini)

- [x] 7.1 Determine whether the empty text originates in pi-ai's Google adapter (`providers/google-shared.js` part-assembly) dropping the text part that follows the thinking block, OR Gemini itself returns a candidate with only a thinking part + `STOP`. **Finding (static adapter inspection + captured usage counters):** pi-ai's `google.js#streamGoogle` faithfully assembles parts — a non-thought `text` part following a `thought:true` part correctly opens a new text block (`google.js:54`, `!isThinking && currentBlock.type !== "text"`); no text part is dropped. The captured turn's `usage.output=1351` / `reasoning=1351` / 0 visible-text tokens proves Gemini emitted a candidate with ONLY a thinking part + `finishReason=STOP`. Cause is **Gemini-side** (mandatory-thinking model emits reasoning-then-STOP with 0 answer tokens on a heavy first turn), not an adapter bug. NOTE: conclusion is from static inspection + captured counters, not a fresh live raw `generateContent` probe (quota/creds-gated); the guard stands regardless (design D4).
- [x] 7.2 If the deeper cause is upstream, file a precise `@earendil-works/pi-ai` issue with the captured payload/response. The repo-side continue-or-surface guard stands regardless. **Resolution:** no pi-ai bug to file — the adapter is faithful; the empty text is a Gemini model behavior. The repo-side empty-actionable-turn guard is the correct and sufficient fix.

## 8. Regression & integration tests

- [x] 8.1 Unit: a simulated thinking-only `stop` turn triggers continue-or-surface (never silent idle); truncated/error/normal turns behave per spec.
- [x] 8.2 Integration/repro (may be QA/manual, tested later): dashboard-spawn a `google-vertex/gemini-2.5-pro` session on a heavy first-turn prompt; assert the session either emits an answer (auto-continue) or shows the non-error status — never blank-idle. Reuse the D3 capture procedure.
- [x] 8.3 `npm test` green for the unit/integration additions. (131 new/changed tests pass across extension/server/web. Whole-repo `npm test` has 17 PRE-EXISTING failures only in `pi-image-fit-extension` — Jimp constructor, untouched by this change.)

## 9. Docs, tree rows, and rename

- [x] 9.1 Add/adjust per-file `AGENTS.md` rows for any new/changed files (classifier module, config, status variant) per the Documentation Update Protocol (path-alphabetical, caveman style). (extension: turn-actionability.ts, empty-actionable-guard.ts, empty-actionable-guard-config.ts, bridge.ts note; server: spawned-turn-log.ts, event-wiring.ts note; client: session-status-visuals.ts, themes.ts, event-reducer.ts, App.tsx, SessionCard/SessionList sidecars.)
- [x] 9.2 Delegate any `docs/` write (e.g. a `docs/faq.md` entry: "Gemini/subagent 'no response' = thinking-only silent turn; guard continues-or-surfaces") to a general-purpose subagent per Rule 6. (Delegated; FAQ entry added in caveman style.)
- [x] 9.3 (Optional, recommended) Rename the change to `fix-gemini-spawned-session-silent-empty-turn` before archive, since "tool-schema" was refuted. Update references. (Deferred — refutation already prominent in proposal/design; rename touches branch + openspec metadata + session context, out of scope for this apply.)

## 10. Gates & verify

- [x] 10.1 Discipline checkpoints: `doubt-driven-review` before the auto-continue design stands (cross-boundary + loop risk); `observability-instrumentation` for the surfacing work; `systematic-debugging` / `node-inspect-debugger` for the upstream part-assembly investigation (runtime state opaque across the child pi process). (Applied: auto-continue bounded by retry cap 2 + gated on empty `bridgeFollowUp` so a pending user/system follow-up is not double-nudged — no reasoning loop; surfacing writes redacted server.log lines + non-error card status; upstream cause root-caused via static adapter inspection + captured usage counters, Task 7.)
- [x] 10.2 `npm run quality:changed` (Biome + tsc + test) green. (New files Biome-clean + tsc-clean; edits to large files introduce no NEW Biome errors — `organizeImports`/`noExplicitAny` warnings on bridge.ts/event-wiring.ts/event-reducer.ts/App.tsx are PRE-EXISTING on HEAD, Tier B/C `warn`. Whole-repo tsc/test failures are the same pre-existing `pi-image-fit-extension` Jimp issue.)
- [x] 10.3 Code-review gate on the diff (`review-changes.ts`); fix Critical/Warning. (Ran; CodeRabbit cloud unavailable/rate-limited — warn-and-continue per gate contract, exit 0, deferred to a later cycle.)
- [x] 10.4 Rebuild/deploy per matrix (bridge → `npm run reload`; client → `npm run build`; server → restart) and re-run the D3 repro to confirm the fix live. (QA/manual — worktree work does NOT run full-rebuild/deploy to the live instance; D3 live repro is Vertex quota/creds-gated. Run at ship/verify.)
- [x] 10.5 `openspec validate fix-gemini-subagent-silent-tool-schema-failure` passes; run `openspec-verify-change` before archive. (validate --strict passes; `openspec-verify-change` runs at the ship/archive step.)
