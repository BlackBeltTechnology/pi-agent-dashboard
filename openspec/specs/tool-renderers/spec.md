## Purpose

Renders tool call results in the chat view with specialized per-tool visualizations. Each tool type has a dedicated renderer that understands its arguments and output format.

## ADDED Requirements

### Requirement: Tool renderer registry
The client SHALL maintain a registry mapping tool names to renderer components. A `getToolRenderer(toolName)` function SHALL return the specialized renderer for known tools or fall back to `GenericToolRenderer` for unrecognized tools.

Built-in renderers:
- `read` → `ReadToolRenderer`
- `edit` → `EditToolRenderer`
- `write` → `WriteToolRenderer`
- `bash` → `BashToolRenderer`
- All others → `GenericToolRenderer`

#### Scenario: Known tool renders with specialized view
- **WHEN** a tool call for "read" is displayed
- **THEN** the `ReadToolRenderer` SHALL be used

#### Scenario: Unknown tool uses generic renderer
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

#### Scenario: DiffPanel split toggle still works for change-derived diffs
- **WHEN** the user toggles `DiffPanel`'s mode control from unified to split for a change-derived diff (Edit or Write)
- **THEN** the underlying `<RichDiff>` SHALL re-render with `mode="split"` and the diff SHALL be displayed side-by-side

#### Scenario: DiffPanel preserves toolbar and file header
- **WHEN** `DiffPanel` renders any diff (change-derived OR git-aggregate)
- **THEN** the toolbar, file-path header, view-mode toggle, and expand controls SHALL be visible exactly as before this change

#### Scenario: Git-aggregate diff path remains inline
- **WHEN** `DiffPanel` renders a file whose diff is sourced from `file.gitDiff` (no specific change selected, no change-derived `DiffFile` built)
- **THEN** `<DiffView>` SHALL be rendered inline within `DiffPanel` using the `data` prop — NOT through `<RichDiff>`

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
