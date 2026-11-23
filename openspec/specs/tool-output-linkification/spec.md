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

When the dashboard is running on localhost AND at least one editor is detected in `ToolContext.editors`, clicking a file link SHALL invoke the existing `openEditor(cwd, editors[0].id, path, line)` call. The `cwd` MUST come from `ToolContext.cwd`. Relative paths MUST be resolved against `cwd` at click time. Absolute paths (POSIX `/`, decoded `file://`, Windows drive) MUST be passed through unchanged and MUST NOT be re-rooted under `cwd`, EXCEPT when the worktree link-origin re-rooting applies (session `cwd` is a `<parentRoot>/.worktrees/<slug>` worktree and the absolute path is rooted under `<parentRoot>`): in that case the path SHALL be re-rooted onto the worktree before the open-editor request, per the "Worktree link-origin re-rooting" requirement.

#### Scenario: localhost with editor
- **GIVEN** the dashboard is loaded from `http://localhost:8000` and `ToolContext.editors = [{id:"code", name:"VS Code"}]`
- **WHEN** the user clicks a file link with `path="src/foo.ts"` and `line=42`
- **THEN** the client SHALL `POST /api/open-editor` with body containing `editor: "code"`, `file: "src/foo.ts"`, `line: 42`, and `path` set to the session cwd

#### Scenario: localhost editor with foreign absolute path
- **GIVEN** the dashboard is loaded from `http://localhost:8000` with a detected editor
- **WHEN** the user clicks a file link with absolute `path="/Users/me/app.ts"` not under the session worktree's parent root
- **THEN** the open-editor request SHALL target `/Users/me/app.ts` verbatim
- **AND** the path SHALL NOT be joined to the session cwd

#### Scenario: localhost editor with parent-rooted absolute path in a worktree
- **GIVEN** the dashboard is on localhost with a detected editor and session `cwd` is `/repo/.worktrees/x`
- **WHEN** the user clicks a file link with absolute `path="/repo/vitest.config.ts"`
- **THEN** the open-editor request SHALL target `/repo/.worktrees/x/vitest.config.ts`

### Requirement: Click routing — remote/mobile preview fallback

When the editor pane is NOT available for the link's session (no split workspace or no session id), clicking a file link SHALL open an in-dashboard preview overlay instead of calling `/api/open-editor`; when it is available, the link opens the editor pane (see "File links open in the editor pane"). The overlay MUST route by file extension: `.md` / `.mdx` → MarkdownPreviewView, image extensions → ImageLightbox, anything else → read-only plain-text view. The overlay MUST be dismissible and MUST NOT mutate the file.

#### Scenario: remote click
- **GIVEN** the dashboard is loaded from `https://dashboard.example.com` (non-localhost) and the link has no session id
- **WHEN** the user clicks a file link
- **THEN** an overlay SHALL open
- **AND** no `POST /api/open-editor` request SHALL be made

#### Scenario: localhost without detected editor
- **GIVEN** `isLocalhost()` returns true, `ToolContext.editors` is empty and the link has no session id
- **WHEN** the user clicks a file link
- **THEN** an overlay SHALL open

### Requirement: Tokenizer performance and overflow cap

Tokenization MUST run as a single linear pass. The result of tokenising a given result string MUST be memoised per render so a re-render that reuses the same string does not re-tokenise. If the number of detected matches exceeds 5000, the linkifier SHALL render the first 5000 as links and the remainder of the input as plain text, with a trailing indicator `+N more links suppressed` where N is the count of suppressed matches.

#### Scenario: large output with many matches
- **WHEN** a tool result contains 6000 grep-style match lines
- **THEN** exactly 5000 file links SHALL render
- **AND** a `+1000 more links suppressed` indicator SHALL render at the end

### Requirement: Selection and copy preservation

Linkified spans MUST preserve native text selection across token boundaries, including selections that start on, end on, or pass over a link element. Link elements MUST NOT intercept the drag-to-select gesture: file links MUST set `user-select: text` and MUST NOT be draggable; URL links MUST NOT be draggable. A click-drag that begins on or crosses a link SHALL extend the text selection rather than initiating a native link-drag or a button press. Selecting a range that includes a link MUST yield the original verbatim text on copy (no inserted prefixes, no missing characters, no zero-width characters introduced by the renderer); link icons and menu controls contribute no text, and a shortened URL label copies as its original URL. Click-to-open behavior: a plain click (no drag) on a link SHALL still open the file or URL; a drag that produces a text selection SHALL suppress the open.

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
- **THEN** the link SHALL open: files per file-link routing; URLs in a web tab when the link is in the transcript of the session the editor pane belongs to, otherwise in a new browser tab

#### Scenario: shortened label copies the original URL
- **GIVEN** tool output `see https://github.com/org/repo/pull/123 now`, rendered with the label `org/repo#123`
- **WHEN** the user selects the whole line and copies
- **THEN** the clipboard SHALL contain `see https://github.com/org/repo/pull/123 now`

### Requirement: Tokenizer fault isolation

If tokenisation throws for any reason, the renderer MUST fall back to rendering the original result string as plain text inside a `<pre>` element. The error MUST NOT propagate to the surrounding chat view. An ErrorBoundary surrounding the linkified renderer is the required mechanism.

