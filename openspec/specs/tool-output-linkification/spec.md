# tool-output-linkification Specification

## Purpose
TBD - created by archiving change linkify-tool-output. Update Purpose after archive.
## Requirements
### Requirement: URL detection in tool output

The linkifier SHALL detect HTTP and HTTPS URLs inside plain-text tool result strings and render each match as an anchor element. Detected URLs MUST start with `http://` or `https://`. Other URI schemes (including `javascript:`, `data:`, `vbscript:`, `file:`) MUST NOT be linkified.

Each rendered anchor MUST set `target="_blank"` and `rel="noopener noreferrer"`. The detection MUST stop the URL match before terminal punctuation (`.`, `,`, `;`, `:`, `!`, `?`) so that "see https://example.com." links to `https://example.com` and not `https://example.com.`.

#### Scenario: bare https URL in output
- **WHEN** tool output contains `visit https://example.com/foo and stop`
- **THEN** `https://example.com/foo` SHALL render as an anchor with `target="_blank"` and `rel="noopener noreferrer"`
- **AND** the surrounding text "visit " and " and stop" SHALL render as plain text

#### Scenario: URL with trailing punctuation
- **WHEN** tool output contains `see https://example.com/page.`
- **THEN** the anchor `href` SHALL be `https://example.com/page` (no trailing `.`)

#### Scenario: javascript URI rejected
- **WHEN** tool output contains `click javascript:alert(1) now`
- **THEN** no anchor SHALL be rendered for the `javascript:` token
- **AND** the text SHALL render verbatim

#### Scenario: data URI rejected
- **WHEN** tool output contains `data:text/html,<script>`
- **THEN** no anchor SHALL be rendered

### Requirement: File reference detection with line:col suffix

The linkifier SHALL detect file references of the shape `<path>:<line>` or `<path>:<line>:<col>` where `<path>` ends in a generic file extension. A file extension for detection purposes is a dot followed by an alphabetic character and up to 15 further alphanumeric characters (`\.[A-Za-z][A-Za-z0-9]{0,15}`); a fixed allowlist MUST NOT be used. An all-numeric tail (e.g. `.2024`, `.3`) MUST NOT be treated as an extension so that version-like prose does not masquerade as a file.

Each detected match MUST render as a clickable element exposing `path`, `line`, and (when present) `col`.

#### Scenario: grep-style match
- **WHEN** tool output contains `src/foo.ts:42:7: error TS2322`
- **THEN** `src/foo.ts:42:7` SHALL render as a clickable file link with `path="src/foo.ts"`, `line=42`, `col=7`

#### Scenario: line-only match
- **WHEN** tool output contains `at src/bar.js:120`
- **THEN** `src/bar.js:120` SHALL render as a clickable file link with `path="src/bar.js"`, `line=120`, `col` unset

#### Scenario: relative path with parent traversal
- **WHEN** tool output contains `../pkg/baz.tsx:5`
- **THEN** `../pkg/baz.tsx:5` SHALL render as a clickable file link with `path="../pkg/baz.tsx"`, `line=5`

#### Scenario: unlisted text extension with line suffix
- **WHEN** tool output contains `config/app.toml:12`
- **THEN** `config/app.toml:12` SHALL render as a clickable file link with `path="config/app.toml"`, `line=12`

### Requirement: File reference detection by extension

The linkifier SHALL detect bare file paths (no `:line` suffix) when the path ends in a generic file extension (`\.[A-Za-z][A-Za-z0-9]{0,15}`, no fixed allowlist) AND the path contains either a path separator OR a leading `./` / `../` segment. Any text or code extension SHALL be accepted on equal terms; the extension token MUST be captured in full (e.g. `.json` MUST NOT truncate to `.js`). Bare filenames with no separator (e.g. `README.md` or `Node.js` alone in prose) MUST NOT be detected. Tokens whose extension tail is all-numeric (e.g. `v1.2.3`) MUST NOT be detected.

The relative path grammar SHALL admit leading dot-directory segments (e.g. `.pi`, `.github`, `.config`) both as the leading segment when followed by a separator and as any interior segment, and SHALL admit one or more leading `../` parent-traversal segments. A relative path that begins with `..` MUST be detected as a relative file token (marked NOT absolute) and MUST NOT be re-captured as an absolute path by an interior `/`.

#### Scenario: relative path with separator
- **WHEN** tool output contains `wrote packages/client/src/foo.ts`
- **THEN** `packages/client/src/foo.ts` SHALL render as a clickable file link

#### Scenario: leading dot-slash
- **WHEN** tool output contains `./bar.tsx`
- **THEN** `./bar.tsx` SHALL render as a clickable file link

#### Scenario: json extension not truncated
- **WHEN** tool output contains `.pi/settings.json`
- **THEN** `.pi/settings.json` SHALL render as a single clickable file link with `path=".pi/settings.json"`
- **AND** no trailing `on` text token SHALL remain
- **AND** the leading `.` SHALL be part of the link

#### Scenario: leading dot-directory
- **WHEN** tool output contains `.github/workflows/ci.yml`
- **THEN** `.github/workflows/ci.yml` SHALL render as a clickable file link with `path=".github/workflows/ci.yml"` marked NOT absolute

#### Scenario: interior dot-directory
- **WHEN** tool output contains `a/.config/b.ts`
- **THEN** `a/.config/b.ts` SHALL render as a single clickable file link with `path="a/.config/b.ts"` marked NOT absolute
- **AND** no absolute link SHALL be rendered for `/.config/b.ts`

#### Scenario: multi-level parent traversal
- **WHEN** tool output contains `../../packages/server/src/cli.ts`
- **THEN** `../../packages/server/src/cli.ts` SHALL render as a single clickable file link with `path="../../packages/server/src/cli.ts"` marked NOT absolute
- **AND** the leading `..` SHALL NOT be dropped
- **AND** no absolute link SHALL be rendered for the interior `/...` tail

