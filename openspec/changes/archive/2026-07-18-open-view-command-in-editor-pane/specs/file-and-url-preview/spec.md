# file-and-url-preview — delta

## RENAMED Requirements

- FROM: `### Requirement: Inline + overlay surfaces share renderers`
- TO: `### Requirement: Overlay and editor-pane surfaces share renderers`

## MODIFIED Requirements

### Requirement: ViewTarget discriminated union

The dashboard SHALL define a `ViewTarget` discriminated union in `packages/shared/src/types.ts` with exactly two variants: `{ kind: "file"; cwd: string; path: string }` and `{ kind: "url"; url: string }`. The `/view` composer command SHALL parse `@<relPath>` into a file target and `http(s)://…` into a URL target, then route that target to the internal editor pane (see `internal-monaco-editor-pane` → "`/view` opens its target in the editor pane"). `ChatMessage` SHALL NOT carry a `view?` field; `/view` no longer injects an inline preview row into the chat transcript.

#### Scenario: File target shape

- **GIVEN** the user runs `/view @docs/foo.md` while in a session with `cwd = "/home/u/proj"`
- **WHEN** the composer constructs a `ViewTarget`
- **THEN** the result is `{ kind: "file", cwd: "/home/u/proj", path: "docs/foo.md" }`

#### Scenario: URL target shape

- **GIVEN** the user runs `/view https://youtu.be/abc123`
- **WHEN** the composer constructs a `ViewTarget`
- **THEN** the result is `{ kind: "url", url: "https://youtu.be/abc123" }`

#### Scenario: No inline view row

- **GIVEN** the user runs `/view @docs/foo.md`
- **WHEN** the command is handled
- **THEN** no `ChatMessage` with a `view` field is produced and the chat transcript gains no inline `PreviewCard`
- **AND** the target opens in the editor pane instead

#### Scenario: Legacy `view` field is inert on replay

- **GIVEN** an OLD persisted session whose messages were serialized with a `view` field
- **WHEN** that session is reduced/replayed by code that includes this change
- **THEN** the `view` field is silently ignored (dropped) — no error is thrown, no inline `PreviewCard` renders
- **AND** every other field on the message remains intact

### Requirement: Overlay and editor-pane surfaces share renderers

Every renderer (`MarkdownPreview`, `AsciiDocPreview`, `HtmlPreview`, `PdfPreview`, `VideoPreview`, `ImagePreview`, `YouTubePreview`, `DocxPreview`, `PptxPreview`, `SpreadsheetPreview`, `EmlPreview`, `FallbackPreview`) SHALL be usable in two contexts: the full-screen `/pi-view` / `…/view` overlay route (FileLink / OpenFileButton / canvas) and the internal editor pane (`viewer-registry` + `UrlViewer`). The renderer component SHALL NOT contain navigation or surface chrome; the shell is owned by the overlay route component or the editor-pane viewer wrapper. There is no longer an in-chat `PreviewCard` surface.

#### Scenario: Same component, two shells

- **GIVEN** a `.pdf` target opens in the editor pane via `/view`
- **WHEN** the same file is opened through a FileLink overlay
- **THEN** both mount the SAME `PdfPreview` component with the same `target` prop (no separate variant component)

## REMOVED Requirements

### Requirement: Inline size caps prevent runaway height

**Reason:** The in-chat `PreviewCard` surface is retired — `/view` now opens its target in the resizable editor pane, which owns its own sizing. The size-cap policy (`max-h-[60vh]`, `h-[60vh]`, image `max-h-[40vh]`, etc.) no longer applies because no renderer mounts inline in the message stream.

**Migration:** None. `/view` targets open in the editor pane; the overlay route remains full-screen. No serialized data carried these caps.
