## Purpose

Renders tool call results in the chat view with specialized per-tool visualizations. Each tool type has a dedicated renderer that understands its arguments and output format.
## Requirements
### Requirement: Tool renderer registry
The client SHALL maintain a registry mapping tool names to renderer components. A `getToolRenderer(toolName)` function SHALL return the specialized renderer for known tools, route any unmapped tool whose name begins with `ctx_` to `CtxToolRenderer`, and otherwise fall back to `GenericToolRenderer`.

Built-in renderers:
- `read` → `ReadToolRenderer`
- `edit` → `EditToolRenderer`
- `write` → `WriteToolRenderer`
- `bash` → `BashToolRenderer`
- `ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`, `ctx_search`, `ctx_index`, `ctx_fetch_and_index`, `ctx_insight` → `CtxToolRenderer`
- Other tools named `ctx_*` → `CtxToolRenderer`
- All others → `GenericToolRenderer`

#### Scenario: Known tool renders with specialized view
- **WHEN** a tool call for "read" is displayed
- **THEN** the `ReadToolRenderer` SHALL be used

#### Scenario: Known ctx tool renders with ctx view
- **WHEN** a tool call for "ctx_search" is displayed
- **THEN** the `CtxToolRenderer` SHALL be used

#### Scenario: Unmapped ctx-prefixed tool routes to ctx renderer
- **WHEN** a tool call for "ctx_stats" (not in the explicit map) is displayed
- **THEN** the `CtxToolRenderer` SHALL be used

#### Scenario: Unknown non-ctx tool uses generic renderer
- **WHEN** a tool call for "custom_tool" is displayed
- **THEN** the `GenericToolRenderer` SHALL be used

### Requirement: ReadToolRenderer
The Read renderer SHALL display the file path as a header with an "Open in editor" button. When the tool result includes image attachments (via the `images` field on the ChatMessage), the renderer SHALL display each image as an inline `<img>` element with a max width of 512px, rounded corners, and a subtle border. The image SHALL be rendered from base64 data using a `data:` URI. When no images are present, the tool result (file content) SHALL be displayed in a syntax-highlighted code block with language auto-detection based on file extension. The syntax highlighting style SHALL be resolved using the active theme name.

#### Scenario: Read image file displays inline image
- **WHEN** a read tool call completes with an image attachment
- **THEN** the renderer SHALL show the file path and an inline `<img>` element

#### Scenario: Read image file with text fallback
- **WHEN** a read tool call completes with both an image attachment and a text result
- **THEN** the renderer SHALL show the inline image and NOT show the text result as a code block

#### Scenario: Read text file displayed as code
- **WHEN** a read tool call completes with text content and no image attachments
- **THEN** the renderer SHALL show the file path and syntax-highlighted content

#### Scenario: Read file respects named theme
- **WHEN** a read tool call renders under the Dracula theme
- **THEN** the syntax token colors SHALL use the Dracula syntax style, not the base default

### Requirement: EditToolRenderer
The Edit renderer SHALL display the file path as a header. When `oldText` and `newText` arguments are present, they SHALL be rendered as a unified diff view. When an `edits` array argument is present, each entry's `oldText` and `newText` SHALL be rendered as a separate diff view, stacked vertically with a thin border separator between them. When neither format is present, arguments SHALL be displayed as raw JSON.

The diff view component used SHALL be selected based on viewport class:

- On **desktop** (when `useMobile()` returns `false`), the renderer SHALL use the shared `<RichDiff>` component, which renders a syntax-highlighted unified diff via `@git-diff-view/react` with `mode="unified"` and a capped maximum height with internal scroll.
- On **mobile** (when `useMobile()` returns `true`), the renderer SHALL use the existing homegrown `DiffView` component that renders a unified patch produced by `createTwoFilesPatch` with per-line CSS classes.

The selection SHALL apply uniformly to both the single-edit (`oldText`/`newText`) and multi-edit (`edits[]`) paths within a single tool call. The `<RichDiff>` component SHALL only be mounted when the parent `ToolCallStep` is in the expanded state — collapsed Edit cards SHALL NOT instantiate `<RichDiff>`, ensuring the syntax-highlighting tokenizer does not run for unviewed diffs.

