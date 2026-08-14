# tool-renderers delta

## MODIFIED Requirements

### Requirement: ctx result parser
A pure module SHALL expose `parseCtxResult(toolName, result, isError)` returning a typed `CtxResult` union with one of the kinds: `error`, `execute`, `batch`, `search`, `index`, `fetch`, `insight`, or `raw`. The parser SHALL NOT import React and SHALL be unit-testable in isolation.

The parser SHALL first strip a leading noise line matching the context-mode upgrade banner (`⚠️ context-mode v… outdated …`) before classifying the result. Every parse branch SHALL return `{ kind: "raw", text }` when its expected header does not match, and SHALL NOT throw on malformed input.

For a `runtime` error whose body has the context-mode execution shape — a fenced code block followed by an `Exit code: <n>` line and optional `stdout:` / `stderr:` sections — the parser SHALL additionally capture those parts into structured fields (`command`, `language`, `exitCode`, `stdout`, `stderr`) on the error struct. When the body does not have that shape, the parser SHALL leave the fields undefined and the renderer SHALL fall back to the flat `message` body. Field extraction SHALL NOT throw on a partial or malformed body.

#### Scenario: Classifies validation error
- **GIVEN** `isError` is true and the result starts with `Validation failed for tool "ctx_batch_execute":`
- **WHEN** the parser runs
- **THEN** it SHALL return `{ kind: "error", variant: "validation" }` with the `Received arguments:` JSON captured into `receivedArgs`

#### Scenario: Classifies timeout error
- **GIVEN** `isError` is true and the result is `MCP request timeout after 120000ms: tools/call`
- **WHEN** the parser runs
- **THEN** it SHALL return `{ kind: "error", variant: "timeout" }`

#### Scenario: Structures a runtime execution error into fields
- **GIVEN** `isError` is true and the body is a fenced ```shell block followed by `Exit code: 1`, a `stdout:` section and a `stderr:` section
- **WHEN** the parser runs
- **THEN** it SHALL return `{ kind: "error", variant: "runtime" }`
- **AND** the fenced block SHALL be captured into `command` with `language: "shell"`
- **AND** `exitCode` SHALL be `1`
- **AND** the two streams SHALL be captured into `stdout` and `stderr`

#### Scenario: Runtime error without execution shape stays flat
- **GIVEN** `isError` is true and the body is a plain sentence with no fenced block or exit-code line
- **WHEN** the parser runs
- **THEN** it SHALL return `{ kind: "error", variant: "runtime" }` with `command` / `exitCode` / `stdout` / `stderr` undefined
- **AND** the original text SHALL remain available in `message`

### Requirement: CtxToolRenderer
A single `CtxToolRenderer` component SHALL render all `ctx_*` tool calls. It SHALL call `parseCtxResult`, render a per-tool header chip, and select a body layout by result kind. When a result is present the chip and body SHALL be derived from the parsed struct. When no result is present (the call is still running) or the parse degrades to `{ kind: "raw" }`, the chip SHALL be derived from the tool `args` (never the bare tool name), and the running body SHALL preview the pending work from `args`. The renderer SHALL NOT render the tool arguments as raw JSON for the recognized kinds, and the header chip SHALL NOT equal the tool-name subtitle for any recognized `ctx_*` tool.

The error card SHALL carry its severity signal on the container chrome (border, fill, label) and SHALL NOT render its body in a raw severity-coloured `<pre>`. When the parser has structured a runtime error into fields, the card SHALL render the `command` through the same `CodeBlock` used by the success path (syntax-highlighted when a language is present), an `exit <n>` badge, and each non-empty stream (`stdout`, `stderr`) as its own labelled section. The success and error paths SHALL therefore share the same code-block and section presentation; a failing ctx call SHALL NOT render as a flat, unstructured wall while a passing one is highlighted and sectioned.

#### Scenario: Execute body shows code and stdout
- **WHEN** a `ctx_execute` tool call has `args.language = "shell"` and a non-empty `code` argument and a stdout result
- **THEN** the card SHALL render the `code` argument as a code block and the stdout below it
- **AND** the card SHALL NOT render `JSON.stringify(args)`

#### Scenario: Runtime error card renders structured sections
- **GIVEN** a `ctx_execute` error parsed with `command`, `language: "shell"`, `exitCode: 1`, and empty streams
- **THEN** the card SHALL render the command through `CodeBlock` with shell syntax highlighting
- **AND** SHALL render an `exit 1` badge
- **AND** SHALL render `stdout` and `stderr` as labelled sections
- **AND** SHALL NOT render the fenced ```` ``` ```` markers or the `Exit code:` label as literal body text

#### Scenario: Error card chrome carries the severity signal
- **WHEN** any error card renders
- **THEN** its border, fill and label SHALL use `--severity-error-*` tokens
- **AND** its body SHALL NOT be a `<pre>` coloured by a raw `red-<NNN>` literal

#### Scenario: Unstructured runtime error falls back to a neutral body
- **GIVEN** a runtime error the parser could not structure into fields
- **THEN** the card SHALL render the flat `message` in `--text-secondary` on `--bg-code`
- **AND** the chrome SHALL still carry the severity signal
