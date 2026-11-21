## MODIFIED Requirements

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

## ADDED Requirements

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
