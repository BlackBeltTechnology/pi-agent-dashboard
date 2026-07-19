## Purpose

Extract per-session file changes from the event stream and expose them over a
localhost-only REST endpoint, optionally enriched with git diff output and
`git diff --numstat` line counts.
## Requirements
### Requirement: Session diff REST endpoint
The server SHALL expose `GET /api/session-diff?sessionId=<id>` (localhost-only) that returns the list of changed files with their individual change events for a given session.

#### Scenario: Successful response
- **WHEN** `GET /api/session-diff?sessionId=xxx` is called for a valid session
- **THEN** the response SHALL return `{ success: true, data: { files: [...], isGitRepo: boolean } }`
- **AND** each file entry SHALL contain `path` (relative to cwd), `changes` (array of change events), and optionally `gitDiff` (unified diff string from `git diff HEAD` when available)

#### Scenario: Session not found
- **WHEN** the sessionId does not exist
- **THEN** the response SHALL return `{ success: false, error: "session not found" }`

#### Scenario: Missing sessionId parameter
- **WHEN** the sessionId query parameter is missing
- **THEN** the response SHALL return `{ success: false, error: "sessionId required" }`

### Requirement: Event-based change extraction
The server SHALL scan session events from the event store to extract individual file change events. Each change event SHALL include the timestamp, tool type, and tool-specific data. The change-event `type` SHALL be one of `"edit" | "write" | "tool"`, where `"tool"` denotes a file surfaced by git-status detection or non-git Bash detection rather than a direct Write/Edit call. Each file entry (`FileDiffEntry`) SHALL carry an `origin` of `"write" | "edit" | "tool" | "mixed"`, and MAY carry `producedBy`, `detectedVia`, `sessionOwned`, and a reserved `previewable` flag. The response MAY carry a separate `otherChanges: FileDiffEntry[]` array for git-detected files this session cannot claim. Attribution fields live at the file level; a `"mixed"` file SHALL retain its real Write/Edit change events with NO synthetic `"tool"` event injected.

#### Scenario: Edit tool change
- **WHEN** a `tool_execution_start` event has `toolName` matching "Edit" (case-insensitive)
- **THEN** the change event SHALL include `type: "edit"`, `timestamp`, `path` (from `args.path` or `args.file_path`), and `edits` (array of `{ oldText, newText }` from `args.edits`)

#### Scenario: Write tool change
- **WHEN** a `tool_execution_start` event has `toolName` matching "Write" (case-insensitive)
- **THEN** the change event SHALL include `type: "write"`, `timestamp`, `path` (from `args.path` or `args.file_path`), and `content` (from `args.content`)

#### Scenario: Pure tool-origin file has one representative event
- **WHEN** a file is surfaced only by detection (no Write/Edit event)
- **THEN** its `changes` SHALL contain exactly one event with `type: "tool"`, a non-zero `timestamp` (attributing Bash event time, else file mtime, else request time), and optional `producedBy`

#### Scenario: Duplicate paths grouped
- **WHEN** the same file path appears in multiple tool events
- **THEN** all change events for that path SHALL be grouped under a single file entry, ordered by timestamp

#### Scenario: Context message extraction
- **WHEN** extracting a change event
- **THEN** the server SHALL include a `message` field with a truncated excerpt (max 120 chars) from the most recent assistant `message_end` event preceding the tool call, if available

### Requirement: Filter files outside cwd
The server SHALL exclude file paths that resolve to locations outside the session's cwd, and SHALL rewrite every retained path to be relative to the session cwd using posix separators. The absolute-under-cwd → relative-posix rule SHALL be the canonical path-normalization contract that clients mirror when materializing changed-file paths from raw tool-call `args.path`.

#### Scenario: Absolute path outside cwd
- **WHEN** a Write/Edit event references an absolute path outside the session cwd (e.g., `/tmp/scratch.ts` when cwd is `/home/user/project`)
- **THEN** that file SHALL NOT be included in the response

