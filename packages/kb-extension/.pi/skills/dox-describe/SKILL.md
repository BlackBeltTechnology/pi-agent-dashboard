---
name: dox-describe
description: Fill the empty Purpose cells of a directory `AGENTS.md` tree with one-line LLM summaries (one subagent per file, plan-then-confirm, cap 50 rows/run). Use for a path-only `kb dox init` tree, or when asked to "describe the tree", "fill AGENTS.md purposes", or "populate the kb corpus".
---

# dox-describe

Turn a path-only directory `AGENTS.md` tree into a searchable kb corpus. A fresh
`kb dox init` tree carries rows shaped `` | `file.ts` | | `` — the Purpose cell is
empty, so the `agents` retrieval lane (the one file-lookup queries depend on)
finds nothing. This skill fills those cells with one-line, caveman-style
purposes, one subagent per `AGENTS.md`.

Read-only first: the CLI enumerates empty rows; the LLM only ever writes a
Purpose cell. The parent never edits an `AGENTS.md` itself, and a subagent edits
only the single file it was assigned.

## Step 1 — enumerate the empty rows

```bash
kb dox describe --list --json
```

Parse `{ groups: [{ agentsPath, subjects: string[] }], total }`. Each group is
one `AGENTS.md`; each subject is a path whose Purpose cell is empty. Nothing to
do when `total === 0` — say so and stop.

## Step 2 — present the plan and confirm

Show the user, then WAIT (`ask_user`, confirm) for approval before any write:

- number of `AGENTS.md` files (groups) and number of rows (total);
- a rough cost estimate (≈ rows × one short file read, plus one subagent per
  group; state it is a rough bound, not a promise);
- the per-run cap: **50 rows**. Rows beyond the cap are DEFERRED to a re-run
  (the walk is empty-cells-only, so a re-run is resumable by construction);
- any row whose subject file is missing or unreadable (report, do not assign).

Never start fan-out without an explicit yes.

## Step 3 — fan out ONE subagent per `AGENTS.md`

Cap concurrency at **2 in flight** (the extension schedules a debounced reindex
on every markdown write, and every subagent contends on the single SQLite index;
≤2 keeps `SQLITE_BUSY` recoverable — the parent's final reindex is
authoritative). Skip groups whose rows are entirely past the cap.

Spawn with an inline `Agent` label (write-capable, parent defaults). Do NOT use
`Explore` — it is read-only and cannot fill cells.

Each subagent's task must include:

- the absolute `AGENTS.md` path and its assigned subjects (cap 50 total across
  all groups for this run);
- **must read every file it describes** — never guess from the filename;
- the row rules:
  - ONE line per row, exactly the schema `` | `file` | purpose | ``;
  - purpose ≤ 200 chars, caveman style: short declarative fragments, drop
    articles/copulas, subject → verb → object;
  - name key exports / contracts / params verbatim (`symbolName`, paths, env
    vars); concrete tokens over prose;
  - CONDENSE, never promote to a `<File>.AGENTS.md` sidecar — sidecar splitting
    is the parent's/`scripts/split-large-agents.mjs` job;
  - edit ONLY its own `AGENTS.md`; do not touch any other file;
  - write the purpose into the EXISTING row (same line, same path cell) — do not
    add, delete, or reorder rows;
  - a subject file that cannot be read (missing, binary, 0-byte) → leave its
    Purpose cell EMPTY and report it back; never invent a purpose.

## Step 4 — verify, report, reindex

1. `kb dox lint` — must be clean. On a finding, hand it back to the subagent
   that owns that `AGENTS.md` to repair or revert its OWN file (the parent never
   edits a tree file). Re-run lint after the repair.
2. One final reindex so the new purposes are searchable:
   ```bash
   kb index
   ```
   (The extension's debounced reindex is best-effort under contention; this
   explicit pass is authoritative.)
3. Report to the user: rows filled, rows deferred (cap), unreadable rows left
   empty, and — when deferred > 0 — "run `dox-describe` again to fill the rest".

Re-running is idempotent: `--list` returns only rows still empty, so a second
run writes nothing when everything is filled.

## Headless escape hatch

For very large trees (well past the 50-row cap), the plan-then-confirm loop is
boring to babysit. You may instead drive workers with parallel headless pi
processes (`pi -p "<task>"`), one per `AGENTS.md`, then run steps 4.1–4.3
yourself. This is an escape hatch, not the default: it skips the interactive
confirm, so the CALLER owns the cap and the `kb dox lint` gate.

## Pitfalls

- Do NOT let a subagent "improve" neighbouring cells or reformat the table — the
  parent's `--list` walk and `kb dox lint` both depend on the exact row shape.
- Do NOT fan out more than 2 at once — concurrent reindex writes can hit
  `SQLITE_BUSY`.
- A wrong-but-non-empty purpose is NOT revisited in v1 (no correctness oracle);
  a `--stale` refresh mode is a follow-up. Read the file before describing it.
- Never write a Purpose for a file you could not open — an empty cell is honest,
  a guessed one is rot.
