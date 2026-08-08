## Why

pi 0.84.1 is available and the repo pins 0.83.0. The 0.84.x line carries eight upstream breaking changes plus five new features — all breaks landed in 0.84.0; 0.84.1 is a patch that adds four more surfaces and **no further breaking changes**. The dashboard cannot validate any of them today because the dependency tree is drifted: `node_modules` resolves pi **0.80.10** against a pinned `^0.83.0`.

The target is 0.84.1, not 0.84.0: the two are pin-equivalent for every break audited here, so there is no reason to land on a version that is already superseded.

The headline break — `message_update` emitting only deltas ([pi#7290](https://github.com/earendil-works/pi/issues/7290)) — **does not apply to this codebase**, and recording that with evidence is part of this change. pi has two event surfaces: the in-process `ExtensionAPI` (`dist/core/extensions/types.d.ts`) and the JSON/RPC **stdout** protocol (`dist/modes/json-event.d.ts`, `toJsonEvent()`). The delta change touches only the latter. `MessageUpdateEvent` in the in-process surface is byte-identical between 0.83.0 and 0.84.1 and still carries `message: AgentMessage`. The bridge consumes the in-process surface via `pi.on(...)` (`bridge.ts:1492`), and the RPC keeper is an outbound command channel that never reads pi's stdout as an event stream. No replay, compaction, or reducer work is required.

## What Changes

- Repair the dependency tree to a coherent pinned baseline before any 0.84.1 validation (`pnpm install`; never `npm install` — `pnpm-workspace.yaml` sets `nodeLinker: hoisted`).
- Bump the governed pi pins to 0.84.1: server `dependencies`, `piCompatibility.recommended`, `docker/Dockerfile` global install, and `scripts/verify-release-deps.mjs` `minVersion` + its evidence note.
- Keep `piCompatibility.minimum` at `0.78.0`. The `pi-core-version-check` spec states `minimum` SHALL NOT be raised merely because the pinned runtime moved, and no 0.84.1 break reaches a surface the dashboard consumes — so the broad-support floor has no reason to move.
- Correct the spec's stale floor anchor. The requirement text ties `minimum` to peer-deps in `packages/electron/resources/bundled-extensions/*/package.json` — a path that does not exist and never has; `eliminate-electron-runtime-install` (task 5.7) removed that resource directory along with the offline cache. The clause is dropped so no future reader tries to check it. See design.md D2a.
- **BREAKING (upstream): `getApiKeyAndHeaders()`** returns `ProviderHeaders` with `string | null`, preserving null header-deletion markers so placeholder credentials are not sent through Cloudflare AI Gateway. `auto-session-namer.ts:137` types headers as `Record<string, string>` and `:186` gates on `Object.keys(headers).length > 0` — a gate that stays true when every value is `null`. Both the type and the emptiness test need rework.
- **BREAKING (upstream): `ModelRegistry.refresh()`** accepts `ModelsRefreshOptions` and returns `ModelsRefreshResult` instead of discarding cancellation and provider errors. Call sites are untyped: `command-handler.ts:769` calls it inside a bare `catch {}`; `bridge.ts:769` fire-and-forgets it.
- **BREAKING (upstream): config-form OAuth `refreshToken(credentials, signal)`** must honor a concrete abort signal. `model-proxy/internal-auth-storage.ts:129`/`:137` call it with no signal.
- **BREAKING (upstream): the harness session model** is replaced by v4 lane-based `Session`/`SessionStorage`/`SessionRepo`. Audit the two consumers: `commit-draft-agent.ts:69-80` (`sdk.createAgentSession` + `sdk.SessionManager.inMemory`) and the fragile inline reference at `bridge.ts:426` into `pi-agent-core/agent.js:307-330`.
- Record `message_update` delta-only, `ModelsStreamTransforms`→`ModelsRequestTransforms`, `setRuntimeApiKey()` options, and provider `context.stored`/`context.publish()` as **audited with no dashboard consumer**, each with the evidence, so a future reader can tell "audited, not applicable" from "not checked".
- Adopt `AGENTS.override.md` per-directory context overrides (verified in `core/tools/read.ts`; shadows rather than appends) and advanced custom-model `samplingParams` (verified in `core/model-config.d.ts:34`).
- Evaluate the Baseten provider. It is present in 0.84.1 only as a `thinkingFormat` literal in `model-config.d.ts`; whether it needs dashboard provider-auth wiring is a design-time verification, not an assumed task.
- Record fullscreen TUI mode and TUI Mermaid/LaTeX rendering as **documented no-ops** — the web client already ships `chat-math-rendering` (KaTeX) and `mermaid-diagram`, following the existing `outputPad` no-op precedent in `pi-api-feature-detection`.
- Record the 0.84.1 additions, each with evidence rather than an assumed task:
  - **`terminate` on blocked `tool_call`** (`ToolCallEventResult.terminate?: boolean`, `dist/core/extensions/types.d.ts:786`) — additive, and it only fires when a handler returns `block`. The bridge subscribes to `tool_call` as a **pass-through** event (`bridge.ts:1470`) and never blocks, so there is no dashboard consumer. Record as audited-not-applicable under the D5 pattern.
  - **Qwen Token Plan Individual** (provider `qwen-token-plan-individual`, shared `QWEN_TOKEN_PLAN_API_KEY`) — a new built-in provider. The dashboard has zero `qwen` references in `packages/{server,client,shared}/src` and its `provider-auth-*` requirements are provider-generic, so this is a design-time verification alongside Baseten, not an assumed wiring task.
  - **`pi auth check`** — a new CLI provider/model credential preflight. Evaluate whether the doctor skill's pi-resolution/auth diagnostics should call it instead of inferring credential state; adopt only behind runtime feature-detection, since it does not exist on floor pi.

## Capabilities

### New Capabilities
_None. Every change lands on an existing capability._

### Modified Capabilities
- `pi-core-version-check`: the spec hard-codes `recommended SHALL be 0.83.0`; it moves to 0.84.1 while `minimum` stays 0.78.0.
- `pi-api-feature-detection`: adds the 0.84.1 adoption row (`AGENTS.override.md`, `samplingParams`) behind runtime feature-detection with explicit fallbacks, plus the TUI no-op entries alongside `outputPad` and the `tool_call` `terminate` no-consumer record.
- `bridge-auto-session-namer`: header values widen to `string | null`, nulls are forwarded rather than coerced, and the non-empty-headers gate must ignore null-only maps.
- `custom-provider-model-registry`: `refresh()` cancellation and provider errors are honored instead of discarded.
- `model-proxy-credential-routing`: OAuth token refresh propagates a concrete abort signal.
- `bridge-commit-draft`: the draft agent's session construction moves to the v4 lane-based API.
- `agent-session-context-injection`: `AGENTS.override.md` shadows directory context instead of appending to it.

## Impact

**Code** — `packages/extension/src/auto-session-namer.ts`, `command-handler.ts`, `bridge.ts`, `commit-draft-agent.ts`; `packages/server/src/model-proxy/internal-auth-storage.ts`.

**Pins (must move atomically)** — `packages/server/package.json` (dependency + `piCompatibility.recommended`), `docker/Dockerfile`, `scripts/verify-release-deps.mjs`. `verify-release-deps.mjs` fails if the dependency pin and `minVersion` diverge.

**Not affected (audited, evidence recorded)** — the streaming/replay path: `shared/src/state-replay.ts`, `server/src/session/replay-compaction.ts`, `server/src/browser-handlers/subscription-handler.ts`, and the client reducer. Node floor is unchanged (`>=22.19.0` on both versions), so `bundled-node-meets-pi-floor` and the Electron bundled-Node work are not triggered.

**Risk** — low and localized. The largest unknown is the v4 session-model audit, where `bridge.ts:426` depends on pi internals that are not exported and therefore will not fail at build time.

**Out of scope** — the `ship-browser-skill-and-electron-cdp` change owns the browser-skill work that surfaced this investigation.

## Discipline Skills

`security-hardening` (null header markers exist to stop placeholder credentials reaching Cloudflare AI Gateway; OAuth refresh gains an abort signal) · `systematic-debugging` (the v4 session-model audit touches unexported pi internals that fail at runtime, not build time) · `review-code` (cross-package diff) · `doubt-driven-review` (already applied: it overturned this change's original premise).
