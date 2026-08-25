# SKILL.md — doubt-driven-review index

Pull-only condensed map. Source: packages/eng-disciplines/.pi/skills/doubt-driven-review/SKILL.md. Keys on non-trivial definition, 5-step doubt cycle, adversarial reviewer prompt, `@propose-review-N` role series, RECONCILE precedence, stop conditions.

## Overview
- Fresh-context reviewer biased to disprove — before non-trivial output stands. NOT `/review` (post-hoc verdict on finished artifact). In-flight, cheap course-correction.

## When to Use
- Non-trivial = branching logic, crosses module/service boundary, asserts compiler-unverifiable property (thread safety, idempotence, ordering, invariants), correctness depends on unseen context, irreversible blast radius (deploy/migration/public API).
- Apply — architectural decision under uncertainty, committing non-trivial code, claiming non-obvious fact ("this is safe", "this scales"), unfamiliar code.
- NOT — mechanical ops, unambiguous instructions, reading/summarizing code, one-line obvious changes, tooling ops, user asked for speed.

## Loading Constraints
- Main-session orchestrator only; never in persona `skills:` frontmatter (personas don't invoke personas).
- Subagent context — surface to user, don't nest; degraded self-questioning fallback only as last resort, flag result as degraded.

## The Process
- Doubt cycle checklist — 1 CLAIM, 2 EXTRACT, 3 DOUBT, 4 RECONCILE, 5 STOP.

### Step 1: CLAIM
- Name decision in 2-3 lines — claim + why-it-matters. Can't write compactly → vibe, not decision.

### Step 2: EXTRACT
- Smallest reviewable unit — diff/function not whole file; proposal 3-5 sentences + constraints; claim + evidence kept distinct. Strip reasoning — hand over conclusions, get validation back. 500-line PR → decompose first.

### Step 3: DOUBT
- Adversarial prompt verbatim — "Find what is wrong… Assume the author is overconfident… Do NOT validate. Do NOT summarize." Overrides persona's default response shape.
- Pass ARTIFACT + CONTRACT only. Never pass CLAIM — biases agreement.

### Cross-model escalation
- Reviewer role set (`@propose-review-N`) + probes clean → run automatically, no per-cycle ask; announce in output. No role → offer (configure / manual / skip); silent skip = red flag.
- Role refs (`@propose-review-1..x`) not raw `provider/model-id` — raw id bypasses registry, custom providers return empty. Configured via `~/.pi/agent/providers.json#roles`, `update_roles` tool.
- Walk series — skip same architecture family as author (Claude author → skip `claude-*`); probe `"Reply with exactly: OK"`; empty → advance.
- Bootstrap (interactive) — `list_models` (credentialed, `reasoning:true`), drop author family, `ask_user` select, `update_roles set_role`, probe. Never hand-edit providers.json.
- Non-interactive (CI/loop) — skip + announce. Pi path — `Agent(subagent_type, model:"@propose-review-1", prompt: adversarial + ARTIFACT + CONTRACT)`. No external review CLI.

### Step 4: RECONCILE
- Findings = data, not verdict; re-read artifact per finding. Precedence — 1 contract misread (fix contract, re-loop), 2 valid + actionable (change, re-loop), 3 valid trade-off (document), 4 noise (note; would context have prevented?).

### Step 5: STOP
- Stop — trivial findings only, 3 cycles (escalate, don't grind 4th), or user says "ship it". Artifact too big → decompose (Step 2), never lift bound.

## Common Rationalizations
- "I'm confident, skip" — confidence ≠ correctness; certainty hides blind spots. "Reviewer is expensive" — bug in prod costs more. "Will just nitpick" — only if unscoped. "Reviewer disagreed, I'm wrong" — disagreement = information, not verdict.

## Red Flags
- Doubt theater — ≥2 cycles substantive findings, zero actionable → stop, escalate. Prompting "is this good?"; passing CLAIM; stripping contract; >3 cycles; re-spawning unchanged artifact; doubt after commit (= /review); external review CLI; silent cross-model skip.

## Interaction with Other Skills
- `/review` — post-hoc verdict, complementary. SDD — verifies framework facts vs docs; doubt verifies reasoning. TDD — RED failing test = doubt step for behavioral claims. Debugging — real failure mode surfaced → localize there.

## Verification
- Every non-trivial decision named as CLAIM; ≥1 fresh-context review per artifact; reviewer got ARTIFACT+CONTRACT, not CLAIM/reasoning; adversarial prompt; findings classified (contract misread/actionable/trade-off/noise); stop condition met; interactive: role set → auto cross-model announced, none → explicitly offered; non-interactive → skip announced; no external review CLI.
