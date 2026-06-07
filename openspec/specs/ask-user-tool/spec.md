# ask-user-tool Specification

## Purpose
TBD - created by archiving change ask-user-message-body. Update Purpose after archive.
## Requirements
### Requirement: ask_user tool parameters
The `ask_user` tool SHALL accept a `message` parameter (optional string) described as "Additional context or detailed question body (all methods)" that works with all methods, not just confirm.

#### Scenario: LLM provides message with input method
- **WHEN** the LLM calls `ask_user` with `{method: "input", title: "Check log", message: "Run this command:\n```\ntype log.txt\n```"}`
- **THEN** the tool SHALL pass `message` through `opts.message` to `ctx.ui.input()`

#### Scenario: LLM provides message with select method
- **WHEN** the LLM calls `ask_user` with `{method: "select", title: "Pick one", message: "Context about the choice", options: ["A", "B"]}`
- **THEN** the tool SHALL pass `message` through `opts.message` to `ctx.ui.select()`

#### Scenario: LLM provides message with multiselect method
- **WHEN** the LLM calls `ask_user` with `{method: "multiselect", title: "Pick items", message: "Select all that apply"}`
- **THEN** the tool SHALL pass `message` through `opts.message` to `ctx.ui.multiselect()`

#### Scenario: No message provided
- **WHEN** the LLM calls `ask_user` without a `message` field
- **THEN** the tool SHALL behave identically to the current implementation (backward compatible)

### Requirement: Strict parameter schema per method

