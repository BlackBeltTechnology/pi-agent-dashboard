## Why

A session that writes a file **outside its workspace** — e.g. the frontend-mockup-loop
writing `/tmp/mime-icon-mockup/index.html` — produces a **clickable change-summary row
that opens a permanently-empty diff tab**.

Two code paths disagree about what counts as a "changed file":

- **Client** (`lineDelta.ts::buildTurnSummaries` → `toolPath`) builds the summary rows
  straight from each Write/Edit event's `args.path` with **no cwd containment check**, so
  an out-of-cwd path becomes a clickable row.
- **Server** drops it: `session-diff.ts::normalizePath` returns `null` for out-of-cwd paths,
  so the file never reaches `data.files`. `normalizeUnderCwd` leaves the absolute path
  verbatim, so the tab opens under `diff:/tmp/…` and `DiffViewer.find(...)` misses.

Result: `DiffViewer` falls to its `!file` branch and renders the dim "No changes for this
file" text — an empty-looking panel. Structural, not mockup-specific: **any** out-of-cwd
file a session writes reproduces it.

The workspace-confinement boundary exists on purpose (the dashboard, exposable remotely via
zrok/tunnel, must not read arbitrary files). An earlier draft of this change proposed a
server-side realpath "eligibility gate" to read the out-of-cwd file on demand; a
doubt-driven review (single + cross-model) **disproved** it as a remotely-reachable
arbitrary-file-read hole (see `design.md`). This proposal takes the safe path the review
revealed: **render the diff from data the session already captured — the server never reads
the out-of-cwd file.**

## What Changes

- **Render out-of-cwd diffs from the captured Write/Edit event payload — no file read.**
  `DiffPanel` already renders diffs from `change.content` (Write) / `change.edits` (Edit)
  via its "Path C" (change-derived) branch, used today for in-cwd non-git files. This change
  lets an out-of-cwd entry reach that same shipped render path. The server performs **no
  filesystem read** of the out-of-cwd path.

- **Server carries out-of-cwd session-authored entries, skips fs/git enrichment.**
  `session-diff.ts` stops dropping out-of-cwd Write/Edit paths; it carries the entry with its
  `changes[]` payload, keyed by absolute path, and **skips** all filesystem/git enrichment
  for it (no synthetic-diff `readFileSync`, no `git diff`/`numstat` with an out-of-repo
  path). In-cwd behavior is unchanged.

- **Two-tier fidelity via session-addressed lazy load (no path read).** The in-memory event
  store caps string fields at ~4 KB and collapses `edits` arrays > 20, so the default render
  can be partial for large files. On demand — when the user opens a diff whose payload is
  truncated or was evicted — the client lazily fetches the **full** Write/Edit payload from
  pi's own **session JSONL** (`~/.pi/agent/sessions/…`, which stores it untruncated),
  addressed by `(sessionId, toolCallId)` — **never** by filesystem path. This mirrors the
  existing `/api/sessions/:sessionId/tool-result/:toolCallId` "Show full output" endpoint and
  is the same safety class (session-scoped identifier, not a path). It also makes the render
  robust against in-memory event trimming.

- **Opt-in global preference (default off).** `showOutOfCwdSessionDiffs` — "Show diffs for
  files this session writes outside its workspace." Off (default) → out-of-cwd rows are
  suppressed client-side (no dead tab, unchanged from today's safe behavior). On → they
  render. The preference gates display only; there is no server read surface for it to gate.

- **Graceful degradation.** Written-then-deleted → the row/tab shows "file no longer present"
  (nothing read). Payload truncated and JSONL unavailable → partial diff + a "content
  truncated" note. `edits` array collapsed (> 20) with no lazy fetch → "diff too large to
  show inline." Very large full content → render cap + "open externally."

## Non-goals

- No server-side read of the out-of-cwd file on disk. No realpath eligibility gate. No
  `/api/session-file` change. (All removed after the doubt review — see `design.md`.)
- Files created out-of-cwd by Bash/`wget`/`cp`/MCP tools (no captured Write/Edit payload)
  stay hidden — there is nothing to render without reading the path. Known, consistent gap.

## Discipline Skills

- `security-hardening` — the design's core property is "no new file-read surface"; verify the
  lazy-load path is session-addressed, never path-addressed.
- `doubt-driven-review` — already applied (it produced this pivot); re-applied to the revised
  design before scenarios are folded.

## Capabilities

### Modified Capabilities
- `session-diff-extraction`: out-of-cwd Write/Edit-authored files SHALL be carried (payload
  only, no fs/git enrichment) instead of dropped; a session-addressed endpoint SHALL serve
  the full untruncated payload from the session JSONL on demand.
- `change-summary-table`: an out-of-cwd row SHALL be suppressed when the preference is off,
  and SHALL open a payload-rendered diff (with lazy full-fidelity fetch) when on.

## Impact

- **Code**:
  - `packages/server/src/session-diff.ts` — carry out-of-cwd Write/Edit entries (absolute
    key); skip fs/git enrichment for them.
  - `packages/server/src/routes/session-routes.ts` — add a session-addressed
    full-payload endpoint (`(sessionId, toolCallId)` → JSONL lookup); **no** `/api/session-file`
    change.
  - `packages/server/src/session-file-reader.ts` / `session-scanner.ts` — reuse to resolve
    `sessionId → JSONL` and locate the Write/Edit entry by `toolCallId`.
  - `packages/client/src/components/DiffPanel.tsx` / `DiffViewer.tsx` — resolve out-of-cwd
    entry by absolute key; lazy-fetch full payload when truncated; handle collapsed `edits`.
  - `packages/client/src/lib/lineDelta.ts` / `ChatView.tsx` — suppress out-of-cwd rows when
    the preference is off.
  - client preferences surface — add `showOutOfCwdSessionDiffs` (default off).
- **Tests**: out-of-cwd Write appears in `data.files` with payload + no gitDiff and no fs
  read; preference off suppresses row / on renders diff; large payload lazy-fetches full
  content from JSONL by toolCallId; deleted-since-write → "file no longer present";
  collapsed-edits → inline-too-large message; in-cwd behavior unchanged (regression).
- **APIs / protocol**: additive session-addressed full-payload endpoint; `/api/session-diff`
  may include out-of-cwd entries keyed by absolute path.
- **Persistence**: none added — the durable source is pi's existing session JSONL. No trust
  store.
- **Security posture**: no filesystem read of any out-of-cwd path is introduced; all
  fidelity comes from session-captured payloads addressed by session id. See `design.md`
  threat model.
