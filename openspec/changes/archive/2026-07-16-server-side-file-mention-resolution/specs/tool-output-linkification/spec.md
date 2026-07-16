# tool-output-linkification Specification

## ADDED Requirements

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
