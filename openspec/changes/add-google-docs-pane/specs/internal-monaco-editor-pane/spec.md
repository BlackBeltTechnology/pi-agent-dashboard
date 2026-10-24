# Spec Delta — internal-monaco-editor-pane

## MODIFIED Requirements

### Requirement: Shared `fileKind` classifier SHALL be the single source of viewer discrimination

The pure module `packages/shared/src/file-kind.ts` SHALL export `fileKind(absPath: string, sniff?: Buffer | string): { kind, mimeType, viewer, editable }`. Both server (`/api/file`, `/api/file/raw`) and client (`OpenFileButton`, `EditorFileTree`) SHALL use this function — no separate discrimination logic SHALL exist elsewhere.

Deciding whether an open becomes a plugin tab, through an `editor-pane-tab` claim's `fileExtensions` (see `editor-pane-plugin-tabs`), is tab routing, not viewer discrimination. It SHALL run before `fileKind` is consulted, SHALL use the same extension normalization, and SHALL NOT change `fileKind`'s output. A file that is not redirected SHALL be classified by `fileKind` alone.

The function SHALL be pure: same inputs always produce the same output; no I/O. Sniff is optional; when absent the function SHALL classify by extension only. The office/asciidoc/email kinds SHALL classify by extension only and SHALL NOT depend on `sniff`.

The `viewer` field SHALL take a value in the `ViewerKind` union including `docx`, `pptx`, `spreadsheet`, `asciidoc`, and `email`. The `editable` field SHALL be `true` for `.md`/`.mdx` and for `.csv` (spreadsheet source is editable as text); it SHALL be `false` for all other kinds, including `.xlsx`/`.xls`, `.docx`, `.pptx`, `.adoc`, and `.eml`.

#### Scenario: Office extensions classify identically on both ends

- **GIVEN** the path `/abs/cwd/report.docx`
- **WHEN** both server and client invoke `fileKind` with that path
- **THEN** both return `{ kind: "docx", viewer: "docx", editable: false }` and matching `mimeType`

#### Scenario: `.csv` is an editable spreadsheet, `.xlsx` is not

- **WHEN** `fileKind` classifies `data.csv` and `book.xlsx`
- **THEN** `data.csv` → `{ kind: "spreadsheet", viewer: "spreadsheet", editable: true }`
- **AND** `book.xlsx` → `{ kind: "spreadsheet", viewer: "spreadsheet", editable: false }`

#### Scenario: Extension-only, sniff-independent for rich kinds

- **GIVEN** a `.eml` path with arbitrary `sniff` bytes
- **WHEN** `fileKind` classifies it
- **THEN** the result is `{ kind: "email", viewer: "email", editable: false }` regardless of `sniff`

#### Scenario: Plugin-tab redirect leaves fileKind unchanged

- **GIVEN** an enabled plugin redirects `.gdoc` to its tab
- **WHEN** `fileKind` classifies `notes.gdoc`
- **THEN** the result SHALL be the same as with no plugin enabled, and the redirect SHALL be decided before `fileKind` is consulted
