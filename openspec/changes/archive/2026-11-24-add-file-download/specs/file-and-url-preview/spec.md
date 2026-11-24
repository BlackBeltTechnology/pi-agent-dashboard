## MODIFIED Requirements

### Requirement: Binary-safe file serving endpoint

The server SHALL expose `GET /api/file/raw?cwd=&path=` that streams the file contents with `Content-Type` derived from the file extension via a shared `extToContentType` mapping. The endpoint SHALL enforce the same anti-traversal gate as `/api/file`: `cwd` must be admitted by the shared cwd admission guard (`core-cwd-admission`: a known folder — session cwd, pinned directory or workspace folder — or a subdirectory / linked worktree whose main checkout is a known folder), and the resolved path must pass the layered file-read containment check (`file-read-containment`: cwd, git common root, artifact roots, or an access grant). The endpoint SHALL support HTTP `Range` requests so `<video>` seek bars work.

The endpoint SHALL accept an optional `download` query parameter. When its value is exactly `1`, the response SHALL carry `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<encoded>`, where the name is the basename of the resolved path. `<ascii>` SHALL replace every character outside printable ASCII (0x20–0x7E), plus `"` and `\`, with `_`. `<encoded>` SHALL be the RFC 5987 percent-encoding of the UTF-8 basename. Otherwise the response SHALL carry `Content-Disposition: inline`. The `download` parameter SHALL NOT change admission, containment, `Content-Type`, the scriptable-type sandbox CSP and `nosniff` headers, caching or Range handling.

#### Scenario: Unknown cwd rejected

- **GIVEN** `cwd` is not admitted (not a known folder, nor a subdirectory or linked worktree whose main checkout is a known folder)
- **WHEN** the client requests `/api/file/raw?cwd=/unknown&path=foo.pdf`
- **THEN** the server responds with HTTP 403 and `{ success: false, error: "unknown session path", code: "cwd_unknown" }`

#### Scenario: Path traversal rejected

- **GIVEN** `cwd` is a known session cwd
- **WHEN** the client requests `/api/file/raw?cwd=/home/u/proj&path=../../../etc/passwd`
- **THEN** the server responds with HTTP 403 and `{ success: false, error: "path outside working directory" }`

#### Scenario: PDF served with correct Content-Type

- **GIVEN** `foo.pdf` exists inside a known cwd
- **WHEN** the client requests `/api/file/raw?cwd=…&path=foo.pdf`
- **THEN** the response Content-Type is `application/pdf` and the body is the raw file bytes

#### Scenario: Range request returns 206

- **GIVEN** `video.mp4` exists inside a known cwd
- **WHEN** the client requests with `Range: bytes=1024-2047`
- **THEN** the response status is 206 (Partial Content) with the requested byte range and a `Content-Range` header

#### Scenario: Missing file returns 404

- **GIVEN** the resolved path does not exist on disk
- **WHEN** the client requests `/api/file/raw`
- **THEN** the response status is 404

#### Scenario: Pinned folder without a session is served
- **GIVEN** `cwd` is a pinned directory with no live session
- **WHEN** the client requests `/api/file/raw?cwd=<pinned>&path=report.pdf`
- **THEN** the server SHALL stream the file with HTTP 200

#### Scenario: Download mode sends an attachment disposition
- **GIVEN** `notes/summary.md` exists inside a known cwd
- **WHEN** the client requests `/api/file/raw?cwd=…&path=notes/summary.md&download=1`
- **THEN** the response status is 200, the body is the file bytes, and `Content-Disposition` is `attachment; filename="summary.md"; filename*=UTF-8''summary.md`

#### Scenario: Default stays inline
- **WHEN** the client requests `/api/file/raw` without `download`, or with `download=0`
- **THEN** `Content-Disposition` is `inline`

#### Scenario: Unsafe file name cannot inject headers
- **GIVEN** a file whose basename is `a"b\r\nX-Evil: 1 é.txt` exists inside a known cwd
- **WHEN** the client requests it with `download=1`
- **THEN** the `filename` value contains no `"`, CR, LF or non-ASCII byte, no `X-Evil` response header exists, and `filename*` percent-encodes the original name

#### Scenario: Download mode keeps the scriptable-type sandbox
- **GIVEN** `page.svg` exists inside a known cwd
- **WHEN** the client requests it with `download=1`
- **THEN** the response carries the same sandbox `Content-Security-Policy` and `X-Content-Type-Options: nosniff` as without `download`

#### Scenario: Download mode does not widen admission
- **WHEN** the client requests `/api/file/raw?cwd=/unknown&path=foo.pdf&download=1` or a traversal path with `download=1`
- **THEN** the server responds with the same 403 as without `download`