#### Scenario: tokenizer throws
- **GIVEN** a result string that triggers an unexpected tokenizer error
- **WHEN** the tool result renders
- **THEN** the original text SHALL render verbatim as plain text
- **AND** no React error boundary message SHALL surface to the chat view above

### Requirement: Worktree link-origin re-rooting

The link resolution SHALL re-root an **absolute** file-link token whose path is rooted in the parent checkout onto the worktree's own tree when the session `cwd` is a dashboard worktree (`<parentRoot>/.worktrees/<slug>`). The re-root SHALL apply before the path is used for the tooltip, the preview overlay target, and the open-in-editor target, and SHALL replace the leading `<parentRoot>` segment of the path with the session `cwd` (the worktree root). When a link is opened, the re-rooted worktree path SHALL be used only if the server resolves it to an existing file; otherwise the original parent-checkout path SHALL open (existence is probed with the existing resolve call; a failed probe request is not "absent").

`<parentRoot>` SHALL be derived from `cwd` alone by stripping a trailing
`/.worktrees/<slug>` (or `\.worktrees\<slug>` on Windows) segment — a pure string
operation, no server round-trip and no git invocation. Separator style and
drive-letter case SHALL be normalized before the prefix compare so a forward-slash
path and a native-separator cwd still match on Windows.

