# session-diff-extraction (delta)

## ADDED Requirements

### Requirement: Out-of-cwd session-authored files are carried without filesystem reads

The session-diff builder SHALL carry Write/Edit-authored files whose resolved path is outside
the session cwd, rather than dropping them via `normalizePath` returning `null`. Such an entry
SHALL be keyed by its **absolute path**, SHALL retain its `changes[]` payload, and SHALL have
**all filesystem and git enrichment skipped** — no synthetic-diff `readFileSync`, no
`git diff`/`numstat` invoked with the out-of-cwd path. The server SHALL NOT read the
out-of-cwd file from disk at any point. In-cwd entries SHALL keep the existing relative-posix
key and full git/synthetic enrichment unchanged.

#### Scenario: out-of-cwd Write appears without a disk read

- **GIVEN** the session emitted a Write to `/tmp/mockup/index.html` (outside cwd)
- **WHEN** `GET /api/session-diff` is built for that session
- **THEN** `data.files` SHALL contain an entry keyed by the absolute path with its `changes[]` payload
- **AND** the entry SHALL carry NO `gitDiff` and the builder SHALL perform no `readFileSync`/`git` call for that path

#### Scenario: enrichment never receives an out-of-cwd entry (guard placement)

- **GIVEN** the session wrote `/repo/.env` while cwd is `/repo/packages/server` (outside cwd, under the repo, untracked)
- **WHEN** `buildSessionDiff` runs
- **THEN** the out-of-cwd entry SHALL be filtered out BEFORE `enrichWithGitDiff` is called
- **AND** no `readFileSync(resolve(cwd, path))` SHALL execute for that path (verified by test)

#### Scenario: in-cwd behavior unchanged

- **WHEN** the session wrote an in-cwd file
- **THEN** its entry SHALL keep the relative-posix key and existing git/synthetic enrichment

### Requirement: On-demand full payload is served by session identifier, never by path

The server SHALL expose a localhost-only endpoint that returns the **full untruncated**
Write/Edit payload for a change, addressed by `(sessionId, toolCallId)`. It SHALL resolve the
session JSONL file via `sessionManager.get(sessionId).sessionFile` (a path fixed at session
creation) and SHALL NOT construct any path from the `sessionId` string. It SHALL locate the
tool call by scanning assistant-message `content[]` blocks for `{ type: "toolCall", id ===
toolCallId }` (the id is nested at `message.content[].id`, not the entry top level) and return
that call's `args.content` / `args.edits`. The endpoint SHALL accept **only** session-scoped
identifiers — no filesystem-path parameter, no `fs.realpath`, no read outside the resolved
session transcript — and SHALL NOT fall back to any path-based read on a miss. It shares the
safety class (session-addressed) of `/api/sessions/:sessionId/tool-result/:toolCallId` but
reads the on-disk JSONL rather than the in-memory store.

#### Scenario: full payload fetched by toolCallId

- **GIVEN** a Write of a > 4 KB file whose in-memory event payload is truncated
- **WHEN** the client requests the full payload by `(sessionId, toolCallId)`
- **THEN** the response SHALL return the untruncated `content` read from the session JSONL

#### Scenario: no path input accepted, no path fallback

- **WHEN** a caller attempts to pass a filesystem path, or supplies an unknown `toolCallId`
- **THEN** the endpoint SHALL address content solely by `(sessionId, toolCallId)` via `sessionFile`, and on any miss SHALL return not-found WITHOUT reading any path

#### Scenario: entry evicted and JSONL missing

- **GIVEN** the in-memory event was trimmed AND the session JSONL entry cannot be located
- **THEN** the endpoint SHALL return a not-found result and the client SHALL render "diff unavailable"

### Requirement: Out-of-cwd diff display is opt-in

The client SHALL suppress out-of-cwd session-authored change rows (and SHALL NOT open their
diff tabs) unless the `showOutOfCwdSessionDiffs` preference is enabled. The default SHALL be
off. The preference gates display only; no server file-read surface exists for it to affect.

#### Scenario: preference off suppresses the row

- **GIVEN** `showOutOfCwdSessionDiffs` is off (default)
- **WHEN** the session wrote an out-of-cwd file
- **THEN** no change row for that file SHALL be shown and no diff tab can open for it

#### Scenario: preference on renders the payload diff

- **GIVEN** `showOutOfCwdSessionDiffs` is on
- **WHEN** the user clicks the out-of-cwd row
- **THEN** a diff tab SHALL open and render from the captured `change.content`/`change.edits` payload
