## MODIFIED Requirements

### Requirement: CtxToolRenderer
A single `CtxToolRenderer` component SHALL render all `ctx_*` tool calls. It SHALL call `parseCtxResult`, render a per-tool header chip, and select a body layout by result kind. When a result is present the chip and body SHALL be derived from the parsed struct. When no result is present (the call is still running) or the parse degrades to `{ kind: "raw" }`, the chip SHALL be derived from the tool `args` (never the bare tool name), and the running body SHALL preview the pending work from `args`. The renderer SHALL NOT render the tool arguments as raw JSON for the recognized kinds, and the header chip SHALL NOT equal the tool-name subtitle for any recognized `ctx_*` tool.

#### Scenario: Header chip per tool
- **WHEN** a `ctx_batch_execute` result parses to a batch summary with 6 commands, 31 sections, 5 queries
- **THEN** the collapsed card header SHALL show a chip summarizing command count, section count, and query count (e.g. `6 cmds · 31 sections · 5 queries`)

#### Scenario: Execute body shows code and stdout
- **WHEN** a `ctx_execute` tool call has `args.language = "shell"` and a non-empty `code` argument and a stdout result
- **THEN** the card SHALL render the `code` argument as a code block and the stdout below it
- **AND** the card SHALL NOT render `JSON.stringify(args)`

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

## ADDED Requirements

### Requirement: Raw fallback still renders a card
When `parseCtxResult` returns `{ kind: "raw", text }`, the `CtxToolRenderer` SHALL render a card whose header chip is derived from the tool `args` (via the same args-chip path used for the running state) rather than the bare tool name, and whose body is the stripped `text` rendered as linkified output. The card SHALL NOT render `JSON.stringify(args)`.

#### Scenario: Raw fallback renders args-derived chip and linkified body
- **WHEN** the parsed result is `{ kind: "raw", text }` for a recognized `ctx_*` tool with usable `args`
- **THEN** the card SHALL render an args-derived header chip (e.g. `▦ N cmds` for `ctx_batch_execute`), distinct from the tool-name subtitle
- **AND** the card SHALL render the stripped `text` as a linkified body
- **AND** the card SHALL NOT render `JSON.stringify(args)`

#### Scenario: Raw fallback for an unknown ctx tool falls back to the tool name
- **WHEN** the parsed result is `{ kind: "raw", text }` for an unmapped `ctx_*` tool with no args-chip mapping
- **THEN** the card SHALL render the tool name as the header chip and the stripped `text` as a linkified body
