## Why

An automation run's `result.md` is supposed to hold the run session's **findings** — the assistant's output. The `automation-folder-format` "Run/triage store" requirement is built on this: "A run that produces no findings SHALL be auto-archived." Empirically it captures the wrong text.

Verified live (2026-06-23) against the running dashboard, after the run-correlation fix landed (commit 5009b883):

- Created a folder automation whose `prompt.md` was `Reply with exactly the single word PONG and nothing else. Do not use any tools.`
- Cron fired, the run spawned, completed `done` in ~10s.
- `GET /api/plugins/automation/result` returned **the prompt text verbatim**, not the model's reply.
- The run session (`019ef1f5-8850-7609-ad1d-6b1cca4b1a6c`) **did** produce the reply — its transcript holds an assistant message `content: [{ type: "text", text: "PONG" }]`. So the model answered correctly; capture grabbed the wrong message. (`PONG` is absent from `server.log` only because that log omits message content.)

The two persisted message records show the relevant shapes:

```jsonc
{ "type": "message", "message": { "role": "user",
    "content": [{ "type": "text", "text": "...the injected prompt..." }] } }
{ "type": "message", "message": { "role": "assistant",
    "content": [{ "type": "text", "text": "PONG" }] } }
```

Root cause is in the capture path, `packages/automation-plugin/src/server/index.ts`:

```ts
function extractAssistantText(event) {
  ...
  const role = d.role ?? d.message?.role;
  if (role && role !== "assistant") return null;   // only rejects EXPLICIT non-assistant
  const candidate =
    (typeof d.text === "string" && d.text) ||
    (typeof d.content === "string" && d.content) ||
    (typeof d.message?.content === "string" && d.message.content) || null;
  ...
}
```

Two defects compound:

1. **Array content is dropped.** Real message `content` is an array of blocks (`[{type:"text",text}]`), but the extractor only accepts a *string* `content`/`text`. The assistant reply (`content: [{text:"PONG"}]`) therefore yields `null` and is never captured.
2. **The injected prompt leaks in.** The prompt the plugin delivers via `ctx.sendToSession(sessionId, pendingRun.promptText)` reaches the buffer through a differently-shaped forwarded event (string text, no explicit `assistant` role — the role guard rejects only *explicit* non-assistant roles), so `runText` collects the prompt and `agent_end` flushes it to `result.md`.

Net effect: `result.md` holds the instruction, the real answer is discarded. The exact wire shapes of the forwarded events (vs the persisted JSONL above) must be confirmed against a live run before pinning the extractor (see tasks 1.1).

Consequence: every automation `result.md` is misleading — it echoes the instruction instead of the result. Triage is useless, and the "no findings → auto-archive" rule never triggers correctly because a run "with findings" (the echoed prompt) is never empty.

## What Changes

- **MODIFIED**: run result capture in `packages/automation-plugin/src/server/index.ts` captures only genuine assistant output and never the injected action prompt.
  - Capture is anchored to the pi event(s) that actually carry assistant message text (verified against live event shapes), not "any event with a truthy `text`/`content`".
  - Extraction handles the real **array-of-blocks** content shape (`content: [{type:"text", text}]`), concatenating text blocks — not only string `content`/`text`.
  - The role guard requires an explicit `role === "assistant"` (a role-less text event is no longer treated as assistant output).
  - The injected action prompt delivered via `sendToSession` is excluded from `result.md` by construction.
- **UNCHANGED**: run lifecycle, correlation (runId-stamp binding from commit 5009b883), retention, auto-archive-on-empty, and the `result.md` on-disk location/format. This change only corrects WHAT text is captured.

## Capabilities

### Modified Capabilities

- `automation-run-lifecycle`: adds an explicit requirement that a run's captured result is the assistant's output and excludes the injected action prompt.

## Impact

- `packages/automation-plugin/src/server/index.ts` — `extractAssistantText` + the `runText` buffering/flush path tightened to assistant-only output; injected prompt excluded.
- Tests: a server-entry / capture unit test that feeds a realistic event sequence (injected prompt echo + assistant reply + `agent_end`) and asserts `result.md` contains the reply and NOT the prompt; an empty-reply case still auto-archives.
- No protocol, no client, no spec-breaking changes. Existing automation-plugin tests (84) remain green.