#### Scenario: Single edit on desktop renders rich diff
- **WHEN** an edit tool call has `oldText` and `newText` arguments AND `useMobile()` returns `false`
- **THEN** the renderer SHALL show a single `<RichDiff>` of oldText → newText with syntax highlighting and unified mode

#### Scenario: Single edit on mobile renders homegrown diff
- **WHEN** an edit tool call has `oldText` and `newText` arguments AND `useMobile()` returns `true`
- **THEN** the renderer SHALL show a single homegrown `DiffView` of oldText → newText (no syntax highlighting)

#### Scenario: Multi-edit on desktop renders stacked rich diffs
- **WHEN** an edit tool call has an `edits` array with multiple entries AND `useMobile()` returns `false`
- **THEN** the renderer SHALL show one `<RichDiff>` per entry, separated by thin borders

#### Scenario: Multi-edit on mobile renders stacked homegrown diffs
- **WHEN** an edit tool call has an `edits` array with multiple entries AND `useMobile()` returns `true`
- **THEN** the renderer SHALL show one homegrown `DiffView` per entry, separated by thin borders

#### Scenario: Empty or missing edit data shows raw JSON
- **WHEN** an edit tool call has neither `oldText`/`newText` nor `edits` array
- **THEN** the renderer SHALL display the arguments as formatted JSON, regardless of viewport class

#### Scenario: Collapsed Edit card does not mount RichDiff
- **WHEN** an Edit tool card is rendered in its default collapsed state on desktop
- **THEN** the `<RichDiff>` component SHALL NOT be mounted in the DOM, and the `@git-diff-view` tokenizer SHALL NOT execute for that card

#### Scenario: Expanding a collapsed Edit card mounts RichDiff lazily
- **WHEN** the user clicks the chevron on a collapsed Edit card on desktop
- **THEN** the `<RichDiff>` component SHALL mount and render the syntax-highlighted diff at that point

### Requirement: RichDiff shared component
The client SHALL provide a shared `<RichDiff>` component that encapsulates the syntax-highlighted diff rendering primitive used by both `EditToolRenderer` (desktop chat) and `DiffPanel` (file diff view).

`<RichDiff>` SHALL accept the following props:
- `oldText: string` — the prior content of the file or region
- `newText: string` — the new content of the file or region
- `filePath: string` — used to derive the syntax-highlighting language via an internal extension-to-language map
- `mode?: "unified" | "split"` — defaults to `"unified"`
- `maxHeight?: string` — optional CSS max-height with internal scroll; when omitted, height is determined by parent layout

`<RichDiff>` SHALL internally:
1. Resolve the language from the file extension via an internal `EXT_LANG_MAP` constant.
2. Build a `DiffFile` via `generateDiffFile(filePath, oldText, filePath, newText, lang, lang)`.
3. Call `.init()`, `.buildSplitDiffLines()`, and `.buildUnifiedDiffLines()` on the file.
4. Render `<DiffView>` from `@git-diff-view/react` with the lowlight highlighter and the resolved mode.

`<RichDiff>` SHALL set the following `<DiffView>` props internally so callers do not pass them:
- `diffViewMode` derived from the resolved `mode` prop
- `diffViewTheme` derived from `useThemeContext().resolved` (`"light" | "dark"`), so that diffs respect the active theme
- `diffViewHighlight` enabled
- `diffViewWrap` enabled
- `registerHighlighter` set to the lowlight `highlighter` import

