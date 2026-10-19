## ADDED Requirements

### Requirement: ask_user opts its choices into inline Other
The `ask_user` tool SHALL accept an optional boolean `allowOther` parameter, at the top level and on each batch sub-question. Its description SHALL say that, in the dashboard, the user may type a custom answer beside the options, that the default is `true`, that it should be set to `false` only when the answer must be exactly one of the options, and that the terminal UI shows the options only. It SHALL apply to `select` and `multiselect` and SHALL be ignored for other methods.

Effective value for a single question: `allowOther ?? true`. Effective value for a batch sub-question: `sub.allowOther ?? allowOther ?? true`, so an explicit sub-question value wins over the top-level one. When the effective value is `true`, the tool SHALL pass `allowOther: true` to `ctx.ui.select` / `ctx.ui.multiselect`, or set `allowOther: true` on the dispatched batch sub-question. When it is `false`, the tool SHALL pass nothing.

Argument rescue SHALL coerce the strings `"true"`/`"false"` in `allowOther` (and `allowCustom`) to booleans and SHALL drop any other non-boolean value, which then counts as absent. It SHALL map a boolean `allowCustom` (the pi-flows parameter name) to `allowOther` when `allowOther` is absent, at the top level and per sub-question, and SHALL then delete `allowCustom`. `allowCustom: true` SHALL NOT append any literal option to `options`. Unlike pi-flows, an absent value means enabled.

#### Scenario: Default opts in
- **WHEN** the LLM calls `ask_user` with `{ method: "select", title: "Pick", options: ["A", "B"] }`
- **THEN** `ctx.ui.select` SHALL receive `allowOther: true`

#### Scenario: Opt-out on a single select
- **WHEN** the LLM calls `ask_user` with `{ method: "select", title: "Pick", options: ["A", "B"], allowOther: false }`
- **THEN** `ctx.ui.select` SHALL NOT receive `allowOther: true`

#### Scenario: Opt-out on one batch sub-question
- **WHEN** a batch call has two select sub-questions and only the second sets `allowOther: false`
- **THEN** the first dispatched sub-question SHALL carry `allowOther: true` and the second SHALL NOT

#### Scenario: Top-level opt-out fans out to batch sub-questions
- **WHEN** a batch call sets top-level `allowOther: false` and has a select sub-question without `allowOther` plus a multiselect sub-question with `allowOther: true`
- **THEN** the select sub-question SHALL be dispatched without `allowOther: true`
- **AND** the multiselect sub-question SHALL be dispatched with `allowOther: true`

#### Scenario: Non-choice sub-questions untouched
- **WHEN** a batch contains `confirm` and `input` sub-questions
- **THEN** those sub-questions SHALL be dispatched without `allowOther`

#### Scenario: allowCustom alias is rescued and removed
- **WHEN** the LLM sends `{ method: "select", title: "Pick", options: ["A", "B"], allowCustom: false }`
- **THEN** the tool SHALL behave as if `allowOther: false` were sent
- **AND** the normalized arguments SHALL NOT contain `allowCustom`, and `options` SHALL stay `["A", "B"]`

#### Scenario: Stringified boolean is coerced
- **WHEN** the LLM sends `{ method: "select", title: "Pick", options: ["A", "B"], allowOther: "false" }`
- **THEN** the tool SHALL behave as if `allowOther: false` were sent

### Requirement: ask_user result flags custom answers for the model
The tool result returned to the model SHALL say which answers are custom (not one of the offered options). The `details` shape SHALL stay unchanged: `details.result` and `details.results[i]` keep the raw string or array. The final line of a single-question result SHALL always be `User responded: ${JSON.stringify(result)}`. Any custom-answer note SHALL come on a line before it. User text SHALL appear only JSON-encoded.

- `select`, answer is a string not among the options: text = `Custom answer (not one of the options).` + newline + `User responded: ${JSON.stringify(result)}`.
- `multiselect`, some values not among the options: text = `Custom values (not among the options): ${JSON.stringify(customValues)}.` + newline + `User responded: ${JSON.stringify(result)}`.
- `batch`: each summary line of a `select` or `multiselect` sub-question whose answer is, or contains, a custom value SHALL end with ` (custom)`. `confirm` and `input` lines SHALL never get the suffix.

Answers made only of listed options SHALL keep the existing result text.

#### Scenario: Custom select answer
- **WHEN** the user answers a select with options `["A", "B"]` by typing `C`
- **THEN** the result text SHALL be `Custom answer (not one of the options).\nUser responded: "C"`
- **AND** `details.result` SHALL be `"C"`

#### Scenario: Option answer unchanged
- **WHEN** the user picks `"A"` on that select
- **THEN** the result text SHALL be exactly `User responded: "A"`

#### Scenario: Multiselect with a custom value
- **WHEN** a multiselect with options `["A", "B"]` resolves to `["A", "D"]`
- **THEN** the result text SHALL be `Custom values (not among the options): ["D"].\nUser responded: ["A","D"]`