Re-rooting SHALL apply ONLY when all hold; otherwise the path SHALL pass through
unchanged (fail-open, never widening the target set beyond today's behavior):

- the token is absolute, AND
- `cwd` matches the `<parentRoot>/.worktrees/<slug>` shape, AND
- the absolute path is under `<parentRoot>` but NOT already under `cwd`.

Relative tokens SHALL continue to resolve against `cwd` unchanged.

#### Scenario: parent-rooted absolute path re-rooted to the worktree
- **GIVEN** session `cwd` is `/repo/.worktrees/x` and `/repo/.worktrees/x/node_modules/vitest/package.json` exists
- **WHEN** an absolute token `path="/repo/node_modules/vitest/package.json"` is clicked
- **THEN** the resolved/opened target SHALL be `/repo/.worktrees/x/node_modules/vitest/package.json`
- **AND** the tooltip SHALL show the worktree-rooted path

#### Scenario: path already under the worktree is unchanged
- **GIVEN** session `cwd` is `/repo/.worktrees/x`
- **WHEN** an absolute token `path="/repo/.worktrees/x/src/foo.ts"` is clicked
- **THEN** the target SHALL remain `/repo/.worktrees/x/src/foo.ts` (no double-rooting)

#### Scenario: foreign absolute path is unchanged
- **GIVEN** session `cwd` is `/repo/.worktrees/x`
- **WHEN** an absolute token `path="/etc/hosts"` (not under `<parentRoot>`) is clicked
- **THEN** the target SHALL remain `/etc/hosts` verbatim

#### Scenario: non-worktree session is unchanged
- **GIVEN** session `cwd` is `/repo` (no `.worktrees/<slug>` segment)
- **WHEN** an absolute token `path="/repo/node_modules/vitest/package.json"` is clicked
- **THEN** the target SHALL remain `/repo/node_modules/vitest/package.json` verbatim

#### Scenario: re-root applies to the open target, not only the tooltip
- **GIVEN** session `cwd` is `/repo/.worktrees/x` and a localhost editor is detected
- **WHEN** an absolute token `path="/repo/node_modules/vitest/package.json"` is clicked
- **THEN** the `POST /api/open-editor` request SHALL target `/repo/.worktrees/x/node_modules/vitest/package.json`

#### Scenario: relative token still resolves against cwd
- **GIVEN** session `cwd` is `/repo/.worktrees/x`
- **WHEN** a relative token `path="node_modules/vitest/package.json"` is clicked
- **THEN** the target SHALL resolve to `/repo/.worktrees/x/node_modules/vitest/package.json` as today

#### Scenario: no worktree copy falls back to the parent path
- **GIVEN** session `cwd` is `/repo/.worktrees/x` and the worktree has no `node_modules/vitest/package.json` while `/repo/node_modules/vitest/package.json` exists
- **WHEN** an absolute token `path="/repo/node_modules/vitest/package.json"` is clicked
- **THEN** the re-rooted candidate SHALL resolve `null` and the target SHALL be the parent path `/repo/node_modules/vitest/package.json`, not a not-found

#### Scenario: a failed probe is not treated as absent
- **GIVEN** the same session and token and the resolve request for the re-rooted candidate fails (network error or 5xx)
- **WHEN** the link is clicked
- **THEN** the client SHALL take the offline fallback and SHALL NOT open the parent path as though the worktree copy were absent

### Requirement: Preview overlay persists across message re-renders

The in-dashboard file preview overlay (`FilePreviewOverlay`) SHALL remain open
across chat message updates until the user explicitly dismisses it (Esc,
backdrop click, or close button) or leaves the chat view. The overlay's
open-state SHALL be owned by a provider mounted **above** the chat message list
(`FilePreviewProvider` at `ChatView` scope), not by the leaf `FileLink`. A
`FileLink` click SHALL dispatch an open request to that provider rather than
holding its own preview state. At most one preview overlay SHALL be rendered at
a time.

#### Scenario: New message does not close an open preview

- **GIVEN** a file link in chat is clicked and the preview overlay is open
- **WHEN** a new chat message arrives in the same chat view
- **THEN** the preview overlay SHALL remain open and unchanged

#### Scenario: Streaming token does not close an open preview

- **GIVEN** the preview overlay is open for a file referenced in the in-flight
  assistant message
- **WHEN** the assistant message streams additional tokens (re-rendering its
  markdown content)
- **THEN** the preview overlay SHALL remain open

#### Scenario: Streaming-to-committed transition does not close an open preview

- **GIVEN** the preview overlay is open while an assistant message is streaming
- **WHEN** that assistant message completes and transitions from the live
  streaming render to its committed (`key=msg.id`) render
- **THEN** the preview overlay SHALL remain open

#### Scenario: Single overlay instance

- **GIVEN** a preview overlay is open for file A
- **WHEN** the user clicks a different file link B
- **THEN** exactly one overlay SHALL be rendered, now showing file B

#### Scenario: Explicit dismissal still closes

- **GIVEN** the preview overlay is open
- **WHEN** the user presses Esc, clicks the backdrop, or clicks the close button
- **THEN** the preview overlay SHALL close

### Requirement: Loopback URLs in tool output open in the internal split viewer

A URL rendered by `UrlLink` (the anchor used by `LinkifiedText` / `GenericToolRenderer`, including the `serve_mockup` result card) whose origin is loopback (`http(s)://` with hostname in `{localhost, 127.0.0.1, ::1}`, any port) SHALL, on a plain primary-button click (left button, no `meta`/`ctrl`/`shift`/`alt`), open in the internal `live-server` split viewer by opening a `live-server` viewer tab (`path="live:<url>"`) and expanding the split, rather than opening a system-browser tab. The client SHALL call `preventDefault()` for that click and carry the full URL (`pathname` + `search`) to the viewer. This routing MUST use the same shared link-open handler as `MarkdownContent` (no duplicated logic).

Non-loopback URLs — including the LAN URL that `serve_mockup` prints alongside the loopback URL — MUST NOT open the `live-server` viewer; they follow "Web URLs open in the editor pane". Loopback classification MUST use the shared `isLoopbackUrl` helper.

#### Scenario: plain click on a loopback tool-output link opens the split viewer
- **GIVEN** a `serve_mockup` result card rendering `http://localhost:50452/board.html`
- **WHEN** the user left-clicks the loopback link with no modifiers
- **THEN** `preventDefault` SHALL be called
- **AND** the `live-server` split viewer SHALL open carrying `http://localhost:50452/board.html`

#### Scenario: the LAN URL stays a browser link
- **GIVEN** a `serve_mockup` result card that also prints a LAN URL `http://192.168.1.20:50452/board.html`
- **WHEN** the user left-clicks the LAN link
- **THEN** the `live-server` viewer SHALL NOT open
- **AND** the anchor SHALL keep `target="_blank"` (used by modifier-click and on other surfaces), while a plain click on the link in the transcript of the session the editor pane belongs to opens a web tab per "Web URLs open in the editor pane"

#### Scenario: modifier-click on a loopback tool-output link escapes to the browser
- **GIVEN** a tool-output loopback link
- **WHEN** the user clicks it with meta/ctrl held (or middle-clicks)
- **THEN** `preventDefault` SHALL NOT be called and the split viewer SHALL NOT open

#### Scenario: no split-workspace context falls back to the browser
- **GIVEN** `UrlLink` rendered outside a `SplitWorkspaceProvider` (so `useOptionalSplitWorkspace()` returns `null`)
- **WHEN** the user left-clicks a loopback link
- **THEN** the shared handler SHALL be a no-op (no crash, no throw)
- **AND** the native anchor `target="_blank"` SHALL open the URL

### Requirement: Server-side file-mention resolution

_Phase 1._ The server SHALL expose an endpoint that resolves a file mention against the real
filesystem, given a `cwd` and a mention string, returning the resolved absolute
path and resolution kind when it names a real in-scope file, or null otherwise.

The `cwd` parameter is untrusted request input and MUST be rejected (403) unless
it is admitted by the shared cwd admission guard (`core-cwd-admission`: a known folder — session cwd, pinned directory or workspace folder — or a subdirectory / linked worktree whose main checkout is a known folder), and the endpoint MUST run
behind the network guard — this gate MUST run BEFORE any path resolution. Only
after the `cwd` gate: the server SHALL expand a leading `~/` to the user home
directory (`os.homedir()`), attempt the mention as an absolute path, then as a
path relative to `cwd`, and each candidate path MUST pass the anti-traversal
containment gate BEFORE any filesystem stat. Containment SHALL authorize a
resolved path when it is contained by `cwd` (in its request spelling or, when it differs, its canonical real path), the git common root, OR a fixed
server-derived home allowlist rooted at `<os.homedir()>/.pi`; the `~/.pi` anchor
is a server constant and MUST NOT be derived from request input. A leading
`~user/` MUST NOT be expanded. The SAME anchor set (cwd in both spellings + git-root + `~/.pi`)
MUST govern the eventual open/preview route, so a resolve never returns a contained
result for a path the open route would reject; the only result for an uncontained path
is `outside: true` (below), which the open route still gates. A mention that is contained
but does not exist MUST return null (never an error). A mention that FAILS containment
MUST NOT be statted: the endpoint SHALL return `{ resolved, kind, outside: true }` where
`resolved` is the normalized absolute candidate (`~/` expanded, `..` collapsed), which
discloses nothing about whether it exists; the open route's own gate (grants, operator
prompt, 403/404) stays the sole authority for reading it.