#### Scenario: Absolute path inside cwd
- **WHEN** a Write/Edit event references an absolute path inside the session cwd (e.g., `/home/user/project/src/foo.ts` when cwd is `/home/user/project`)
- **THEN** the path SHALL be included and rewritten to relative-posix (`src/foo.ts`)
- **AND** the response key for that file SHALL be the relative-posix form (never the absolute form)

#### Scenario: Relative path inside cwd
- **WHEN** a Write/Edit event references a relative path (e.g., `src/foo.ts`)
- **THEN** the path SHALL be included and kept relative to cwd

### Requirement: Optional git diff enrichment

When the session cwd is a git repository, the server SHALL optionally include aggregate `git diff HEAD` output per file AND optional per-file and aggregate line-change counts derived from `git diff --numstat HEAD`. Git-diff enrichment for the session-diff request path SHALL be computed **without blocking the Node event loop**: no synchronous git subprocess (`spawnSync`) SHALL run on the `GET /api/session-diff` request path. Per-file content diffs SHALL be produced from a **single** batched `git diff` invocation over the worktree (not one subprocess per changed file), split per file. A tracked file whose diff or on-disk blob exceeds `TRACKED_DIFF_MAX_BYTES` SHALL be listed with its numstat `additions`/`deletions` but no text `gitDiff`.

#### Scenario: Git repo with uncommitted changes
- **WHEN** the session cwd is a git repository
- **AND** a file has uncommitted changes vs HEAD
- **THEN** the file entry SHALL include `gitDiff` with the unified diff output for that file
- **AND** the file entry SHALL include `additions` and `deletions` (non-negative integers) from `git diff --numstat HEAD`
- **AND** the response SHALL include `totalAdditions` and `totalDeletions` summing all files
- **AND** `isGitRepo` SHALL be `true`

#### Scenario: Content diffs come from one batched spawn
- **WHEN** the session has N (N > 1) changed tracked files
- **THEN** the server SHALL compute all per-file content diffs from a single `git diff` subprocess over the worktree
- **AND** it SHALL NOT spawn one `git diff -- <path>` subprocess per changed file

#### Scenario: No synchronous git spawn on the request path
- **WHEN** `GET /api/session-diff` computes enrichment for a git repo
- **THEN** every git subprocess it runs SHALL be asynchronous (non-blocking)
- **AND** no `spawnSync` git call SHALL be reachable from the session-diff request handler

#### Scenario: Non-git repository
- **WHEN** the session cwd is not a git repository
- **THEN** `isGitRepo` SHALL be `false`
- **AND** no `gitDiff` fields SHALL be present
- **AND** `additions`, `deletions`, `totalAdditions`, `totalDeletions` SHALL be absent

#### Scenario: Git not available or errors
- **WHEN** git commands fail (e.g., corrupted repo, git not installed)
- **THEN** the endpoint SHALL still return the event-based changes with `isGitRepo: false`
- **AND** SHALL NOT fail the request
- **AND** SHALL omit the numstat-derived count fields

#### Scenario: Binary or unmergeable file in numstat
- **WHEN** `git diff --numstat` reports `-` for additions/deletions (binary file)
- **THEN** the file entry SHALL omit `additions`/`deletions` rather than emit a non-numeric value
- **AND** that file SHALL NOT contribute to `totalAdditions`/`totalDeletions`
- **AND** that file SHALL omit `gitDiff`

### Requirement: Session file read endpoint
The server SHALL expose `GET /api/session-file?sessionId=<id>&path=<relativePath>` (localhost-only) that reads a file from the session's cwd.

#### Scenario: Successful file read
- **WHEN** the sessionId is valid and the path resolves to a file within the session's cwd
- **THEN** the response SHALL return `{ success: true, data: { content: "..." } }`

#### Scenario: Path outside cwd
- **WHEN** the path resolves to a location outside the session's cwd
- **THEN** the response SHALL return 403 with `{ success: false, error: "path outside session directory" }`

#### Scenario: File not found
- **WHEN** the file does not exist on disk
- **THEN** the response SHALL return 404 with `{ success: false, error: "file not found" }`

