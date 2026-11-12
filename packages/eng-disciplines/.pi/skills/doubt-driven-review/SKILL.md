---
name: doubt-driven-review
description: 'In-flight adversarial check on a non-trivial decision BEFORE it stands — distinct from post-hoc review of a finished diff. Use on "stress-test this decision", "are we sure about this", "verify before commit", "poke holes in this", when working in unfamiliar code, or before an irreversible step (migration, prod deploy, public API). Runs earlier than code-review, while course-correction is cheap.'
---

# Doubt-Driven Development

## Overview

A confident answer is not a correct one. Long sessions accumulate context that quietly turns assumptions into "facts" without anyone noticing. Doubt-driven development is the discipline of materializing a fresh-context reviewer — biased to **disprove**, not approve — before any non-trivial output stands.

This is not post-hoc review (`review-code`, `code-review`). Those are a verdict on a finished artifact. This is an in-flight posture: non-trivial decisions get cross-examined while course-correction is still cheap.

## When to Use

A decision is **non-trivial** when at least one of these is true:

- It introduces or modifies branching logic
- It crosses a module or service boundary
- It asserts a property the type system or compiler cannot verify (thread safety, idempotence, ordering, invariants)
- Its correctness depends on context the future reader cannot see
- Its blast radius is irreversible (production deploy, data migration, public API change)

Apply the skill when:

- About to make an architectural decision under uncertainty
- About to commit non-trivial code
- About to claim a non-obvious fact ("this is safe", "this scales", "this matches the spec")
- Working in code you don't fully understand

**When NOT to use:**

- Mechanical operations (renaming, formatting, file moves)
- Following a clear, unambiguous user instruction
- Reading or summarizing existing code
- One-line changes with obvious correctness
- Pure tooling operations (running tests, listing files)
- The user has explicitly asked for speed over verification

If you doubt every keystroke, you ship nothing. The skill applies only to non-trivial decisions as defined above.

## Loading Constraints

This skill is designed for the **main-session orchestrator**, where Step 3 (DOUBT) can spawn a fresh-context reviewer.

- **Do NOT list this skill in an agent definition's `skills:` frontmatter.** A subagent following Step 3 would spawn a nested subagent — extra context layers, and it competes for the host's small concurrent-subagent cap.
- **If you find yourself applying this skill from inside a subagent context**: the preferred path is to surface to the user that doubt-driven cannot run nested and let the main session handle it. As a last resort only, a degraded self-questioning fallback exists — rewrite ARTIFACT + CONTRACT as a fresh self-prompt with a hard mental separator from your prior reasoning, and walk Steps 1–5. This is **not fresh-context review** (you carry your own context with you), so flag the result as degraded and prefer escalation whenever the user is reachable.

## The Process

Copy this checklist when applying the skill:

```
Doubt cycle:
- [ ] Step 1: CLAIM — wrote the claim + why-it-matters
- [ ] Step 2: EXTRACT — isolated artifact + contract, stripped reasoning
- [ ] Step 3: DOUBT — spawned doubt-reviewer (single-model + cross-model) with adversarial prompt
- [ ] Step 4: RECONCILE — classified every finding against the artifact text
- [ ] Step 5: STOP — met stop condition (trivial findings, 3 cycles, or user override)
```

### Step 1: CLAIM — Surface what stands

Name the decision in two or three lines:

```
CLAIM: "The new caching layer is thread-safe under the
        read-heavy workload described in the spec."
WHY THIS MATTERS: a race here corrupts user data and is
                  hard to detect in QA.
```

If you can't write the claim that compactly, you have a vibe, not a decision. Surface it before scrutinizing it.

### Step 2: EXTRACT — Smallest reviewable unit

A fresh-context reviewer needs the **artifact** and the **contract**, not the journey.

