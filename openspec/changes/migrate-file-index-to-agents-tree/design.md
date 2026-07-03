# Design — migrate-file-index-to-agents-tree

Captures an explore-mode finding: moving from centralized `docs/file-index-<area>.md`
to a recursive per-directory `AGENTS.md` tree (agent0ai/dox's real structure) is
possible, searchability-positive, but the shipped `kb dox init` targets the wrong
file set and cannot author purposes. The migration is therefore an
**LLM-authoring** job best run as **parallel `@fast` subagents**, one per directory.

## 0. Decisions (clarified pre-apply)

- **Deliverable = tooling + committed tree.** This change ships source-aware
  `dox init` + the migration orchestrator AND runs it once, committing the
  fully generated per-directory `AGENTS.md` tree. "Done" includes the tree on disk.
- **Scope = big-bang.** Entire `src/` + `packages/` source tree migrated in one
  change (no pilot area).
- **Granularity = every dir (option A).** Every directory holding ≥1 source file
  gets its own `AGENTS.md` (tightest BM25 chunk). `AREA_FILE_THRESHOLD` no longer
  gates source-mode `dox init` — no roll-up to ancestors, no minimum file count.
- **Tier-1 authored purposes route through a review pass.** Non-empty is not
  enough for `miss` rows — see §4c review gate. Deterministic Tier-0 (hit) rows
  skip review (byte-identical copy).
- **file-index fate = (B) generated rollup** (§4d). Splits become generated, tree
  is source of truth.
- **`directoryLevelAgents` ships pull-only.** Push mode deferred behind the §5
  context-cost spike; out of scope for this change.
- **Root `AGENTS.md` is protected; walk anchored at source roots.** The migration
  runs `dox init` per source root (`src/`, `packages/*/`) — NEVER repo root — so the
  hand-authored top-level `AGENTS.md` never receives a per-file index (Rule 0). Repo-
  root config files (`playwright.config.ts`, `vitest.config.ts`) are out of the tree.
  Also: `DEFAULT_EXCLUDE` is matched relative to the walk root, so running inside
  `.worktrees/<branch>/` does not self-exclude the whole tree.

## 1. Why searchability survives (and improves)

`kb_search` = FTS5 + BM25 over markdown **chunks**, each tagged `doc_type`
(`doc | agents | source-md`). The index is built by a directory walk + include-glob;
file location is irrelevant to token content.

```
doc_type      source                     searchable?
─────────────────────────────────────────────────────
doc           docs/*.md                       ✅
agents        AGENTS.md (any dir)  ◀────       ✅   ← flip indexAgentsFiles
source-md     *.md co-located in src/          ✅
```

A row emits identical BM25 tokens in `docs/file-index-client.md` or
`src/client/AGENTS.md`. BM25 favors tight chunks:

```
NOW   file-index-client.md  → 1 query term / ~200 rows  → score diluted
AFTER src/client/AGENTS.md   → 1 query term / ~10 rows   → tighter, ranks up
```

This is the exact fix for AGENTS.md's own warning that file-index rows "are huge
dense single-line table rows that BM25 buries." Plus a second retrieval path:
`kb agents <path>` returns the root→nearest chain deterministically (no ranking
lottery) — the descendant-docs half pi's native up-walk omits.

## 2. Why `kb dox init` cannot do the migration today

Direct source read (`packages/kb/src/dox.ts`) + a real `--dry-run`:

- **Wrong target set.** `walkMd` = `/\.(md|mdx)$/i`. File-index rows describe
  `.ts/.tsx`. The two sets barely overlap — `dox init` maps docs, not code.
- **No noise exclusion.** `DEFAULT_EXCLUDE` = `node_modules|.git|dist|build|.next|coverage|.kb|.pi`.
  Missing `.worktrees` (84 phantom files — a full repo checkout) and `openspec`
  (82 archived proposals).
- **Pseudo-directories.** Over-threshold areas chunk by `ROW_CAP=40` into
  `join(cwd, a, 'part-N')` — directories that do not exist on disk.
- **Top-level bucketing.** `areaFiles` groups by `rel.slice(0, rel.indexOf('/'))`
  → all of `src/` lands in one bucket, not per real directory.

Dry-run from repo root: **188 `AGENTS.md` planned, ~166 noise** (84 `.worktrees`,
82 `openspec`, 18 `doc-example`, 3 `packages`, 1 `docs`), plus `+8` appended to
root. Not a codebase map.

## 3. The five deltas (source-aware `dox init`)

```
①  walkMd regex     /\.(md|mdx)$/i   →  /\.(ts|tsx|js|jsx)$/  (skip .d.ts, __tests__, *.test.*)
②  DEFAULT_EXCLUDE  …|.kb|.pi        →  …|.kb|.pi|.worktrees|openspec|doc-example
③  areaFiles group  top segment      →  dirname(rel)          ◀── carries the value
④  part-N chunking  join(cwd,a,part) →  (deleted; ③ yields real nested dirs)
⑤  buildRows base   relative-to-cwd  →  relative-to-own-AGENTS.md dir
```

③ is the only semantically deep change; ①②④⑤ are trivial. But ③ still yields
**empty purpose columns** — detect-don't-write. Hence §4.

### 3a. Migration vs steady-state — where `dox init` actually pays off

```
MIGRATION (one-time)              STEADY-STATE (ongoing new files)
──────────────────────            ────────────────────────────────
file-index already has            new .tsx has no row → source-aware
path AND purpose → a              dox init + doxEnforcement hook
transform reproduces the          scaffolds an empty row in the RIGHT
tree WITH prose. dox init          dir → LLM fills purpose.
would re-derive paths and         ✅ dox init essential here
throw purposes away.
❌ dox init redundant here
```

Verdict: fix `dox init` for the **future** (and delta ③ specifically), but the
**migration itself** is an authoring transform (§4), not a `dox init` run.

## 4. The migration: parallel `@fast` subagents

The purpose text is the real payload. Two provenance sources per file:

```
              ┌─────────────────────────────────────┐
              │  ORCHESTRATOR (main agent)           │
              │  1. enumerate source files (deltas   │
              │     ①②) grouped by dirname (③)       │
              │  2. parse docs/file-index-*.md →     │
              │     path → { purpose, seeChange }    │
              │  3. fan out one @fast subagent PER    │
              │     target directory (independent)   │
              └───────────────┬─────────────────────┘
                              │  parallel, read-only over source
                              │  route by gap, not blindly per-dir
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
   TIER 0 — deterministic              TIER 1 — @fast subagent
   (NO subagent)                       (dirs with ≥1 miss)
   all files are file-index hits       ┌──────────────────────────────┐
   → orchestrator copies rows          │ HIT  → echo purpose +         │
     VERBATIM. zero LLM cost.          │        See change: VERBATIM   │
                                       │ MISS → read source, author    │
                                       │        caveman purpose        │
                                       └──────────────────────────────┘
            │                                   │
            └─────────────────┬─────────────────┘
                              ▼
              orchestrator writes each <dir>/AGENTS.md
              (idempotent ensure), checkpoints the dir
```

### 4a. Routing tiers — spawn `@fast` only for gaps

The file-index already holds authored purposes; copying them is deterministic
string work, not an LLM task. So route by whether a directory has any miss:

- **Tier 0 (deterministic, no subagent).** Every file in the dir is a file-index
  hit → the orchestrator emits rows verbatim itself. Zero token cost, zero
  latency, byte-exact history preservation.

  > **MEASURED (preview run, packages/ only):** 911 source files, index covers
  > 426 (**46.8%**). 92 dirs → 36 tier-0, **56 tier-1**; **485 miss files** need
  > `@fast` authoring. The design's "file-index near-complete" assumption is FALSE
  > for this repo — file-index tracks only "architecturally significant" files, not
  > every component. Tier-1 is the BULK of the work (~25 subagent batches at
  > ≥20 miss/batch), not a small fraction. Top tier-1 dirs: client/src/components
  > (91 miss), server/src (79), client/src/lib (41), client/src/hooks (30).
- **Tier 1 (`@fast` subagent).** The dir has ≥1 miss → spawn one `@fast`
  subagent for that dir. Hit rows are passed pre-filled (for ordering/context);
  the subagent authors **only** the miss rows from source.

This collapses subagent count from "per directory" to "per directory-with-gaps" —
typically a small fraction of the tree.

### 4b. Concurrency + batching

- **Work unit = one directory** (atomic — never split one `AGENTS.md` across two
  subagents). Directories are independent → no shared state.
- **Bounded pool, default 6 concurrent `@fast` subagents** (configurable). Balances
  throughput against provider rate limits; tune down on 429s.
- **Coalesce tiny dirs.** Sibling leaf dirs under one parent are batched into a
  single subagent call until the batch reaches ~8 dirs OR ~20 miss files, to
  amortize spawn overhead. Each dir still yields its own `AGENTS.md`.
- **Cap misses per subagent at ~20 files** to bound context + output. A dir with
  >20 misses splits into sequential sub-batches writing the *same* `AGENTS.md`
  (append), never a `part-N` dir.

### 4c. Subagent contract (I/O)

- **Input:** `{ dirRelPath, files: [{ path, status: "hit"|"miss", purpose?, seeChange? }] }`
  + the caveman-style rule verbatim (Doc Update Protocol Rule 6) + the row schema
  + `ROW_CAP`.
- **Output:** table rows **only**, one per input file. Hit rows echoed byte-for-byte;
  miss rows authored (key exports, contracts, 1-line summary). No prose, no
  invented `See change:` on misses.
- **Read-only.** Subagent may `Read` source files in its dir; MUST NOT edit/write.
  The orchestrator owns every disk write.
- **Validation gate.** Orchestrator checks: exactly one row per input file; every
  purpose non-empty; hit purposes byte-identical to input. Mismatch → retry once
  → on second failure record the dir in `migration-gaps.json` and continue.
- **Review gate (semantic, `miss` rows only).** After structural validation, each
  authored `miss` purpose routes through a review pass (a second `@fast` reviewer
  reads the source file + proposed row; flags wrong/vague/hallucinated purposes).
  Flagged rows → one re-author attempt → still-flagged rows recorded in
  `migration-gaps.json` for human follow-up (row kept, marked `<!-- review -->`).
  Tier-0 hit rows skip review (verbatim copy of already-authored file-index prose).
- **Resumable.** Orchestrator writes each `AGENTS.md` as its subagent returns via
  `dox init`'s idempotent `ensure()` (never clobber, append missing) and
  checkpoints completed dirs, so a crashed/aborted run resumes without re-spawning
  finished work.

### 4d. Fate of `docs/file-index-<area>.md`

Two options (decide during apply):

- **(A) Retire** — delete the splits; the tree is the sole map. Loses the
  "one `kb get` = whole area" convenience.
- **(B) Generated rollup** — keep a *generated* `docs/file-index-<area>.md`
  concatenating the tree's rows (via `kb dox` export), so both the per-dir map
  and the whole-area read exist, tree being the source of truth.

Recommend **(B)** for the transition, revisit retirement after the tree proves out.

## 5. Open question — context-injection cost

pi auto-loads `AGENTS.md` walking **up** from cwd at startup; it does **not**
force-load descendants (§6d). So scattering 50+ `AGENTS.md` under `src/` stays
cheap **iff** agents run from repo root (only root loads) and directory files are
reached pull-only via `kb agents`. Risk: a session with cwd deep in `src/`
loads every ancestor `AGENTS.md`. Needs a measurement spike before flipping
`directoryLevelAgents` to push mode. Pull mode is safe.

> **MEASURED (6.1 spike, tree present):**
> - root cwd → root `AGENTS.md` only, ~6k tokens (unchanged, fine).
> - package-root cwd (`packages/client`) → root + 812 B, ~6k tokens (fine).
> - deep cwd (`packages/client/src/components`) → root + 812 B + 8 KB +
>   **60 KB** = ~23k tokens/turn. The `components/` dir holds ~90 rows → 60 KB
>   `AGENTS.md`; pi's native up-walk injects it when cwd sits at/below it.
> - tree overall: 92 files, avg 4 KB, max 60 KB (components outlier), 383 KB total.
>
> **Verdict:** pull mode correct; push stays deferred. Common cwds (root, package
> root) unaffected. Only deep-under-a-mega-dir sessions pay — rare. Optional future
> mitigation: split the `components/` mega-file, or cap rows/dir. Not blocking.

## 5b. Extension — non-source areas join the tree (task 9)

Initial migration ran over `packages/**` source only; the `docs/file-index-<area>.md`
rows for `docker/`, `scripts/`, `.pi/skills/`, `public/`, `qa/`, `tests/e2e/`,
`.github/workflows/` stayed hand-maintained. Task 9 folds these into the tree too
via **Option A (hand-author)**: per-directory `AGENTS.md` generated from the curated
split rows verbatim (paths rewritten relative to each `AGENTS.md`) — no walker change,
so the source-aware `dox init` deltas ①② stay intact. `treeRows` gains `TREE_ROOTS`
(walks the non-source roots, `existsSync`-guarded); `SPLIT_AREAS` gains `"docker"` so
`exportRollup` loads that split. Only files with **no directory owner** — root-level
config (`biome.json`, `playwright.config.ts`, `.pi-test-harness.json`) + `docs/` files
— remain hand-maintained in the splits; the splits are otherwise generated rollups.

Rejected **Option B (broaden the walker to `.sh/.yml/.mjs/...` + un-exclude `.pi`)**:
reverts deltas ①②, re-authors purposes from non-code files, larger blast radius.

## 6. Non-goals

- The `doxEnforcement` per-edit write-hook (steady-state auto-scaffold) — separate
  follow-up.
- Embeddings / semantic search — out of Tier-1 scope, unchanged.
- Touching pi's native up-walk loader — the `kb agents` pull path is the
  descendant surface, no core change.
