## MODIFIED Requirements

### Requirement: Server SHALL extend `/api/file` and add `/api/file/raw`

`GET /api/file?cwd=<cwd>&path=<relPath>` SHALL return `{ type: "file", kind, mimeType, size, mtime, content? }` for file entries. `content` SHALL be present when the classified `viewer ∈ { "monaco", "markdown" }` OR when `editable === true` (so an editable non-markdown tab such as `.csv` or `.adoc` can load its text into Monaco). `content` SHALL be omitted for all other kinds, including `image`, `pdf`, `binary`, `docx`, `pptx`, `xlsx` spreadsheets, and `email`.

`mtime` SHALL be the file's modification time in milliseconds at full filesystem precision (not rounded or truncated). It is the optimistic-concurrency token for `POST /api/file/write`. Echoing it back unchanged for an unmodified file SHALL pass the write-side conflict check.

`GET /api/file/raw?cwd=<cwd>&path=<relPath>` SHALL stream raw file bytes with the resolved `Content-Type` header. Both endpoints SHALL apply the existing security gates: `cwd` admitted by the shared cwd admission guard (`core-cwd-admission`: a known folder — session cwd, pinned directory or workspace folder — or a subdirectory / linked worktree whose main checkout is a known folder); the resolved path SHALL lie inside the containment anchors of `file-read-containment` (path-traversal prevention).

The file-kind discrimination SHALL invoke the shared `fileKind` module with the first 1024 bytes of the file as the `sniff` argument; the server SHALL NOT read the full file just to classify.

#### Scenario: Editable CSV returns content

- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=data.csv` succeeds
- **THEN** the response includes `content` (`editable === true`), `kind: "spreadsheet"`

#### Scenario: Binary spreadsheet omits content

- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=book.xlsx` succeeds
- **THEN** the response does NOT include `content` (`editable === false`)

#### Scenario: Office/email omit content

- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=report.docx` (or `mail.eml`) succeeds
- **THEN** the response does NOT include `content`
- **AND** the client renders it via the rich viewer, not Monaco raw text

#### Scenario: Editable AsciiDoc returns content

- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=guide.adoc` succeeds
- **THEN** the response includes `content` (`editable === true`), `kind: "asciidoc"`

#### Scenario: Fractional mtime round-trips through save

- **GIVEN** an editable `.md` file whose on-disk mtime has a sub-millisecond fraction (e.g. `1700000000000.5`)
- **WHEN** the client loads it via `GET /api/file` and POSTs `/api/file/write` with the returned `mtime` and new content, with no intervening disk change
- **THEN** the server responds `200` and the file holds the new content

#### Scenario: Genuine external change still conflicts

- **GIVEN** a file loaded via `GET /api/file` at token T
- **WHEN** the file is modified on disk and the client POSTs `/api/file/write` with T
- **THEN** the server responds `409` and the file is left untouched

### Requirement: Editor-pane tabs SHALL offer system-open actions gated to a local server

Each editor-pane tab SHALL offer system-open actions. A **file** tab SHALL offer *Open in system app* and *Reveal in file manager*; a **url** tab SHALL offer *Open in system browser*.

The two **file** actions SHALL be shown only when the server advertises `capabilities.systemOpen === true` on `/api/health` — a value the server computes at startup, true only for a desktop-capable host (an OS opener plus a display session) and false when headless / containerized / remote. A browser-side loopback check SHALL NOT be used as the gate: it is wrong for the Docker forwarded-port case (browser origin is `localhost:PORT` but the server runs in a headless container). When `capabilities.systemOpen` is false the file actions SHALL be hidden. The **url** action SHALL be unconditional.

The file actions SHALL dispatch to `POST /api/open-in-system` and `POST /api/reveal-in-file-manager`, each taking `{ cwd, path }` and spawning the OS opener on the server host (macOS `open` / `open -R`; Linux `xdg-open` / freedesktop reveal; Windows `start` / `explorer /select,`). The opener SHALL be invoked via `execFile`/`spawn` with an **argument array**, never a shell string, so a path containing a comma, space, quote, or newline cannot inject (notably the `explorer /select,<path>` argument). Both endpoints SHALL reuse the existing file-routes containment gate (the request `cwd` MUST be admitted by the shared cwd admission guard (`core-cwd-admission`: a known folder — session cwd, pinned directory or workspace folder — or a subdirectory / linked worktree whose main checkout is a known folder), and the resolved path MUST lie inside its containment anchors), SHALL refuse when `capabilities.systemOpen` is false, AND SHALL reject a request whose Origin/Host is not loopback — an absent Origin/Host SHALL be treated as non-loopback (rejected). Neither endpoint SHALL read or stream the file content. *Reveal in file manager* SHALL select the file without executing it.

The **url** action SHALL be `window.open(url, "_blank")`, which opens the system browser in every context (Electron rewrites it to `openExternal`; browsers honor it natively); it requires no server round-trip.

#### Scenario: File actions shown when the server is desktop-capable

- **GIVEN** `/api/health` reports `capabilities.systemOpen === true`
- **WHEN** a file tab is active
- **THEN** *Open in system app* and *Reveal in file manager* are available

#### Scenario: File actions hidden when the server is headless/remote