#### Scenario: Batch line marks custom
- **WHEN** batch sub-question 2 (a select over `["A", "B"]`) is answered `"C"`
- **THEN** summary line 2 SHALL end with ` (custom)` and the other lines SHALL be unchanged

#### Scenario: Input lines never marked custom
- **WHEN** a batch `input` sub-question is answered `"free text"`
- **THEN** its summary line SHALL NOT end with ` (custom)`

### Requirement: The ask_user history card shows custom answers
When the `ask_user` tool card is the surviving record of an answered question (no paired live interactive card, e.g. after history reload), it SHALL parse the response from the LAST LINE of the result text that begins with `User responded:`. `JSON.stringify` never emits a raw newline, so marker text inside a note line or inside the JSON payload cannot shift the parse. For a `select`, when the parsed response is not one of the options, the card SHALL show a "Response:" row with the custom text as plain text, beside the unhighlighted option chips. For a `multiselect`, the card SHALL parse the JSON array, and when it contains values not among the options, the card SHALL show a "Response:" row listing only those custom values as plain text.

#### Scenario: Custom select answer survives reload
- **WHEN** an answered `ask_user` select over `["A", "B"]` has result text `Custom answer (not one of the options).\nUser responded: "C"` and no live interactive card
- **THEN** the tool card SHALL show chips `A` and `B` unhighlighted and a "Response:" row reading `C`

#### Scenario: Custom multiselect value survives reload
- **WHEN** an answered `ask_user` multiselect over `["A", "B"]` has result text ending `User responded: ["A","D"]`
- **THEN** the tool card SHALL show a "Response:" row reading `D`

#### Scenario: Marker text inside a custom value
- **WHEN** a multiselect custom value is `x User responded: y`, so the note line contains that text JSON-encoded
- **THEN** the card SHALL parse the final `User responded:` line and show `x User responded: y` as the custom value

#### Scenario: Option answer rendering unchanged
- **WHEN** the result text is `User responded: "A"`
- **THEN** the tool card SHALL highlight chip `A` and SHALL NOT show a "Response:" row

### Requirement: Flat parameter schema with runtime per-method enforcement

The `ask_user` tool SHALL declare its parameters as ONE flat JSON Schema object: root `{"type": "object"}` with a `properties` map (`method`, `title`, `message`, `options`, `placeholder`, `questions`, `allowOther`) and `required: ["method"]`. The root SHALL NOT carry `oneOf`, `anyOf`, `allOf`, `enum` or `not`, because OpenAI strict mode (GPT-4.1+, GPT-5.x, Codex, Responses API) rejects a schema that has any of these at its top level. `SubQuestionSchema` SHALL follow the same flat rule, with properties `method`, `title`, `options`, `placeholder`, `message` and `allowOther`.

Per-method requirements are enforced at runtime, by the `prepareArguments` rescue layer and by the `execute` guards, not by the schema. Select and multiselect need a non-empty `options` array. Batch needs `questions[]`, and batch sub-questions cannot themselves be a batch.

#### Scenario: Schema root remains type:object (OpenAI strict compat)
- **WHEN** the `ask_user` tool's `parameters` schema is JSON-serialized
- **THEN** the root object SHALL have `"type": "object"`
- **AND** the root SHALL NOT have a `oneOf`, `anyOf`, `allOf`, `enum` or `not` field

#### Scenario: Sub-question schema is flat
- **WHEN** the `questions` item schema is JSON-serialized
- **THEN** it SHALL have `"type": "object"` and SHALL NOT have a `oneOf`, `anyOf`, `allOf`, `enum` or `not` field

#### Scenario: allowOther is declared as an optional boolean
- **WHEN** the schema is JSON-serialized
- **THEN** `properties.allowOther` and the sub-question `properties.allowOther` SHALL be `{"type": "boolean", ...}` and SHALL NOT appear in `required`

#### Scenario: Empty options rejected at runtime
- **WHEN** an LLM emits `{method: "multiselect", title: "Pick", options: []}`
- **THEN** `execute` SHALL throw an error naming the non-empty `options` requirement

#### Scenario: Batch sub-question with empty options rejected at runtime
- **WHEN** a batch sub-question is `{method: "select", title: "Pick", options: []}`
- **THEN** `execute` SHALL throw before dispatching any UI request

## MODIFIED Requirements

### Requirement: prepareArguments preserves empty-args rejection
The `ask_user` tool's `prepareArguments` rescue layer SHALL NOT synthesize a `method`, `title`, `questions` or `allowOther` field when the input is an empty object `{}`. The framework's runtime schema validator MUST continue to reject empty-args invocations so the model is forced to retry with valid arguments. Every existing rescue transformation requires at least one input field to fire and SHALL remain a no-op on `{}`. These are: unwrap `params`, rename `question` → `title`, parse stringified `options`, synthesize `method: "batch"` from a non-empty `questions` array, normalize `[{label,value}]` → `[label]`, coerce or alias `allowOther`/`allowCustom`.

#### Scenario: Empty-args call stays empty
- **WHEN** `prepareArguments({})` is called
- **THEN** it SHALL return an object with no `method`, no `title`, no `questions` and no `allowOther` properties (the only allowed extra is the non-enumerable `__normalizations` array, which MUST be empty)