#### Scenario: Missing parameters
- **WHEN** sessionId or path is missing
- **THEN** the response SHALL return 400 with `{ success: false, error: "sessionId and path required" }`

### Requirement: git-status file detection unioned into the changed-file list

When the session cwd is a git repository, the server SHALL scan `git status --porcelain` (run with `cwd = session.cwd`) and union each new/modified/untracked path into the changed-file list, so files created by any tool (not only Write/Edit) appear. Each porcelain path SHALL be C-unquoted, rename/copy lines (`R`/`C` `old -> new`) SHALL resolve to the new path, and each SHALL be passed through the SAME `normalizePath(abs, cwd)` pipeline as Write/Edit so keys share one space and paths outside cwd are excluded. Containment SHALL be tested via `path.relative(cwd, abs)` + `..`-prefix check, NOT a literal string prefix (`abs.startsWith(cwd)`), so a sibling directory sharing a name prefix is not falsely admitted. Paths already present from Write/Edit events SHALL be deduped by path (never listed twice).

#### Scenario: Tool-created file appears
- **WHEN** the session cwd is a git repo
- **AND** `out.docx` exists and is untracked/modified per `git status --porcelain`
- **AND** no Write/Edit event referenced `out.docx`
- **THEN** `data.files` SHALL include an entry for `out.docx` with `origin: "tool"`

#### Scenario: Key equivalence with Write/Edit (no double-listing)
- **WHEN** a path has a Write event AND appears in `git status --porcelain`
- **THEN** exactly one file entry SHALL exist for that path
- **AND** its `origin` SHALL be `"mixed"`
- **AND** its Write change events SHALL be preserved with NO synthetic change event added

#### Scenario: Quoted / renamed porcelain paths dedup correctly
- **WHEN** git reports a path with special characters as a C-quoted porcelain entry, or a rename line `R  old.ts -> new.ts`
- **THEN** the detector SHALL unquote / take the new path
- **AND** the resulting key SHALL equal the `normalizePath` key a Write/Edit event to the same file would produce

#### Scenario: Absolute path under cwd yields the relative key
- **WHEN** any source (porcelain, Bash-token, or a Write/Edit `args.path`) supplies an absolute path inside cwd (e.g. `/home/user/project/src/foo.ts`, cwd `/home/user/project`)
- **THEN** its key SHALL be the relative-posix form `src/foo.ts` (never the absolute form)
- **AND** an absolute-path source and a relative-path source for the same file SHALL dedup to ONE entry

#### Scenario: Sibling directory sharing a name prefix is not admitted
- **WHEN** cwd is `/home/user/project` and a path is `/home/user/project-backup/x.ts`
- **THEN** `path.relative(cwd, abs)` yields `../project-backup/x.ts` (starts with `..`)
- **AND** the file SHALL be excluded (a literal `startsWith(cwd)` prefix test would wrongly admit it)

#### Scenario: Path outside cwd excluded
- **WHEN** a porcelain entry resolves outside the session cwd
- **THEN** it SHALL NOT appear in `data.files` (v1 out-of-cwd files are out of scope)

#### Scenario: Gitignored files excluded
- **WHEN** a changed file is matched by `.gitignore`
- **THEN** it SHALL NOT appear in `data.files` (porcelain default, no `--ignored`)

#### Scenario: git unavailable
- **WHEN** git is not installed or the cwd is not a git repo
- **THEN** git-status detection SHALL contribute no entries
- **AND** the request SHALL NOT fail

### Requirement: Bash-command attribution labels detected files (best-effort)

The server SHALL scan `tool_execution_start` events with `toolName` matching "bash" (case-insensitive) for output tokens — `>`, `>>`, `-o <path>`, `--output <path>`, `--output=<path>`, `tee <path>` — and build a path → `{ command, timestamp }` map. Inside cwd, attribution SHALL only add a `producedBy` label to a file the detector already found; it SHALL NOT by itself add a file. The stored `producedBy` SHALL be secret-redacted and length-capped.

