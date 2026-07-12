## Why

Selecting a Gemini model (e.g. `google-vertex/gemini-2.5-pro`) for a **dashboard "spawn new session"** with the full toolset produces a silent failure: the session starts, the model never responds, and no error surfaces. Users read this as "Gemini is not usable / cannot be accessed with subagents." It is neither an access nor an auth problem — Vertex auth and the model both work. **Captured root cause (live):** on the first agentic turn Gemini 2.5 Pro returns a **thinking-only completion** — all output tokens are reasoning, **zero visible text, no tool call, `stopReason=stop`** — and pi/dashboard treats that clean-but-empty turn as finished, so the session **idles silently with no answer and no error**. (An initial tool-schema hypothesis was investigated and **refuted** — see evidence.)

### Evidence (all live, this environment)

| Probe | Result |
|---|---|
| Raw Vertex `generateContent`, `gemini-2.5-pro`, `global` + `us-central1`, SA creds | **HTTP 200**, valid reply — auth/endpoint fine |
| In-memory `Agent` tool on `google-vertex/gemini-2.5-pro`, no tools ("say PONG") | **✅ PONG** |
| In-memory `Agent` tool, forced `Bash` call | **✅** tool call + result |
| Vertex + **legacy `parameters`** field with `anyOf`/`const`/`format:uri` | HTTP 400 `INVALID_ARGUMENT` — *but pi does NOT use this field for google/vertex* |
| Vertex + **`parametersJsonSchema`** (the field pi actually sends) with `anyOf`/`const`/`format:uri` | **HTTP 200**, clean `functionCall` → **tool-schema theory REFUTED** |
| `~/.pi/dashboard/model-proxy.jsonl` | Does not exist → spawned sessions call Vertex **directly**, not via proxy |
| `~/.pi/dashboard/server.log` during spawned-session failures | Only gateway/session lifecycle rows — **zero model-turn outcomes** |
| **D3 live capture** — dashboard-spawned Gemini session, `doubt-driven-review` task, transcript jsonl | assistant turn `content=[thinking(1500c)]`, `usage.output=1351` all `reasoning`, **0 text, no tool call**, `stopReason=stop`, `error={}` → **thinking-only silent idle** |

pi-ai `google-shared.js#convertTools` is called with `useParameters=false` by both `google.js` and `google-vertex.js`, so tool schemas ship as `parametersJsonSchema` (full JSON Schema) — which Gemini accepts (200 above); the tool-schema theory is refuted. The captured failing path is dashboard "spawn new session" (fresh `pi --mode rpc`, full MCP toolset + `doubt-driven-review` skill, **27,475 input tokens** on turn 1): the model emitted reasoning then `stop` with no text/tool call, and pi/dashboard idled the turn. Nothing errored, so nothing was reported. Open upstream question: whether pi-ai's Google adapter dropped a text part or Gemini itself returned thinking-only `STOP` (see design.md).

## What Changes

- **(Primary)** Add an **empty-actionable-turn guard**: when an assistant turn completes with `stopReason=stop` (or equivalent) but has **no visible text and no tool call** (thinking-only / empty content), pi/dashboard MUST NOT silently idle — either **auto-continue** (nudge the model to emit its answer/action, capped retries) or **surface** a clear "model returned only reasoning, no answer" state on the card + `server.log`. Provider-agnostic (applies to any `reasoning:true` model). This is the captured, confirmed defect.
- **(Complementary)** Add **spawned-session model-turn error surfacing**: when a child `pi` session's model call *errors* (provider non-2xx / thrown adapter error), forward a structured error to the card + `server.log`. Covers the genuine-error case (the captured case had no error).
- **(Investigate, possibly upstream)** Determine whether the empty-text turn is pi-ai's Google adapter dropping the text part vs. Gemini returning thinking-only `STOP`; file upstream to `@earendil-works/pi-ai` if the deeper fix is there.
- **REMOVED from scope:** a Google/Vertex tool-schema sanitizer — refuted (`parametersJsonSchema` accepts `anyOf`/`const`/`format`).
- Regression coverage: a simulated thinking-only `stop` turn triggers continue-or-surface (not silent idle); a simulated child error reaches card + `server.log`.

## Capabilities

### New Capabilities
- `empty-actionable-turn-guard`: when an assistant turn ends with no visible text and no tool call (thinking-only / empty, `stopReason=stop`), continue-or-surface instead of silently idling. Provider-agnostic. (Primary — captured defect.)
- `spawned-session-error-surfacing`: forward model-turn/provider *errors* from a spawned child `pi` session to the dashboard card + `server.log`. (Complementary.)

### Modified Capabilities
<!-- Likely none local. The upstream investigation (adapter part-assembly vs Gemini
     thinking-only STOP) may produce a pi-ai issue rather than a local spec change. The
     refuted `gemini-tool-schema-sanitization` capability is intentionally dropped. -->

## Impact

- **Code**: dashboard session/bridge event path that renders spawned-session turns + writes `server.log` (the surfacing target); the child `pi --mode rpc` spawn path where model-turn errors currently die.
- **Upstream dependency risk**: the *deeper* cause of the empty text may live in `@earendil-works/pi-ai` (google-shared turn/part assembly — whether a text part is dropped after the thinking block, or Gemini returns thinking-only `STOP`). Even if so, the primary empty-actionable-turn guard is ownable here. Confirmed: pi-ai sends `parametersJsonSchema` (google.js / google-vertex.js call `convertTools` with `useParameters=false`), so no schema fix is needed there.
- **No breaking changes**: surfacing only adds error output; non-Gemini providers unaffected.
- **Auth/creds**: unchanged — Vertex ADC via `GOOGLE_APPLICATION_CREDENTIALS` + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION=global` is confirmed working.

## Discipline Skills

- `systematic-debugging` — root-cause the sanitizer/surfacing across the child-process boundary; the failure is opaque (runtime state hidden in the spawned session).
- `observability-instrumentation` — the surfacing work is literally making a currently-invisible runtime error visible on the card + log.
- `doubt-driven-review` — before committing to sanitizer scope, verify whether the `function_declarations` transform belongs here or upstream in pi-ai (irreversible-ish design fork).