The `ask_user` tool SHALL declare its parameters with a JSON Schema whose **root** is `{"type": "object"}` (preserving OpenAI strict-mode compatibility per commit `a53933f`'s rationale) AND whose **body** carries a `oneOf` discriminator over the `method` literal so each method's required fields and array `minItems` constraints are enforced at the schema level (restoring Anthropic's discriminated-union strictness that was lost when the per-method `Type.Object` arms were collapsed into a single flat object).

Concretely the parameters schema SHALL emit (after typebox compilation):

```json
{
  "type": "object",
  "properties": { "method": {...}, "title": {...}, "message": {...}, "options": {...}, "placeholder": {...}, "questions": {...} },
  "required": ["method"],
  "oneOf": [
    { "properties": { "method": { "const": "confirm" } },     "required": ["method", "title"] },
    { "properties": { "method": { "const": "select" } },      "required": ["method", "title", "options"], "properties": { "options": { "minItems": 2 } } },
    { "properties": { "method": { "const": "multiselect" } }, "required": ["method", "title", "options"], "properties": { "options": { "minItems": 1 } } },
    { "properties": { "method": { "const": "input" } },       "required": ["method", "title"] },
    { "properties": { "method": { "const": "batch" } },       "required": ["method", "questions"], "properties": { "questions": { "minItems": 1 } } }
  ]
}
```

The same `oneOf` pattern (with four arms — `confirm` / `select` / `multiselect` / `input`, no batch nesting) SHALL be applied to `SubQuestionSchema` so a batch's individual sub-questions are subjected to the same per-method strictness.

The runtime `prepareArguments` rescue layer and `execute` empty-options throws (already in place) MUST remain unchanged — they are defense in depth on top of the schema, not redundant with it. They cover (a) malformed-but-recoverable shapes the schema would reject and (b) the case where a provider's tool-call validator does not enforce body-level `oneOf` (e.g. some non-strict OpenAI Completions paths).

#### Scenario: Schema root remains type:object (OpenAI strict compat)
- **WHEN** the `ask_user` tool's `parameters` schema is JSON-serialized
- **THEN** the root object SHALL have `"type": "object"`
- **AND** the root SHALL NOT have an `anyOf` field (OpenAI strict mode rejects root-level `anyOf`)

#### Scenario: Body-level oneOf has 5 arms
- **WHEN** the schema is JSON-serialized
- **THEN** the root object SHALL have a `oneOf` array of length 5
- **AND** the arms SHALL be ordered: confirm, select, multiselect, input, batch

#### Scenario: Multiselect arm enforces options.minItems = 1
- **WHEN** an LLM emits `{method: "multiselect", title: "Pick", options: []}`
- **THEN** the schema validator SHALL reject the call (multiselect requires at least 1 option)
- **AND** the error message SHALL identify `options.minItems` as the failing constraint

#### Scenario: Multiselect arm requires options field
- **WHEN** an LLM emits `{method: "multiselect", title: "Pick"}` (no `options` field)
- **THEN** the schema validator SHALL reject the call (multiselect requires options)

#### Scenario: Select arm enforces options.minItems = 2
- **WHEN** an LLM emits `{method: "select", title: "Pick", options: ["only"]}`
- **THEN** the schema validator SHALL reject the call (select requires at least 2 options; use confirm for yes/no)

#### Scenario: Batch arm enforces questions.minItems = 1
- **WHEN** an LLM emits `{method: "batch", title: "X", questions: []}`
- **THEN** the schema validator SHALL reject the call

#### Scenario: Confirm arm accepts no options or questions
- **WHEN** an LLM emits `{method: "confirm", title: "Proceed?"}`
- **THEN** the schema validator SHALL accept the call (confirm does not require options or questions)

#### Scenario: SubQuestionSchema also has body-level oneOf
- **WHEN** a batch sub-question is `{method: "multiselect", title: "Pick", options: []}`
- **THEN** the `SubQuestionSchema`'s `oneOf` SHALL reject it on the same `options.minItems: 1` rule

#### Scenario: Anthropic regains discriminated-union behavior
- **WHEN** an Anthropic Claude model is presented with the `ask_user` tool schema
- **THEN** the model SHALL receive the per-method required and minItems constraints via the body-level `oneOf` (this is observed indirectly — by re-running an Anthropic regression suite that previously failed with the flat schema and confirming pass-rate restoration; the assertion in this requirement is that the schema *enables* the constraint propagation, not that any specific LLM behavior is guaranteed)

### Requirement: Defensive argument rescue for common LLM shape mistakes

The `ask_user` tool's `prepareArguments` SHALL repair known malformed argument shapes before validation so that equivalent-intent calls succeed instead of producing unusable dialogs.

#### Scenario: arguments wrapped in a JSON-encoded `params` string
- **WHEN** an LLM calls `ask_user` with `{method: "select", params: "{\"title\":\"Pick\",\"options\":[\"a\",\"b\"]}"}`
- **THEN** `prepareArguments` SHALL parse the `params` string and merge its fields into the top-level arguments
- **AND** the resulting call SHALL be equivalent to `{method: "select", title: "Pick", options: ["a","b"]}`

#### Scenario: arguments wrapped in an object `params` field
- **WHEN** an LLM calls `ask_user` with `{method: "select", params: {title: "Pick", options: ["a","b"]}}`
- **THEN** `prepareArguments` SHALL spread the `params` object into the top-level arguments
- **AND** the resulting call SHALL be equivalent to `{method: "select", title: "Pick", options: ["a","b"]}`

#### Scenario: `question` used instead of `title`
- **WHEN** an LLM calls `ask_user` with `{method: "input", question: "Your name?"}`
- **AND** no `title` field is present
- **THEN** `prepareArguments` SHALL copy `question` into `title`
- **AND** the resulting call SHALL be equivalent to `{method: "input", title: "Your name?"}`

#### Scenario: existing options-string rescue still works
- **WHEN** an LLM calls `ask_user` with `{method: "select", title: "Pick", options: "[\"a\",\"b\"]"}`
- **THEN** `prepareArguments` SHALL parse the `options` JSON string into an array
- **AND** the resulting call SHALL be equivalent to `{method: "select", title: "Pick", options: ["a","b"]}`

### Requirement: Runtime refusal of empty options

The `ask_user` tool's `execute` SHALL throw a descriptive error if `method` is `select` or `multiselect` and the effective `options` array is empty or not an array, so that the LLM receives clear corrective feedback instead of the user seeing an unusable dialog with only a Cancel button.

#### Scenario: select reaches execute with empty options
- **WHEN** `execute` is invoked with `{method: "select", title: "Pick", options: []}`
- **THEN** the tool SHALL throw an error whose message identifies `options` as the problem
- **AND** the error message SHALL suggest using `method: "input"` if no options are available
- **AND** no prompt SHALL be sent to the PromptBus

#### Scenario: multiselect reaches execute with missing options
- **WHEN** `execute` is invoked with `{method: "multiselect", title: "Pick"}` and `options` is undefined
- **THEN** the tool SHALL throw an error whose message identifies `options` as the problem
- **AND** no prompt SHALL be sent to the PromptBus

### Requirement: Batch question method

The `ask_user` tool SHALL accept a `batch` method that asks multiple related questions in a single tool call, returning an ordered array of answers.

A batch call has the shape:

```
{
  method: "batch",
  title: string,               // Header shown above the sequence of dialogs
  questions: Question[],       // At least 1; each is a single-question object
  message?: string             // Optional additional context for the whole batch
}
```

Where each `Question` is one of the existing non-batch shapes (`confirm`, `select`, `multiselect`, `input`) with all its normal required fields (`method`, `title`, and `options` where applicable). Sub-questions MAY include their own optional `message` field — when present it is shown on that specific sub-dialog; the outer batch `message` is shown as context on every sub-dialog.

#### Scenario: batch call with mixed question types
- **WHEN** an LLM calls `ask_user` with `{method: "batch", title: "Project setup", questions: [{method: "input", title: "Project name?"}, {method: "select", title: "Language?", options: ["TypeScript", "Python"]}, {method: "confirm", title: "Initialize git?"}]}`
- **THEN** the tool SHALL prompt the user sequentially: first input, then select, then confirm
- **AND** the tool SHALL return `{content: [...], details: {method: "batch", results: [<answer1>, <answer2>, <answer3>]}}`
- **AND** the `content` text SHALL include all three answers in order

#### Scenario: batch call with single question
- **WHEN** an LLM calls `ask_user` with `{method: "batch", title: "One thing", questions: [{method: "confirm", title: "Proceed?"}]}`
- **THEN** the tool SHALL execute the single sub-question via `ctx.ui.confirm`
- **AND** the result SHALL be a one-element array

#### Scenario: batch call with empty questions array is rejected
- **WHEN** an LLM calls `ask_user` with `{method: "batch", title: "Nothing", questions: []}`
- **THEN** the tool's parameter schema SHALL reject the call because `questions` has fewer than 1 entry

#### Scenario: batch call with invalid sub-question is rejected
- **WHEN** an LLM calls `ask_user` with `{method: "batch", title: "Bad", questions: [{method: "select", title: "Pick"}]}` (sub-question missing `options`)
- **THEN** the tool's parameter schema SHALL reject the call
- **AND** the validation error SHALL identify which sub-question failed

### Requirement: Batch cancellation semantics

If the user cancels any sub-question during a batch call, the tool SHALL stop prompting further sub-questions and return the partial results collected so far, flagged as cancelled.

#### Scenario: user cancels mid-batch
- **WHEN** a batch is executing and the user cancels the second of three sub-questions
- **THEN** the tool SHALL NOT prompt the third sub-question
- **AND** the tool SHALL return `details: {method: "batch", cancelled: true, results: [<answer1>, null]}`
- **AND** the `content` text SHALL indicate the batch was cancelled and include the partial answers

#### Scenario: user cancels first sub-question
- **WHEN** a batch is executing and the user cancels the first sub-question
- **THEN** the tool SHALL return `details: {method: "batch", cancelled: true, results: [null]}`
- **AND** no further sub-questions SHALL be prompted

### Requirement: Argument rescue for batch shapes

The `ask_user` tool's `prepareArguments` SHALL repair known malformed batch shapes before validation.

#### Scenario: `questions` array sent as a JSON string
- **WHEN** an LLM calls `ask_user` with `{questions: "[{\"method\":\"select\",\"title\":\"Pick\",\"options\":[\"a\",\"b\"]}]"}` (no top-level `method`)
- **THEN** `prepareArguments` SHALL parse the `questions` string into an array
- **AND** SHALL synthesize `method: "batch"` at the top level
- **AND** SHALL synthesize `title: <first question's title>` if none is present
- **AND** the resulting call SHALL validate against the `batch` schema branch

#### Scenario: single-question wrapped in `questions` array
- **WHEN** an LLM calls `ask_user` with `{questions: [{method: "confirm", title: "Proceed?"}]}` (no top-level `method`, array not stringified)
- **THEN** `prepareArguments` SHALL synthesize `method: "batch"` and a `title` from the first sub-question
- **AND** the resulting call SHALL validate against the `batch` schema branch

#### Scenario: legacy `{label, value}` options in a sub-question
- **WHEN** a batch sub-question has `options: [{label: "Sync now", value: "sync"}, {label: "Skip", value: "skip"}]`
- **THEN** `prepareArguments` SHALL normalize each entry to its `label` string, producing `options: ["Sync now", "Skip"]`
- **AND** the returned tool result SHALL include a warning in `details` noting that value fields were discarded

#### Scenario: `input_type` wrapper in a sub-question
- **WHEN** a batch sub-question has `{header: "...", question: "...", input_type: {method: "select", options: [...]}}`
- **THEN** `prepareArguments` SHALL flatten `input_type` fields to the top of the sub-question
- **AND** SHALL rename `header` or `question` to `title`
- **AND** the resulting sub-question SHALL match one of the single-question schema branches

#### Scenario: explicit method=batch call missing outer title
- **WHEN** an LLM calls `ask_user` with `{method: "batch", questions: [{method: "confirm", question: "Proceed?"}, ...]}` (explicit `method: "batch"` but no outer `title`)
- **THEN** `prepareArguments` SHALL backfill `title` from the first sub-question's `title`, `question`, or `header` (or `"Questions"` as a last-resort fallback)
- **AND** the resulting call SHALL validate against the `batch` schema branch

### Requirement: Schema imports use the typebox package

`packages/extension/src/ask-user-tool.ts` and its tests SHALL import the TypeBox schema factory from the `typebox` package, not from `@sinclair/typebox`.

This aligns with the pi 0.69.0+ TypeBox 1.x migration. pi-coding-agent still aliases the legacy `@sinclair/typebox` root package for backward compatibility, but the alias is documented as legacy and `@sinclair/typebox/compiler` is no longer shimmed. Migrating now removes the dashboard's last consumer of the deprecated path.

#### Scenario: Production import
- **WHEN** `packages/extension/src/ask-user-tool.ts` declares its TypeBox import
- **THEN** the import specifier SHALL be `"typebox"` (not `"@sinclair/typebox"`)
- **AND** the `Type.*` factory calls used to build the discriminated-union schema SHALL continue to compile and produce the same runtime schema shape

#### Scenario: Test mock target
- **WHEN** `packages/extension/src/__tests__/ask-user-tool.test.ts` mocks the schema factory via `vi.mock(...)`
- **THEN** the mocked module specifier SHALL be `"typebox"` (matching the production import)

#### Scenario: No /compiler subpath usage
- **WHEN** any file under `packages/extension/src/` imports from TypeBox
- **THEN** it SHALL NOT import from `"@sinclair/typebox/compiler"` or `"typebox/compiler"`
- **AND** schema validation SHALL continue to flow through pi's tool-argument validator

### Requirement: Configurable PromptBus timeout for ask_user
The bridge's PromptBus SHALL accept a `timeoutMs` option that controls how long a `request(...)` waits before auto-cancelling. The bridge extension's `session_start` handler SHALL pass `timeoutMs = config.askUserPromptTimeoutSeconds * 1000` when `askUserPromptTimeoutSeconds > 0`, and SHALL pass a value `<= 0` when `askUserPromptTimeoutSeconds <= 0` so the bus skips the cancellation timer entirely. With no timer scheduled, the request SHALL remain pending until either the user answers, the session ends, or another adapter explicitly responds.

The PromptBus implementation SHALL NOT call `setTimeout(...)` when the resolved `timeoutMs <= 0`. Equivalently, the per-request `timer` field SHALL be `null` (or otherwise non-firing) for infinite-wait requests, and any cleanup paths that `clearTimeout(...)` SHALL tolerate the null-timer case.

This applies uniformly to every PromptBus-routed prompt method (`select`, `input`, `confirm`, `multiselect`, `editor`), not just `ask_user`. The `ask_user` tool itself does not branch on the config — it simply calls the bridge-patched `ctx.ui.*` wrappers, which inherit the bus-level timeout configured at `session_start`.

#### Scenario: Default timeout fires after 300 s
- **GIVEN** `config.askUserPromptTimeoutSeconds` is 300 (default) and an `ask_user` prompt is dispatched
- **WHEN** 300 s elapse without any adapter responding
- **THEN** the PromptBus SHALL invoke its cancellation path, every adapter's `dismiss(id)` SHALL be called, and the awaiting `request(...)` promise SHALL resolve with `{ cancelled: true }`

#### Scenario: Custom positive timeout is honored
- **GIVEN** `config.askUserPromptTimeoutSeconds = 60` at session start
- **WHEN** an `ask_user` prompt is dispatched
- **THEN** the PromptBus SHALL schedule the cancellation timer for 60_000 ms (= `60 * 1000`)

#### Scenario: -1 disables the cancellation timer (infinite wait)
- **GIVEN** `config.askUserPromptTimeoutSeconds = -1`
- **WHEN** an `ask_user` prompt is dispatched
- **THEN** the PromptBus SHALL NOT call `setTimeout(...)` for cancellation
- **AND** the request SHALL remain pending indefinitely until a user response, session end, or explicit cross-adapter dismissal arrives

#### Scenario: 0 also disables the cancellation timer
- **GIVEN** `config.askUserPromptTimeoutSeconds = 0`
- **WHEN** an `ask_user` prompt is dispatched
- **THEN** the PromptBus SHALL behave identically to the `-1` case (no `setTimeout`, infinite wait)

#### Scenario: Timeout applies to all PromptBus methods, not just ask_user
- **GIVEN** `config.askUserPromptTimeoutSeconds = 60`
- **WHEN** the bridge invokes any of `ctx.ui.select`, `ctx.ui.input`, `ctx.ui.confirm`, `ctx.ui.multiselect`, or `ctx.ui.editor` (each of which is patched at `session_start` to route through PromptBus)
- **THEN** the underlying PromptBus `request(...)` SHALL inherit the same 60_000 ms timeout
- **AND** an in-flight request from any of these methods SHALL auto-cancel after 60 s with `{ cancelled: true }` if no adapter responds first

### Requirement: prepareArguments preserves empty-args rejection
The `ask_user` tool's `prepareArguments` rescue layer SHALL NOT synthesize a `method`, `title`, or `questions` field when the input is an empty object `{}`. The framework's runtime schema validator MUST continue to reject empty-args invocations so the model is forced to retry with valid arguments. The rescue layer's existing transformations (unwrap `params`, rename `question` → `title`, parse stringified `options`, synthesize `method: "batch"` from a non-empty `questions` array, normalize `[{label,value}]` → `[label]`, etc.) all require at least one input field to fire and SHALL remain no-ops on `{}`.

#### Scenario: Empty-args call stays empty
- **WHEN** `prepareArguments({})` is called
- **THEN** it SHALL return an object with no `method`, no `title`, and no `questions` properties (the only allowed extra is the non-enumerable `__normalizations` array, which MUST be empty)

#### Scenario: Schema rejection still fires for empty args
- **WHEN** the model emits a `tool_use` block for `ask_user` with `input: {}`
- **THEN** the framework's runtime schema validator SHALL reject it with `Validation failed for tool "ask_user"` listing the union arms' missing required properties (`method, title`, `method, title, options`, `method, title, questions`)

#### Scenario: Real rescue cases still apply
- **WHEN** `prepareArguments({ questions: [{ method: "confirm", title: "Proceed?" }] })` is called (no top-level `method`)
- **THEN** it SHALL return `{ method: "batch", title: "Proceed?", questions: [...] }` — the synthesis depends on a non-empty `questions` array, so this scenario is NOT regressed by the empty-args contract

### Requirement: Batch dispatched as a single UI request
The `ask_user` tool SHALL dispatch a `batch` call as a single interactive UI request carrying all sub-questions, rather than as a sequential per-question loop of individual `ctx.ui.*` calls. The tool SHALL issue one request with `method: "batch"` and a `questions[]` array, await a single response containing an index-aligned `answers[]` array, and map that result into the tool's existing text + `details` return shape. Cancellation of the batch SHALL be signalled by the single response and SHALL produce the existing "User cancelled batch …" summary.

#### Scenario: batch issues one request
- **WHEN** the LLM calls `ask_user` with `{method: "batch", questions: [q1, q2, q3]}`
- **THEN** the tool SHALL issue exactly one interactive UI request with `method: "batch"` and `questions: [q1, q2, q3]`
- **THEN** the tool SHALL NOT issue a separate per-question `ctx.ui.*` request for each sub-question

#### Scenario: answers mapped back index-aligned
- **WHEN** the batch response returns `{answers: [a1, a2, a3]}`
- **THEN** the tool's `details.results` SHALL be index-aligned with `questions[]` as `[a1, a2, a3]`
- **THEN** the tool's text summary SHALL list each question with its answer

#### Scenario: multiselect sub-question returns multiple values
- **WHEN** a batch sub-question uses method `multiselect` and the user selects two options
- **THEN** that sub-question's answer SHALL be `{values: [...]}` containing both selected values

#### Scenario: batch cancelled
- **WHEN** the batch response indicates cancellation
- **THEN** the tool SHALL return a "User cancelled batch …" summary consistent with prior behavior

#### Scenario: single-method calls unchanged
- **WHEN** the LLM calls `ask_user` with a non-batch method (`confirm`, `select`, `multiselect`, or `input`)
- **THEN** the tool SHALL dispatch it exactly as before (no `batch` method, no `questions[]` envelope)

### Requirement: method:"input" supports optional image attachments via a disk-backed side channel

The `ask_user` tool's standalone `method:"input"` branch and the `input` step of the `method:"batch"` wizard SHALL accept an optional `images?: ImageContent[]` side channel. When images are present, the tool SHALL persist each image to disk under `~/.pi/dashboard/attachments/<sessionId>/<hash>.<ext>` and include the resulting absolute paths in the tool result so the calling LLM may invoke its own `Read` tool to view them.

The two methods use different transports (since change `redesign-ask-user-question-cards`, #76):

1. **Standalone** `method:"input"` rides `PromptResponse.images`. The dashboard's `InputRenderer` SHALL be permitted to call `onRespond({ value: string, images?: ImageContent[] })` where `images` is an array of `{type: "image", data: <base64>, mimeType: <"image/jpeg" | "image/png" | "image/gif" | "image/webp">}`. The `PromptResponse` interface in `packages/extension/src/prompt-bus.ts` SHALL gain an optional `images?: ImageContent[]` field (purely additive). The matching `PromptResponseBrowserMessage` in `packages/shared/src/browser-protocol.ts` SHALL gain the same optional field.
2. **Batch** rides `ctx.ui.batch`. The `input` variant of `BatchAnswer` in `packages/shared/src/protocol.ts` SHALL gain an optional `images?: ImageContent[]` field; `BatchRenderer` includes pasted images in the per-step answer, and they ride inside the `{answers}` payload (JSON-encoded into the bus `answer` string). No per-sub-question `PromptResponse.images` channel is used.
3. The bridge SHALL patch `(ctx.ui as any).inputWithImages` (next to the existing `ctx.ui.input` patch, where `bus`/`sessionId`/`connection` are in scope). For **standalone** `method:"input"`, the `ask_user` tool SHALL dispatch through `ctx.ui.inputWithImages(...)` when present (else fall back to `ctx.ui.input(...)`, text-only). For **batch**, the tool SHALL keep its single `ctx.ui.batch(...)` dispatch; the bridge SHALL extend that patch to process `answers[].images`. Attachment persistence and `asset_register` emission live in the bridge (importing the pure `ask-user-attachments.ts` helper), not in the tool. All other methods (`confirm`, `select`, `multiselect`) SHALL continue to dispatch through `ctx.ui.*` unchanged.
4. When a resolved input answer carries no `images` (or an empty array), the tool's behavior and result shape SHALL be byte-for-byte identical to the pre-change behavior for both standalone `method:"input"` and the batch `input` step.

#### Scenario: input response with no images (backward compat)
- **WHEN** the dashboard renderer resolves `method:"input"` with `{ value: "hello world" }` (no `images`)
- **THEN** the tool SHALL return `{content: [{type: "text", text: 'User responded: "hello world"'}], details: {method: "input", result: "hello world"}}`
- **AND** no files SHALL be written to `~/.pi/dashboard/attachments/`
- **AND** no `asset_register` events SHALL be emitted

#### Scenario: input response with one image
- **WHEN** the dashboard renderer resolves `method:"input"` with `{ value: "check this", images: [{type: "image", data: "<base64 png>", mimeType: "image/png"}] }`
- **THEN** the tool SHALL write the decoded bytes to `~/.pi/dashboard/attachments/<sessionId>/<hash>.png` where `<hash> = sha256(bytes).slice(0,16)`
- **AND** the tool SHALL return `{content: [{type: "text", text: 'User responded: {"value":"check this","attachments":[{"path":"<absolute path>","mimeType":"image/png","bytes":<N>}]}'}], details: {method: "input", result: {value: "check this", attachments: [...]}}}`

#### Scenario: input response with multiple images of different types
- **WHEN** the dashboard renderer resolves with `{ value: "screenshots", images: [{type: "image", data: "<png>", mimeType: "image/png"}, {type: "image", data: "<jpg>", mimeType: "image/jpeg"}] }`
- **THEN** the tool SHALL write two files with extensions `.png` and `.jpg` respectively
- **AND** the `attachments` array in the result SHALL have two entries in the same order as the incoming `images` array

#### Scenario: input change does not affect confirm/select/multiselect
- **WHEN** the `ask_user` tool dispatches `method:"confirm"`, `method:"select"`, or `method:"multiselect"`
- **THEN** the call SHALL continue to flow through `ctx.ui.confirm` / `ctx.ui.select` / `polyfillMultiselect` exactly as before this change
- **AND** the result shape for these methods SHALL be unchanged

#### Scenario: batch sub-question with input + images
- **WHEN** a `method:"batch"` call has a sub-question `{method: "input", title: "Paste the error"}` and the user pastes an image while answering that step in the `BatchRenderer` wizard
- **THEN** the image SHALL ride in that step's `BatchAnswer.images` inside the single `{answers}` payload (no per-question bypass)
- **AND** the bridge's `ctx.ui.batch` patch SHALL persist that answer's images and rewrite its mapped result to `{value, attachments}` before returning to the tool
- **AND** the index-aligned `details.results[i]` and the numbered summary line for that sub-question SHALL carry `{value, attachments}` instead of a bare string
- **AND** other sub-questions in the same batch SHALL be unaffected

### Requirement: Pasted images are persisted under ~/.pi/dashboard/attachments/<sessionId>/

The `ask_user` attachment writer SHALL persist each `ImageContent` from a `method:"input"` response to a content-addressable file under `~/.pi/dashboard/attachments/<sessionId>/<hash>.<ext>`. Hash is `sha256(bytes).slice(0,16)` (matching `markdown-image-inliner.hashBytes`). The extension is derived from the MIME type via the allowlist: `image/png` → `.png`, `image/jpeg` → `.jpg`, `image/gif` → `.gif`, `image/webp` → `.webp`.

The writer SHALL be idempotent: if a file at the resolved path already exists, the write SHALL be skipped (content-addressable means re-writing the same bytes is a no-op anyway). The per-session directory SHALL be created (`mkdir -p` semantics) before the first write to it. Writes that fail SHALL be logged and the image silently dropped from the resulting `attachments[]` array — partial success is preferred over rejecting the entire response.

#### Scenario: Per-session directory is created lazily
- **GIVEN** `~/.pi/dashboard/attachments/<sessionId>/` does not yet exist
- **WHEN** the first image is persisted for `<sessionId>`
- **THEN** the directory SHALL be created with mkdir -p semantics
- **AND** the file SHALL land inside it

#### Scenario: Same image pasted twice dedups by hash
- **WHEN** the user pastes the same image twice across two separate `ask_user{method:"input"}` calls in the same session
- **THEN** the file at `~/.pi/dashboard/attachments/<sessionId>/<hash>.<ext>` SHALL be written once (the second call SHALL detect the existing file and skip the write)
- **AND** both tool results SHALL include the same absolute path in their `attachments[]` array

#### Scenario: Filename uses MIME-derived extension
- **WHEN** an image with `mimeType: "image/jpeg"` is persisted
- **THEN** the resulting filename SHALL end with `.jpg` (not `.jpeg`)
- **WHEN** an image with `mimeType: "image/png"` is persisted
- **THEN** the resulting filename SHALL end with `.png`

#### Scenario: Disk write failure is non-fatal
- **GIVEN** writing one of several images fails (e.g. ENOSPC, EACCES)
- **WHEN** the tool builds the result
- **THEN** the failed image SHALL be omitted from `attachments[]`
- **AND** an error SHALL be logged
- **AND** the surrounding tool call SHALL still resolve with the remaining successful attachments

### Requirement: Per-image and per-response byte caps mirror markdown-image-inliner

The attachment side channel SHALL enforce the same caps as `markdown-image-inliner`: 5 MB per image (`MAX_PER_IMAGE_BYTES`) and 20 MB cumulative per `ask_user` response (`MAX_PER_MESSAGE_BYTES`). Caps SHALL be enforced both client-side (by `useImagePaste`, which already drops oversize blobs with a transient banner) and bridge-side as a defense-in-depth check (inside the bridge's `persistAnswerImages` helper).

#### Scenario: Bridge re-validates per-image cap
- **WHEN** an image larger than 5 MB somehow reaches the bridge (e.g. client-side cap was bypassed)
- **THEN** the bridge SHALL drop that image from the `attachments[]` array
- **AND** an error SHALL be logged identifying the image's hash and size

#### Scenario: Cumulative cap caps total response bytes
- **WHEN** a single response carries images whose summed base64 size exceeds 20 MB
- **THEN** the bridge SHALL drop images in array order until cumulative bytes are within the cap
- **AND** dropped images SHALL be logged

### Requirement: Pasted images surface as thumbnails in the ask_user tool card

For each successfully persisted image, the bridge SHALL emit one `asset_register` message (per-session-deduplicated by hash) so the dashboard's `AskUserToolRenderer` card can render a thumbnail. This is independent of the disk-write path: the disk file is for the LLM's `Read`, the `asset_register` is for the user's chat-history view. Both fire on resolve.

The emission SHALL use the same `connection.send({type: "asset_register", sessionId, hash, mimeType, data})` shape established by `markdown-image-inliner` callsites in `bridge.ts`.

#### Scenario: asset_register fires once per new hash per session
- **WHEN** an image with hash `H1` is pasted in `ask_user{method:"input"}`
- **THEN** the bridge SHALL emit `asset_register {sessionId, hash: H1, mimeType, data}` exactly once for that session
- **WHEN** the same image (same hash `H1`) is pasted again later in the same session
- **THEN** the bridge SHALL NOT emit a second `asset_register` for `H1` (the dashboard already has the bytes)

#### Scenario: Multiple images emit multiple asset_register events
- **WHEN** an `ask_user{method:"input"}` response carries three distinct images
- **THEN** the bridge SHALL emit three `asset_register` events (one per unique hash) BEFORE returning the tool result

### Requirement: Tool result JSON shape evolves only when attachments are present

The `ask_user` tool's text-content result SHALL preserve its current `User responded: ${JSON.stringify(result)}` shape unchanged when no attachments are present. When attachments are present, the `result` object embedded in the JSON SHALL be `{value: string, attachments: Array<{path: string, mimeType: string, bytes: number}>}` instead of a bare string.

This rule applies to both the standalone `method:"input"` result and the per-sub-question entries in the `method:"batch"` numbered summary.

#### Scenario: Text-only input preserves bare-string result
- **WHEN** the user submits "hello" with no images
- **THEN** the tool result text SHALL be exactly `User responded: "hello"`
- **AND** the `details.result` field SHALL be the bare string `"hello"`

#### Scenario: Input with attachments emits object result
- **WHEN** the user submits "see attached" with one image
- **THEN** the tool result text SHALL be `User responded: {"value":"see attached","attachments":[{"path":"<abs>","mimeType":"image/png","bytes":<N>}]}`
- **AND** the `details.result` field SHALL be `{value: "see attached", attachments: [{path, mimeType, bytes}]}`

#### Scenario: Batch summary line uses same shape for input sub-questions
- **WHEN** a batch contains an `input` sub-question whose answer carried attachments
- **THEN** the numbered summary line for that sub-question SHALL be `${i+1}. ${title}: {"value":"...","attachments":[...]}` and `details.results[i]` SHALL be `{value, attachments}`
- **AND** other sub-question types (confirm→boolean / select→string / multiselect→string[]) in the same batch SHALL keep their existing `JSON.stringify` rendering

### Requirement: Attachment directory is cleaned up on session_end (best-effort)

When a session ends (the bridge's existing `session_end` hook fires), the attachment writer SHALL attempt to remove the session's attachment directory (`~/.pi/dashboard/attachments/<sessionId>/`) recursively. Failures SHALL be logged and swallowed. Orphans from crashed dashboards are tolerated; no separate prune CLI is part of this change.

#### Scenario: session_end deletes the per-session directory
- **GIVEN** `~/.pi/dashboard/attachments/<sid>/` contains one or more attachment files from a session
- **WHEN** the bridge's `session_end` hook fires for `<sid>`
- **THEN** the attachment cleanup SHALL be invoked
- **AND** the directory SHALL be removed recursively (`fs.rmSync(dir, { recursive: true, force: true })` semantics)

#### Scenario: session_end cleanup tolerates a missing directory
- **GIVEN** no attachments were ever written for `<sid>` (so the directory does not exist)
- **WHEN** the bridge's `session_end` hook fires
- **THEN** the cleanup SHALL be a no-op (no error thrown, no log noise)

#### Scenario: session_end cleanup tolerates errors
- **GIVEN** the per-session attachment directory cannot be removed (e.g. EACCES)
- **WHEN** cleanup is invoked
- **THEN** the failure SHALL be logged at warn-or-error level
- **AND** the session_end handler SHALL still complete normally (no exception propagates)

### Requirement: InputRenderer is multiline with image-paste support

The `InputRenderer` component at `packages/client/src/components/interactive-renderers/InputRenderer.tsx` SHALL render an autosizing `<textarea>` instead of a single-line `<input type="text">`. The textarea SHALL accept clipboard image paste via the existing `useImagePaste` hook in controlled mode and SHALL display a thumbnail preview strip (the existing `ImagePreviewStrip`) above itself. The Submit button and the `Cmd/Ctrl+Enter` keyboard shortcut SHALL invoke `onRespond({value, images})` where `images` is omitted (or empty) when no images were pasted. The bare `Enter` key SHALL insert a newline. The `Esc` key SHALL invoke `onCancel`.

The textarea SHALL NOT advertise image-paste support via a placeholder hint, helper text, or visual affordance — the paste capability is silent, matching the main composer's `CommandInput`.

The textarea + paste wiring SHALL be extracted into a shared `<InputComposer>` component consumed by both `InputRenderer` (registry `type:"input"`) and `BatchRenderer`'s `StepBody` `input` arm (registry `type:"batch"`), since #76 routes standalone-input and batch through separate renderers. Via `InputRenderer`, the upgrade SHALL apply uniformly to every callsite routing `type:"input"` through `PromptBus`: standalone `ask_user{method:"input"}`, the `polyfillMultiselect` input fallback path, and any third-party extension issuing input prompts. The batch `input` step gets the same UX via `BatchRenderer`'s `StepBody`.

#### Scenario: Enter inserts a newline, Cmd/Ctrl+Enter submits
- **GIVEN** the textarea has focus and the user has typed "line one"
- **WHEN** the user presses `Enter`
- **THEN** a newline SHALL be inserted at the cursor
- **AND** `onRespond` SHALL NOT be called
- **WHEN** the user then presses `Cmd+Enter` (or `Ctrl+Enter` on non-Mac)
- **THEN** `onRespond({value: "line one\n"})` SHALL be called

#### Scenario: Paste an image attaches it without inserting text
- **GIVEN** the textarea has focus
- **WHEN** the user pastes an image from the clipboard
- **THEN** the image SHALL be added to the controlled `pendingImages` array via `useImagePaste`
- **AND** the textarea text SHALL NOT change (no base64 data URL inserted as text)
- **AND** a thumbnail SHALL appear in the `ImagePreviewStrip` above the textarea

#### Scenario: Submit with both text and images
- **GIVEN** the textarea contains "describe this:" and one image is in the preview strip
- **WHEN** the user clicks Submit
- **THEN** `onRespond({value: "describe this:", images: [<the image>]})` SHALL be called
- **AND** the preview strip SHALL clear

#### Scenario: Cancel discards pending images
- **GIVEN** one or more images are in the preview strip
- **WHEN** the user presses `Esc` or clicks Cancel
- **THEN** `onCancel()` SHALL be called
- **AND** the pending images SHALL be discarded (not persisted, not sent)

#### Scenario: No image-paste discoverability hint
- **WHEN** the textarea is rendered in its idle (no-input) state
- **THEN** its placeholder SHALL NOT mention images, paste, attachments, or any related affordance
- **AND** no separate helper text or icon SHALL advertise paste support

