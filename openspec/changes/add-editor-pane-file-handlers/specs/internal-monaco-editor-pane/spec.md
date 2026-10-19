## MODIFIED Requirements

### Requirement: Pane SHALL dispatch viewers via a kind-based registry

The pane SHALL dispatch the active tab to a viewer via a kind-based registry. The registry SHALL cover: `monaco` (text/code), `markdown`, `image`, `pdf`, `html`, `video`, `audio`, `mermaid`, `docx`, `pptx`, `spreadsheet`, `asciidoc`, `email`, and `binary-warn`. Where a shared `preview/*` renderer exists for a kind, the registry entry SHALL delegate to it rather than a pane-local duplicate:

- `pdf` → `PdfPreview`; `html` → `HtmlPreview` (sandboxed, scripts disabled);
  `image` → `ImagePreview`; `video` → `VideoPreview`; `audio` → `AudioPreview`;
  `mermaid` → `MermaidBlock`.
- `docx` → `DocxPreview`; `pptx` → `PptxPreview`; `spreadsheet` →
  `SpreadsheetPreview`; `asciidoc` → `AsciiDocPreview`; `email` → `EmlPreview`.
  Each reuses the existing shared renderer with its established sandbox /
  remote-content posture; no new preview logic and no new bytes path.

`fileKind` SHALL classify `.html`/`.htm` → html, `.mmd`/`.mermaid` → mermaid, `.mp3`/`.wav`/`.ogg`/`.m4a`/`.flac` → audio, `.webm`/`.mov` → video, `.docx` → docx, `.pptx` → pptx, `.xlsx`/`.xls`/`.csv` → spreadsheet, `.adoc`/`.asciidoc` → asciidoc, and `.eml` → email. The `line` scroll target SHALL be passed only to the `monaco` viewer.

The registry governs the tab's built-in view. When a plugin file-handler mode is selected for a tab, the handler renders instead and the tab's registry viewer SHALL NOT be mounted, so it fetches nothing.

#### Scenario: Office and email kinds dispatch to shared renderers

- **WHEN** the user opens `.docx`, `.pptx`, `.xlsx`, `.adoc`, or `.eml` tabs
- **THEN** they render `DocxPreview`, `PptxPreview`, `SpreadsheetPreview`, `AsciiDocPreview`, and `EmlPreview` respectively
- **AND** none renders as raw text in Monaco

#### Scenario: PDF renders via pdfjs, not a native plugin

- **GIVEN** the pane runs inside the Electron shell (no PDF plugin)
- **WHEN** the user opens a `.pdf` tab
- **THEN** the tab renders `PdfPreview` as a continuous-scroll pdfjs viewer (text-selectable, find-capable), not a Prev/Next paged canvas

#### Scenario: Handler mode replaces the registry viewer

- **GIVEN** an enabled plugin claims `.docx` and `report.docx` is open
- **WHEN** the user selects the plugin's mode
- **THEN** `DocxPreview` is not mounted and no preview request for `report.docx` is made

### Requirement: Pane SHALL be read-only in v1

The Monaco editor SHALL be configured with `readOnly: true`. The pane SHALL display no save button, no dirty indicator, and no "+" affordance for creating new files in v1, except within the Preview/Edit tabs and plugin file-handler modes described below.

The shared `fileKind` classifier SHALL return `editable: false` for every file EXCEPT the editable text kinds — the writable markdown subset (`.md`/`.mdx`), `.csv`, and AsciiDoc (`.adoc`/`.asciidoc`) — which return `editable: true`.

Only these expose a save path:
- the Preview/Edit tabs of the editable text kinds (see "Markdown tabs SHALL offer a Preview/Edit toggle");
- edit modes contributed by enabled file-handler plugins (see the `editor-pane-file-handlers` capability), which save only through the core handler save path.

All other viewers (Monaco text/code, media, pdf, html, every built-in preview) remain read-only.

