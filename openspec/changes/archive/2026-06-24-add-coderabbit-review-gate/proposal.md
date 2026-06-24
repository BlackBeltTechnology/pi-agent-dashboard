# Add a CodeRabbit review gate to the implementation phase

## Why

The repo ships a `code-review` skill (on-demand CodeRabbit) and an `autofix`
skill (apply CodeRabbit PR-thread feedback post-push). Neither fires
**during implementation**. So a feature can be implemented and committed without
any AI review until a PR exists — late, and only if someone remembers.

Two facts shape the fix:

1. **Review is a git-diff operation, not a deploy operation.** CodeRabbit
   reviews the working-tree diff (`coderabbit review --agent -t uncommitted`). It
   needs no running server and no build. So it works in a **git worktree** and
   alongside the **Docker-isolated instance** — exactly where feature work
   happens.

2. **`full-rebuild.ts` is the wrong hook.** That script **deploys the
   checked-out dev version to the local running instance** (build → restart →
   reload). Feature implementation in a worktree never runs it and never restarts
   the main server. Tying the review to it would miss every worktree change. The
   review gate must be **decoupled from build/restart**.

This is **complementary to** the active `add-code-quality-skill` change: Biome is
a deterministic static-lint oracle (exit code); CodeRabbit is an advisory AI
semantic review. They compose — Biome hard-gates, CodeRabbit advises.

## What Changes

- **Enhance `code-review` skill** (`.pi/skills/code-review/SKILL.md`, v0.2.0):
  severity triage (Critical / Warning / Info) with a nit cap, `--agent` NDJSON
  parsing guide (`review_context` / `status` / `heartbeat` / `finding` /
  `complete`), dev-inner-loop fix cycle, diff-scoping table mapped to the **real
  v0.5.2 flags** (`--agent`, `-t`, `--base`, `--base-commit`, `--dir`, `-c`), and
  a usage-limits section (no local model; cloud rate-limited).

- **New script** `.pi/skills/implement/scripts/review-changes.ts` — the
  implementation-phase gate. Server-independent, worktree-safe. Runs
  `coderabbit review --agent -t <scope>` on the current working tree, parses
  findings, summarizes by severity. **Advisory: warn-and-continue, exits 0.** On
  missing CLI / auth failure / usage limit it prints "deferred to a later cycle".
  Honours `--no-review` / `SKIP_CR_REVIEW=1` and passthrough flags.

- **Keep `full-rebuild.ts` deploy-only** — reverted any review logic; header note
  points to `review-changes.ts`.

- **Wire `implement` skill** (`.pi/skills/implement/SKILL.md`) — new
  "Review gate — before commit (server-independent)" section; clarifies
  full-rebuild is a deploy step, not an implementation step; instructs
  openspec-apply to run the gate after the last task, in the worktree.

- **Document in `AGENTS.md`** — "Code-review gate (implementation phase)"
  subsection under Build & Restart Workflow + the deploy-vs-review distinction.

### Out of scope (v1)

- A deterministic **pi commit-time hook** that fires the gate even when
  `review-changes.ts` is not run manually (the workflow-step is soft). Tracked as
  a follow-up.
- **Hard-blocking** on findings — the gate stays advisory because CodeRabbit is
  cloud rate-limited and must never wedge an offline / quota-exhausted session.