`<RichDiff>` SHALL NOT include a toolbar, mode toggle, file-metadata header, or expand controls. Such chrome SHALL be the responsibility of the caller (e.g., `DiffPanel`'s toolbar).

#### Scenario: RichDiff renders unified by default
- **WHEN** `<RichDiff>` is rendered without a `mode` prop
- **THEN** it SHALL render in unified mode

#### Scenario: RichDiff renders split when requested
- **WHEN** `<RichDiff>` is rendered with `mode="split"`
- **THEN** it SHALL render in split mode

#### Scenario: RichDiff caps height when maxHeight provided
- **WHEN** `<RichDiff>` is rendered with `maxHeight="20rem"`
- **THEN** the rendered container SHALL have its max-height set to `20rem` and overflow content SHALL scroll internally

#### Scenario: RichDiff resolves language from file extension
- **WHEN** `<RichDiff>` is rendered with `filePath="foo.ts"`
- **THEN** the underlying `DiffFile` SHALL be generated with `typescript` as the language

#### Scenario: RichDiff resolves unknown extensions to plaintext
- **WHEN** `<RichDiff>` is rendered with a file path whose extension is not in `EXT_LANG_MAP`
- **THEN** the underlying `DiffFile` SHALL fall back to a plaintext language identifier without throwing

#### Scenario: RichDiff respects active theme
- **WHEN** the active theme resolves to `"light"` and `<RichDiff>` is rendered
- **THEN** `<DiffView>` SHALL receive `diffViewTheme="light"`
- **AND WHEN** the active theme resolves to `"dark"`
- **THEN** `<DiffView>` SHALL receive `diffViewTheme="dark"`

### Requirement: DiffPanel consumes RichDiff for change-derived diffs
`DiffPanel` SHALL delegate its **change-derived** diff rendering (Edit changes, Write changes, and the most-recent-change fallback — i.e., paths that build a `DiffFile` via `generateDiffFile`) to the shared `<RichDiff>` component. The split↔unified toggle, view-mode toggle (diff/file), file-metadata header, expand controls, and per-change-type dispatch logic SHALL remain in `DiffPanel`. The user-visible behavior of `DiffPanel` (and therefore of `FileDiffView`) SHALL be unchanged by this delegation.

The **git-aggregate-diff path** of `DiffPanel` (the branch that consumes the raw `data` prop of `<DiffView>` with `{ oldFile, newFile, hunks }` derived from `file.gitDiff`) is OUT OF SCOPE for this delegation and SHALL continue to render `<DiffView>` inline within `DiffPanel`. This is intentional: `<RichDiff>`'s API is narrowly scoped to `(oldText, newText, filePath)` and does not accept the raw hunks shape.

The git-aggregate path SHALL supply `<DiffView>`'s `data.hunks` a **header-preserving** unified diff — i.e. a diff string that retains its `diff --git`/`---`/`+++` file header — so that `@git-diff-view` reconstructs diff lines when the `data.oldFile`/`data.newFile` `content` fields are empty. Because `file.gitDiff` is already a complete header-bearing unified diff for the file, `DiffPanel` SHALL pass it whole and SHALL NOT strip its file header before handing it to `<DiffView>`. Rendering a non-empty `file.gitDiff` through this path SHALL produce a non-empty diff view (at least one rendered diff line).

The change-derived fallback (the branch used when no specific change is selected and no `file.gitDiff` is present) SHALL select the file's most recent change whose payload yields renderable texts (an `edit` with a non-empty `edits[]`, or a `write` with `content`), scanning newest-to-oldest; a detected-on-disk-only change (`type:"tool"`, which yields no texts) SHALL be skipped rather than rendered as an empty panel. The "No diff data available" note SHALL appear only when neither a git-aggregate diff nor any renderable change exists.

#### Scenario: DiffPanel split toggle still works for change-derived diffs
- **WHEN** the user toggles `DiffPanel`'s mode control from unified to split for a change-derived diff (Edit or Write)
- **THEN** the underlying `<RichDiff>` SHALL re-render with `mode="split"` and the diff SHALL be displayed side-by-side

#### Scenario: DiffPanel preserves toolbar and file header
- **WHEN** `DiffPanel` renders any diff (change-derived OR git-aggregate)
- **THEN** the toolbar, file-path header, view-mode toggle, and expand controls SHALL be visible exactly as before this change

#### Scenario: Git-aggregate diff path remains inline
- **WHEN** `DiffPanel` renders a file whose diff is sourced from `file.gitDiff` (no specific change selected, no change-derived `DiffFile` built)
- **THEN** `<DiffView>` SHALL be rendered inline within `DiffPanel` using the `data` prop — NOT through `<RichDiff>`

#### Scenario: Git-aggregate diff renders non-empty for a git-tracked file
- **WHEN** `DiffPanel` renders a file whose `file.gitDiff` is a non-empty unified diff and no specific change is selected (e.g. a `diff:` tab opened from the change-list, `selection.changeIndex === null`)
- **THEN** the `hunks` payload handed to `<DiffView>`'s `data` prop SHALL retain the diff's `diff --git`/`+++` file header, and the rendered diff view SHALL contain at least one diff line (SHALL NOT be empty)

#### Scenario: Fallback skips a detected-on-disk-only change
- **WHEN** `DiffPanel` has no selected change and no `file.gitDiff`, and `file.changes` ends with a `type:"tool"` (detected-on-disk-only) event preceded by an `edit` or `write` event on the same file
- **THEN** `DiffPanel` SHALL render the diff of that earlier `edit`/`write` change and SHALL NOT show the "No diff data available" note

### Requirement: WriteToolRenderer
The Write renderer SHALL display the file path as a header with an "Open in editor" button. The written content SHALL be displayed in a syntax-highlighted code block. The syntax highlighting style SHALL be resolved using the active theme name.

#### Scenario: Write file displayed
- **WHEN** a write tool call completes
- **THEN** the renderer SHALL show the file path and written content

#### Scenario: Write file respects named theme
- **WHEN** a write tool call renders under the Nord theme
- **THEN** the syntax token colors SHALL use the Nord syntax style, not the base default

### Requirement: BashToolRenderer
The Bash renderer SHALL display the command with a `$` prompt in the theme's accent green color. The tool result (stdout/stderr) SHALL be displayed below in a scrollable pre-formatted block.

#### Scenario: Bash command displayed
- **WHEN** a bash tool call completes
- **THEN** the renderer SHALL show the command and its output

#### Scenario: Bash prompt uses theme accent
- **WHEN** the bash renderer displays under any named theme
- **THEN** the `$` prompt color SHALL use `var(--accent-green)`

### Requirement: GenericToolRenderer
The Generic renderer SHALL display the tool name as a header, arguments as a JSON code block, and the result as a pre-formatted text block.

#### Scenario: Unknown tool displayed
- **WHEN** a tool call for an unrecognized tool completes
- **THEN** the renderer SHALL show the tool name, arguments, and result

### Requirement: DiffView component
The `DiffView` component SHALL render unified diff content with colored lines using theme accent CSS variables: additions (`+` prefix) SHALL use `var(--accent-green)` text with a transparent green background, deletions (`-` prefix) SHALL use `var(--accent-red)` text with a transparent red background, and hunk headers (`@@` prefix) SHALL use `var(--accent-blue)` text.

#### Scenario: Diff with additions and deletions
- **WHEN** diff content contains `+` and `-` lines
- **THEN** additions SHALL use `var(--accent-green)` styling and deletions SHALL use `var(--accent-red)` styling

#### Scenario: Diff colors adapt to theme
- **WHEN** a diff view renders under the Nord theme
- **THEN** addition/deletion/hunk colors SHALL use Nord's accent values, not hardcoded Tailwind colors

### Requirement: Open file button
Tool renderers for file-based tools (Read, Write) SHALL include an "Open in editor" button that calls `POST /api/open-editor` with the file path and optionally the line number. The button SHALL only appear when the dashboard is accessed from localhost.

#### Scenario: Open file in editor
- **WHEN** user clicks the open button on a ReadToolRenderer
- **THEN** the client SHALL call `/api/open-editor` with the file path

#### Scenario: Button hidden on remote access
- **WHEN** the dashboard is accessed via a tunnel or non-localhost URL
- **THEN** the open file button SHALL NOT be displayed

### Requirement: Language auto-detection
Tool renderers SHALL auto-detect the programming language for syntax highlighting based on the file extension. Common mappings SHALL include `.ts`→typescript, `.tsx`→tsx, `.js`→javascript, `.py`→python, `.rs`→rust, `.go`→go, `.md`→markdown, etc.

#### Scenario: TypeScript file highlighted
- **WHEN** a read tool call shows a `.ts` file
- **THEN** the content SHALL be highlighted as TypeScript

### Requirement: ToolCallStep auto-expands for image results
The `ToolCallStep` component SHALL default to expanded when the tool result contains image attachments. For tool results without images, the default SHALL remain collapsed.

#### Scenario: Image tool result is expanded by default
- **WHEN** a tool call step renders with image attachments
- **THEN** the step SHALL be expanded (content visible) without user interaction

#### Scenario: Non-image tool result is collapsed by default
- **WHEN** a tool call step renders without image attachments
- **THEN** the step SHALL be collapsed by default

### Requirement: Uniform code payload font-size

The code/diff payload region of `ReadToolRenderer`, `WriteToolRenderer`, `EditToolRenderer`, `BashToolRenderer`, and `GenericToolRenderer` SHALL render at a single shared font-size of 12 px on both mobile and desktop. The shared size SHALL be applied via a single reusable utility class (`.text-code`) declared in `packages/client/src/index.css`. Non-payload chrome (filename labels, status text, action buttons, `AskUserToolRenderer` controls) is OUT OF SCOPE for this requirement and retains its existing sizing.

When wrapping third-party components where the utility class cannot be reliably applied to the payload container (e.g. `RichDiff` wrapping `@git-diff-view/react`), an inline `style={{ fontSize: "12px" }}` MAY be used as a fallback to achieve the required font-size. The structural test (`tool-renderer-payload-fontsize.test.tsx`) accepts either `.text-code` on the payload root OR `style.fontSize === "12px"`.

`DiffPanel` (the full-screen diff viewer) and markdown code blocks inside assistant prose (`MarkdownContent`) are explicitly OUT OF SCOPE and SHALL retain their existing font-sizes.

#### Scenario: Read and Edit cards for the same file render at the same font-size

- **GIVEN** a chat view contains a `Read(foo.ts)` tool call followed by an `Edit(foo.ts)` tool call
- **WHEN** both cards have completed and their content is visible
- **THEN** the computed `font-size` of the code payload in the Read card SHALL equal the computed `font-size` of the diff payload in the Edit card
- **AND** that shared value SHALL be 12 px

#### Scenario: Mobile and desktop Edit cards render at the same font-size

- **GIVEN** an `EditToolRenderer` is rendered with both `oldText` and `newText` populated
- **WHEN** the viewport is narrow enough to trigger the mobile fallback `DiffView`
- **THEN** the computed `font-size` of the diff lines SHALL be 12 px
- **AND** SHALL equal the computed `font-size` of the desktop `RichDiff` payload at a wider viewport

#### Scenario: Bash and Generic output payload match Read

- **GIVEN** a chat view contains a `Bash` tool call result and a `Read` tool call result
- **WHEN** both cards have completed
- **THEN** the computed `font-size` of the `<pre>` output in the Bash card SHALL equal the computed `font-size` of the code payload in the Read card (both 12 px)

#### Scenario: Filename header is unaffected

- **GIVEN** any of the affected tool renderers is displayed
- **WHEN** the filename label / status row above the payload is inspected
- **THEN** the filename label SHALL retain its existing `text-xs` styling and SHALL NOT be coerced through the shared `.text-code` utility

### Requirement: ctx result parser
A pure module SHALL expose `parseCtxResult(toolName, result, isError)` returning a typed `CtxResult` union with one of the kinds: `error`, `execute`, `batch`, `search`, `index`, `fetch`, `insight`, or `raw`. The parser SHALL NOT import React and SHALL be unit-testable in isolation.

The parser SHALL first strip a leading noise line matching the context-mode upgrade banner (`⚠️ context-mode v… outdated …`) before classifying the result. Every parse branch SHALL return `{ kind: "raw", text }` when its expected header does not match, and SHALL NOT throw on malformed input.

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

#### Scenario: Classifies validation error
- **GIVEN** `isError` is true and the result starts with `Validation failed for tool "ctx_batch_execute":`
- **WHEN** the parser runs
- **THEN** it SHALL return `{ kind: "error", variant: "validation" }` with the `Received arguments:` JSON captured into `receivedArgs`

#### Scenario: Classifies timeout error
- **GIVEN** `isError` is true and the result is `MCP request timeout after 120000ms: tools/call`
- **WHEN** the parser runs
- **THEN** it SHALL return `{ kind: "error", variant: "timeout" }`

#### Scenario: Malformed result falls back to raw
- **GIVEN** a `ctx_search` result whose body does not match the expected `## <query>` grammar
- **WHEN** the parser runs
- **THEN** it SHALL return `{ kind: "raw", text }` and SHALL NOT throw

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

