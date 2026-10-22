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
path the open route would reject. A mention that does not resolve to
an existing in-scope file MUST return null (never an error).

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
- **WHEN** a request with a known `cwd` asks to resolve `~/.ssh/id_rsa`
- **THEN** the path SHALL fail containment (not under cwd, git-root, or `~/.pi`) and the result SHALL be null

#### Scenario: tilde traversal escape blocked
- **WHEN** a request with a known `cwd` asks to resolve `~/../../etc/passwd`
- **THEN** the server SHALL expand the tilde, the containment gate SHALL reject the path, and the result SHALL be null
