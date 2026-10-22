## MODIFIED Requirements

### Requirement: the raw file route SHALL serve images from an artifact-root allowlist as an additional containment anchor

`GET /api/file/raw` SHALL allow a resolved path that lies within a configured artifact root, in addition to the session `cwd` and the cwd's git common root. The artifact-root allowlist SHALL include `realpath(~/.agent-browser/tmp)` and, when set, `realpath($AGENT_BROWSER_SCREENSHOT_DIR)` — the same environment variable the `agent-browser` CLI honors. A screenshot written to a `--screenshot-dir` CLI path not reflected in those entries is OUT OF SCOPE for this change (best-effort coverage). An allowlist entry whose real path cannot be resolved SHALL be dropped, not treated as an error. The cwd gate (the request `cwd` must be admitted by the shared cwd admission guard (`core-cwd-admission`: a known folder — session cwd, pinned directory or workspace folder — or a subdirectory / linked worktree whose main checkout is a known folder)) SHALL apply unchanged by this requirement; the artifact root is an additional path anchor, not a cwd-gate bypass.

#### Scenario: screenshot under the artifact root loads

- **GIVEN** a request with a valid session `cwd` and `path` = `~/.agent-browser/tmp/screenshots/shot.png`
- **WHEN** `GET /api/file/raw` resolves the path inside the artifact root and the extension is an image type
- **THEN** the image bytes SHALL be served with an image `Content-Type` (HTTP 200)

#### Scenario: path outside cwd, git root, and artifact root is rejected

- **WHEN** `GET /api/file/raw` requests a path that is outside the session `cwd`, outside its git root, and outside every artifact root
- **THEN** the response SHALL be HTTP 403 with `{ success: false, error: "path outside working directory" }`

#### Scenario: missing artifact root behaves as no extra anchor

- **GIVEN** the configured artifact root does not exist on disk
- **WHEN** a path that would have been under it is requested
- **THEN** containment SHALL behave as if the artifact anchor were absent (cwd/git-root only)

#### Scenario: artifact root does not admit an unknown cwd
- **GIVEN** a request whose `cwd` is not admitted
- **WHEN** `path` lies inside an artifact root
- **THEN** the route SHALL refuse at the cwd gate and SHALL NOT serve the file