A request MAY opt into recovery and MAY carry a producing-tool directory. Only then are the tool-directory candidate ("The producing tool's working directory is tried first") and fuzzy fallback applied, under the same containment gate. A request without the opt-in gets exactly the results described above. Every response SHALL additionally carry `state` (`found`, `recovered`, `ambiguous`, `missing`, `gated`), plus `via` (`tool-dir` or `fuzzy`) and `candidates` (ambiguous only) when recovery applied, while keeping `resolved`, `kind` (`relative` for a tool-directory hit, `fuzzy` for a fuzzy hit) and `outside` with their meaning above.

#### Scenario: untrusted cwd rejected before resolution
- **WHEN** the endpoint receives `{ cwd: "/etc", mention: "passwd" }` and `/etc` is not admitted (not a known folder, nor a subdirectory or linked worktree whose main checkout is a known folder)
- **THEN** the server SHALL respond 403 and MUST NOT stat any path

#### Scenario: tilde home path resolves under home
- **WHEN** a request with a known `cwd` asks to resolve `~/.pi/agent/settings.json` (which exists)
- **THEN** the server SHALL return the resolved path `<os.homedir()>/.pi/agent/settings.json` with kind `tilde`

#### Scenario: relative mention resolves against cwd
- **WHEN** a request with a known `cwd` asks to resolve `packages/server/src/routes/file-routes.ts` and that file exists under `cwd`
- **THEN** the server SHALL return a path rooted at `cwd` with kind `relative`

#### Scenario: nonexistent mention returns null
- **WHEN** a request asks to resolve `foo.ts` with no such file in scope
- **THEN** the server SHALL return null (no error)

#### Scenario: home config file under ~/.pi resolves
- **WHEN** a request with a known `cwd` asks to resolve `~/.pi/dashboard/worktree-init-trust.json` (which exists)
- **THEN** the server SHALL return the resolved path under `<os.homedir()>/.pi` with kind `tilde`

#### Scenario: home file outside ~/.pi rejected
- **WHEN** a request with a known `cwd` asks to resolve `~/Downloads/x.md` (not under cwd, git-root, or `~/.pi`, no grant)
- **THEN** the path SHALL fail containment, no `fs.stat` SHALL run, and the result SHALL be `{ resolved: "<home>/Downloads/x.md", kind: "tilde", outside: true }`
- **AND** the result SHALL be identical whether or not the file exists

#### Scenario: sensitive home path returns outside but is still refused on read
- **WHEN** a request with a known `cwd` asks to resolve `~/.ssh/id_rsa`
- **THEN** the result SHALL be `{ resolved: "<home>/.ssh/id_rsa", kind: "tilde", outside: true }` with no stat
- **AND** opening it SHALL still be refused by the open route's forbidden-subject rule with no grant prompt

#### Scenario: granted outside path resolves as contained
- **GIVEN** a path-anchor grant covering `~/Downloads`
- **WHEN** a request asks to resolve `~/Downloads/x.md` and the file exists
- **THEN** the result SHALL be `{ resolved, kind: "tilde" }` without `outside`

#### Scenario: tilde traversal escape blocked
- **WHEN** a request with a known `cwd` asks to resolve `~/../../etc/passwd`
- **THEN** the server SHALL expand the tilde, collapse `..`, fail containment without a stat, and return `outside: true` with the normalized path
- **AND** reading it through the open route SHALL still be refused by the containment gate

#### Scenario: request without the recovery opt-in
- **WHEN** a client that does not opt into recovery asks to resolve `SplitWorkspaceContext.tsx`, which exists only deeper in the tree
- **THEN** the result SHALL be null exactly as before this change, and no fuzzy search SHALL run

### Requirement: File links resolve lazily on open

_Phase 1._ A detected file mention SHALL render synchronously on the client exactly as
before (no render-time server dependency). Resolution against the filesystem
SHALL occur when the link is opened: on activation the client SHALL request
server resolution for the mention and open the server-resolved path. When the
server returns null (a contained path with no such file) the client SHALL surface a not-found
affordance and MUST NOT open an incorrect path. A result flagged `outside: true` is not
null: the link opens, and a missing outside file is reported by the open route's load error
in the opened tab, not by the not-found affordance (existence is never probed at resolve time).
When the resolution request
itself fails (network error, timeout, 5xx) the client SHALL fall back to its
existing client-side open behavior and MUST NOT treat the failure as a null
result. The server-resolved path SHALL be the authoritative open target. The client MUST NOT alter a path the server resolved, except the worktree probe of "Worktree link-origin re-rooting": it MAY first resolve the re-rooted worktree candidate and open that iff it resolves non-null.

"Exactly as before" refers to the link's text, element and open behaviour; the file-type icon and the pre-confirmed state are additive presentation. A pre-confirmed state ("File links are pre-confirmed in batches once settled and visible") is applied after first paint as a visual hint only. It SHALL NOT replace the click-time resolution: a click always resolves anew, and its result decides what opens.

#### Scenario: click resolves and opens the real path
- **WHEN** the user activates a link for `~/.pi/agent/settings.json` and the server resolves it
- **THEN** the client SHALL open the server-resolved home path, not a filesystem-root path

