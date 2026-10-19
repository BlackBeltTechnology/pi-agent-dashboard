## MODIFIED Requirements

### Requirement: Pane SHALL surface a changed-on-disk banner for open files

The server SHALL watch the files currently open in a session's editor pane and emit a
`file_changed` signal each time an open file's watch fires (e.g. an agent edit or an
external change). Each signal is a **candidate** only. Before a file tab's viewer
mounts (open, tab activation, Refresh) the session-scoped pane SHALL record a content
**baseline** for that file (its digest at that moment). On every candidate for an open
tab the pane SHALL compare the file's current digest with the baseline and SHALL
display the per-tab banner stating the file changed on disk, offering a **Refresh**
action, ONLY when the current content differs from the baseline, the file no longer
exists, the digest is refused or fails, or the file exceeds the digest ceiling (no
hash). When the current digest equals the baseline the pane SHALL drop that candidate
and SHALL clear any banner already shown for that path. A candidate that arrives while an earlier verification of the
same path is running SHALL be verified again; a verification whose baseline changed
while it ran (Refresh, remount, own save) SHALL be discarded and re-run against the new
baseline.

The pane SHALL NOT auto-reload the buffer (preserving the read-only-v1
no-auto-refresh decision); Refresh SHALL re-fetch via the existing manual-refresh path,
SHALL reset the tab's baseline, and SHALL clear the banner. Dismissing the banner SHALL
clear it, SHALL leave the cached (stale) view in place, and SHALL NOT change the
baseline.

Shortly after a newly opened tab's baseline is taken, the pane SHALL run one
verification without waiting for a candidate, so a change that lands before the
server watch is established is still detected.

A save performed from within the pane (the editable tabs' Save, and any in-pane
repair or apply-fix action that writes the open file) SHALL NOT display the banner when
the saved content is within the digest ceiling: after a successful save the tab's
baseline SHALL equal the saved content; a candidate that arrives, or a verification
that is running, while a save for that path is in flight SHALL be verified only after
the save settles (bounded: 60 s, after which it is verified against the current
baseline). A write from outside the pane (another dashboard surface, an agent, an external
editor) SHALL be treated as an external change. A save the server refused (`4xx` or `5xx` response) SHALL leave the
baseline unchanged. A save whose outcome is unknown (no response) or whose success
response carries no content hash SHALL clear the baseline, so the next candidate shows
the banner.

The folder-scoped pane (no session watch) SHALL NOT record baselines or request digests.

The watch SHALL be scoped to the pane's **open files only**, not the whole `cwd` tree,
and SHALL be created and torn down as tabs open and close, on session switch, and on
client disconnect, so no file descriptors leak. When an open file is replaced
atomically (written to a temporary file and renamed over the original) or deleted and
re-created shortly after, the watch SHALL keep signalling later changes to that path.

#### Scenario: Agent edit to an open file shows the banner
- **GIVEN** `foo.ts` is open in the pane and unchanged on disk
- **WHEN** the agent writes new content to `foo.ts`
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab
- **AND** the buffer content is NOT auto-reloaded

#### Scenario: Identical-content rewrite does not show the banner
- **GIVEN** `foo.ts` is open in the pane
- **WHEN** a process rewrites `foo.ts` with byte-identical content
- **THEN** no changed-on-disk banner is shown

#### Scenario: Metadata-only touch does not show the banner
- **GIVEN** `foo.ts` is open in the pane
- **WHEN** `foo.ts` has its mtime or permissions changed without a content change
- **THEN** no changed-on-disk banner is shown

#### Scenario: Change then revert clears the banner
- **GIVEN** `foo.ts` is open and a different write raised the banner
- **WHEN** `foo.ts` is rewritten back to the exact bytes of the baseline
- **THEN** the changed-on-disk banner for `foo.ts` clears

#### Scenario: A second change during verification is not lost
- **GIVEN** `foo.ts` is open and a touch candidate is being verified
- **WHEN** the agent writes different content to `foo.ts` before that verification completes
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab

#### Scenario: Change racing the tab mount is not hidden
- **GIVEN** the user opens `foo.ts`
- **WHEN** `foo.ts` changes after its baseline is taken but before or after its viewer fetches content
- **THEN** the change never leaves a stale view without a banner (a banner may show even if the viewer already loaded the new bytes)