#### Scenario: unlisted text extension with separator
- **WHEN** tool output contains `wrote scripts/setup.lua and config/db.sql`
- **THEN** `scripts/setup.lua` SHALL render as a clickable file link with `path="scripts/setup.lua"`
- **AND** `config/db.sql` SHALL render as a clickable file link with `path="config/db.sql"`

#### Scenario: version string not detected
- **WHEN** tool output contains `installed v1.2.3 of foo`
- **THEN** no file link SHALL be rendered

#### Scenario: bare filename in prose not detected
- **WHEN** tool output contains `the Node.js runtime and README.md docs`
- **THEN** no file link SHALL be rendered for `Node.js` or `README.md`

#### Scenario: prose noise not detected
- **WHEN** tool output contains `decide and/or skip`
- **THEN** no file link SHALL be rendered for `and/or`

### Requirement: Token precedence and non-overlap

When multiple patterns match overlapping ranges of the same input, the linkifier MUST pick exactly one match for each character span using this precedence: URL > path-with-line(-col) > path-with-extension. The output token stream MUST cover the input verbatim with no character duplicated or dropped.

#### Scenario: URL containing path-shaped tail
- **WHEN** tool output contains `https://example.com/src/foo.ts`
- **THEN** the entire URL SHALL render as a single anchor
- **AND** no separate file link SHALL be rendered for the `src/foo.ts` substring

#### Scenario: path with line beats bare path
- **WHEN** tool output contains `src/foo.ts:42`
- **THEN** exactly one link SHALL render, with `line=42`
- **AND** no second link SHALL render for `src/foo.ts` alone

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

### Requirement: Click routing — remote/mobile preview fallback

When `isLocalhost()` returns false OR `ToolContext.editors` is empty, clicking a file link SHALL open an in-dashboard preview overlay instead of calling `/api/open-editor`. The overlay MUST route by file extension: `.md` / `.mdx` → MarkdownPreviewView, image extensions → ImageLightbox, anything else → read-only plain-text view. The overlay MUST be dismissible and MUST NOT mutate the file.

#### Scenario: remote click
- **GIVEN** the dashboard is loaded from `https://dashboard.example.com` (non-localhost)
- **WHEN** the user clicks a file link
- **THEN** an overlay SHALL open
- **AND** no `POST /api/open-editor` request SHALL be made

#### Scenario: localhost without detected editor
- **GIVEN** `isLocalhost()` returns true but `ToolContext.editors` is empty
- **WHEN** the user clicks a file link
- **THEN** an overlay SHALL open

### Requirement: Tokenizer performance and overflow cap

Tokenization MUST run as a single linear pass. The result of tokenising a given result string MUST be memoised per render so a re-render that reuses the same string does not re-tokenise. If the number of detected matches exceeds 5000, the linkifier SHALL render the first 5000 as links and the remainder of the input as plain text, with a trailing indicator `+N more links suppressed` where N is the count of suppressed matches.

#### Scenario: large output with many matches
- **WHEN** a tool result contains 6000 grep-style match lines
- **THEN** exactly 5000 file links SHALL render
- **AND** a `+1000 more links suppressed` indicator SHALL render at the end

### Requirement: Selection and copy preservation

Linkified spans MUST preserve native text selection across token boundaries, including selections that start on, end on, or pass over a link element. Link elements MUST NOT intercept the drag-to-select gesture: file links MUST set `user-select: text` and MUST NOT be draggable; URL links MUST NOT be draggable. A click-drag that begins on or crosses a link SHALL extend the text selection rather than initiating a native link-drag or a button press. Selecting a range that includes a link MUST yield the original verbatim text on copy (no inserted prefixes, no missing characters, no zero-width characters introduced by the renderer). Click-to-open behavior is unchanged: a plain click (no drag) on a link SHALL still open the file or URL; a drag that produces a text selection SHALL suppress the open.

#### Scenario: copy across link boundary
- **GIVEN** tool output `error in src/foo.ts:42 line`
- **WHEN** the user selects from `error` through `line` and copies
- **THEN** the clipboard SHALL contain the verbatim string `error in src/foo.ts:42 line`

#### Scenario: drag-select starting on a file link
- **GIVEN** a rendered file link for `src/foo.ts`
- **WHEN** the user presses the mouse on the link text and drags across it
- **THEN** the link text SHALL be highlighted as a text selection
- **AND** the file SHALL NOT open
- **AND** copying SHALL place `src/foo.ts` on the clipboard

#### Scenario: drag-select crossing a URL link
- **GIVEN** a rendered URL link for `https://example.com`
- **WHEN** the user drags a selection from surrounding text across the URL link
- **THEN** the selection SHALL extend through the URL text rather than starting a native link-drag
- **AND** the URL SHALL NOT open in a new tab

#### Scenario: plain click still opens
- **GIVEN** a rendered file link or URL link
- **WHEN** the user clicks the link without dragging
- **THEN** the link SHALL open (editor/preview for files, new tab for URLs) exactly as before

### Requirement: Tokenizer fault isolation

If tokenisation throws for any reason, the renderer MUST fall back to rendering the original result string as plain text inside a `<pre>` element. The error MUST NOT propagate to the surrounding chat view. An ErrorBoundary surrounding the linkified renderer is the required mechanism.

#### Scenario: tokenizer throws
- **GIVEN** a result string that triggers an unexpected tokenizer error
- **WHEN** the tool result renders
- **THEN** the original text SHALL render verbatim as plain text
- **AND** no React error boundary message SHALL surface to the chat view above

