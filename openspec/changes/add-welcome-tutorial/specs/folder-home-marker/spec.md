## ADDED Requirements

### Requirement: Folder home marker file
A directory MAY declare a custom home page with a marker file `.pi/home.json` of the shape `{ v: 1, entry: string, fallback?: string, showPrompt?: boolean }`. `entry` is a path relative to the directory and MAY contain the placeholder `{lang}`. The server SHALL expose the validated marker for a known cwd (pinned or workspace folder) and SHALL reject markers whose resolved entry escapes the directory.

#### Scenario: Valid marker is reported
- **GIVEN** pinned directory `D` contains `.pi/home.json` `{ "v": 1, "entry": "{lang}/index.html", "fallback": "en" }` and `D/en/index.html`
- **WHEN** the client requests the marker for `D`
- **THEN** the server SHALL return the marker with an opaque `dirId` for `D`

#### Scenario: Entry escaping the directory is rejected
- **WHEN** a marker's `entry` resolves outside `D` (e.g. `../x/index.html` or a symlink out)
- **THEN** the server SHALL report the marker as invalid

#### Scenario: Unknown directory is refused
- **WHEN** the marker is requested for a cwd that is neither pinned nor a workspace folder
- **THEN** the server SHALL refuse the request

### Requirement: Language-resolved entry
The client SHALL substitute `{lang}` with the active UI language (`en`, `hu`, `zh-CN`). When that file does not exist it SHALL use `fallback`; when neither exists the marker SHALL be treated as invalid.

#### Scenario: Hungarian user with Hungarian page
- **GIVEN** the UI language is `hu` and `D/hu/index.html` exists
- **WHEN** the folder home renders
- **THEN** it SHALL load `hu/index.html`

#### Scenario: Missing language falls back
- **GIVEN** the UI language is `zh-CN` and only `D/en/index.html` exists with `fallback: "en"`
- **WHEN** the folder home renders
- **THEN** it SHALL load `en/index.html`

### Requirement: Guarded serving of marker directories
The server SHALL serve files of a directory with a valid marker at `GET /api/home/:dirId/*`, inside the universal network guard's jurisdiction, resolving every path through the shared path-containment check (realpath both sides). Only GET/HEAD SHALL be accepted. The route SHALL NOT add a CORS allowance for `Origin: null`.

#### Scenario: Authenticated parent fetch succeeds
- **WHEN** a genuine-local or authenticated client requests `GET /api/home/<dirId>/en/index.html` for a file inside `D`
- **THEN** the server SHALL return it with an HTML content type

#### Scenario: Unauthenticated tunnel request is denied
- **WHEN** the same request arrives through a tunnel without a session cookie or bearer
- **THEN** the network guard SHALL deny it

#### Scenario: Traversal is refused
- **WHEN** `GET /api/home/<dirId>/../../etc/passwd` or an encoded variant is requested
- **THEN** the server SHALL NOT return any file outside `D`

#### Scenario: Unknown dirId is refused
- **WHEN** a request uses a `dirId` not issued for a current marker directory
- **THEN** the server SHALL respond 404
