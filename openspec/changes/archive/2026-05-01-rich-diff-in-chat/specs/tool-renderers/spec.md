## MODIFIED Requirements

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

## ADDED Requirements

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
