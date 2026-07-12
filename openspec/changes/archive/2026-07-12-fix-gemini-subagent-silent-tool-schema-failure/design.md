## Context

Users report Gemini (`google-vertex/gemini-2.5-pro`) "cannot be accessed / is not usable with subagents." Diagnosis (all live, this environment) shows the *access* framing is wrong and the originally-suspected *tool-schema* cause is **refuted**:

- **Vertex auth + model work.** Raw `generateContent` → HTTP 200 on `global` and `us-central1` with the SA creds (`GOOGLE_APPLICATION_CREDENTIALS`=judo-ng.json, `GOOGLE_CLOUD_PROJECT`=judo-ng, `GOOGLE_CLOUD_LOCATION`=global, `GOOGLE_GENAI_USE_VERTEXAI`=true).
- **In-memory `Agent`-tool subagents on this model work** — plain generation (`PONG`) and forced tool-calling (`Bash`) both succeed.
- **Tool-schema theory REFUTED.** pi-ai `google-shared.js#convertTools` is called with `useParameters=false` by both `google.js` and `google-vertex.js`, so pi sends `parametersJsonSchema` (full JSON Schema). A live `parametersJsonSchema` payload with `anyOf`+`const`+`format:uri` → **HTTP 200** with a clean `functionCall`. (Only the *legacy* `parameters` field 400s on those constructs, and pi does not use it for google/vertex.)
- **No model-proxy in the path.** `~/.pi/dashboard/model-proxy.jsonl` does not exist → dashboard-spawned sessions call Vertex directly, same as the passing in-memory tests.
- **Errors are structurally invisible.** The reported-failing path is dashboard **"spawn new session"** (a fresh `pi --mode rpc` process, full MCP toolset + `doubt-driven-review` skill). `~/.pi/dashboard/server.log` during such failures contains only gateway/session-lifecycle rows — **zero model-turn errors**. Any provider error raised inside the child `pi` process never reaches the dashboard card or `server.log`.

**Root cause CAPTURED (D3 done, live).** A dashboard-spawned `google-vertex/gemini-2.5-pro` session running the `doubt-driven-review` task produced an assistant turn whose transcript (`…/2026-07-12T01-56-02…_019f5409….jsonl`) is unambiguous:

- `content` = `[ thinking(1500 chars) ]` only — **zero text parts, zero tool calls**.
- `usage`: `output: 1351`, `reasoning: 1351` → **every output token was reasoning; visible-answer tokens = 0**.
- `stopReason: "stop"` (a clean completion, **not** `length`/`MAX_TOKENS`), `error: {}` (none), `thoughtSignature`: not retained.
- The thinking text shows the model **mid-plan** ("I'm applying the doubt-driven-review skill … keeping the output conci[se]") — it intended to answer, then the turn ended with no text.

So the true failure is a **thinking-only / no-actionable-output completion**: Gemini emits reasoning then `stop` with no text and no tool call, and pi/dashboard treats that as a finished turn → the session **idles silently**. The in-memory `Agent` probes passed only because their tiny prompts forced a text/tool output; the failing path carried **27,475 input tokens** (full toolset + skill + inherited context) on the first agentic turn.

Net: two defects — **(primary)** pi/dashboard does not handle thinking-only/empty-actionable completions (silent idle instead of continue-or-surface), and **(secondary)** even genuine model-turn errors from spawned sessions are not surfaced. Both were originally invisible because the child-process turn outcome never reached the card/log.

## Goals / Non-Goals

**Goals:**
- **(Primary)** Never let a thinking-only / empty-actionable assistant turn silently idle a session: continue-or-surface (D4).
- Make spawned-session model-turn / provider *errors* visible on the dashboard card + `server.log` (D2) — complementary; covers the genuine-error case (distinct from the captured empty-turn case, which has no error).
- Keep the change provider-agnostic where the empty-turn guard applies to any `reasoning:true` model.

**Non-Goals:**
- A Google/Vertex tool-schema **sanitizer** — refuted as unnecessary for the pi path (`parametersJsonSchema` accepts the constructs). Explicitly dropped unless the capture proves a *different* schema issue.
- Changing Vertex auth, credentials, endpoint, or `GOOGLE_CLOUD_LOCATION` handling — all confirmed working.
- Any change to the in-memory `Agent`-tool subagent path — confirmed working.

## Decisions

### D1 — Reframe: the primary defect is empty-actionable-turn handling, not schema sanitization
The D3 capture shows the failing turn is a clean-but-empty `stop` (thinking-only). The primary fix is the continue-or-surface guard (D4); error-surfacing (D2) is complementary. Rationale: both are reproducible and ownable by this repo (dashboard/bridge turn-outcome path). Alternative considered — ship the schema sanitizer from the original proposal — rejected: the live `parametersJsonSchema` 200 refutes its premise for the pi path.

