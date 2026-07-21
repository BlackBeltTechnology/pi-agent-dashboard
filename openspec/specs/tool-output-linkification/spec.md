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

### Requirement: Worktree link-origin re-rooting

The link resolution SHALL re-root an **absolute** file-link token whose path is rooted in the parent checkout onto the worktree's own tree when the session `cwd` is a dashboard worktree (`<parentRoot>/.worktrees/<slug>`). The re-root SHALL apply before the path is used for the tooltip, the preview overlay target, and the open-in-editor target, and SHALL replace the leading `<parentRoot>` segment of the path with the session `cwd` (the worktree root).

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
- **GIVEN** session `cwd` is `/repo/.worktrees/x`
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

A URL rendered by `UrlLink` (the anchor used by `LinkifiedText` / `GenericToolRenderer`, including the `serve_mockup` result card) whose origin is loopback (`http(s)://` with hostname in `{localhost, 127.0.0.1, ::1}`, any port) SHALL, on a plain primary-button click (left button, no `meta`/`ctrl`/`shift`/`alt`), open in the internal `live-server` split viewer by opening a `live-server` viewer tab (`path="live:<url>"`) and expanding the split, rather than opening a system-browser tab. The client SHALL call `preventDefault()` for that click and carry the full URL (`pathname` + `search`) to the viewer. This routing MUST use the same shared handler (`useLoopbackLinkOpen` → `SplitWorkspaceContext.openLiveTarget`) as `MarkdownContent` (no duplicated logic).

Non-loopback URLs — including the LAN URL that `serve_mockup` prints alongside the loopback URL — MUST keep their current `target="_blank"` behavior. Loopback classification MUST use the shared `isLoopbackUrl` helper.

#### Scenario: plain click on a loopback tool-output link opens the split viewer
- **GIVEN** a `serve_mockup` result card rendering `http://localhost:50452/board.html`
- **WHEN** the user left-clicks the loopback link with no modifiers
- **THEN** `preventDefault` SHALL be called
- **AND** the `live-server` split viewer SHALL open carrying `http://localhost:50452/board.html`

#### Scenario: the LAN URL stays a browser link
- **GIVEN** a `serve_mockup` result card that also prints a LAN URL `http://192.168.1.20:50452/board.html`
- **WHEN** the user left-clicks the LAN link
- **THEN** the split viewer SHALL NOT open
- **AND** the anchor SHALL open with `target="_blank"` as today

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
it matches a known session cwd or a pinned directory, and the endpoint MUST run
behind the network guard — this gate MUST run BEFORE any path resolution. Only
after the `cwd` gate: the server SHALL expand a leading `~/` to the user home
directory (`os.homedir()`), attempt the mention as an absolute path, then as a
path relative to `cwd`, and each candidate path MUST pass the anti-traversal
containment gate BEFORE any filesystem stat. Containment SHALL authorize a
resolved path when it is contained by `cwd`, the git common root, OR a fixed
server-derived home allowlist rooted at `<os.homedir()>/.pi`; the `~/.pi` anchor
is a server constant and MUST NOT be derived from request input. A leading
`~user/` MUST NOT be expanded. The SAME anchor set (cwd + git-root + `~/.pi`)
MUST govern the eventual open/preview route, so a resolve never succeeds on a
path the open route would reject. A mention that does not resolve to
an existing in-scope file MUST return null (never an error).

#### Scenario: untrusted cwd rejected before resolution
- **WHEN** the endpoint receives `{ cwd: "/etc", mention: "passwd" }` and `/etc` is not a known session cwd or pinned directory
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
- **WHEN** a request with a known `cwd` asks to resolve `~/.ssh/id_rsa`
- **THEN** the path SHALL fail containment (not under cwd, git-root, or `~/.pi`) and the result SHALL be null

#### Scenario: tilde traversal escape blocked
- **WHEN** a request with a known `cwd` asks to resolve `~/../../etc/passwd`
- **THEN** the server SHALL expand the tilde, the containment gate SHALL reject the path, and the result SHALL be null

### Requirement: File links resolve lazily on open

_Phase 1._ A detected file mention SHALL render synchronously on the client exactly as
before (no render-time server dependency). Resolution against the filesystem
SHALL occur when the link is opened: on activation the client SHALL request
server resolution for the mention and open the server-resolved path. When the
server returns null (no such file) the client SHALL surface a not-found
affordance and MUST NOT open an incorrect path. When the resolution request
itself fails (network error, timeout, 5xx) the client SHALL fall back to its
existing client-side open behavior and MUST NOT treat the failure as a null
result. The server-resolved path SHALL be the authoritative open target; the
client MUST NOT additionally re-root a path the server already resolved.

#### Scenario: click resolves and opens the real path
- **WHEN** the user activates a link for `~/.pi/agent/settings.json` and the server resolves it
- **THEN** the client SHALL open the server-resolved home path, not a filesystem-root path

#### Scenario: click on a nonexistent mention does not open a wrong file
- **WHEN** the user activates a link whose server resolution is null
- **THEN** the client SHALL render an inline not-found affordance on the link (e.g. strikethrough / disabled) and MUST NOT make any open call

#### Scenario: resolution request failure falls back to client behavior
- **WHEN** the resolution request fails with a network error or 5xx
- **THEN** the client SHALL fall back to its existing client-side open path and MUST NOT declare the file absent

### Requirement: Fuzzy fallback resolves only on a unique, on-disk match

_Phase 2 (scheduled separately)._ The server SHALL, when exact resolution (absolute / tilde / relative-to-cwd) misses, optionally search for the mention's basename among the tracked files of the session's own tree (bounded), scoped inside the cwd / git common root. A fuzzy match SHALL resolve the mention ONLY when exactly one tracked file matches AND that file is confirmed present on disk by a stat; a tracked path that is not present on disk MUST return null. When the mention's basename matches more than one tracked file the server MUST return null and MUST NOT auto-select any candidate. When the cwd is not inside a git repository, fuzzy fallback SHALL be skipped.

#### Scenario: unique on-disk basename resolves
- **WHEN** the mention `monaco-setup.ts` matches exactly one tracked file that exists on disk
- **THEN** the server SHALL resolve the mention to that file

#### Scenario: unique but deleted-on-disk tracked file returns null
- **WHEN** the mention matches exactly one tracked file that no longer exists on disk
- **THEN** the server SHALL return null (no dead link)

#### Scenario: colliding basename refuses to resolve
- **WHEN** the mention `tasks.md` matches many tracked files
- **THEN** the server SHALL return null and MUST NOT pick any single `tasks.md`

#### Scenario: fuzzy disabled outside a repo
- **WHEN** the cwd is not inside a git repository
- **THEN** fuzzy fallback SHALL be skipped and resolution SHALL rely on exact matching only

