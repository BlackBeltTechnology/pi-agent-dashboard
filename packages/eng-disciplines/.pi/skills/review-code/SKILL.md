---
name: review-code
description: "Review a code change well — engine-agnostic critical review discipline for an inline dev loop. Use on triggers like \"review this code\", \"review my diff\", \"is this change good\", \"critique this implementation\", \"review before commit\", or autonomously after writing a non-trivial change and before committing. Defines WHAT to look for (design→correctness→complexity→tests→naming→security), a parseable severity taxonomy, and a review→fix→re-review loop with a hard stop condition. Runs on any reviewer engine (a model via role alias, a human, or a cloud tool). Not a ship-gate: the cloud PR gate (rabbit-code-review) stays reserved for the pull request. Not a debugging or feature-build workflow."
related_skills: doubt-driven-review, systematic-debugging, security-hardening, code-simplification
---

# Review Code

## Overview

Code review is the discipline of judging whether a change **improves the health of the codebase** — not whether it is perfect. An undirected reviewer does one of two failure modes: it rubber-stamps (misses real defects) or it nit-blocks (treats every preference as mandatory and never lets the change land). This skill prevents both by giving the review a governing principle, a fixed set of dimensions to inspect in value order, a **parseable severity taxonomy**, and a loop with an explicit stop condition.

This is the **inline development-loop reviewer** — it runs after you write a non-trivial change and before you commit. It is **engine-agnostic**: the reviewer can be a model (invoked via a role alias), a human, or a cloud tool. Because a model-backed reviewer has effectively unlimited throughput, it is the right engine for the inner loop — run it on every non-trivial change without spending a rate-limited cloud quota.

The cloud PR gate (CodeRabbit, via the `rabbit-code-review` skill) is a **separate, later** gate reserved for the pull request — do not spend it inside the inner loop. This skill covers everything up to the commit; the ship gate covers the PR.

Distilled from Google's Engineering Practices ("The Standard of Code Review", "What to look for"), the Conventional Comments spec, and the local severity→fix loop.

## When to Use

- After writing a non-trivial change, before committing it (the inner loop)
- On an explicit request: "review this", "critique this diff", "is this change sound"
- Reviewing a subagent's or another author's diff before integrating it
- As a checkpoint in an implementation loop, once a task's code is written

**When NOT to use:**

- Shipping a PR — that is the cloud gate (`rabbit-code-review`), run once, at the PR
- A one-line or mechanical change (rename, import tweak) — review overhead > benefit
- In-flight, before the code exists — that is `doubt-driven-review` (per-decision, not per-diff)
- Diagnosing a failure — that is `systematic-debugging`

## The Governing Principle — the loop terminator

> **Pass the change when it *definitely improves* code health. Not when it is perfect.**

This is the single most important rule, because it is what *ends* the loop. A reviewer without it keeps finding one more nitpick forever and the change never lands. Approve once no blocking defect remains — even if you can still imagine improvements. Leave the non-blocking improvements as labelled suggestions the author may take or defer.

Two corollaries:

- **There is no perfect change, only a healthier codebase.** Block on defects, not on taste.
- **Continuous improvement over perfection.** A change that measurably improves things and leaves a `suggestion:` for the rest is better than a change stalled on a reviewer's ideal.

## Review Dimensions — inspect in value order

Review **every changed line**, in context, highest-value dimension first. Most defects that matter live near the top of this list; do not spend the review budget on naming while a design flaw goes unexamined.

```text
1. DESIGN         Does the change fit the system? Right layer, right seam?
                  Does it integrate, or bolt on? (highest-value — a wrong
                  design is expensive later; a wrong variable name is cheap.)
2. CORRECTNESS    Does it do what it claims? Edge cases, error paths,
                  concurrency/races, boundary values, empty/null inputs.
3. COMPLEXITY     Is it more complex than it needs to be? Over-engineering
                  and speculative generality (YAGNI) — solve the problem
                  that exists now, not a hypothetical future one.
4. TESTS          Are there tests, and do they test behaviour (not just
                  cover lines)? Would they fail if the code were wrong?
5. NAMING         Do names reveal intent? Could a reader guess wrong?
6. COMMENTS       Do comments explain WHY, not WHAT? (What is in the code.)
7. CONSISTENCY    Does it match the repo's conventions and style?
8. SECURITY       Untrusted input, secrets, authz, injection. On any hit,
                  escalate to the `security-hardening` skill.
9. DOCS           Are public surfaces / behavioural changes documented?
```

