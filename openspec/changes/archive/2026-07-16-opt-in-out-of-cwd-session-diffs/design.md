# Design

## Summary

Render out-of-cwd session diffs from **session-captured payloads**, not from the file on
disk. Default render uses the truncated in-memory Write/Edit event payload (the shipped
`DiffPanel` Path C); a session-addressed lazy fetch upgrades to full fidelity from pi's
session JSONL on demand. The server never reads the out-of-cwd path. A default-off global
preference gates display only.

## Doubt-review history (why the first design was abandoned)

The initial draft proposed a server-side "eligibility gate": `/api/session-file` would read
an out-of-cwd file when `fs.realpath(request) ∈ realpath(session Write/Edit event path set)`,
with the preference gating display and the gate gating reads. A doubt-driven review
(single-model + cross-model `glm-5.2`) disproved it:

- **Pre-execution seeding** — the event path set is built from `tool_execution_start`
  (fires *before* the tool runs). A prompt-injected or pi-*rejected* `write({path:"/etc/passwd"})`
  still records the path → it enters the eligible set → readable over HTTP.
- **Symlink-target inflation** — `fs.realpath` resolves symlinks to their targets, so an
  induced symlink write makes a sensitive target a member of the eligible set.
- **Remote reachability** — because eligibility is server-side and independent of the
  preference, a remote (zrok/tunnel) HTTP-only viewer reaches the read channel with the
  toggle off. The "attacker already has the secret" dismissal is false in the multi-actor /
  remote model.
- **Ignored the shipped standard** — the repo already governs `/api/file*` with
  `path-containment.ts` (git-common-root + realpath, explicitly unconditional across remote).
  The eligibility gate invented a weaker, attacker-influenceable parallel boundary.

Conclusion: **do not read the out-of-cwd file server-side at all.** The content the diff
needs is already captured in the session's events.

## Render path (default): payload, no file read

`DiffPanel` already derives a diff from a file's own change payload (`changeToRichDiff`):
`change.content` for a Write, `change.edits` for an Edit — the "Path C" branch used today for
in-cwd non-git files. This change carries an out-of-cwd entry into `data.files` so it reaches
that same branch. The server, in `session-diff.ts`:

1. Stops dropping out-of-cwd Write/Edit paths (today `normalizePath` returns `null`).
2. Carries the entry keyed by its **absolute path**, with its `changes[]` payload intact.
3. **Skips** all filesystem/git enrichment for out-of-cwd entries — no synthetic-diff
   `readFileSync(resolve(cwd, path))` (which for an absolute path = the path itself → a read),
   no `git diff HEAD -- <path>` / `numstat` (out-of-repo, and would emit malformed
   `diff --git a//tmp/x` headers). The one guard that matters: the enrichment's untracked
   synthetic-diff branch must be bypassed for out-of-cwd, or the read channel returns.

In-cwd entries keep the existing relative-posix key and full git/synthetic enrichment
(unchanged — INV3).

**Guard placement is load-bearing (doubt-review cycle 2, F1).** `enrichWithGitDiff` contains
`readFileSync(resolve(cwd, file.path))` in its untracked synthetic-diff branch; on Unix
`resolve(cwd, "/abs")` = `/abs`, so an out-of-cwd absolute-keyed entry reaching enrichment
WOULD read that file (real trigger: cwd `/repo/packages/server`, write `/repo/.env` — outside
cwd, under the repo, untracked). The guard therefore MUST filter out-of-cwd entries **before**
they are passed to `enrichWithGitDiff` — in `buildSessionDiff`, split entries into in-cwd
(enriched) vs out-of-cwd (payload-only, never enriched). Enrichment must never receive an
out-of-cwd entry. "Out-of-cwd" = any path `normalizePath` would drop (not under `cwd`). This
is a tested invariant: a unit test asserts zero `readFileSync`/`git` calls for an out-of-cwd
path. `FileDiffEntry.path`'s "relative to cwd" doc is widened to allow an absolute key for
out-of-cwd entries; every relative-assuming consumer (numstat map, file tree) is handled
explicitly below.

## Fidelity (two-tier): session-addressed lazy load

The in-memory event store (`memory-event-store.ts`) caps string fields at ~4 KB and collapses
`edits` arrays > 20 (`"[array truncated]"`), and can evict `tool_execution_*` events under
memory pressure. So the default payload render can be partial. Upgrade on demand:

```
  DEFAULT                              ON-DEMAND (user opens a truncated diff)
  in-memory event payload (~4 KB)      GET full payload by (sessionId, toolCallId)
  → DiffPanel Path C render            → resolve sessionId→JSONL (session-scanner)
                                       → find the Write/Edit entry by toolCallId
                                       → return full untruncated content / edits
                                       → re-render full diff
```

The durable source is **pi's own session JSONL** (`~/.pi/agent/sessions/…`), verified to
store Write `content` untruncated (sampled entries 6 KB–7 KB, no truncation marker). The
dashboard already reads these files (`session-file-reader.ts`, `session-scanner.ts`).

