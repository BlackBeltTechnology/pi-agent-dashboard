# SKILL.md — doubt-driven-review index

Pull-only condensed map. Source: packages/eng-disciplines/.pi/skills/doubt-driven-review/SKILL.md. Keys on non-trivial definition, 5-step doubt cycle, adversarial reviewer prompt, `doubt-reviewer` agent, `@propose-review-N` role series, RECONCILE precedence, stop conditions.

## Overview
- Fresh-context reviewer biased to disprove — before non-trivial output stands. NOT post-hoc review (`review-code`, `code-review`). In-flight, cheap course-correction.

## When to Use
- Non-trivial = branching logic, crosses module/service boundary, asserts compiler-unverifiable property (thread safety, idempotence, ordering, invariants), correctness depends on unseen context, irreversible blast radius (deploy/migration/public API).
- Apply — architectural decision under uncertainty, committing non-trivial code, claiming non-obvious fact ("this is safe", "this scales"), unfamiliar code.
- NOT — mechanical ops, unambiguous instructions, reading/summarizing code, one-line obvious changes, tooling ops, user asked for speed.

## Loading Constraints
- Main-session orchestrator only; never in an agent definition's `skills:` frontmatter (nested spawn, competes for subagent cap).
- Subagent context — surface to user, don't nest; degraded self-questioning fallback only as last resort, flag result as degraded.

## The Process
- Doubt cycle checklist — 1 CLAIM, 2 EXTRACT, 3 DOUBT, 4 RECONCILE, 5 STOP.

### Step 1: CLAIM
- Name decision in 2-3 lines — claim + why-it-matters. Can't write compactly → vibe, not decision.

### Step 2: EXTRACT
- Smallest reviewable unit — diff/function not whole file; proposal 3-5 sentences + constraints; claim + evidence kept distinct. Strip reasoning — hand over conclusions, get validation back. 500-line PR → decompose first.

### Step 3: DOUBT
- Adversarial prompt verbatim — "Find what is wrong… Assume the author is overconfident… Do NOT validate. Do NOT summarize."
- Prompt also: verify each claim against the repository; write `unverified` when a claim cannot be checked (never assert it); check every candidate requirement the CONTRACT lists and report each one the artifact contradicts.
- Output shape — table row per finding: severity (blocker/major/minor), location (file:line), contract clause violated, finding, verified/unverified.
- Pass ARTIFACT + CONTRACT only. Never pass CLAIM — biases agreement.
- Reviewer = `subagent_type: "doubt-reviewer"` (`agents/doubt-reviewer.md`, read-only, no pinned model, `inherit_context: false`). Never generic label (`general-purpose`) — inherits compressed parent snapshot incl. CLAIM. Not discoverable → other `inherit_context: false` def (`Explore`, `CodeReviewer`) + verbatim prompt, announce substitution.
- Two passes, parallel — single-model (omit `model` → author's model, clean context) + cross-model (`model: "@propose-review-N"`). Host concurrency cap (~2) refusal → wait + re-issue, not a failure.

### Cross-model — `@propose-review-N` series
- Series configured → run automatically, no per-cycle ask. Role refs only, never raw `provider/model-id` (bypasses live registry → custom provider empty output). No external review CLI.
- Walk in order; first pass skips author's family (Claude author → skip `claude-*`).
- Probe `"Reply with exactly: OK"` once per session per role, cache. Empty/error → retry once (transport flake), still empty → next role.
- Same-family role only as last resort after every different-family role failed — label "degraded: same-family reviewer".
- Nothing resolves — interactive: bootstrap (`list_models` credentialed + `reasoning:true`, drop author family, `ask_user` select, `update_roles set_role`), declined → manual/skip; non-interactive (CI/loop) → skip.
- Announce outcome every cycle — ran on @propose-review-N / degraded same-family / skipped + reason. Silent skip = red flag.

### Step 4: RECONCILE
- Findings = data, not verdict; re-read artifact per finding. Precedence — 1 contract misread (fix contract, re-loop), 2 valid + actionable (change, re-loop), 3 valid trade-off (document), 4 noise (note; would context have prevented?). `unverified` → check before classifying actionable. Report table `# | reviewer | severity | class | action`.

### Step 5: STOP
- Stop — trivial only (minor or already-classified), 3 cycles (escalate, don't grind 4th), or user says "ship it". Artifact too big → decompose (Step 2), never lift bound.

## Common Rationalizations
- "I'm confident, skip" — confidence ≠ correctness. "Reviewer is expensive" — bug in prod costs more. "Will just nitpick" — scope prompt; minor severity stops loop. "Reviewer disagreed, I'm wrong" — information, not verdict. "`general-purpose` works" — may inherit your conversation. "Probe empty, role dead" — retry once.

## Red Flags
- Doubt theater — ≥2 cycles with blocker/major findings, zero actionable → stop, escalate. Reviewer def without `inherit_context: false`; passing CLAIM/reasoning; stripping contract; "is this good?" prompt; >3 cycles; re-spawning unchanged artifact; doubt after commit; unannounced cross-model outcome; raw `provider/model-id` or external review CLI.

## Interaction with Other Skills
- **`review-code`** — post-hoc diff review, complementary.
- **`code-review`** — CodeRabbit ship gate, last external check.
- **`systematic-debugging`** — hands off here after 3 failed fixes; real failure mode surfaced → localize there.
- **`scenario-design`** — failing RED test = doubt step for behavioral claims.
- **`security-hardening`** — auth/secrets/untrusted input → threat checklist into CONTRACT.
- **`plan-proposal`** — runs this skill on proposals, spec-collateral scan before each cycle; main session only.

## Verification
- Every non-trivial decision named as CLAIM; ≥1 fresh-context review per artifact; reviewer = `doubt-reviewer` (or announced `inherit_context: false` substitute) with ARTIFACT+CONTRACT, not CLAIM/reasoning; adversarial prompt + severity table; findings classified + reported as table; stop condition met; cross-model ran automatically / bootstrapped / offered / skipped per rules and outcome announced; no external review CLI.
