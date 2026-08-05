# Humanize provider error JSON in the error banner

## Why

pi forwards some provider failures as a **raw JSON envelope** in `errorMessage`, e.g.

```
{"type":"error","error":{"details":null,"type":"overloaded_error","message":"Overloaded"},"request_id":"req_…"}
```

`extractAgentEndError` returns that string **verbatim**, so the settled error banner dumps the
whole blob instead of a readable line. Same raw string feeds the retry `reason`. There is no
parsing/humanization anywhere.

## What Changes

- Add a pure `humanizeProviderError(raw)` helper in the client event-reducer: when `raw` is a
  JSON envelope carrying `error.message`, render a compact **`error.type: error.message`** (or
  just `error.message` when no type) — e.g. `overloaded_error: Overloaded`. Any non-JSON string,
  malformed JSON, or envelope without a string `error.message` passes through **unchanged**.
- Route the three error-text sites through it: `extractAgentEndError` (the settled `lastError`)
  and the two retry `reason` assignments (`auto_retry_waiting`, `auto_retry_start`).
- Unit tests for the helper + the extractor.

### Explicitly out of scope

- Provider-layer retry observability (still unobservable; unchanged).
- Any change to when `lastError` / `retryState` are set or cleared.

## Discipline Skills

- `review-code` — small pure-function + wiring change; review the diff before commit.

## Capabilities

### Modified Capabilities

- **error-detection** — adds a humanization requirement over the extracted error string.
