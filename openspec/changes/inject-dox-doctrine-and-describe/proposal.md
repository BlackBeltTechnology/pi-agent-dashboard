# Proposal: inject-dox-doctrine-and-describe

## Why

The DOX doctrine (READ: kb-first retrieval; WRITE: directory `AGENTS.md` tree
maintenance) is a property of the kb tooling, yet it is delivered by COPYING
`dox-doctrine.md` into every project's root `AGENTS.md` at `project-init` time.
The copy drifts the moment the extension changes (the `doc_type` lane advice was
rewritten in `fix-kb-search-lane-composition`; every seeded `AGENTS.md` still
carries the old wording), it has to be hand-maintained per project, and this
repo's own `AGENTS.md` is a 14.5 KB hand-evolved superset of it. Separately,
`kb dox init` scaffolds path-only rows, so a fresh project's corpus contains no
purposes — the doctrine tells the agent to search before grep while there is
nothing worth finding. Both gaps block the "works out of the box" story for new
projects.

## What Changes

- **Canonical READ section refreshed first.** `dox-doctrine.md`'s
  `dox:read:kb` section is synced to the current root `AGENTS.md` READ
  content (lane rule, corpus boundaries, trust-verdict row, `ctx_execute`
  row) so the moved doctrine is byte-neutral against the REAL baseline; no
  per-turn reduction, so the A/B gate in `kb-read-discipline` is not
  triggered.
- **Doctrine injection by the kb extension.** `kb-extension` registers a
  `before_agent_start` handler that inserts the DOX doctrine into the system
  prompt immediately before the `Current working directory:` anchor (the
  bridge injector slices everything after that anchor, so a plain append is
  order-dependent), sourced from the canonical `dox-doctrine.md` that MOVES
  into `packages/kb-extension/`. Config is resolved per turn from the
  session cwd.
- **New `doctrine` config group** in `knowledge_base.json` (layered project →
  global → default): `inject: "kb" | "off"` and `write: boolean`. READ injects
  whenever `inject == "kb"`; WRITE injects only when `write == true`. Global
  default: `write: false`; a project may set `write: true`.
- **First-contact prompt.** When the extension loads for a cwd whose resolved
  config has NO `doctrine` key (neither project nor global), it injects a
  one-time nudge instructing the agent to ask the user (`ask_user`) which mode
  to enable and to write the answer to the PROJECT
  `.pi/dashboard/knowledge_base.json`. "Ask later" records nothing and the
  nudge re-fires on the next session, never on the next turn.
- **Legacy-seed guard + migration nudge.** If a loaded context file carries
  the `<!-- dox-doctrine -->` marker AND a `dox:*:start` section delimiter,
  injection is skipped for that cwd (no duplication) and a once-per-session
  nudge offers to replace the legacy block with the pointer block so the
  project stops drifting; the pointer block alone never trips the guard.
- **`seed-doctrine.ts` shrinks** to a marker + pointer block (doctrine is
  injected by `kb-extension`; tune via `.pi/dashboard/knowledge_base.json`).
  **BREAKING** for `project-init`: the `dox:read:manual` variant is REMOVED —
  the kb extension becomes the single carrier of the doctrine, and a project
  without it gets no doctrine text (but keeps the pointer).
- **New `dox-describe` skill** that fills EMPTY Purpose cells in the directory
  `AGENTS.md` tree with one-line LLM summaries via per-directory subagent
  fan-out (read files → write `| File | Purpose |` rows in the row schema →
  `kb` reindex). Idempotent (only empty cells by default), plan-then-confirm
  (dir/file/token estimate before fan-out), resumable. `project-init` offers
  it after `kb dox init`. A `kb dox describe --list` CLI helper enumerates
  empty-purpose rows so the skill never parses tables itself. Ships at
  `packages/kb-extension/.pi/skills/dox-describe/`.
- **Dogfood.** This repo's root `AGENTS.md` drops the Docs-First Gate, the
  Investigation Protocol and the generic half of the Documentation Update
  Protocol (now injected); keeps only project-specific rows (DocScribe /
  caveman routing, subagent table, commands). Project config sets
  `doctrine.write: true`.

Out of scope (follow-ups, tracked in tasks.md): a per-project kb settings
dialog in the client; an A/B run to test whether the READ table can shrink
given the guard + tool descriptions.

## Capabilities

### New Capabilities
- `kb-doctrine-injection`: the kb extension delivers the DOX doctrine per turn
  via `before_agent_start`, governed by the layered `doctrine` config group,
  with first-contact prompting and the seeded-marker double-load guard.
- `dox-describe`: skill + CLI helper that populates empty Purpose cells of the
  directory `AGENTS.md` tree with LLM-generated one-line summaries.

### Modified Capabilities
- `kb-read-discipline`: "New projects inherit the substitution table" and
  "Seeded projects keep the full doctrine" change — the table is carried by
  the extension's injection, not the seeded `AGENTS.md`; the manual variant
  is removed.
- `kb-config-and-init`: layered configuration gains the `doctrine` group and
  its validation.
- `project-init-skill`: the DOX step seeds a pointer block instead of the
  doctrine text and offers `dox-describe` after tree scaffolding.
- `kb-dox-tree`: `kb dox describe --list` enumerates rows with empty Purpose.

## Impact

- `packages/kb/src/config.ts` — `doctrine` group, defaults, validation.
- `packages/kb/src/cli.ts`, `dox.ts` / `dox-triage.ts` — `dox describe --list`
  (reuses `parseRows`).
- `packages/kb-extension/` — `dox-doctrine.md` (moved), `src/doctrine.ts`
  (pure: section extraction, marker detection, fragment build),
  `src/extension.ts` (`before_agent_start` append; must APPEND, never splice,
  to coexist with `dashboard-context-injector.ts`).
- `packages/extension/.pi/skills/project-init/` — `dox-doctrine.md` removed,
  `SKILL.md` step 5 updated; `src/project-init/seed-doctrine.ts` shrunk;
  tests updated.
- `packages/kb-extension/.pi/skills/dox-describe/` (+ `files` in package.json).
- `AGENTS.md` (root), `.pi/dashboard/knowledge_base.json` — dogfood.
- `docs/architecture.md` — config reference for `doctrine` (via DocScribe).

## Discipline Skills

- `doubt-driven-review` — removing the seeded doctrine text is a one-way step
  for projects initialised afterwards; review before it stands.
- `review-code` — non-trivial change across three packages before commit.
- None of security-hardening / performance-optimization /
  observability-instrumentation apply: no untrusted input, no latency budget,
  no new endpoint.
