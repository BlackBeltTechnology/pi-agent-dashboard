## ADDED Requirements

### Requirement: Absolute and file:// file reference detection

The linkifier SHALL detect absolute file references and render them as clickable file links whose stored path retains its root (no leading-segment stripping). Three forms MUST be recognised when the path ends in a recognised extension (optionally followed by a `:line` or `:line:col` suffix):

- POSIX absolute paths beginning with `/` (e.g. `/Users/me/app.ts`).
- `file://` and `file:///` URIs (e.g. `file:///Users/me/app.ts`), whose path payload SHALL be decoded to a native absolute path (percent-decoding applied) and the `file://` scheme removed before the token is emitted.
- Windows drive-absolute paths (e.g. `C:\src\app.ts` or `C:/src/app.ts`).

Each absolute file token MUST be marked absolute so downstream resolution skips the cwd join. The `file:` scheme MUST still be rejected for URL (anchor) detection; only its file-path payload is captured as a file token.

#### Scenario: bare absolute POSIX path
- **WHEN** tool output contains `see /Users/me/app.ts for details`
- **THEN** `/Users/me/app.ts` SHALL render as a clickable file link with `path="/Users/me/app.ts"` marked absolute
- **AND** the leading `/` SHALL be part of the link, not stripped into preceding text

#### Scenario: file URI decoded to native path
- **WHEN** tool output contains `file:///Users/me/my%20app.ts`
- **THEN** a clickable file link SHALL render with `path="/Users/me/my app.ts"` marked absolute
- **AND** no anchor (URL) element SHALL be rendered for the `file://` token

#### Scenario: absolute path with line:col
- **WHEN** tool output contains `/Users/me/app.ts:42:7: error`
- **THEN** a clickable file link SHALL render with `path="/Users/me/app.ts"`, `line=42`, `col=7`, marked absolute

#### Scenario: Windows drive path
- **WHEN** tool output contains `C:\src\app.ts:10`
- **THEN** a clickable file link SHALL render with `path="C:\src\app.ts"`, `line=10`, marked absolute
- **AND** the drive-letter colon SHALL NOT be parsed as a line separator

### Requirement: Prose and inline-code linkification

The linkifier SHALL apply to assistant message prose (paragraph text, list items) and inline `code` spans rendered by `MarkdownContent`, turning detected file references and URLs into clickable elements using the same tokenizer and click-routing as tool output. Fenced/multi-line code blocks (`pre > code`) MUST NOT be linkified. Real markdown link anchors MUST NOT be double-wrapped.

#### Scenario: path inside inline code span
- **WHEN** an assistant message contains `` see `packages/client/src/FileLink.tsx` `` 
- **THEN** `packages/client/src/FileLink.tsx` SHALL render as a clickable file link

#### Scenario: absolute path in prose text
- **WHEN** an assistant message paragraph contains `wrote /Users/me/app.ts`
- **THEN** `/Users/me/app.ts` SHALL render as a clickable file link

#### Scenario: fenced code block not linkified
- **WHEN** an assistant message contains a fenced ```` ```ts ```` block whose body includes `src/foo.ts`
- **THEN** no file link SHALL be rendered inside the fenced block
- **AND** syntax highlighting SHALL render unchanged

### Requirement: Syntax highlighting in preview overlay

The in-dashboard preview overlay (`FilePreviewOverlay`) SHALL syntax-highlight code files using the same highlighter, language detection, and theme as the Read tool renderer. The line-number gutter and scroll-to-`line` behavior MUST be preserved. Markdown files continue to render via `MarkdownContent`; images continue to render inline. A file whose extension has no detected language SHALL fall back to plain line-numbered text (no regression).

#### Scenario: code file is highlighted
- **WHEN** the preview overlay opens for `src/foo.ts`
- **THEN** the content SHALL render with TypeScript syntax highlighting
- **AND** a line-number gutter SHALL be present
- **AND** if a target line was given, the view SHALL scroll to it

#### Scenario: unknown extension falls back to plain text
- **WHEN** the preview overlay opens for a file with no detected language
- **THEN** the content SHALL render as plain line-numbered text without error

## MODIFIED Requirements

### Requirement: Click routing — localhost editor

When the dashboard is running on localhost AND at least one editor is detected in `ToolContext.editors`, clicking a file link SHALL invoke the existing `openEditor(cwd, editors[0].id, path, line)` call. The `cwd` MUST come from `ToolContext.cwd`. Relative paths MUST be resolved against `cwd` at click time. Absolute paths (POSIX `/`, decoded `file://`, Windows drive) MUST be passed through unchanged and MUST NOT be re-rooted under `cwd`.

#### Scenario: localhost with editor
- **GIVEN** the dashboard is loaded from `http://localhost:8000` and `ToolContext.editors = [{id:"code", name:"VS Code"}]`
- **WHEN** the user clicks a file link with `path="src/foo.ts"` and `line=42`
- **THEN** the client SHALL `POST /api/open-editor` with body containing `editor: "code"`, `file: "src/foo.ts"`, `line: 42`, and `path` set to the session cwd

#### Scenario: localhost editor with absolute path
- **GIVEN** the dashboard is loaded from `http://localhost:8000` with a detected editor
- **WHEN** the user clicks a file link with absolute `path="/Users/me/app.ts"`
- **THEN** the open-editor request SHALL target `/Users/me/app.ts` verbatim
- **AND** the path SHALL NOT be joined to the session cwd