#### Scenario: click on a nonexistent mention does not open a wrong file
- **WHEN** the user activates a link whose server resolution is null
- **THEN** the client SHALL render an inline not-found affordance on the link (e.g. strikethrough / disabled) and MUST NOT make any open call

#### Scenario: outside and missing opens a tab that shows the load error
- **WHEN** the user activates `~/Downloads/missing.md` (outside the cwd, no such file) and the server returns `outside: true`
- **THEN** the pane tab SHALL open and show the load error after the open route's gate and 404, and the link SHALL NOT render the not-found affordance

#### Scenario: resolution request failure falls back to client behavior
- **WHEN** the resolution request fails with a network error or 5xx
- **THEN** the client SHALL fall back to its existing client-side open path and MUST NOT declare the file absent

#### Scenario: file created after a missing pre-confirmation opens
- **WHEN** a link was pre-confirmed missing and the file has since been created
- **THEN** a click SHALL resolve anew and open the file

### Requirement: Fuzzy fallback resolves only on a unique, on-disk match

When the request opts into recovery and exact resolution (producing-tool directory / absolute / tilde / relative-to-cwd) misses, the server SHALL search the session's tracked files for paths ending with the mention's path on a segment boundary, or, for a bare name, with an equal basename, scoped inside the cwd / git common root. Each candidate SHALL pass containment on its real path before a stat; at most 25 are stat-ed per mention. It SHALL resolve ONLY when exactly one tracked file matches AND a stat confirms it on disk; a tracked path absent on disk MUST return null. With more than one tracked match it MUST NOT auto-select and SHALL return up to 10 on-disk candidates for a picker. Outside a git repository, or when the listing exceeds its limits, fuzzy fallback SHALL be skipped.

#### Scenario: unique on-disk basename resolves
- **WHEN** the mention `monaco-setup.ts` matches exactly one tracked file that exists on disk
- **THEN** the server SHALL resolve the mention to that file

#### Scenario: unique path suffix resolves
- **WHEN** the mention `split/SplitWorkspaceContext.tsx` matches exactly one tracked file by path suffix
- **THEN** the server SHALL resolve the mention to that file

#### Scenario: suffix matches only on a segment boundary
- **WHEN** the mention is `a/b.ts` and the only tracked file is `xa/b.ts`
- **THEN** the server SHALL NOT match it

#### Scenario: unique but deleted-on-disk tracked file returns null
- **WHEN** the mention matches exactly one tracked file that no longer exists on disk
- **THEN** the server SHALL return null (no dead link)

#### Scenario: colliding basename refuses to resolve
- **WHEN** the mention `tasks.md` matches many tracked files
- **THEN** the server SHALL NOT pick any single `tasks.md` and SHALL return at most 10 on-disk candidates instead of a resolution, having stat-ed at most 25 files

#### Scenario: several tracked matches with one on disk still refuse
- **WHEN** the mention matches 3 tracked files and only one of them exists on disk
- **THEN** the server SHALL NOT resolve it and SHALL return that one on-disk path as the only candidate

#### Scenario: several tracked matches with none on disk
- **WHEN** the mention matches 3 tracked files and none exists on disk
- **THEN** the result SHALL be missing

#### Scenario: tracked symlink pointing outside scope
- **WHEN** the only matching tracked file is a symlink whose target lies outside scope
- **THEN** the server SHALL NOT stat the target and SHALL NOT report it as recovered

#### Scenario: fuzzy disabled outside a repo
- **WHEN** the cwd is not inside a git repository
- **THEN** fuzzy fallback SHALL be skipped and resolution SHALL rely on exact matching only

### Requirement: File links open in the editor pane

When a split workspace is live for the link's session, a resolved file link (relative, absolute, `file://`, Windows-drive or `~/`) SHALL open in the editor pane, never in `FilePreviewOverlay`. A path inside the session cwd SHALL open as the cwd-relative tab; one outside it as an absolute-path tab.

#### Scenario: absolute path inside cwd opens the cwd-relative tab
- **GIVEN** a live split for session `s1` with cwd `/work/repo`
- **WHEN** the user clicks a link for `/work/repo/src/a.ts` and the server resolves it
- **THEN** `openInSplit("src/a.ts", line)` SHALL be called and `FilePreviewOverlay` SHALL NOT mount

#### Scenario: tilde path outside cwd opens an absolute tab
- **GIVEN** a live split for session `s1` with cwd `/work/repo`
- **WHEN** the user clicks `~/Downloads/x.md` and the server returns `{ resolved: "/Users/u/Downloads/x.md", outside: true }`
- **THEN** `openInSplit("/Users/u/Downloads/x.md", line)` SHALL be called and the link SHALL NOT be marked not-found

#### Scenario: worktree session parent-checkout link opens the worktree copy when it exists
- **GIVEN** a worktree session with cwd `<parentRoot>/.worktrees/w1`, a link to the absolute `<parentRoot>/src/a.ts` and `src/a.ts` existing in the worktree
- **WHEN** the user clicks it and the server resolves the re-rooted `<parentRoot>/.worktrees/w1/src/a.ts`
- **THEN** the pane SHALL open the cwd-relative tab `src/a.ts` (the worktree copy)