#### Scenario: Own save does not show the banner
- **GIVEN** `README.md` is open in an editable pane tab
- **WHEN** the user edits the buffer and saves successfully
- **THEN** no changed-on-disk banner is shown for `README.md`

#### Scenario: In-pane repair write does not show the banner
- **GIVEN** a markdown or mermaid file open in the pane
- **WHEN** the user applies an in-pane repair or AI fix that writes the file successfully
- **THEN** no changed-on-disk banner is shown for that file

#### Scenario: Change before the watch is established is detected
- **GIVEN** the user opens `foo.ts`
- **WHEN** `foo.ts` changes after its baseline is taken but before the server watch fires for it
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab

#### Scenario: Activating a changed background tab reloads it and clears the banner
- **GIVEN** `foo.ts` is open in a background tab and changed on disk
- **WHEN** the user activates the `foo.ts` tab
- **THEN** the viewer loads the current content
- **AND** no changed-on-disk banner is shown for that change

#### Scenario: Own save while a verification is running does not show the banner
- **GIVEN** a touch candidate for `README.md` is being verified
- **WHEN** the user saves `README.md` successfully before that verification completes
- **THEN** no changed-on-disk banner is shown for `README.md`

#### Scenario: Failed save keeps detecting external changes
- **GIVEN** `README.md` is open in an editable tab
- **WHEN** a save returns `409`
- **AND** the agent later writes different content to `README.md`
- **THEN** the pane displays a changed-on-disk banner on the `README.md` tab

#### Scenario: Change after an atomic replace is still signalled
- **GIVEN** `foo.ts` is open and was replaced via write-to-temp + rename
- **WHEN** the agent writes different content to `foo.ts`, including within 50 ms of the rename
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab

#### Scenario: Change after delete and re-create is still signalled
- **GIVEN** `foo.ts` is open
- **WHEN** `foo.ts` is deleted and re-created within 1 s
- **AND** the agent later writes different content to `foo.ts`
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab

#### Scenario: Reconnect re-establishes watches and catches up
- **GIVEN** `foo.ts` is open and the dashboard WebSocket disconnects
- **WHEN** `foo.ts` changes while disconnected and the WebSocket reconnects
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab
- **AND** a later change to `foo.ts` is still signalled

#### Scenario: Baselines are per session
- **GIVEN** sessions A and B with different `cwd` both have a tab for relative path `X`
- **WHEN** session A's `X` changes on disk
- **THEN** the change is verified against session A's baseline only

#### Scenario: Deleted open file shows the banner
- **GIVEN** `foo.ts` is open in the pane
- **WHEN** `foo.ts` is deleted on disk
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab

#### Scenario: File above the digest ceiling keeps today's banner
- **GIVEN** an open text file larger than the 256 MiB digest ceiling
- **WHEN** its watch fires
- **THEN** the pane displays a changed-on-disk banner (no content check is possible)

#### Scenario: Refresh re-fetches the changed file
- **GIVEN** the changed-on-disk banner is shown for `foo.ts`
- **WHEN** the user activates Refresh
- **THEN** the pane re-fetches `GET /api/file?cwd=<cwd>&path=foo.ts`
- **AND** the Monaco buffer updates to the new content
- **AND** the banner clears
- **AND** a later identical-content rewrite of `foo.ts` shows no banner

#### Scenario: Dismiss clears the banner and keeps the stale view
- **GIVEN** the changed-on-disk banner is shown for `foo.ts`
- **WHEN** the user activates Dismiss
- **THEN** the banner clears and the buffer still shows the earlier content

#### Scenario: Folder pane requests no digests
- **GIVEN** the folder-scoped editor pane with `foo.ts` open
- **WHEN** the tab mounts and `foo.ts` changes on disk
- **THEN** no `GET /api/file/digest` request is made and no banner is shown

#### Scenario: Closing a tab tears down its watch
- **GIVEN** `foo.ts` and `bar.ts` are open with active watches
- **WHEN** the user closes the `foo.ts` tab
- **THEN** the watch on `foo.ts` is torn down
- **AND** the watch on `bar.ts` remains active