### D2 — Surface errors at the child→dashboard boundary
Forward a structured error event when a spawned session's model turn fails (provider non-2xx, empty/blocked completion, or thrown adapter error) to: (a) the session card (visible status + message), and (b) `server.log`. Rationale: `server.log` currently proves these are dropped. Alternative — rely on the child session's own jsonl transcript — rejected as insufficient: the operator watches the dashboard, not per-session files, and the current UX shows nothing.

### D3 — Root-cause capture (DONE — see Context)
Captured live: the failing turn is **thinking-only** (`stopReason=stop`, 1351 reasoning tokens, 0 text, no tool call). This resolves the primary-cause open question and supersedes the earlier `thoughtSignature` hypothesis (D4, below).

### D4 — Primary fix: guard thinking-only / empty-actionable completions
When an assistant turn completes with `stopReason=stop` (or equivalent) but has **no visible text and no tool call** (content is thinking-only / empty), pi/dashboard MUST NOT silently idle. Options, in preference order: (a) **auto-continue** — issue a minimal continuation nudge so the model emits its answer/action (matches that the model was mid-plan); (b) if continuation is out of scope for this repo, **surface** a clear "model returned only reasoning, no answer" state on the card + `server.log`. Rationale: the model intended to answer; a silent idle is never the right terminal state for an empty-actionable turn. Alternative — rely on error-surfacing (D2) — insufficient here because there is **no error** to surface; the turn is a clean-but-empty `stop`. Ownership check: whether the empty-text turn originates in pi-ai's Google adapter (dropping the text part that followed the thinking) or in the Gemini API response itself is an open question (below); the continue-or-surface guard is ownable by this repo regardless.

### D5 — (superseded) `thoughtSignature` multi-turn hypothesis
Previously the leading hypothesis; the D3 capture shows the failure occurs on the **first** turn as a thinking-only stop, so multi-turn `thoughtSignature` echoing is not the direct cause. Retained only as a note; the captured turn did not retain a `thoughtSignature`, which may or may not relate to the empty text — track under Open Questions, do not gate the fix on it.

## Risks / Trade-offs

- **[Primary cause may live upstream in pi-ai, not this repo]** → D2 (surfacing) is still fully ownable and valuable independently; if the root cause is a pi-ai `thoughtSignature`/streaming bug, this change delivers surfacing + a guard + a precise upstream issue with the captured payload.
- **[Error-surfacing could leak sensitive request content to the card/log]** → surface status + provider error message + model/turn ids only; do not dump full request bodies or credentials.
- **[Reframing may make the change name misleading]** (`fix-gemini-subagent-silent-tool-schema-failure`) → note the refutation prominently; optionally rename the change dir to `fix-gemini-spawned-session-silent-failure` before specs.
- **[Repro is environment/quota dependent]** → capture uses the same working SA creds already verified; low risk.

## Migration Plan

1. Land D4 (empty-actionable-turn guard: continue-or-surface) — the primary, provider-agnostic fix.
2. Land D2 (error-surfacing) — complementary, additive, covers the genuine-error case.
3. Investigate the upstream open question (adapter drops text part vs. Gemini returns thinking-only `STOP`); file upstream to `@earendil-works/pi-ai` if the deeper cause is there.
4. Regression coverage: a simulated thinking-only `stop` turn triggers continue-or-surface (not silent idle); a simulated child error reaches card + `server.log`.
5. Rollback: guard and surfacing are additive and independently revertible.

## Open Questions

- **RESOLVED:** the child-session outcome is a thinking-only `stop` (no text, no tool call), not an error. (D3 capture.)
- Does the empty-text turn originate in pi-ai's Google adapter **dropping/losing the text part** that should follow the thinking block, or does the **Gemini API itself** return a candidate with only a thinking part + `STOP`? Distinguish with a raw `generateContent` (streaming + non-streaming) that elicits reasoning, and by inspecting the adapter's part-assembly for google/google-vertex. Determines whether the deeper fix is upstream; the continue-or-surface guard (D4) is ownable here either way.
- For the guard, is **auto-continue** acceptable in the spawned/subagent loop, or must it be **surface-only**? (Affects UX + cost; auto-continue risks a reasoning loop if the model repeatedly emits thinking-only turns — cap retries.)
- Should the change be **renamed** now that "tool-schema" is refuted (recommend `fix-gemini-spawned-session-silent-empty-turn`), before specs?
- Does the same silent thinking-only idle affect **other mandatory-thinking models** (other Gemini 2.5/3 variants, or any `reasoning:true` model that can emit reasoning-then-stop) or is it `gemini-2.5-pro`-specific? The guard should be provider-agnostic if so.