#### Scenario: worktree session link opens the parent file when the worktree has no copy
- **GIVEN** the same session and link, but the re-rooted candidate resolves `null`
- **WHEN** the client then resolves the original path (contained by the git common root, so no `outside`)
- **THEN** the pane SHALL open an absolute-path tab for `<parentRoot>/src/a.ts` and saving it SHALL raise the write prompt (bound-checkout roots do not admit a write)

#### Scenario: Windows drive-letter case does not duplicate the tab
- **GIVEN** a live split with cwd `C:/Work/repo` and the server resolves the link to `c:/Work/repo/a.md` (drive letter lower-case)
- **WHEN** the client normalises the resolved path against the cwd
- **THEN** only the drive letter SHALL be compared case-insensitively and the cwd-relative tab `a.md` SHALL open, not an absolute-path tab; the rest of the path stays case-sensitive

#### Scenario: nonexistent contained path still shows not-found
- **WHEN** the server returns `{ resolved: null }`
- **THEN** the link SHALL render the inline not-found affordance and nothing SHALL open

### Requirement: Pane-first routing takes precedence over the localhost editor call

Whenever a split is live for the link's session, a file link SHALL open the editor pane with the server-resolved path (the worktree probe aside, no client re-root on top, per "File links resolve lazily on open") and SHALL NOT call `openEditor` / `POST /api/open-editor`, regardless of "Click routing — localhost editor".

#### Scenario: live split on localhost with a detected editor still opens the pane
- **GIVEN** `isLocalhost()` is true, `ToolContext.editors` is non-empty and a split is live for the link's session
- **WHEN** the user clicks a file link
- **THEN** the pane SHALL open the file and no `POST /api/open-editor` request SHALL be made

### Requirement: File links without a live split SHALL deep-link before falling back to the overlay

Without a live split for the link's session, a localhost browser with a detected editor SHALL keep today's `openEditor` / `POST /api/open-editor` call (see "Click routing — localhost editor"); the deep link is used only when no editor is detected or the page is not on localhost. In that case a link carrying a session id SHALL navigate to `buildEditorUrl(sessionId, path, line)`; only a link with no session id SHALL keep the preview overlay.

#### Scenario: no live split on localhost with a detected editor keeps the editor call
- **GIVEN** `isLocalhost()` is true, `ToolContext.editors` is non-empty, no split workspace for the session and a link with `sessionId` `s1`
- **WHEN** the user clicks an absolute path link
- **THEN** `openEditor` / `POST /api/open-editor` SHALL be called once, and the client SHALL NOT navigate to `buildEditorUrl` and SHALL NOT mount `FilePreviewOverlay`

#### Scenario: no live split but a session id deep-links
- **GIVEN** no split workspace for the session, no detected editor (or a non-localhost page) and a link with `sessionId` `s1`
- **WHEN** the user clicks an absolute path link
- **THEN** the client SHALL navigate to `buildEditorUrl("s1", <path>, line)`

#### Scenario: no session id keeps the overlay
- **GIVEN** a link rendered with no `sessionId`
- **WHEN** the user clicks it
- **THEN** `FilePreviewOverlay` SHALL open as today

### Requirement: File links carry a file-type icon

Every file link in the dashboard's chat transcript SHALL show, from first paint, the file-type icon the editor pane uses for that extension, with a generic file icon for unknown extensions. File links on other surfaces are unchanged. The icon SHALL occupy a fixed-size slot, SHALL be hidden from assistive technology, and MUST NOT contribute text to a copied selection.

#### Scenario: TypeScript file link
- **WHEN** tool output contains `src/app.ts:12`
- **THEN** the link SHALL show the TypeScript file icon before `src/app.ts:12`

#### Scenario: unknown extension
- **WHEN** tool output contains `build/out.xyz1`
- **THEN** the link SHALL show the generic file icon

#### Scenario: copy excludes the icon
- **WHEN** the user copies a line containing a file link
- **THEN** the clipboard text SHALL equal the original line text

### Requirement: Web links carry a provider icon and label

Every http(s) URL link in the dashboard's chat transcript SHALL show the provider icon from link-provider-recognition, SHALL keep the original URL as its `href` and tooltip, and SHALL show the short label where one exists; copying restores the original URL. A classification failure shows the URL text with the generic icon. URL links on other surfaces are unchanged.

#### Scenario: GitHub issue in tool output
- **WHEN** tool output in the chat transcript contains `https://github.com/org/repo/issues/7`
- **THEN** the link SHALL show the GitHub icon and the label `org/repo#7`

#### Scenario: outside the chat transcript
- **WHEN** the same URL renders in a README dialog or a markdown file preview
- **THEN** it SHALL render exactly as before this change

#### Scenario: unparseable URL
- **WHEN** a detected URL cannot be parsed
- **THEN** it SHALL render with its original text and the generic web icon, and the chat SHALL NOT fail to render

### Requirement: Web URLs open in the editor pane

On a plain primary-button click (no `meta`/`ctrl`/`shift`/`alt`) of a non-loopback http(s) link rendered in the chat transcript of the session the editor pane belongs to, the client SHALL prevent default navigation and open the URL in a web tab of that pane, revealing the pane if it is closed. A second click on the same URL SHALL focus its existing tab. Loopback URLs keep their live-server routing. Links on other surfaces keep opening the browser.

#### Scenario: plain click opens a web tab
- **WHEN** the user left-clicks `https://example.com/docs` in tool output
- **THEN** the editor pane SHALL open a web tab for `https://example.com/docs` and no browser tab SHALL open

