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
MUST govern the eventual open/preview route, so a resolve never succeeds on a
path the open route would reject. A mention that is contained
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

#### Scenario: nonexistent contained path still shows not-found
- **WHEN** the server returns `{ resolved: null }`
- **THEN** the link SHALL render the inline not-found affordance and nothing SHALL open

### Requirement: File links without a live split SHALL deep-link before falling back to the overlay

Without a live split for the link's session, a link carrying a session id SHALL navigate to `buildEditorUrl(sessionId, path, line)`; only a link with no session id SHALL keep the preview overlay.

#### Scenario: no live split but a session id deep-links
- **GIVEN** no split workspace for the session and a link with `sessionId` `s1`
- **WHEN** the user clicks an absolute path link
- **THEN** the client SHALL navigate to `buildEditorUrl("s1", <path>, line)`

#### Scenario: no session id keeps the overlay
- **GIVEN** a link rendered with no `sessionId`
- **WHEN** the user clicks it
- **THEN** `FilePreviewOverlay` SHALL open as today
