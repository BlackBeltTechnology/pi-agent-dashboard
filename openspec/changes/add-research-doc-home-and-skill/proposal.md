# Consolidate research docs into a single home + ship a research-doc skill

## Why

Research and planning documents were scattered across **four unindexed
directories** — `docs/plan/`, `docs/plans/`, `docs/research/`, and
`docs/architecture-notes/` — holding 9 files between them. None were referenced
from `AGENTS.md` or `docs/file-index.md`, so the index-first Investigation
Protocol could not surface them. The practical failure: a new session had no
breadcrumb to prior research, which is exactly the "read it again later" need
that motivated this work.

Two gaps underneath the sprawl:

1. **No convention for where research lives.** A change's `design.md` is the
   natural home for its rationale, but `design.md` is archived with the change.
   Research that outlives the change (reusable findings, option evals, roadmaps)
   had no durable, discoverable home.
2. **No procedure for producing research.** Each research effort reinvented its
   structure and its search strategy, so output was inconsistent and hard to index.

The tempting fix — a per-research pointer in `AGENTS.md` — is the wrong layer.
`AGENTS.md` loads into every agent on every turn, and its Documentation Update
Protocol explicitly defaults updates *away* from it. The correct fix is an
on-demand indexed home, one terse process rule, and a reusable skill.

## What Changes

- **Consolidate** the 9 docs into a single flat `docs/research/` home and delete
  the three now-empty directories (`plan/`, `plans/`, `architecture-notes/`).
- **Index** the home two ways: an in-dir `docs/research/README.md` table
  (title · summary · status), and one row in `docs/file-index.md` ▸ "Standalone
  topic docs" so the Investigation Protocol discovers it on a fresh session.
- **Add one rule** to `AGENTS.md` ▸ OpenSpec Conventions: research rationale →
  the change's `design.md`; research that outlives the change → `docs/research/`,
  referenced from `proposal.md`.
- **Ship a `research-doc-synthesis` skill** as a monorepo skill-plugin
  (`packages/research-doc-skill/`, declared via `pi.skills`, no TS code). The
  skill fans out parallel `@fast` web-search subagents across distinct angles,
  gathers codebase context, and synthesizes into a stable document skeleton,
  then saves to `docs/research/`, indexes it, and references it from the backing
  proposal.
- **Fix** the 2 live inbound references to moved docs and index the new package
  in `docs/file-index-plugins.md`.

### Out of scope

- The pre-existing lockstep-version drift in `mockup-loop` (`0.1.0`) and
  `kb`/`kb-extension` (`0.0.0`) — unrelated unpublished packages, untouched.
- References to the moved docs inside `openspec/changes/archive/**` and
  `.worktrees/**` — frozen history, left as-is.