#### Scenario: Schema rejection still fires for empty args
- **WHEN** the model emits a `tool_use` block for `ask_user` with `input: {}`
- **THEN** the framework's runtime schema validator SHALL reject it with `Validation failed for tool "ask_user"`, naming the missing required property `method` of the flat schema

#### Scenario: Real rescue cases still apply
- **WHEN** `prepareArguments({ questions: [{ method: "confirm", title: "Proceed?" }] })` is called (no top-level `method`)
- **THEN** it SHALL return `{ method: "batch", title: "Proceed?", questions: [...] }` — the synthesis depends on a non-empty `questions` array, so this scenario is NOT regressed by the empty-args contract

### Requirement: Argument rescue for batch shapes

The `ask_user` tool's `prepareArguments` SHALL repair known malformed batch shapes before validation.

#### Scenario: `questions` array sent as a JSON string
- **WHEN** an LLM calls `ask_user` with `{questions: "[{\"method\":\"select\",\"title\":\"Pick\",\"options\":[\"a\",\"b\"]}]"}` (no top-level `method`)
- **THEN** `prepareArguments` SHALL parse the `questions` string into an array
- **AND** SHALL synthesize `method: "batch"` at the top level
- **AND** SHALL synthesize `title: <first question's title>` if none is present
- **AND** the resulting call SHALL pass schema validation and the batch runtime guards

#### Scenario: single-question wrapped in `questions` array
- **WHEN** an LLM calls `ask_user` with `{questions: [{method: "confirm", title: "Proceed?"}]}` (no top-level `method`, array not stringified)
- **THEN** `prepareArguments` SHALL synthesize `method: "batch"` and a `title` from the first sub-question
- **AND** the resulting call SHALL pass schema validation and the batch runtime guards

#### Scenario: legacy `{label, value}` options in a sub-question
- **WHEN** a batch sub-question has `options: [{label: "Sync now", value: "sync"}, {label: "Skip", value: "skip"}]`
- **THEN** `prepareArguments` SHALL normalize each entry to its `label` string, producing `options: ["Sync now", "Skip"]`
- **AND** the returned tool result SHALL include a warning in `details` noting that value fields were discarded

#### Scenario: `input_type` wrapper in a sub-question
- **WHEN** a batch sub-question has `{header: "...", question: "...", input_type: {method: "select", options: [...]}}`
- **THEN** `prepareArguments` SHALL flatten `input_type` fields to the top of the sub-question
- **AND** SHALL rename `header` or `question` to `title`
- **AND** the resulting sub-question SHALL be a valid single (non-batch) sub-question per the flat sub-question schema and runtime guards

#### Scenario: explicit method=batch call missing outer title
- **WHEN** an LLM calls `ask_user` with `{method: "batch", questions: [{method: "confirm", question: "Proceed?"}, ...]}` (explicit `method: "batch"` but no outer `title`)
- **THEN** `prepareArguments` SHALL backfill `title` from the first sub-question's `title`, `question`, or `header` (or `"Questions"` as a last-resort fallback)
- **AND** the resulting call SHALL pass schema validation and the batch runtime guards

### Requirement: Tool result JSON shape evolves only when attachments are present

The `ask_user` tool's text-content result SHALL end with `User responded: ${JSON.stringify(result)}` as its final line when no attachments are present. The only addition SHALL be a custom-answer note line before it, as defined by "ask_user result flags custom answers for the model". An answer made only of listed options, an input answer, and a confirm answer SHALL produce exactly that one line. When attachments are present, the `result` object embedded in the JSON SHALL be `{value: string, attachments: Array<{path: string, mimeType: string, bytes: number}>}` instead of a bare string.

This rule applies to both the standalone `method:"input"` result and the per-sub-question entries in the `method:"batch"` numbered summary. In a batch summary, a sub-question line whose answer is custom SHALL additionally end with ` (custom)`.

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
- **AND** other sub-question types (confirm→boolean / select→string / multiselect→string[]) in the same batch SHALL keep their existing `JSON.stringify` rendering, with ` (custom)` appended only when that answer is custom

#### Scenario: Custom select answer keeps the final line parseable
- **WHEN** a select answer is the custom string `"C"`
- **THEN** the final line of the result text SHALL be exactly `User responded: "C"`

## REMOVED Requirements

### Requirement: Strict parameter schema per method
**Reason**: Never shipped as specified. The body-level `oneOf` discriminator ("Layer 2" of fix-multiselect-auto-cancel-on-dashboard) was dropped because real OpenAI gpt-5 strict mode rejects any root-level `oneOf`/`anyOf`/`allOf`/`enum`/`not`. The code ships a flat schema, and `ask-user-schema-discriminator.test.ts` guards against reintroducing `oneOf`. Keeping this requirement would contradict both the code and the new `allowOther` schema field.
**Migration**: Superseded by "Flat parameter schema with runtime per-method enforcement". Per-method constraints (non-empty `options`, `questions[]`, no nested batch) are enforced by `prepareArguments` and the `execute` guards.