#### Scenario: same URL reuses its tab
- **WHEN** the user clicks the same URL twice
- **THEN** exactly one web tab for that URL SHALL exist and it SHALL be active

#### Scenario: modifier or middle click goes to the browser
- **WHEN** the user cmd/ctrl-clicks or middle-clicks `https://example.com/docs`
- **THEN** the click SHALL NOT be intercepted and the native `target="_blank"` SHALL open it

#### Scenario: link outside the session transcript
- **WHEN** the link renders in a README dialog, a markdown file preview or a plugin chat view
- **THEN** a plain click SHALL open the browser as today

### Requirement: HTML file links offer an open-mode menu

In the chat transcript of the session the editor pane belongs to, an `.html`/`.htm` file link SHALL show a menu control offering rendered (scripts on), static (scripts off) and source. A plain click on the link keeps normal file-link routing. The control SHALL be icon-only with an accessible name, not draggable, and add no copied text. Source SHALL open a read-only, syntax-highlighted text tab distinct from the rendered tab.

#### Scenario: plain click unchanged
- **WHEN** the user left-clicks `mockups/board.html` with a split workspace present
- **THEN** it SHALL open exactly as any other file link does under file-link routing

#### Scenario: choose static from the menu
- **WHEN** the user opens the menu and picks the static mode
- **THEN** the page SHALL open served with scripts disabled

#### Scenario: open source
- **WHEN** the user picks source from the menu
- **THEN** a read-only text tab with HTML highlighting SHALL open, and an already-open rendered tab of the same file SHALL stay open

#### Scenario: source tab is not writable
- **WHEN** the source tab of an `.html` file is active
- **THEN** no edit or save control SHALL be offered

#### Scenario: outside the session transcript
- **WHEN** the link renders on any other surface
- **THEN** no menu control SHALL be shown

### Requirement: File links are pre-confirmed in batches once settled and visible

A chat-transcript file link SHALL be pre-confirmed only once its content has settled (no running tool, no streaming text) and it is in view. Links are resolved in batches, one request per flush window per session and never one per link; a link waits at most 1 second. Each link then shows found, recovered, ambiguous, missing or gated. Until a result arrives, or if the request fails, it stays unknown with today's look and click behaviour.

#### Scenario: dead link visible without clicking
- **WHEN** a finalized, visible message mentions `src/missing.ts` that does not exist under the session cwd
- **THEN** the link SHALL render the missing affordance without any click

#### Scenario: no requests while streaming
- **WHEN** a message is still streaming, or its tool call is still running
- **THEN** no batch resolution request SHALL include its mentions

#### Scenario: links in view share one request
- **WHEN** a finalized message whose 40 file mentions are all in view settles
- **THEN** exactly one batch request SHALL carry those mentions

#### Scenario: off-screen links wait
- **WHEN** a long history loads with most links off-screen
- **THEN** only the in-view links SHALL be requested, and the others SHALL be requested when scrolled into view

#### Scenario: batch failure keeps today's behaviour
- **WHEN** the batch request fails with a network error or 5xx, or the server does not provide the batch endpoint
- **THEN** the links SHALL stay unknown and a click SHALL resolve as today

#### Scenario: other surfaces are not pre-confirmed
- **WHEN** file links render in a plugin chat view or a dialog
- **THEN** no batch request SHALL be sent for them and they SHALL behave as today

### Requirement: Pre-confirmation never swaps or reflows links

Applying a pre-confirmation result SHALL change only the state of an already-rendered link: its state attribute, colour, decoration, tooltip and the glyph inside its fixed-size icon slot. It MUST NOT replace the link element, change its text content, or change its box size, and it MUST NOT collapse an active text selection.

#### Scenario: selection survives a result
- **WHEN** the user has a text selection spanning a file link and the batch result arrives
- **THEN** the selection SHALL remain unchanged

#### Scenario: no layout shift
- **WHEN** a link's state changes from unknown to missing
- **THEN** the link's bounding box SHALL be unchanged

### Requirement: Out-of-scope mentions report gated without an existence check

A mention whose candidate fails containment (outside the session cwd in both spellings, the git common root, `~/.pi` and active grants) SHALL be reported as gated. Such a path MUST NOT be stat-ed and MUST NOT be reported as found or missing. A gated link SHALL indicate that access is needed. Clicking it follows the normal open and grant flow.

#### Scenario: home file outside scope
- **WHEN** a settled message mentions `~/Downloads/notes.md` and no grant covers it
- **THEN** the link SHALL show the gated state and the server SHALL NOT have stat-ed the path

#### Scenario: response does not leak existence
- **WHEN** two out-of-scope mentions are resolved, one existing and one not
- **THEN** both SHALL be reported identically as gated

#### Scenario: granted path is not gated
- **GIVEN** a grant covering `~/Downloads`
- **WHEN** a settled message mentions `~/Downloads/notes.md` and the file exists
- **THEN** the link SHALL show the found state

### Requirement: Batch resolution endpoint is bounded and gated

The batch endpoint SHALL use the same network guard, access tier and `cwd` admission as single-mention resolution, before any filesystem access. It SHALL accept at most 200 mentions per request, reject a mention or tool directory over 1024 characters, keep request order, report mentions beyond the cap as unknown, and rate-limit each client. The client SHALL not send overlong mentions and SHALL retry after a 429 with back-off.