When the agent edits a file that the user has open, the pane SHALL NOT auto-refresh. A manual refresh button in the pane header SHALL re-fetch the active file's content from `/api/file`. On a tab showing a plugin file-handler mode, manual refresh SHALL instead reload the handler from a fresh read of the file, asking for confirmation first when the handler has unsaved edits or an unknown saved state. (Auto-refresh on agent edits is deferred to v4.)

#### Scenario: Read-only editor rejects keystrokes
- **GIVEN** the pane has `foo.ts` open in a Monaco tab
- **WHEN** the user types into the editor area
- **THEN** the buffer content is unchanged
- **AND** no `POST /api/file/write` request is issued

#### Scenario: Manual refresh re-fetches active file
- **GIVEN** `foo.ts` is open in the pane
- **AND** the agent has just written new content to `foo.ts` via the Edit tool
- **WHEN** the user clicks the refresh button in the pane header
- **THEN** the pane issues `GET /api/file?cwd=<cwd>&path=foo.ts`
- **AND** the Monaco buffer updates to the new content
- **AND** the refresh is performed without closing or reopening the tab

#### Scenario: Manual refresh on a handler tab with unsaved edits
- **GIVEN** `report.docx` is open in a plugin edit mode holding unsaved edits
- **WHEN** the user clicks the refresh button
- **THEN** a confirmation is shown, and only after confirming does the handler reload from the file on disk

#### Scenario: Built-in Office preview stays read-only
- **GIVEN** `report.docx` is open in its built-in preview
- **THEN** no save button or dirty indicator is shown

### Requirement: Markdown tabs SHALL offer a Preview/Edit toggle

An `editable` tab SHALL offer a per-tab **Preview / Edit** toggle.

| Kind | Preview | Edit |
|---|---|---|
| `.md`/`.mdx` | rendered markdown | the controlled `MarkdownEditor` |
| `.csv` | `SpreadsheetPreview` | a plain Monaco text buffer over the raw file text |
| AsciiDoc (`.adoc`/`.asciidoc`) | `AsciiDocPreview` | a plain Monaco text buffer over the raw file text |

The tab body below the toggle toolbar SHALL be the scroll container, since the editor pane supplies none. Saving SHALL `POST /api/file/write` with the buffer's loaded `mtime`; a `409` (changed on disk) SHALL surface the existing changed-on-disk banner and leave the file untouched.

Non-editable kinds (`.markdown`, `.xlsx`, `.docx`, `.eml`, …) SHALL have no built-in Edit affordance. Any edit mode they show SHALL come from an enabled file-handler plugin claim.

#### Scenario: Edit and save a markdown file

- **GIVEN** a `.md` file open in Preview mode
- **WHEN** the user switches to Edit, changes text, and clicks Save
- **THEN** the client POSTs `/api/file/write` with the loaded `mtime` and the dirty indicator clears on success

#### Scenario: CSV offers a spreadsheet Preview and a Monaco Edit

- **GIVEN** a `.csv` file open in the pane
- **WHEN** the tab renders
- **THEN** Preview shows the `SpreadsheetPreview` grid and an Edit toggle is available
- **WHEN** the user switches to Edit
- **THEN** a Monaco text buffer over the raw CSV is mounted, saved via `/api/file/write` with `mtime`

#### Scenario: AsciiDoc offers a rendered Preview and a Monaco Edit

- **GIVEN** an `.adoc` file open in the pane
- **WHEN** the tab renders
- **THEN** Preview shows the rendered AsciiDoc inside a scrollable body and an Edit toggle is available
- **WHEN** the user switches to Edit, changes text, and clicks Save
- **THEN** the raw source is saved via `/api/file/write` with `mtime`, and returning to Preview re-renders the saved file

#### Scenario: Non-editable kinds have no Edit affordance

- **WHEN** the user opens a `.xlsx`, `.docx`, or `.eml` file and no enabled plugin claims its extension
- **THEN** only Preview is available (no Edit toggle)