#### Scenario: Change to a non-open file does not signal
- **GIVEN** only `foo.ts` is open in the pane
- **WHEN** an unrelated file `baz.ts` (not open) changes on disk
- **THEN** no changed-on-disk banner is shown

### Requirement: Oversized files SHALL fall back to a too-large notice

The editor pane SHALL gate rich viewers on the configured **editor large-file limit**
(`editor.largeFileLimitMb`, default 10 MiB, see the `settings-panel` capability). The
shared `MAX_PREVIEW_BYTES = 10 * 1024 * 1024` SHALL be the default when the setting is
absent or invalid. When an opened file's `size` (as reported by `/api/file`) exceeds the
limit, the viewer SHALL mount a `TooLargePreview` fallback (a short notice naming the
editor limit plus an **Open raw** affordance that streams `/api/file/raw`) INSTEAD of
the rich renderer (`MarkdownViewer`, `SpreadsheetPreview`, `DocxPreview`, `PdfPreview`,
`ImagePreview`, etc.). Monaco text tabs retain their existing large-file handling and
are not governed by this limit. This replaces the inline size caps removed with the
in-chat `PreviewCard` surface.

The gate SHALL use the limit from the server config; until the client has loaded it,
the gate SHALL wait (showing the viewer loading state) and SHALL fall back to the
default if the config fails to load or has not loaded within 3 s. A change to the setting SHALL take effect
for tabs opened or refreshed after the change, without a page reload. The editor-limit
gate SHALL run before any rich-viewer fetch. Server-side office conversion caps are
independent of this setting and are not raised by it: when the server refuses an office
conversion with `413`, the too-large notice SHALL name that office cap, not the editor
limit.

#### Scenario: File over the cap shows the too-large fallback

- **GIVEN** the large-file limit is the default 10 MiB
- **AND** a `report.docx` whose `/api/file` `size` is `10 * 1024 * 1024 + 1`
- **WHEN** the file opens in the pane
- **THEN** `TooLargePreview` mounts with an **Open raw** affordance (streams `/api/file/raw`)
- **AND** `DocxPreview` is NOT mounted

#### Scenario: File at or below the cap renders richly

- **GIVEN** the large-file limit is the default 10 MiB
- **AND** a `data.csv` whose `size` is exactly `10 * 1024 * 1024`
- **WHEN** the file opens in the pane
- **THEN** the rich `SpreadsheetPreview` mounts (no too-large fallback)

#### Scenario: Raised limit lets a large markdown file open for editing

- **GIVEN** a `notes.md` of 30 MiB
- **AND** the large-file limit is set to 64 MiB
- **WHEN** the file opens in the pane
- **THEN** `MarkdownViewer` mounts with its edit affordance
- **AND** no too-large fallback is shown

#### Scenario: Limit change applies without reload

- **GIVEN** a 30 MiB `notes.md` tab showing the too-large fallback under the default limit
- **WHEN** the user raises the limit to 64 MiB in Settings and saves
- **AND** refreshes or reopens the `notes.md` tab
- **THEN** `MarkdownViewer` mounts without a page reload

#### Scenario: No too-large flash before the config loads

- **GIVEN** the large-file limit is set to 64 MiB
- **WHEN** a 30 MiB `notes.md` tab mounts before the client has loaded the config
- **THEN** the viewer loading state shows until the config loads
- **AND** `TooLargePreview` is never shown for it

#### Scenario: Office 413 names the office cap

- **GIVEN** the large-file limit is 256 MiB
- **WHEN** a 60 MiB `.docx` opens and the server refuses the conversion with `413`
- **THEN** `TooLargePreview` names the docx office cap, not the editor limit

## ADDED Requirements

### Requirement: Server SHALL expose a content digest for a file without its content

`GET /api/file/digest?cwd=<cwd>&path=<path>` SHALL return `{ size, mtime, sha1 }` for a
regular file, where `sha1` is the lowercase hex SHA-1 of the file bytes and `mtime` is
the full-precision `stat.mtimeMs`, without returning the content. It SHALL apply the
same session check, path decoding, containment anchors and layers as `GET /api/file`,
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
