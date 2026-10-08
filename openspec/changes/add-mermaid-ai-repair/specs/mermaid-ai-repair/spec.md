## Purpose

On-demand, model-assisted repair of Mermaid diagrams that rule-based repair cannot fix, invoked explicitly by the user and accepted only when the returned source actually renders.

## ADDED Requirements

### Requirement: AI repair is explicit and gated
The mermaid error display SHALL offer a "Fix with AI" action only when rule-based repair did not produce a renderable diagram and `mermaidRepair.enabled` (as served by `GET /api/config`) is true. AI repair SHALL never run without the user activating the action. The action SHALL be keyboard-operable, have an accessible name, and state that the diagram source is sent to the configured model provider.

#### Scenario: Action hidden when disabled
- **WHEN** AI repair is not enabled in configuration and a diagram fails to render
- **THEN** no "Fix with AI" action is shown

#### Scenario: Action shown after rule repair fails
- **WHEN** AI repair is enabled and a diagram fails to render after rule-based repair
- **THEN** the error display offers "Fix with AI" with a provider-disclosure hint

#### Scenario: Action not shown when rule repair succeeded
- **WHEN** AI repair is enabled and rule-based repair produced a renderable diagram
- **THEN** no "Fix with AI" action is shown

#### Scenario: No automatic call
- **WHEN** a failing diagram is displayed and the user does not activate the action
- **THEN** no repair request is sent

### Requirement: Repair endpoint contract
The server SHALL expose `POST /api/mermaid/repair`, protected by the network guard, accepting `{ code, error }` and returning `{ success: true, data: { code, model } }` where `code` is the corrected mermaid source and `model` is the configured model reference. Failures SHALL use the envelope `{ success: false, error, code }` with `error` human-readable and `code` one of: `disabled` (404) when AI repair is not enabled; `bad_request` (400) when `code` is not a non-empty string or `error` is not a string; `too_large` (413) when `code` exceeds the configured maximum length or `error` exceeds 2000 characters; `busy` (429) when another repair request is in flight on the server; `timeout` (504) when the model exceeds the configured timeout; `provider_error` (502) when the provider fails or the configured model is not found; `unparseable` (502) when no non-empty diagram within the configured maximum length can be extracted from the model output. Validation failures (`disabled`, `bad_request`, `too_large`, `busy`) SHALL NOT call the model. The model call SHALL use temperature 0 and a maximum output of `min(ceil(maxChars / 3), 8192)` tokens. The model output SHALL be the concatenation of the assistant text deltas of the stream; non-text events (e.g. tool calls, thinking) SHALL be ignored. When the client disconnects, the server SHALL abort the model call, release the in-flight slot, send no response and log outcome `aborted`; `timeout` applies only when the timeout elapsed without a disconnect. The server SHALL NOT truncate model output. Model credentials SHALL never be included in any response.

#### Scenario: Successful repair from fenced block
- **WHEN** an enabled endpoint receives a failing diagram and the model returns prose plus a fenced mermaid block
- **THEN** the response contains only the fenced block's diagram source and the model reference used

#### Scenario: Non-text stream events ignored
- **WHEN** the model stream contains thinking or tool-call events alongside text deltas
- **THEN** only the concatenated text deltas are used for extraction

#### Scenario: Successful repair from bare text
- **WHEN** the model returns unfenced diagram text
- **THEN** the response contains the trimmed text with any leading `mermaid` line removed

#### Scenario: Oversized input rejected
- **WHEN** the submitted source exceeds the configured maximum length, or the error text exceeds 2000 characters
- **THEN** the response status is 413 with code `too_large` and no model call is made

#### Scenario: Malformed request
- **WHEN** the request body lacks a non-empty `code` string or a string `error`
- **THEN** the response status is 400 with code `bad_request` and no model call is made

#### Scenario: Disabled
- **WHEN** AI repair is not enabled
- **THEN** the response status is 404 with code `disabled` and no model call is made

#### Scenario: Concurrent request rejected
- **WHEN** a repair request arrives while another is in flight
- **THEN** the response status is 429 with code `busy` and no second model call is made

