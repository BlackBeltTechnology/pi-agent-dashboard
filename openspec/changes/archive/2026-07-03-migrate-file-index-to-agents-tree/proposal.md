## Why

The repo adapted agent0ai/dox (a recursive per-directory `AGENTS.md` tree) but **kept only its philosophy, not its data structure**. `2026-06-23-add-markdown-knowledge-base` §6d shipped the DOX *tooling* (`kb dox init`, `kb dox lint`, `kb agents <path>`, `indexAgentsFiles`, `directoryLevelAgents`, `doxEnforcement` — all opt-in, default OFF) but the tree was never stood up. Instead the codebase map lives in centralized `docs/file-index-<area>.md` splits (10 files, hundreds of rows describing source).

Exploring a move to the real recursive `AGENTS.md` structure surfaced three findings that no existing artifact records:

1. **Searchability is preserved and likely improved.** `kb_search` indexes markdown *chunks* tagged `doc_type` (`doc | agents | source-md`), not whole files. A row `` | `SessionCard.tsx` | … | `` produces identical BM25 tokens wherever it lives. Splitting a 200-row monolith into ~10-row per-directory files makes each query term a larger fraction of its chunk → higher BM25 score → directly fixes the "file-index rows get buried" complaint AGENTS.md already documents. A DOX tree also adds a second, structural retrieval path (`kb agents <path>` root→nearest walk) alongside full-text search.

2. **`kb dox init` maps the wrong target.** It walks `*.md`/`*.mdx` (documentation), not `*.ts`/`*.tsx` (source). The file-index rows describe *source*. A `--dry-run` from repo root plans **188 `AGENTS.md`, ~166 pure noise**: 84 in `.worktrees/` (a full repo checkout — not in `DEFAULT_EXCLUDE`), 82 in `openspec/` (archived proposals), plus `part-N/` *pseudo-directories* invented by the `ROW_CAP=40` chunker. Running it as-is does **not** reproduce the file-index; it maps the docs themselves.

3. **Descriptions cannot be auto-derived by the tool.** `kb dox init` obeys detect-don't-write: it fills the **path** column and leaves **purpose** empty by design. So the migration's real work is authoring purposes — from two sources: (a) the existing file-index rows (migrate purpose + `See change:` verbatim), and (b) source files with **no** covering file-index row (must read source and author a caveman purpose).

## What Changes

- **Make `kb dox init` source-aware** (5 small deltas in `packages/kb/src/dox.ts`):
  - ① walk target `*.md` → source globs (`.ts/.tsx/.js/.jsx`, skip `.d.ts`/`__tests__`).
  - ② extend `DEFAULT_EXCLUDE` with `.worktrees`, `openspec`, `doc-example`.
  - ③ **group by full parent dir (`dirname(rel)`), not top-level segment** — the one delta that makes the tree *directory-level*; `src/client/components/*.tsx` → its own `src/client/components/AGENTS.md`.
  - ④ delete `part-N/` pseudo-dir chunking (③ yields real nested dirs instead).
  - ⑤ emit rows relative to each `AGENTS.md`'s own directory.
- **One-time migration, tiered — spawn `@fast` subagents only for gaps.** An orchestrator buckets every source file by target directory and routes by whether a directory has any file-index miss:
  - **Tier 0 (deterministic, no subagent)** — every file is a file-index hit → the orchestrator copies the purpose + `See change:` rows verbatim itself. Zero token cost; expected to cover most directories.
  - **Tier 1 (`@fast` subagent)** — the dir has ≥1 miss → one `@fast` subagent per dir authors **only** the miss rows from source (key exports, contracts, one-line summary); hit rows passed pre-filled.
  - **Concurrency:** bounded pool (default 6 concurrent), work unit = one directory (atomic, no shared state), tiny sibling dirs coalesced (~8 dirs / ~20 miss files per call), ~20-miss cap per subagent.
  - **Contract:** subagents are read-only over source (orchestrator owns all writes); output is table rows only (hits byte-identical, misses non-empty, no invented `See change:`); orchestrator validates one-row-per-file + retries once + records residual gaps; writes are idempotent (`ensure()`) and checkpointed for resumability.
- **Flip the opt-in flags** once the tree exists: `indexAgentsFiles: true` (make the tree searchable, `doc_type: agents`), `directoryLevelAgents` pull mode (enable `kb agents <path>`).
- **Retire the `docs/file-index-<area>.md` splits** — DELETED; the per-directory `AGENTS.md` tree is the sole per-file record (design.md §4d, resolved to decision **A**). `docs/` topic docs + the 3 root-level config files re-home to `docs/AGENTS.md`. No generated rollup kept.

## Capabilities

### New Capabilities
- `dox-source-tree-migration`: a source-aware `kb dox init` (walks source, excludes worktree/openspec noise, groups by real directory, no pseudo-dirs) plus a parallel-`@fast`-subagent migration that re-homes existing `docs/file-index-<area>.md` purposes into per-directory `AGENTS.md` and authors purposes from source for files no file-index row covers. Searchability preserved via `indexAgentsFiles` (`doc_type: agents`).

## Impact

- **Delta on `2026-06-23-add-markdown-knowledge-base` §6d** — extends its DOX tooling; does not reverse it. §6d assumed dox maps docs and never reconciled that with a source-file file-index; this change closes that gap.
- **Code**: `packages/kb/src/dox.ts` (`walkMd`, `DEFAULT_EXCLUDE`, `areaFiles`, `doxInit` — deltas ①–⑤), plus a migration script/orchestrator (one-off) that spawns `@fast` subagents per directory.
- **Docs**: `docs/file-index-<area>.md` splits DELETED, replaced by the per-directory tree (+ `docs/AGENTS.md` for `docs/` topic docs + root-level config); AGENTS.md Investigation + Documentation Update Protocols updated to point at `kb agents <path>` / directory `AGENTS.md` instead of the splits.
- **Context cost**: pi auto-loads `AGENTS.md` walking **up** from cwd only; directory files stay pull-only (`kb agents`), so per-turn injection stays cheap (root only, unless cwd is deep). Verified as a design open question in design.md §5.
- **Out of scope (v1)**: the `doxEnforcement` write-hook (steady-state new-file scaffolding) — separate follow-up; this change delivers the migration + source-aware `init`, not the per-edit nudge.
- **Reversibility**: one-way. Rows scatter into the tree; the "read the whole area map in one `kb get`" convenience is gone (design.md §4d resolved to **A / retire** — no rollup kept).
