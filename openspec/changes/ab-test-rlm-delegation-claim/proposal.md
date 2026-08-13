# Pre-register an A/B on the RLM delegation claim

> **Full research record: [`research.md`](./research.md)** — Prime Agent's fork
> lineage, its four deltas, the RLM host bridge, the evidence assessment behind
> this change, pi's subagent capability surface, the convergent-evolution map vs
> this repo, the `agent_message` gap, the subagent-identity layer analysis, and
> five open forks. Read that first when resuming this thread.

## Why

Prime Intellect's Prime Agent — a hard fork of pi-mono, self-described in its own
`docs/index.md` as *"It began as a hard fork of pi-mono"* — claims better problem
resolution via a Recursive Language Model (RLM) harness: a persistent IPython
kernel where context is a variable and subagents are function calls.

The published evidence does not settle the claim for this repo:

| Source | What it shows | Why it doesn't transfer |
|---|---|---|
| RLM blog (`primeintellect.ai/blog/rlm`) | RLM lift on Oolong-real; **loses** on math-python and DeepDive | GPT-5-mini, `verifiers/RLMEnv`, **zero coding benchmarks**, N=50, recursion depth 1 |
| Their own conclusion | "the RLM scaffold doesn't necessarily improve baseline on all benchmark ... will be unleashed after being train via RL" | future tense |
| Continual Harness paper (arXiv 2605.09998) | Gemini 3.1 Pro: all Pokémon milestones @ median **$130** vs 98% @ **$215** baseline | embodied game-play, human-in-the-loop refinement |
| Launch table vs pi-mono | "Several pairings favour Prime Agent, **while some rows favour the comparison harness**" | company-reported; no prompts, run counts, variance, model snapshots or cost accounting |
| ARC-AGI-3 95.54% (Opus 5) vs 38.3% | striking | launch video, unreproduced, interactive-exploration benchmark |
| Kingy review (8.3/10, favourable) | "clearest advantage today is **architectural expressiveness, not a settled universal leaderboard win**" | reviewer did not run a paid session or reproduce the suite |

Porting the RLM would mean a ZeroMQ Jupyter kernel (`core/kernel/index.ts`,
~1529 LOC) and a new Python runtime dependency.

**Correction (verified against pi 0.84.1): it would NOT need a core patch.**
`createAgentSession` / `AgentSessionRuntime` / `createAgentSessionServices` are
public exports of pi's SDK (`dist/core/sdk.d.ts`). In-process child sessions are
already extension-reachable, and this repo ships two proofs:
`@blackbelt-technology/pi-dashboard-subagents` v0.2.2 (17× `createAgentSession`,
4× `registerTool`, zero pi-internal imports) and
`packages/extension/src/commit-draft-agent.ts`.

What pi subagent extensions still lack versus `rlm()` is narrower than assumed:
fire-and-forget admission, a parent↔child `agent_message` mailbox, a registry
surviving compaction/restart, and an in-code (rather than tool-call) call site.

That is still a large bet on an unreproduced vendor claim.

**The RLM hypothesis is behavioural, so it can be tested at the prompt level for
~1% of the cost of building it.** `scripts/ab-context` already does exactly this
manipulation. Either outcome saves the kernel work:

- **No lift** → the claim does not transfer to this codebase; the port is unjustified. Stop.
- **Lift** → we may already have the win for an `AGENTS.md` edit, and only *then* is it worth asking whether the kernel adds anything the prompt didn't.

## What Changes

Pre-register (before seeing results) an A/B/C experiment on `scripts/ab-context`
measuring **problem resolution**, not doctrine adherence.

- Add `tasks.rlm.jsonl` — a mixed short/long-context battery of replayed commits,
  each validated RED at `<commit>^` and GREEN with the real implementation.
- Add `arms.rlm.json` — three worktrees whose **only** diff is the doctrine block.
- Run a two-stage design: a cheap N=5 screen, then a higher-N confirmation **only
  if** the screen shows directional lift.
- Write `report-rlm.txt` and a findings note. Ship no production code.

**Explicitly out of scope:** implementing the RLM kernel, the `rlm()` subagent
bridge, or the Continual Harness. This change buys the evidence to decide.

## Hypotheses

- **H1 (primary)** — a delegation-first doctrine (derive in code, keep bulk data
  out of main context, fan work to subagents) raises pass rate on replayed
  implementation tasks in this repo.
- **H2 (mechanism)** — if H1 holds, the lift concentrates in the **long-context**
  bucket. Their own data shows the bare LLM wins at short contexts.
- **H3 (cheaper alternative)** — Arm C (per-task hand-written tips) matches or
  beats Arm B. In their data `RLM+tips ≫ RLM`. If C ≫ B, the conclusion is
  "write better AGENTS.md", not "port a kernel".
- **H4 (capability floor)** — the Continual Harness paper found Flash-Lite
  *underperformed* its baseline. If lift appears on the frontier model and
  inverts on the floor probe, delegation-first must never become unconditional
  doctrine for cheap models.

## Pre-registered decision rule

Committed **before** any run, to stop us reading whatever we like into N=5:

| Screen result (N=5, frontier) | Action |
|---|---|
| B pass rate ≥ A + 10pp | proceed to N=15 confirmation |
| B within ±10pp of A | **STOP** — record null, close the port question |
| B ≤ A − 10pp | **STOP** — record regression |
| C ≫ B | drop the RLM thread; open a separate AGENTS.md-quality change |

A null result is a **successful** outcome of this change. It closes a large,
expensive question for a small, fixed cost.

## Impact

- Affected: `scripts/ab-context/` (new task/arm files, new report). No `packages/` source.
- Risk: low — no production code, worktrees removed on completion.
- Cost: see `design.md`. Budget-capped; abort if exceeded.

## Discipline Skills

- **`doubt-driven-review`** — the whole change *is* an in-flight adversarial check
  on an irreversible-if-wrong decision (porting a kernel). Applies again at the
  point of interpreting results, where the temptation to over-read N=5 peaks.
- **`scenario-design`** — deriving the replayed-commit battery, especially the
  long/short context split and the RED-at-`<commit>^` validation that stops
  vacuous gates.
- **`systematic-debugging`** — if the screen produces an implausible result
  (e.g. 100% pass in both arms), root-cause the harness before believing it. The
  index-pollution and vacuous-gate traps both present exactly this way.
- **`performance-optimization`** — measure-before-optimize is the entire premise;
  invoked if the token/cost deltas need attribution rather than reporting.

`security-hardening` and `observability-instrumentation` do not apply: no
untrusted input, no secrets, no new endpoint or external call.