#### Scenario: Output budget bounded
- **WHEN** `maxChars` is 50000 and a repair request is made
- **THEN** the model call is made with temperature 0 and a maximum output of 8192 tokens

#### Scenario: Client disconnect aborts the model call
- **WHEN** the client disconnects while a repair request is in flight
- **THEN** the model call is aborted, and a following repair request is accepted rather than rejected as `busy`

#### Scenario: Timeout
- **WHEN** the model does not complete within the configured timeout
- **THEN** the request is aborted and the response status is 504 with code `timeout`

#### Scenario: Provider failure or unknown model
- **WHEN** the provider call throws for a reason other than the timeout, or the configured model is not in the model registry
- **THEN** the response status is 502 with code `provider_error`

#### Scenario: Model output without a usable diagram
- **WHEN** the extracted output is empty or longer than the configured maximum length
- **THEN** the response status is 502 with code `unparseable` and no partial diagram is returned

#### Scenario: Unauthenticated remote caller
- **WHEN** a request fails the network guard
- **THEN** it is rejected by the guard and no model call is made

### Requirement: AI result accepted only if it renders
The client SHALL render the returned source through the same render and sanitization path used for every mermaid diagram. A result that renders SHALL be displayed with an "AI-fixed" indication naming the model, distinct from the rule-repair indication, plus a show-original control and a copy-fixed control with the same keyboard, assistive-technology, hidden-viewport and zoom-restore behaviour as the rule-repair indication. The AI-fixed state SHALL be discarded when the original source or the configured model changes, and an open original view SHALL close when the rendered outcome changes (source or theme). A result that fails to render SHALL NOT be displayed; the original error SHALL remain and an "AI fix failed" message SHALL be shown with the option to retry. An endpoint error SHALL be shown the same way with its human-readable reason.

#### Scenario: Renderable AI result
- **WHEN** the returned source renders successfully
- **THEN** the diagram is displayed with an "AI-fixed" indication naming the model, a show-original control and a copy-fixed control

#### Scenario: Non-renderable AI result
- **WHEN** the returned source fails to render
- **THEN** the original error display remains with an "AI fix failed" message and a retry option

#### Scenario: Endpoint error
- **WHEN** the repair request fails with an error response
- **THEN** the original error display remains with an "AI fix failed" message carrying the reason and a retry option

#### Scenario: Request in flight
- **WHEN** the user activates "Fix with AI"
- **THEN** the action shows a pending state and cannot be activated again until the request completes

#### Scenario: Source change discards AI result
- **WHEN** a diagram is AI-fixed and its original source changes to a different failing diagram
- **THEN** the AI-fixed indication is removed and the error display with "Fix with AI" is shown for the new source

#### Scenario: Theme change keeps AI result
- **WHEN** a diagram is AI-fixed and the theme changes
- **THEN** the AI-fixed diagram is re-rendered in the new theme without a new repair request

#### Scenario: Unmount aborts
- **WHEN** the diagram unmounts while a repair request is pending
- **THEN** the request is aborted and no result is applied

#### Scenario: Localized strings
- **WHEN** the UI language is Hungarian
- **THEN** the action, pending, AI-fixed and failure texts are shown in Hungarian

### Requirement: AI repair results are not re-requested
Within a page lifetime, a successful AI repair for the same original source and model SHALL be reused on remount without a new request. Failed attempts SHALL NOT be cached.

#### Scenario: Remount reuses result
- **WHEN** an AI-fixed diagram unmounts and remounts with the same source
- **THEN** the AI-fixed diagram is shown without a new repair request

### Requirement: Repair requests are observable without leaking content
Each repair request SHALL produce one log line with its outcome (`ok`, `aborted` or the error code), model reference, latency and input size. Diagram source, error text and model output SHALL NOT be logged.

#### Scenario: Log line on timeout
- **WHEN** a repair request times out
- **THEN** a log line records outcome `timeout`, the model and the latency, and contains no diagram text

#### Scenario: Log line on success
- **WHEN** a repair request succeeds
- **THEN** a log line records outcome `ok`, the model, the latency and the input size, and contains neither the submitted source nor the model output