#### Scenario: Attribution labels a detected file
- **WHEN** a Bash event ran `npx nano-banana "logo" --output logo.png`
- **AND** `logo.png` is detected on disk by git-status
- **THEN** the `logo.png` entry SHALL carry `producedBy` containing the (redacted, capped) command and `detectedVia`

#### Scenario: False-positive token does not add or re-tag a file
- **WHEN** a Bash event ran `grep -o pattern src/index.ts` (no file created)
- **THEN** no new entry SHALL be added for `pattern`
- **AND** if `src/index.ts` has a real Write/Edit change, its change events SHALL NOT be rewritten (at most a file-level label may attach)

#### Scenario: Secret redaction on producedBy
- **WHEN** an attributing Bash command contains a secret shape (e.g. `-u user:TOKEN`, `Bearer sk-…`, `--password …`)
- **THEN** the secret SHALL be redacted from `producedBy` before it is included in the response

#### Scenario: Collision resolves by timestamp without throwing
- **WHEN** two Bash events name the same output path
- **THEN** the later (higher timestamp) command SHALL be used for `producedBy`
- **AND** extraction SHALL NOT throw

### Requirement: Non-git detection via in-cwd Bash-token scan

When the session cwd is NOT a git repository, the server SHALL detect tool-created files using the Bash-token scan plus an `existsSync` check, where each parsed output path is first `normalizePath`'d to be cwd-contained before the existence check (no arbitrary-path probe). Such entries SHALL have `origin: "tool"` and `detectedVia: "bash-artifact"`.

#### Scenario: Non-git in-cwd tool file listed
- **WHEN** the cwd is not a git repo
- **AND** a Bash command wrote `notes.md` inside cwd and the file exists
- **THEN** `data.files` SHALL include `notes.md` with `origin: "tool"` and `detectedVia: "bash-artifact"`

#### Scenario: Non-git out-of-cwd path not probed
- **WHEN** the cwd is not a git repo
- **AND** a Bash command named an output path resolving outside cwd
- **THEN** the server SHALL NOT `existsSync`-probe that path
- **AND** it SHALL NOT appear in `data.files`

### Requirement: Binary and size safety for tool-detected synthetic diffs

Before generating a synthetic new-file diff for a tool-detected file, the server SHALL binary-sniff (NUL byte in the leading block or a known-binary extension) and enforce a 256 KB size cap. Binary or oversized files SHALL be listed without a text `gitDiff`. The response SHALL cap `data.files` at 200 entries, with Write/Edit entries taking precedence over detector-only entries when truncating.

#### Scenario: Generated image is not rendered as a text diff
- **WHEN** a tool-detected file is a binary PNG (e.g. from nano-banana)
- **THEN** its entry SHALL be listed with `origin: "tool"` and NO text `gitDiff`
- **AND** the server SHALL NOT read it as utf-8 to build a synthetic diff

#### Scenario: Oversized file capped
- **WHEN** a tool-detected file exceeds 256 KB
- **THEN** its entry SHALL omit the synthetic `gitDiff` rather than embed the full content

#### Scenario: File-count cap
- **WHEN** detection would produce more than 200 file entries
- **THEN** `data.files` SHALL contain at most 200 entries
- **AND** Write/Edit entries SHALL be retained in preference to detector-only entries

### Requirement: Session-ownership gating of git-detected files

Because `git status` reflects the cwd's shared working tree (not the session), the server SHALL classify each git-detected file by ownership evidence from THIS session and SHALL place only owned files in `data.files`. A file is `sessionOwned: true` when ANY of: (1) a Write/Edit event references it, (2) a Bash output-token names it, or (3) its `statSync` mtime falls inside one of this session's Bash execution windows `[tool_execution_start, tool_execution_end]` (fallback `[start, now]` when no end), with a small clock slack. Files with no such evidence SHALL be returned in a separate `data.otherChanges[]` array (never silently dropped).

#### Scenario: File this session created is owned
- **WHEN** a Bash command in this session wrote `out.pdf` and its mtime is inside that command's execution window
- **THEN** `out.pdf` SHALL appear in `data.files` with `sessionOwned: true`