- **GIVEN** `/api/health` reports `capabilities.systemOpen === false` (headless Docker image, or remote)
- **WHEN** a file tab is active
- **THEN** the two file actions are NOT shown
- **AND** the URL action remains available on url tabs

#### Scenario: Endpoint refuses when systemOpen is false

- **GIVEN** a server whose `capabilities.systemOpen` is false
- **WHEN** `/api/open-in-system` is called anyway
- **THEN** it is refused without spawning an opener

#### Scenario: Reveal is path-contained

- **WHEN** a client posts `/api/reveal-in-file-manager` with `path` resolving outside the session `cwd` (e.g. `../../../etc/passwd`)
- **THEN** the server responds 403 and spawns no opener

#### Scenario: Endpoint rejects a non-loopback or absent origin

- **GIVEN** a request to `/api/open-in-system` whose Origin/Host is non-loopback OR absent
- **WHEN** the server handles it
- **THEN** it is rejected without spawning an opener (defense-in-depth beyond the UI gate)

#### Scenario: Reveal argument is not shell-interpolated

- **GIVEN** a contained path containing a comma or space
- **WHEN** *Reveal in file manager* spawns the opener
- **THEN** the path is passed as a single `execFile` argument (no shell), so it cannot break `explorer /select,` or inject

#### Scenario: Open URL in system browser works remotely

- **GIVEN** a url tab in a remote browser session
- **WHEN** the user activates *Open in system browser*
- **THEN** `window.open(url, "_blank")` opens the URL in the user's own browser (no server round-trip)

### Requirement: Server SHALL expose a content digest for a file without its content

`GET /api/file/digest?cwd=<cwd>&path=<path>` SHALL return `{ size, mtime, sha1 }` for a
regular file, where `sha1` is the lowercase hex SHA-1 of the file bytes and `mtime` is
the full-precision `stat.mtimeMs`, without returning the content. It SHALL apply the
same cwd admission, path decoding, containment anchors and layers as `GET /api/file`,
in the same order, SHALL admit the same files (including an in-`cwd` symlink to a
regular file, and the grant-verified open for grant-admitted paths), and SHALL refuse with the same status, error,
and remedy fields for every path `GET /api/file` refuses; a path refused by containment
SHALL be refused before existence is revealed. The dashboard client SHALL request
digests opted out of the access-grant prompt, so a prompt-eligible containment miss is
refused immediately (never suspended, never prompting). A directory or other
non-regular file SHALL return `404` without blocking, as SHALL a missing file. For a
file larger than the fixed 256 MiB digest ceiling it SHALL return `{ size, mtime }`
with no `sha1`. The server SHALL always hash; it SHALL NOT report a file unchanged from
caller-supplied metadata. The response SHALL NOT be cacheable.

`POST /api/file/write` SHALL accept request bodies large enough for content up to the
digest ceiling and SHALL refuse content above the ceiling with `413`. It SHALL additionally return `size` and `sha1` of the bytes it
wrote (the UTF-8 encoding of the submitted content) in its success payload, alongside
the existing `mtime`, unless the content exceeds the digest ceiling (then no `sha1`).
A digest of the file immediately after an uncontested write SHALL equal the write's
`sha1`.

#### Scenario: Digest of a contained file
- **GIVEN** `foo.ts` exists under `cwd`
- **WHEN** the client requests `GET /api/file/digest?cwd=<cwd>&path=foo.ts`
- **THEN** the response is `success: true` with `size`, full-precision `mtime` and the file's `sha1`
- **AND** the response contains no file content
- **AND** the response is marked non-cacheable

#### Scenario: Digest refuses exactly what /api/file refuses
- **GIVEN** a path that `GET /api/file` refuses (unknown session, outside containment, or refused grant)
- **WHEN** the client requests its digest
- **THEN** the digest endpoint refuses with the same status, error and remedy fields as `GET /api/file`

#### Scenario: Digest admits what /api/file admits
- **GIVEN** a file that `GET /api/file` serves without a grant (under `cwd`, through an in-`cwd` symlink to a regular file, or under the read site's `~/.pi` anchor)
- **WHEN** the client requests its digest
- **THEN** the response carries its `sha1`

#### Scenario: Missing file outside containment is refused, not 404
- **GIVEN** a non-existent path outside the working directory
- **WHEN** the client requests its digest
- **THEN** the response is the containment refusal, not `404`

#### Scenario: Non-regular file returns 404
- **GIVEN** a directory or a FIFO at the requested path under `cwd`
- **WHEN** the client requests its digest
- **THEN** the response is `404` and the request does not block

#### Scenario: File above the digest ceiling has no hash
- **GIVEN** a file larger than 256 MiB
- **WHEN** the client requests its digest
- **THEN** the response carries `size` and `mtime` and no `sha1`

#### Scenario: Large markdown save is accepted
- **GIVEN** a 20 MiB `notes.md` open for editing
- **WHEN** the user saves it
- **THEN** `POST /api/file/write` succeeds (no request-body-size refusal)

#### Scenario: Write returns the content hash
- **WHEN** `POST /api/file/write` succeeds
- **THEN** the response data contains `mtime`, `size` and the `sha1` of the written bytes
- **AND** an immediate digest of the file returns the same `sha1`
