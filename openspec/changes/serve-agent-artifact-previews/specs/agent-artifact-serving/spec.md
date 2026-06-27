# agent-artifact-serving — delta

## ADDED Requirements

### Requirement: the raw file route SHALL serve images from an artifact-root allowlist as an additional containment anchor

`GET /api/file/raw` SHALL allow a resolved path that lies within a configured artifact root, in addition to the session `cwd` and the cwd's git common root. The artifact-root allowlist SHALL include `realpath(~/.agent-browser/tmp)` and, when set, `realpath($AGENT_BROWSER_SCREENSHOT_DIR)` — the same environment variable the `agent-browser` CLI honors. A screenshot written to a `--screenshot-dir` CLI path not reflected in those entries is OUT OF SCOPE for this change (best-effort coverage). An allowlist entry whose real path cannot be resolved SHALL be dropped, not treated as an error. The session-cwd gate (the request `cwd` must equal a known session cwd) SHALL remain unchanged; the artifact root is an additional path anchor, not a session bypass.

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

### Requirement: artifact-root serving SHALL be image-only and real-path contained

A path permitted solely by the artifact-root anchor SHALL be served only when its extension is a recognized image type; non-image artifacts under the artifact root SHALL be rejected. Containment against an artifact root SHALL compare the real path (`fs.realpath`) of both the resolved target and the root, so a `..` segment or symlink whose real target escapes the root SHALL be rejected.

#### Scenario: non-image artifact is not served

- **WHEN** `GET /api/file/raw` requests a non-image file (e.g. `trace.json`) that lies under an artifact root but outside every session cwd and git root
- **THEN** the response SHALL be HTTP 403 with `{ success: false, error: "path outside working directory" }`

#### Scenario: symlink escaping the artifact root is rejected

- **GIVEN** a symlink under the artifact root whose real target is outside the artifact root
- **WHEN** a request resolves through that symlink
- **THEN** the response SHALL be HTTP 403

#### Scenario: a deleted artifact yields 404, not 500

- **GIVEN** a path that lies inside an artifact root but no longer exists on disk
- **WHEN** `GET /api/file/raw` is requested for it
- **THEN** the artifact-anchor containment check SHALL NOT raise a 500
- **AND** the response SHALL be HTTP 404 `{ success: false, error: "not found" }`

#### Scenario: artifact anchor is not shared with other routes

- **WHEN** `GET /api/file` or `GET /api/file/render` requests an image path under an artifact root that is outside every session cwd and git root
- **THEN** the request SHALL be rejected (the artifact anchor applies only to `GET /api/file/raw`)
