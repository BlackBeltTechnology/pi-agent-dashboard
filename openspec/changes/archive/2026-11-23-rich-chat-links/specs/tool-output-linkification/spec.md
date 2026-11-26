# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
