# Design — detect-tool-created-files

## Context

`extractFileChanges(events, cwd)` (`packages/server/src/session-diff.ts`) is the sole source
of the changed-file list; it reads only `write`/`edit` tool events and keys files via
`normalizePath(rawPath, cwd)` → **cwd-relative, posix, unquoted** paths. `enrichWithGitDiff`
decorates the given list (per-file `git diff`, numstat, and a synthetic new-file diff for
untracked entries via `readFileSync(abs,"utf-8")`); it never *adds* a file. The list is
served over `GET /api/session-diff`; the client reads/previews via the cwd-gated
`GET /api/session-file` (403 outside cwd).

Adjacent in-flight change **`fix-session-diff-open-nongit-and-preview`** edits the SAME spec
and code (cwd-relative-posix key contract + first-class file preview, "no wire change"). This
change is additive at the wire level and keeps the same key frame, but the two WILL collide
on `session-diff.ts` and the `session-diff-extraction` spec. Reconciliation is explicit
(Decision 8), not "rebase and hope".

Adjacent, synergistic (no file/spec overlap): `auto-canvas` drives a preview surface from
tool events but explicitly drops bash/mtime detection as "no reliable signal" and detects
`write`/`edit` only. This change builds that signal (git-status + Bash-token + mtime-window).
The two are additive here; a future follow-up could feed this change's `origin:"tool"` +
`sessionOwned` deliverables into auto-canvas's classifier — but only after re-clearing
auto-canvas's auto-open security bar (safe-for-list ≠ safe-for-auto-open).

## Scope (v1)

- **IN:** git-status detection of tool-created files **inside cwd**; Bash-command
  attribution *labels* on detected files; non-git detection via Bash-token scan +
  **in-cwd** `existsSync`; origin/attribution wire fields + Files-panel badge.
- **DEFERRED to a follow-up change:** files created **outside** cwd. v1 filters them out
  exactly like Write/Edit does today. This removes the unanchored-probe-oracle risk and the
  not-previewable UX gap. (Rationale: reviewers flagged out-of-cwd as the security/complexity
  hotspot; the converter/image/script cases are covered whenever they write into the project.)

## Decision 1 — detector vs attributor, split by git availability

```
  GIT REPO (cwd is a git worktree)
    DETECTOR  = git status --porcelain, run WITH cwd = session.cwd
                → each entry → unquote → resolve rename target
                → normalizePath(abs, cwd)  (SAME pipeline as Write/Edit)
                → out-of-cwd entries filtered (return null) — matches today's behavior
    ATTRIBUTOR = Bash-token scan; ONLY labels a file the detector already found.
                 Never adds a file inside cwd. Kills grep -o / ssh -o false positives:
                 a named path that does not exist / is not detected gets no label.

  NON-GIT REPO
    DETECTOR  = Bash-token scan + in-cwd existsSync. A parsed output path is
                normalizePath'd (cwd-contained) then existsSync-gated. Anchored to cwd,
                so no arbitrary-path probe oracle. Best-effort by construction.
```

**Why route porcelain through `normalizePath`:** git status prints paths in git's *default*
frame; running the command with `cwd = session.cwd` makes them cwd-relative, but the ONLY way
to guarantee the detector's keys match the Write/Edit keys (contract 7: no double-listing) is
to resolve each to an absolute path and pass it through the identical `normalizePath`. A test
pins this equivalence so a later `--porcelain=v2` / `-C` / pathspec refactor can't silently
re-break dedup.

**Porcelain parse robustness (contract 7):** the detector MUST (a) C-unquote paths that git
wraps in `"…"` with backslash escapes, and (b) handle rename lines `R  old -> new` /
`C  old -> new` by taking the **new** path. The existing `getDirtyFiles` `slice(3)` does
neither — the detector uses a dedicated porcelain parser, not `getDirtyFiles`.

## Decision 2 — wire schema (additive; older clients ignore unknown fields)

Attribution lives at the **file** level, not per change-event (fixes the ghost-event / count
inflation and the incoherent `mixed`-on-event problem):