#### Scenario: Other-session file diverted to otherChanges
- **WHEN** `other.txt` is dirty in git status
- **AND** this session has no Write/Edit event, no Bash-token match, and no Bash window covering its mtime
- **THEN** `other.txt` SHALL NOT appear in `data.files`
- **AND** it SHALL appear in `data.otherChanges[]`

#### Scenario: mtime outside any Bash window is not claimed
- **WHEN** a dirty file's mtime is after session start but inside NO Bash execution window (e.g. a formatter-on-save bump)
- **THEN** it SHALL NOT be marked `sessionOwned`
- **AND** it SHALL be placed in `data.otherChanges[]`

#### Scenario: Worktree-isolated session has empty otherChanges
- **WHEN** the session's cwd is a dedicated worktree with no other session sharing it and every dirty file is attributable to this session
- **THEN** `data.otherChanges` SHALL be empty (or absent)

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

### Requirement: Event-loop responsiveness under heavy session diffs

Computing `GET /api/session-diff` for a session with many changed files and/or a very large tracked file SHALL NOT starve other HTTP requests. While a heavy diff is computed, unrelated endpoints (`/api/health`, static `GET /`, settings, prompt submission) SHALL remain responsive.

#### Scenario: Health stays responsive while a heavy diff computes
- **WHEN** a session cwd has hundreds of changed files and/or a tracked file larger than 100 MB
- **AND** `GET /api/session-diff` is computing that session's diff
- **THEN** a concurrent `GET /api/health` SHALL respond within a small latency budget (e.g. < 100 ms)
- **AND** the server SHALL NOT be wedged after the diff completes

#### Scenario: Repeated polls do not snowball
- **WHEN** multiple browser tabs / reconnects poll the same heavy session's diff concurrently
- **THEN** the server SHALL NOT accumulate one git spawn per poll per file
- **AND** HTTP request handling SHALL NOT stall into an unrecoverable spawn storm

### Requirement: Tracked-file diff size cap

The server SHALL enforce a byte cap `TRACKED_DIFF_MAX_BYTES` on tracked-file content diffs, analogous to the existing `SYNTHETIC_DIFF_MAX_BYTES` cap for synthetic new-file diffs. A tracked file whose diff (or on-disk blob) exceeds the cap SHALL be surfaced without a text `gitDiff`, and SHALL NOT be read as utf-8 or fed to `git diff` for text rendering.

#### Scenario: Oversized tracked file is not rendered as a text diff
- **WHEN** a tracked changed file's diff or blob exceeds `TRACKED_DIFF_MAX_BYTES` (e.g. a 992 MB `.tar`)
- **THEN** its entry SHALL be listed with any available `additions`/`deletions` from numstat
- **AND** its entry SHALL omit `gitDiff`
- **AND** the server SHALL NOT read the file as utf-8 nor run a per-file `git diff` to render it

#### Scenario: Normal-sized tracked file still shows a diff
- **WHEN** a tracked changed file's diff is below `TRACKED_DIFF_MAX_BYTES`
- **THEN** its entry SHALL include the unified `gitDiff` text as before

### Requirement: Session-diff result cache and single-flight

The server SHALL cache session-diff results per session for a short TTL, keyed by a signature that changes when the diff would change (e.g. HEAD sha + dirty-file signature). Concurrent requests for the same key SHALL coalesce onto one in-flight computation (single-flight) rather than each launching its own diff.

#### Scenario: Cache hit within TTL avoids recompute
- **WHEN** two `GET /api/session-diff` requests for the same session arrive within the cache TTL
- **AND** the session's HEAD and dirty state are unchanged between them
- **THEN** the second request SHALL return the cached result without recomputing the diff

#### Scenario: Concurrent identical requests coalesce
- **WHEN** two identical session-diff requests are in flight simultaneously for the same key
- **THEN** the server SHALL compute the diff once and serve both from that single computation

#### Scenario: State change busts the cache
- **WHEN** the session's HEAD sha or dirty-file signature changes
- **THEN** the next request SHALL recompute the diff rather than serve a stale cached entry

