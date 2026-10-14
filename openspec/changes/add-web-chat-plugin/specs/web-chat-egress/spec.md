## ADDED Requirements

### Requirement: Only assistant text and status reach the customer

The conversation stream (`GET stream?cid=<conversationId>`, served through the host's event-stream helper) SHALL emit only: `message` frames carrying assistant text (incremental deltas and the final text of a turn), `status` frames (`thinking`, `ready`, `ended`, `escalated`), and `error` frames carrying a generic code. Tool calls, tool results, thinking, user/system prompts, session ids, model names, token metrics and any other event SHALL NOT be emitted. Assistant text SHALL pass a post-filter that replaces absolute filesystem paths and strings matching the operator-configured secret patterns with `[redacted]`, applied with a hold-back window of at least 256 characters so a match spanning two streamed deltas is still redacted.

#### Scenario: Tool activity is invisible
- **WHEN** a turn calls `kb_search` and then answers
- **THEN** the stream SHALL carry `status: thinking`, the assistant `message` frames and `status: ready`, and nothing naming `kb_search` or its result

#### Scenario: Path in assistant text is redacted
- **WHEN** the assistant text contains `/Users/robson/x` or `C:\Users\x`
- **THEN** the emitted frame SHALL contain `[redacted]` in its place