- `FileDiffEntry` gains:
  - `origin?: "write" | "edit" | "tool" | "mixed"`
  - `producedBy?: string` — redacted, capped label of the attributing Bash command
  - `detectedVia?: "git-status" | "bash-artifact"` — how it was *detected* (git-status wins
    when both apply; `producedBy` is the independent *attribution* and may be set regardless)
  - `previewable?: boolean` — reserved; always `true` in v1 (all rows are in-cwd). The field
    ships now so the deferred out-of-cwd follow-up can set `false` without a wire bump.
- `FileChangeEvent.type` union gains `"tool"`.

## Decision 3 — dedup, precedence, and NO ghost events

Group by normalized path (one shared key space, Decision 1). Per path:

1. Has ≥1 `write`/`edit` event → keep those real change events unchanged. If the detector also
   found it, set `entry.origin = "mixed"` and optionally `producedBy` — but **inject no
   synthetic change event** (the change list stays the real edits; no count inflation, no
   ghost row).
2. Detector-only (no write/edit) → `entry.origin = "tool"`, `changes = [ one representative
   event { type: "tool", timestamp, producedBy?, } ]` so `changes[]` is never empty.

A Bash false-positive that names a real, separately-edited file therefore can at most add a
`producedBy` label — it can NEVER rewrite that file's real edits or invent changes.

## Decision 3b — session-ownership gating (git state is cwd-scoped, not session-scoped)

`git status --porcelain` reflects the **working tree**, keyed by cwd, not by session
(`packages/shared/src/types.ts`: "sessions sharing a cwd share one working tree"). Multiple
sessions can share a cwd (`active-sessions-in-cwd.ts`). A raw union would surface files another
session — or a manual edit, or a build — touched, which THIS session never went near.
`.gitignore` files are already excluded (porcelain default), but that does not solve
cross-session pollution.

Each git-detected file is classified by **ownership evidence** from THIS session's events:

1. a `write`/`edit` event for the path (definitive), OR
2. a Bash output-token naming the path (strong), OR
3. the file's `statSync` **mtime falls inside one of this session's Bash execution windows**
   `[tool_execution_start.ts, tool_execution_end.ts]` (catches a converter output the command
   never named).

- **Any hit → `sessionOwned: true`** → file goes in `data.files` with its `origin`.
- **No hit → `sessionOwned: false`** → file goes in a separate `data.otherChanges[]` array
  ("working-tree changes this session cannot claim"). NOT dropped — the worktree is genuinely
  shared, so hiding it outright confuses ("I made that, where is it?").

**Client treatment (B default + A toggle):** `data.files` renders normally; `data.otherChanges`
renders under a muted, **collapsed** `▸ N other working-tree changes` group. A header toggle
"this session only" (A) hides that group entirely. Default = B (collapsed-but-present).

**mtime-window mechanics + fallbacks:** window = `[start, end]` from the Bash tool's execution
events; no `end` (still running / dropped) → `[start, now]`. A small slack (≈±1 s) absorbs
fs/event clock jitter. Evidence ③ requires an actual Bash window — NOT merely "mtime after
session start" — so a formatter/editor/`git checkout` bump does not falsely claim a file.
Deleted paths (` D`/`D `) are out of scope (Non-Goal: feature is tool-*created* files).

**Known limits (documented, accepted):** mtime is coarse; concurrent sessions in the same cwd
with overlapping Bash windows are genuinely ambiguous (mtime alone can't split them —
Decision 3c is the future fix); clock domains differ under docker/remote. Worktree-isolated
sessions (OpenSpec flow, one session per worktree) already have a session-scoped working tree,
so `otherChanges` is empty there — this gating is a no-op where isolation exists and only does
work in the shared-cwd case that needs it.

## Decision 3c — positive other-session attribution (deferred, follow-up)

The server sees ALL sessions in a cwd (`active-sessions-in-cwd.ts`) and their event streams, so
an `otherChanges` file's mtime could be matched to another session's Bash window to label it
`changed by <session>` instead of the generic group. Deferred: more compute + overlapping-window
ambiguity needs its own rules. B (the collapsed group) ships first.

## Decision 4 — binary + size safety on the synthetic diff (fixes the headline case)

