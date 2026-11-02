## ADDED Requirements

### Requirement: Dialog prompts honour a per-call timeout

The bridge's patched dialog methods (`select`, `input`, `inputWithImages`, `confirm`, `editor`, `multiselect`, `batch`) SHALL honour `opts.timeout` when it is a positive finite number. When it is shorter than the session's prompt timeout (an infinite session timeout counts as longer), the prompt SHALL be cancelled through the PromptBus cancel path when it elapses. The call SHALL resolve as cancelled: `confirm` to `false`, the others to `undefined`.

#### Scenario: Per-call timeout shorter than the session timeout
- **WHEN** the session prompt timeout is 300 s and a tool calls `ctx.ui.confirm("Send?", "body", {timeout: 1000})`
- **THEN** after 1 s with no answer the bridge SHALL send `prompt_cancel` for that prompt, and the call SHALL resolve `false`

#### Scenario: Infinite session timeout still honours the call
- **WHEN** `askUserPromptTimeoutSeconds` is `-1` and a tool calls `ctx.ui.select("Pick", ["a"], {timeout: 1000})`
- **THEN** the prompt SHALL be cancelled after 1 s and the call SHALL resolve `undefined`

#### Scenario: Invalid timeout is ignored
- **WHEN** a tool passes `{timeout: "soon"}`
- **THEN** the prompt SHALL use only the session timeout

### Requirement: Dialog prompts honour an abort signal

The patched dialog methods SHALL honour `opts.signal` when it is an object with an `aborted` flag and `addEventListener`. A signal that aborts while the prompt is pending SHALL cancel the prompt through the PromptBus cancel path, so every adapter and every dashboard browser removes it. The bridge SHALL remove its abort listener and per-call timer when the prompt settles. A prompt without these options SHALL behave as before.

#### Scenario: Abort removes the dashboard card
- **WHEN** a tool calls `ctx.ui.confirm("Send?", "body", {signal})` and aborts `signal` before anyone answers
- **THEN** the bridge SHALL send `prompt_cancel` for that prompt id, the dashboard SHALL dismiss the card, and the call SHALL resolve `false`

#### Scenario: Answer first, abort later
- **WHEN** the user answers a prompt raised with `{timeout: 60000, signal}` and the signal aborts afterwards
- **THEN** the answer SHALL be returned and no `prompt_cancel` SHALL be sent

#### Scenario: Non-signal value is ignored
- **WHEN** a tool passes `{signal: {}}`
- **THEN** the prompt SHALL behave as if no signal was given

### Requirement: An already-aborted signal dispatches nothing

When a patched dialog method receives a valid signal that is already aborted, the call SHALL resolve as cancelled without dispatching the prompt: no adapter's `onRequest` SHALL run and no `prompt_request` frame SHALL be sent.

#### Scenario: Already-aborted signal
- **WHEN** a tool passes a signal that is already aborted
- **THEN** the call SHALL resolve as cancelled, no prompt SHALL remain pending, no adapter's `onRequest` SHALL have run, and no `prompt_request` frame SHALL have been sent

### Requirement: Patched dialogs expose the session prompt timeout

When the bridge patches `ctx.ui` at `session_start`, it SHALL also set a read-only number `ctx.ui.promptTimeoutMs` equal to the PromptBus timeout it resolved for that session (`effectiveSeconds * 1000`, or a value `<= 0` for an infinite wait). It is informational: a caller uses it to tell a bus timeout from a decline, because a patched `confirm` returns `false` for both.

#### Scenario: Session timeout is readable
- **WHEN** a session starts with `askUserPromptTimeoutSeconds = 60` and no override
- **THEN** `ctx.ui.promptTimeoutMs` SHALL be `60000`

#### Scenario: Infinite wait
- **WHEN** a session starts with `askUserPromptTimeoutSeconds = -1`
- **THEN** `ctx.ui.promptTimeoutMs` SHALL be `<= 0`