Also, deliberately look for something **done well** and say so — a sincere `praise:` per review is part of the discipline, not decoration.

## Severity Taxonomy — parseable, prioritized

Every finding carries a label so the author (or the loop) knows what is mandatory versus optional. Without labels, everything reads as blocking and the change stalls. Based on Conventional Comments; the `blocking` / `non-blocking` decoration is what the loop keys on.

| Label | Meaning | Blocks the loop? |
|---|---|---|
| **`issue(blocking)`** | A real defect that must be fixed before pass — wrong behaviour, a design flaw, a security hole, a missing critical test | **Yes** |
| **`issue(non-blocking)`** | A real but low-stakes defect; fine to fix now or file a follow-up | No |
| **`suggestion`** | An improvement; the author decides. Pair with the concrete change | No |
| **`nitpick`** | Trivial preference (style, phrasing). Never blocks | No |
| **`question`** | You are unsure a problem exists — ask for intent before judging | No (resolve first) |
| **`praise`** | Something genuinely good. Aim for ≥1 per review | No |

Finding format (explain the reasoning, point at the fix):

```text
<label>[(blocking|non-blocking)]: <one-line subject>
  path/to/file.ts:42 — why this is a problem, and the suggested change.
```

Rules for writing findings (from Google's "How to write comments"):

- **Explain the reasoning**, don't just assert. "This can race" → say how.
- **Point at the problem and suggest the fix** — balance directing with letting the author choose.
- **Be kind and specific.** Review the code, never the author.
- **Label honestly.** Do not inflate a `nitpick` to `issue(blocking)` to force it.

## The Review → Fix Loop

Coherence-preserving: the reviewer and the fixer share the same context, so the fix understands the change's intent.

```text
1. Review every changed line across the dimensions → emit labelled findings.
2. Triage: collect all issue(blocking) + issue(non-blocking) you intend to fix.
3. Fix them SURGICALLY — smallest safe change per finding. Every changed line
   traces to a finding. Do NOT refactor adjacent code "while you're here".
4. Re-review the new diff (fixes can introduce defects).
5. Repeat 1–4 until only non-blocking / suggestion / nitpick / praise remain.
6. PASS. Leave remaining suggestions labelled for the author to take or defer.
```

The stop condition is the governing principle made mechanical: **zero `issue(blocking)` remaining ⇒ pass.** Do not loop on suggestions.

## Choosing the reviewer engine

- **Inner loop (this skill):** a model via a role alias (e.g. a strong-reasoning role). Unlimited throughput — run it on every non-trivial change. No cloud quota spent.
- **PR ship gate:** the cloud tool (`rabbit-code-review` / CodeRabbit), run **once** at the pull request, where its GitHub integration and auto-fix loop earn their cost. Never call it inside the inner loop — that spends the quota you need at ship time.
- Give the reviewer the **diff plus the change's intent** (the task text / spec). A reviewer that can't see intent flags style noise instead of real defects — when intent is missing, emit a `question:` and get it before judging.

## Red Flags

- Treating every finding as blocking — the nit-block spiral; the change never lands
- Rubber-stamping PASS without reading every changed line
- Reviewing naming/style while a design flaw goes unexamined (wrong dimension order)
- Blocking on taste instead of defects (violates the governing principle)
- Scope-creep refactors inside the fix step ("while I'm here") — every changed line must trace to a finding
- Judging code whose intent you never established — ask (`question:`) first
- Spending a rate-limited cloud gate on the inner loop
- No `praise:` ever — you are only modelling fault-finding

## Verification

- [ ] Every changed line was reviewed, in context, across the dimensions in value order
- [ ] Findings carry honest labels; blocking vs non-blocking is explicit
- [ ] All `issue(blocking)` findings were fixed surgically and the diff re-reviewed
- [ ] The loop stopped at zero blocking findings (not at "perfect")
- [ ] Fixes introduced no scope-creep; every changed line traces to a finding
- [ ] The cloud PR gate was NOT spent — it remains reserved for the pull request