nano-banana emits PNGs; the existing synthetic-diff path reads the file as utf-8 and prefixes
every line with `+`. For a tool-detected file the detector MUST, before generating a synthetic
diff: (a) sniff binary (NUL byte in the first block, or a known-binary extension), and
(b) enforce a **256 KB** size cap. Binary/oversized tool rows are listed with `origin: "tool"` and **no
`gitDiff`** — the Files panel renders them via the existing image/preview dispatch, not the
text differ. `gitNumstat`'s `-` binary guard does NOT cover this path; the sniff is new.

## Decision 5 — secret redaction on `producedBy` (contract 5-adjacent, security)

`/api/session-diff` is a NEW exposure channel for Bash command text (previously it never left
the event store). `producedBy` MUST be sanitized before storage on the entry:

- Keep the leading program + the output flag/target only (e.g. `nano-banana … --output logo.png`),
  drop the middle.
- Redact known secret shapes (`Bearer <tok>`, `ghp_…`, `sk-…`, `--pass…`, `-u user:pass`,
  `AWS_SECRET…`, `password=…`) → `‹redacted›`.
- Hard length cap (reuse the `MAX_MESSAGE_LENGTH = 120` convention).

## Decision 6 — performance / dedup with existing enrichment

Run one bulk `git status --porcelain` for detection and **thread its parsed untracked set into
`enrichWithGitDiff`** so the per-file `statusPorcelainOr` untracked probe (session-diff.ts:146)
is not re-spawned for the same files. Net: one bulk porcelain replaces N per-file porcelain
probes. Trade-off (documented, accepted): bulk porcelain scans the whole worktree, so on a very
large monorepo it can be heavier and can hit `GIT_TIMEOUT` (15 s) → detector yields nothing,
endpoint still returns (contract 6). A **200-entry** file-count cap bounds the produced
`FileDiffEntry[]` (Write/Edit entries take precedence when truncating).

## Decision 7 — degradation (contract 6 preserved)

- git absent / not a repo / timeout → `statusPorcelainOr` returns "" → detector empty;
  non-git Bash+existsSync path still runs; endpoint never fails.
- Unparseable Bash command → no attribution; git-detected file still listed (no `producedBy`).
- Attribution timestamp collision → later-by-timestamp wins; ties resolved by event order;
  never throws. (Attribution is a cosmetic label, so non-determinism here is low-stakes.)
- Tool-origin `timestamp`: use the attributing Bash event's timestamp when available, else the
  file's `statSync` mtime, else request time — never `0` (avoids "54 years ago").

## Decision 8 — reconciliation with `fix-session-diff-open-nongit-and-preview`

Both edit `session-diff.ts` + `session-diff-extraction`. Contract with the sibling change:

- **Key frame is shared and unchanged** — this change keeps cwd-relative-posix keys (Decision
  1), satisfying the sibling's "keys unchanged (already relative)" invariant.
- **Wire is additive** — new optional fields only; the sibling's "no wire change" is not
  violated for its own rows.
- **Merge order** — whichever lands second rebases; the second PR MUST re-run the shared
  `session-diff` test suite (including the new dedup-equivalence test, Decision 1) to prove the
  combined `extractFileChanges` still emits one key per path. The two spec deltas are authored
  as disjoint requirements (this change: ADDED detection/attribution requirements + a narrow
  MODIFY of "Event-based change extraction"; the sibling: cwd-filter + non-git diff) to
  minimize textual overlap.

## Alternatives considered

- **Bash-only detection (no git):** rejected as the primary path — cannot see files a program
  wrote without naming them. Kept ONLY as the non-git detector, anchored to cwd.
- **Attribution as a real detector inside cwd:** rejected — produces the `grep -o` / `ssh -o`
  false-positive storm both reviewers flagged. Attribution only *labels* detected files.
- **Wrap converter/image CLIs as structured pi tools:** rejected (Non-Goal) — huge surface,
  helps nothing for arbitrary scripts.
- **Out-of-cwd listing in v1:** deferred (Scope) — unanchored probe oracle + not-previewable
  UX; belongs in its own security-reviewed change.
- **Loosen `/api/session-file` for out-of-cwd preview:** rejected — security invariant.
