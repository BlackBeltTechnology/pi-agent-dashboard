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

#### Scenario: Strips upgrade banner
- **GIVEN** a result whose first line is `⚠️ context-mode v1.0.161 outdated → v1.0.162 available. Upgrade: npm run build`
- **WHEN** the parser runs
- **THEN** the returned struct's rendered body SHALL NOT contain the banner line

#### Scenario: Parses batch summary header
- **GIVEN** a `ctx_batch_execute` result starting with `Executed 6 commands (816 lines, 62.8KB). Indexed 31 sections. Searched 5 queries.`
- **WHEN** the parser runs
- **THEN** it SHALL return `{ kind: "batch" }` with summary fields `commands=6`, `sections=31`, `queries=5`

#### Scenario: Parses index header
- **GIVEN** a `ctx_index` result `Indexed 830 sections (169 with code) from: docs/`
- **WHEN** the parser runs
- **THEN** it SHALL return `{ kind: "index", sections: 830, withCode: 169, source: "docs/" }`

#### Scenario: Malformed result falls back to raw
- **GIVEN** a `ctx_search` result whose body does not match the expected `## <query>` grammar
- **WHEN** the parser runs
- **THEN** it SHALL return `{ kind: "raw", text }` and SHALL NOT throw

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
#### Scenario: Header chip per tool
- **WHEN** a `ctx_batch_execute` result parses to a batch summary with 6 commands, 31 sections, 5 queries
- **THEN** the collapsed card header SHALL show a chip summarizing command count, section count, and query count (e.g. `6 cmds · 31 sections · 5 queries`)

#### Scenario: Execute_file body shows path header
- **WHEN** a `ctx_execute_file` tool call has a `path` argument
- **THEN** the card SHALL render the file path as a header above the code block

#### Scenario: Search body renders per-query accordions
- **WHEN** a `ctx_search` result contains two `## <query>` blocks, one with snippets and one with `No results found.`
- **THEN** the card SHALL render two accordions, the first listing source-tagged snippets and the second showing a "no results" indicator

#### Scenario: Batch body renders sections and query answers
- **WHEN** a `ctx_batch_execute` result contains an Indexed Sections list and per-query answer blocks
- **THEN** the card SHALL render the section list and one collapsible accordion per query answer
- **AND** the body region SHALL be height-capped with internal scroll

#### Scenario: Index body is a compact one-liner
- **WHEN** a `ctx_index` result parses to `{ kind: "index" }`
- **THEN** the card SHALL render a single line with the section count and source, without a code block

#### Scenario: Fetch body shows source and url
- **WHEN** a `ctx_fetch_and_index` result parses to `{ kind: "fetch" }` with a source and url
- **THEN** the card SHALL render the section count, source label, and the originating url/host

#### Scenario: Insight body shows dashboard link
- **WHEN** a `ctx_insight` result contains a `http://localhost:<port>` url
- **THEN** the card SHALL render a link/button to that url

#### Scenario: Error kind renders error card
- **WHEN** the parsed result is `{ kind: "error", variant: "validation", receivedArgs }`
- **THEN** the card SHALL render an error-styled body with the reason and a collapsible `Received arguments:` block

#### Scenario: Running chip is derived from args, not the tool name
- **WHEN** a `ctx_batch_execute` tool call is running (`status = "running"`) with no result yet and `args.commands` has 3 entries
- **THEN** the header chip SHALL read `▦ 3 cmds` (derived from `args.commands.length`)
- **AND** the chip SHALL NOT equal the `ctx_batch_execute` tool-name subtitle

#### Scenario: Running batch previews its pending commands
- **WHEN** a `ctx_batch_execute` tool call is running with `args.commands = [{label, command}, …]`
- **THEN** the running body SHALL list each command's `label` (and command text), not a bare `Running…`
- **AND** the list SHALL be height-capped with internal scroll

#### Scenario: Running execute previews its code
- **WHEN** a `ctx_execute` tool call is running with `args.language = "javascript"` and a non-empty `args.code`
- **THEN** the header chip SHALL read `⚙ javascript`
- **AND** the running body SHALL render `args.code` in a code block

#### Scenario: Running search previews its queries
- **WHEN** a `ctx_search` tool call is running with `args.queries` of length 2
- **THEN** the header chip SHALL read `🔍 2 queries`
- **AND** the running body SHALL list both `args.queries` entries