#### Scenario: unknown cwd rejected
- **WHEN** a batch request names a `cwd` that is not admitted
- **THEN** the endpoint SHALL reject the request without touching the filesystem

#### Scenario: oversized batch
- **WHEN** a request carries 250 mentions
- **THEN** the first 200 SHALL be resolved, the remaining 50 SHALL be reported unknown, and the client SHALL request them in a later flush

#### Scenario: overlong mention
- **WHEN** a request carries a 5000-character mention
- **THEN** the endpoint SHALL reject the request with a 400 and no filesystem access

#### Scenario: rate limit
- **WHEN** one client exceeds the batch rate limit
- **THEN** further requests SHALL be refused with 429, its links SHALL stay unknown, and the client SHALL retry them after a back-off

### Requirement: Link states are cached briefly and refreshed after later tool calls

The client SHALL cache a link state per session, producing-tool directory and mention for a bounded time. Every cached state of a session SHALL be dropped when it expires, when a later tool call of that session completes, or when the access grants change. A dropped state is requested again in the next flush while the link is in view.

#### Scenario: agent creates a missing file
- **WHEN** a link shows missing and a later tool call in the session (an edit, or a bash command such as `touch`) completes after creating that file
- **THEN** the link SHALL be re-resolved and show found

#### Scenario: expiry
- **WHEN** a cached state is older than the cache window and the link is in view
- **THEN** the link SHALL be re-resolved in the next flush

#### Scenario: deleted file
- **WHEN** a link shows found and a later bash call in the session deletes the file
- **THEN** the link SHALL be re-resolved and show missing

#### Scenario: new grant
- **WHEN** a link shows gated and the operator grants access to its folder
- **THEN** the link SHALL be re-resolved

### Requirement: The producing tool's working directory is tried first

When the producing tool ran in another directory, the resolver SHALL try a relative mention against that directory and the session cwd. One hit opens; two hits make the link ambiguous, tool-directory candidate first. The directory is the call's working-directory argument, or a leading literal `cd <dir> &&` resolved against it. The directory and the joined candidate SHALL each pass containment before any stat. An out-of-scope directory is ignored without a gated result.

#### Scenario: output from a subdirectory command
- **WHEN** a bash call `cd packages/client && rg foo` prints `src/a.ts:3` and only `packages/client/src/a.ts` exists
- **THEN** the link SHALL resolve to `packages/client/src/a.ts`

#### Scenario: both candidates exist
- **WHEN** the same output is printed and both `src/a.ts` and `packages/client/src/a.ts` exist
- **THEN** clicking the link SHALL show a picker listing `packages/client/src/a.ts` first and `src/a.ts` second

#### Scenario: tool directory outside scope
- **WHEN** the producing call ran in `/etc` and printed `hosts.conf`
- **THEN** the resolver SHALL NOT stat `/etc/hosts.conf` and SHALL resolve the mention as if no tool directory were known

#### Scenario: traversal out of the tool directory
- **WHEN** the tool directory is `packages/client` and the mention is `../../../etc/x.conf`
- **THEN** the joined candidate SHALL fail containment and SHALL NOT be stat-ed

#### Scenario: tool directory equal to the session cwd
- **WHEN** the tool's working directory is the session cwd (in any spelling) and the mention exists there
- **THEN** the link SHALL resolve as found, not ambiguous

#### Scenario: non-literal directory ignored
- **WHEN** the bash command is `cd $PROJECT && ls` or `cd ~/x && ls` or `cd - && ls`
- **THEN** no tool directory SHALL be used

### Requirement: Recovered links disclose where they resolved

A link resolved through fuzzy fallback SHALL be shown as recovered, and a link resolved through the producing tool's directory SHALL show the real path. The tooltip SHALL name the real path it opens, and clicking it SHALL open that path.

#### Scenario: recovered tooltip
- **WHEN** `src/a.ts` resolved to `packages/client/src/a.ts`
- **THEN** the tooltip SHALL contain `packages/client/src/a.ts` and a click SHALL open that file

### Requirement: Ambiguous mentions offer a picker

When a mention cannot be resolved to a single file but has one or more on-disk candidates (several tracked matches, or both a tool-directory and a session-cwd candidate), the result SHALL carry no single resolution plus up to 10 candidate paths. Clicking such a link SHALL show a picker of those candidates and open only the one the user picks.

#### Scenario: several matches
- **WHEN** `tasks.md` matches 4 tracked files on disk
- **THEN** clicking the link SHALL show a picker listing the 4 paths and SHALL open nothing until one is picked

#### Scenario: dismissing the picker
- **WHEN** the user dismisses the picker
- **THEN** no file SHALL open

### Requirement: Pre-confirmed state matches what a click opens

The batch resolver SHALL apply the same candidate order as a click, including the worktree re-root probe of "Worktree link-origin re-rooting", so that a link's pre-confirmed state describes the file a click on it would open at the time of the check. The re-rooted candidate SHALL pass the same containment gate as the mention before any stat.

#### Scenario: worktree session parent-rooted link
- **GIVEN** a worktree session whose worktree contains a copy of a parent-rooted linked file
- **WHEN** the link is pre-confirmed
- **THEN** its state and tooltip SHALL describe the worktree copy, which is also what a click opens
