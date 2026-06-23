# Design — CodeRabbit implementation-phase review gate

## Deploy vs. review — two distinct operations

The core design decision is separating two things that were briefly conflated:

| Concern | Script | Touches server? | Worktree-safe? |
|---|---|---|---|
| **Deploy** dev build to local instance | `full-rebuild.ts` (build → restart → reload) | Yes | N/A |
| **Review** the implementation diff | `review-changes.ts` (`coderabbit review`) | No | Yes |

Feature implementation happens in a worktree or against the Docker-isolated
instance and does not restart the main server. Therefore the review gate cannot
live in the deploy path; it runs purely on the git working-tree diff.

## Advisory, never blocking

CodeRabbit CLI has **no local model** — it is cloud-backed and rate-limited per
account/plan. A hard gate would wedge a session that is offline or out of quota.
So `review-changes.ts` always exits 0:

- missing CLI (ENOENT) / auth failure / usage limit → warn "deferred to a later
  cycle", exit 0.
- findings present → print severity summary, surface Critical/Warning, exit 0.

The agent (guided by the `code-review` skill) is responsible for fixing
Critical/Warning before commit; the script only surfaces, it does not enforce.

## `--agent` output contract

`coderabbit review --agent` streams newline-delimited JSON. The parser keys on
`type`:

- `review_context`, `status` — progress, ignored.
- `heartbeat` — keep-alive (reviews take 1–3 min); ignored.
- `finding` — collected; severity bucketed via `/critical|major|high|warn|error/i`.
- `complete` — terminal.

Non-JSON lines are skipped defensively. Fix guidance prefers `codegenInstructions`
then falls back to `comment` (documented in the skill).

## Real v0.5.2 flags only

Public guides reference `--light` and `--config=prompts/*.md`; **neither exists**
in the installed CLI (v0.5.2). The design uses only verified flags: `--agent`,
`--plain`, `-t {all|committed|uncommitted}`, `--base`, `--base-commit`, `--dir`,
`-c <files>`. Repo conventions / constraints are passed via `-c AGENTS.md` rather
than the non-existent per-prompt config.

## Relationship to add-code-quality-skill (Biome)

Orthogonal, composable:

- **Biome** (`quality:changed`) — deterministic static analysis, single exit code,
  the goal-loop **oracle** (hard gate).
- **CodeRabbit** (`review-changes.ts`) — AI semantic review, **advisory** signal.

Both run on the changed diff during implementation; Biome decides done/continue,
CodeRabbit advises on issues a linter cannot see.
