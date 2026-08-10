# ab-context — A/B behavior harness for context injections

Measures whether trimming the per-turn injections (root `AGENTS.md`, tool
schemas) changes **agent behavior** — framed as a **non-inferiority** test:
prove arm B (trimmed) is *not meaningfully worse* than arm A (full), while
using fewer tokens.

## Why non-inferiority (not significance)

We are NOT trying to show B differs from A. We want to show B preserves the
doctrine behaviors (kb-before-grep, rebuild-matrix, doc-protocol, ask_user)
within a margin `δ` while spending fewer tokens. A null "no difference" with
small N is inconclusive — power the N accordingly.

## Pieces

| File | Role |
|------|------|
| `arms.json`    | `{ "A": "<cwd>", "B": "<cwd>" }` — each arm points at a git worktree whose ONLY diff is the injected context. |
| `tasks.jsonl`  | The eval battery. One JSON object per line: `{ id, prompt, checks[] }`. Checks target exactly the rules moved in arm B. |
| `run.sh`       | For each arm × task × N: runs `pi -p <prompt>` headless (hidden), captures the new session JSONL into `runs/`. Serialized so file-diff capture is unambiguous. |
| `extract.mjs`  | Parse one run's JSONL → behavior row (tool sequence, adherence checks, token usage). |
| `analyze.mjs`  | Aggregate rows → per-check pass-rate per arm, non-inferiority verdict, token delta + CI. |
| `judge.mjs`    | (optional) Blind LLM judge: score each transcript 1–5 on doctrine + quality via `pi -p`. |

## Quick start

```bash
cd scripts/ab-context

# 1. Create arm B worktree with the TRIMMED AGENTS.md (arm A = main repo).
#    git worktree add ../../.worktrees/ab-trimmed HEAD   # then trim its AGENTS.md
#    Edit arms.json to point A and B at the two cwds.

# 2. Pilot: 2 tasks × 2 arms × 5 runs (shake out the plumbing, cheap).
MODEL="anthropic/claude-haiku-4-5" N=5 TASKS="kb-before-grep rebuild-matrix" ./run.sh

# 3. Score behavior.
node extract.mjs runs/*.json.jsonl   # writes rows.jsonl
node analyze.mjs rows.jsonl          # prints the verdict table

# 4. (optional) blind quality judge
MODEL="anthropic/claude-haiku-4-5" node judge.mjs runs/*.jsonl >> rows.jsonl
```

## Honest limits

- Proxy battery, not the real turn distribution → treat green as a **regression
  guardrail**, not proof of universal equivalence.
- LLM stochasticity is high; "no difference" at small N proves nothing.
- Interleave arms in time (run.sh already alternates) — provider models drift.
- Do NOT name a skill in a prompt: the whole confidence test for B is whether
  its one-line pointer causes the skill to auto-load. Naming it invalidates the run.
- Validate `judge.mjs` against a few hand-labeled transcripts before trusting it.