- Code: the diff or the function — not the whole file
- Decision: the proposal in 3–5 sentences plus the constraints it has to satisfy
- Assertion: the claim plus the evidence that supposedly supports it (kept distinct from the Step 1 CLAIM block, which is the orchestrator's hypothesis under scrutiny)

Strip your reasoning. If you hand over conclusions, you'll get back validation of your conclusions. The unit must be small enough that a reviewer can hold it in mind in one read — if it's a 500-line PR, decompose first.

### Step 3: DOUBT — Invoke the fresh-context reviewer

The reviewer's prompt **must be adversarial**. Framing decides the answer.

```
Adversarial review. Find what is wrong with this artifact.
Assume the author is overconfident. Look for:
- Unstated assumptions
- Edge cases not handled
- Hidden coupling or shared state
- Ways the contract could be violated
- Existing conventions this might break
- Failure modes under unexpected input

Do NOT validate. Do NOT summarize. Find issues, or state
explicitly that you cannot find any after thorough examination.

Verify each claim against the repository before relying on it.
If you cannot check a claim (no access, no tool, no network),
write `unverified` next to it instead of asserting it true or false.
If the CONTRACT lists candidate requirements, check every
candidate and report each one the artifact contradicts.

Output one table row per finding, most severe first:
| # | severity (blocker/major/minor) | location (file:line or section) |
  contract clause violated | finding | verified/unverified |

ARTIFACT: <paste artifact>
CONTRACT: <paste contract>
```

**Pass ARTIFACT + CONTRACT only. Do NOT pass the CLAIM.** Handing the reviewer your conclusion biases it toward agreement. The reviewer must independently determine whether the artifact satisfies the contract.

#### Who reviews — the `doubt-reviewer` agent

Spawn the reviewer as `subagent_type: "doubt-reviewer"` — shipped with this package as `agents/doubt-reviewer.md`: read-only tools, no pinned model, **`inherit_context: false`**.

- **Never use a generic label** (`general-purpose`, an ad-hoc name, or a definition without `inherit_context: false`). When the operator's `inheritContext` setting is on, such a child receives a compressed snapshot of *your* conversation — your reasoning and the CLAIM — and the review is no longer fresh-context. That is the exact bias this skill exists to remove.
- If `doubt-reviewer` is not discoverable, fall back to another definition that sets `inherit_context: false` (e.g. `Explore`, `CodeReviewer`) and paste the adversarial prompt verbatim — it overrides the persona's default response shape (balanced verdicts, strengths, summaries). Note the substitution in the output.

Run **two passes** on the same ARTIFACT + CONTRACT:

```
# single-model: omit `model` → the author's model, clean context
Agent(subagent_type: "doubt-reviewer", description: "Adversarial review",
      prompt: "<adversarial prompt> + ARTIFACT + CONTRACT")      # NO CLAIM

# cross-model: a different-architecture reviewer role
Agent(subagent_type: "doubt-reviewer", model: "@propose-review-1",
      description: "Cross-model adversarial review",
      prompt: "<adversarial prompt> + ARTIFACT + CONTRACT")      # NO CLAIM
```

The passes are independent — issue them **in parallel**. The host caps concurrent subagents (observed: 2); an admission refusal ("at the concurrency cap") means wait for a running subagent to finish and re-issue — it is not a reviewer failure.

#### Cross-model reviewer — walk the `@propose-review-N` series

A single-model reviewer shares blind spots with the original author — a different-architecture model catches them. Within this skill's scope, cross-model is part of the value, not optional friction.

The operator pre-configures a numbered series of reviewer roles (`propose-review-1` … `propose-review-x` in `~/.pi/agent/providers.json#roles`, editable via the `update_roles` tool or the dashboard Roles panel). A configured series **is** the user's standing decision that cross-model is wanted: run it **automatically**, never ask per cycle.

1. **Walk in order, different family first.** Start at `@propose-review-1`. On the first pass skip any role whose architecture family matches the author's (author is Claude → skip roles mapping to `claude-*`) — it shares the author's blind spots.
2. **Probe once per session.** Before the first real prompt to a role, send `"Reply with exactly: OK"`. Remember the result for the rest of the session — do not re-probe every cycle. Empty output or a resolution error → **retry once** (the subagent transport is known to return empty on a first call that succeeds on retry); still empty → advance to the next role.
3. **Same-family last resort.** Only when every different-family role failed may a same-family role in the series run. Label its findings **degraded: same-family reviewer**.
4. **Nothing resolves.**
   - *Interactive* → bootstrap a role (below), then probe and spawn. If the user declines, offer: manual external review (they paste ARTIFACT + CONTRACT + adversarial prompt into another model) or skip.
   - *Non-interactive* (CI, `/loop`, autonomous, scheduled) → skip.

**Always use a role ref, never a raw `provider/model-id`.** Role refs resolve through the parent's live registry, so a custom-provider model actually spawns; a raw id can build a child registry that lacks the provider → **empty output**, silently. This skill does not shell out to an external review CLI; the only automated reviewer is the in-process subagent.

> **Bootstrap a reviewer role (interactive only).**
> 1. Enumerate with `list_models` (or `pi --list-models` / dashboard `GET /api/models`). Keep credentialed rows (`excludedReason: null`); prefer `reasoning: true`.
> 2. Drop the author's architecture family.
> 3. `ask_user` (`select`) with a handful of the strongest different-family candidates — do not auto-pick.
> 4. `update_roles` → `set_role`, `role: "propose-review-1"` (or the next free slot), `ref: "<chosen provider/model-id>"`. Persists for every future session; never hand-edit `providers.json`.
>
> **Seeding example:** `propose-review-1 → opencode-go/glm-5.2`, `propose-review-2 → deepseek/deepseek-v4-pro`, `propose-review-3 → anthropic/claude-opus-4-8` (same-family last, reached only via rule 3).

#### Announce what ran — always

The output states the reviewer situation in one line, every cycle:

- *"Cross-model review ran automatically on @propose-review-2."*
- *"Cross-model: degraded: same-family reviewer (@propose-review-3)."*
- *"Cross-model skipped: <non-interactive context | user declined | series exhausted, every role probed empty>."*

Skipping is fine; silent skipping is not. An exhausted series is a failure to surface, not a reason to quietly proceed single-model.

### Step 4: RECONCILE — Fold findings back

The reviewer's output is data, not verdict. **You are still the orchestrator.** Re-read the artifact text against each finding before classifying — rubber-stamping the reviewer is the same failure mode as ignoring it.

For each finding, classify in this **precedence order** (first matching class wins):

1. **Contract misread** — reviewer flagged something specifically because the CONTRACT you provided was unclear or incomplete. Fix the contract first, re-classify on the next cycle.
2. **Valid + actionable** — real issue requiring a change to the artifact. Change it, re-loop.
3. **Valid trade-off** — issue is real but cost of fixing exceeds cost of accepting. Document the trade-off explicitly so the user sees it.
4. **Noise** — reviewer flagged something that's actually correct under context the reviewer didn't have. Note it, move on, and ask: would adding that context to the contract have prevented the false flag?

A fresh reviewer can be wrong because it lacks context. Don't defer just because it's "fresh." Findings marked `unverified` need you to check them before they can be classified as actionable.

Report the result as a compact table — `# | reviewer | severity | class | action` — so the user sees every finding's fate, not just the fixes.

### Step 5: STOP — Bounded loop, not recursion

Stop when:

- Next iteration returns only **trivial** findings — `minor` severity, or already classified in an earlier cycle — **or**
- 3 cycles completed (escalate to user, don't grind a fourth alone), **or**
- User explicitly says "ship it"

If after 3 cycles the reviewer still surfaces `blocker`/`major` findings, the artifact may not be ready. Surface this to the user — three unresolved cycles is information about the artifact, not a reason to keep looping.

If 3 cycles is "obviously insufficient" because the artifact is large: the artifact is too big — return to Step 2 and decompose. Do not lift the bound.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'm confident, skip the doubt step" | Confidence correlates poorly with correctness on novel problems. Moments of certainty are exactly when blind spots hide. |
| "Spawning a reviewer is expensive" | Debugging a wrong commit in production is more expensive. The check is bounded; the bug isn't. |
| "The reviewer will just nitpick" | Only if unscoped. Constrain the prompt to "issues that would make this fail under the contract"; the severity column lets minor findings stop the loop. |
| "I'll do doubt at the end with a code review" | Code review is a final gate. Doubt-driven catches wrong directions early when course-correction is cheap. By PR time it's too late. |
| "If I doubt every step I'll never ship" | The skill applies to non-trivial decisions, not every keystroke. Re-read "When NOT to Use." |
| "Two opinions are always better than one" | Not when the second has less context and produces noise. Reconcile, don't defer. |
| "The reviewer disagreed so I was wrong" | The reviewer lacks your context — disagreement is information, not verdict. Re-read the artifact, classify, then decide. |
| "`general-purpose` works, it's fine as the reviewer" | It works *and* may inherit your conversation. A reviewer that read your reasoning is not fresh-context. Use `doubt-reviewer`. |
| "The probe came back empty, that role is dead" | The transport sometimes returns empty on a first call. Retry once before advancing. |

## Red Flags

- Spawning a fresh-context reviewer for a one-line rename or formatting change
- Spawning the reviewer from a definition without `inherit_context: false` — the CLAIM leaks through the parent snapshot
- Passing the CLAIM, your reasoning, or no CONTRACT to the reviewer
- Prompting the reviewer with "is this good?" instead of "find issues"
- Treating reviewer output as authoritative without re-reading the artifact text
- Looping >3 cycles without escalating to the user
- Skipping doubt under time pressure on a high-stakes decision
- Re-spawning fresh-context on an unchanged artifact (you'll get the same findings; you're stalling)
- **Doubt theater (checkable signal)**: across 2 or more cycles where the reviewer surfaced `blocker`/`major` findings, zero findings were classified as actionable. You are validating, not doubting. Stop and escalate.
- Doubting only after committing — that's post-hoc review, not doubt-driven development
- Any cross-model outcome (skip, exhausted series, same-family fallback, substituted agent) not announced in the output
- Substituting a raw `provider/model-id` or an external review CLI for the `@propose-review-N` subagent

## Interaction with Other Skills

- **`review-code`**: complementary. `review-code` is a post-hoc review of a finished diff; doubt-driven is in-flight per-decision. Use both.
- **`code-review`**: the CodeRabbit ship gate — the last, external check. Doubt-driven happens long before it.
- **`systematic-debugging`**: hands control to this skill after three failed fixes — the protected premise is what to doubt. In the other direction, when the reviewer surfaces a real failure mode, drop into systematic-debugging to localize and fix it.
- **`scenario-design`**: a failing test is a disproof attempt — when a test can express the claim, write it; a failing RED test satisfies the doubt step for behavioral claims.
- **`security-hardening`**: when the artifact touches auth, secrets or untrusted input, add its threat checklist to the CONTRACT.
- **`plan-proposal`**: runs this skill on OpenSpec proposals with a spec-collateral scan before each cycle; main session only, never degraded to self-questioning.

## Verification

After applying doubt-driven development:

- [ ] Every non-trivial decision (per the definition above) was named explicitly as a CLAIM before standing
- [ ] At least one fresh-context review per non-trivial artifact (a failing RED test satisfies this for behavioral claims)
- [ ] The reviewer was spawned as `doubt-reviewer` (or another `inherit_context: false` definition, announced) and received ARTIFACT + CONTRACT — NOT the CLAIM, NOT your reasoning
- [ ] The reviewer's prompt was adversarial ("find issues") and asked for the severity / location / contract clause table
- [ ] Findings were classified against the artifact text (not rubber-stamped) using the precedence: contract misread / actionable / trade-off / noise, and reported as a table
- [ ] A stop condition was met (only minor/repeat findings, 3 cycles, or user override)
- [ ] Cross-model: a configured `@propose-review-N` series ran automatically (different family first, probed once per session, empty retried once, same-family only as announced degraded last resort); with no role, an interactive session bootstrapped one (`list_models` → `ask_user` → `update_roles`) or offered manual/skip; a non-interactive run skipped
- [ ] The cross-model outcome was announced in the output, whatever it was