**Safety keystone:** the lazy endpoint's input is a **session-scoped identifier**
`(sessionId, toolCallId)`, resolved against the session's own transcript — **never** a
filesystem path. No path traversal, no `realpath`, no symlink follow, no arbitrary read.
It shares the **safety class** (session-addressed, not path-addressed) of the existing
`/api/sessions/:sessionId/tool-result/:toolCallId` endpoint — but NOT its implementation:
that endpoint reads the **in-memory** event store (`findToolEndEvent`); this one reads the
**on-disk JSONL** (cycle-2 F2). The lookup is fully specified to prevent an implementer from
adding an unsafe path fallback:

1. Resolve `sessionId → JSONL file` via `sessionManager.get(sessionId)?.sessionFile` — a path
   set at session creation (bridge `session_register` / scanner), **never** constructed from
   the `sessionId` string (cycle-2 F3; constructing from `sessionId` is path-traversal).
2. Parse the JSONL entries (`session-file-reader.ts::loadSessionEntries`).
3. Find the assistant message whose `content[]` holds `{ type: "toolCall", id === toolCallId }`
   — `toolCallId` is nested at `message.content[].id`, NOT at the entry top level (cycle-2 F2).
4. Return that tool call's `args.content` (Write) / `args.edits` (Edit).
5. On any miss (unknown id, missing file, unparseable) → not-found. **No path fallback of any
   kind is permitted.**

Because the in-memory store truncates every string field at ~4 KB, this endpoint is REQUIRED
for correctness (not merely an optimization) for any Write > 4 KB or any Edit with > 20 ops
(the `edits` array collapses to `"[array truncated]"`) — cycle-2 F7.

Bonus: this resolves the review's F6 (in-memory trimming silently drops the payload) — the
durable JSONL survives eviction, so the on-demand path is robust under memory pressure.

## Preference (display only)

`showOutOfCwdSessionDiffs`, default **off**. Off → the client suppresses out-of-cwd rows
(today's safe behavior; no dead tab). On → rows render and open payload diffs. Because there
is no server read surface, the preference carries no security role — it is purely UX. (The
original design's INV1 "preference must not change readability" is now vacuous: nothing is
read server-side either way.)

## Threat model (post-pivot)

No filesystem read of any out-of-cwd path is introduced. All out-of-cwd fidelity comes from
session-captured payloads addressed by session id. A remote HTTP-only viewer can retrieve
only what the session already recorded as Write/Edit content — which the dashboard already
exposes today through the change stream / tool-result endpoint. No new read capability, local
or remote. A prompt-injected `write({path:"/etc/passwd", content:"x"})` renders only the
attacker-supplied `content`, never the on-disk `/etc/passwd`.

## Absolute-key fallout in existing consumers (cycle-2 F4/F5/F6)

Carrying an absolute path as `FileDiffEntry.path` breaks code that assumes a cwd-relative key:

- **File tree** (`diff-tree.ts::buildFileTree` splits on `/`): an absolute `/tmp/x` yields a
  `["", "tmp", "x"]` blank-root node and an incoherent mixed tree. Out-of-cwd entries SHALL be
  rendered in a distinct "outside workspace" grouping (or with a dedicated leaf label), NOT
  merged into the relative tree.
- **File-content view toggle** (`DiffPanel`): the "File" view fetches
  `/api/session-file?path=…`, which correctly 403s for out-of-cwd → an error dialog. Out-of-cwd
  entries SHALL carry `previewable: false`, and `DiffPanel` SHALL respect it by hiding the
  File-view toggle (today it ignores the flag).
- **numstat** (`gitNumstat` map keyed by git `--relative` output): absolute keys never match;
  this is fine because out-of-cwd entries are payload-only (no numstat). Line counts, when
  shown, derive client-side from the payload (existing `lineDelta`).

## Graceful degradation

| Case | Behavior |
|---|---|
| Written then deleted | "file no longer present" — nothing read |
| Payload truncated, JSONL fetch fails/unavailable | partial (truncated) diff + "content truncated — full version unavailable" banner |
| `edits` collapsed (> 20), no lazy fetch | "diff too large to show inline" |
| Full content very large | **no render cap — always render full** (decision: accept large DOM) |
| Event evicted + JSONL missing | "diff unavailable" |

## Open questions (implementation-time)

- **Correlation key** — confirm the JSONL Write/Edit entry carries the `toolCallId` the
  dashboard event uses (the tool-result endpoint already correlates by `toolCallId` in
  memory; the JSONL lookup must match the same id, or fall back to entry sequence).
- ~~Large-content render cap~~ — **decided: no cap, always render full** (accept large DOM).
- **Endpoint shape** — reuse/extend the tool-result endpoint vs. a dedicated
  `/api/session-change/:sessionId/:toolCallId`. Leaning: a dedicated route returning
  `{ content?, edits? }` so the client renders via the existing `changeToRichDiff`.
- **`data.files` placement** — same `files` array (flagged out-of-cwd, client filters on the
  preference) vs. a separate bucket. Leaning: same array + flag, one render path.
