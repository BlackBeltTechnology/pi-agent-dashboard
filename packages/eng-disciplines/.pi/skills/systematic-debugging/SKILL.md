---
name: systematic-debugging
description: Root-cause a bug already in front of you, instead of guessing at fixes. Use on triggers like "root cause this", "why is this failing", "debug systematically", "this test is flaky", "it works locally but not in CI", or when a fix attempt has already failed once. Enforces a phased evidence-first process before any code change. Not a feature-build or ship workflow.
related_skills: doubt-driven-review, code-review, observability-instrumentation
---

# Systematic Debugging

## Overview

A bug is a gap between what the code does and what you believe it does. Guessing at fixes closes the gap by accident, if at all — and each blind edit adds a new variable that hides the real cause. Systematic debugging is the discipline of **gathering evidence until the cause is known**, then changing exactly one thing.

The failure mode this skill prevents: reading a stack trace, forming an instant theory, editing code to match the theory, re-running, and repeating. That loop feels like progress and usually is not — it mutates the system faster than it explains it.

## When to Use

- A test fails and the message doesn't immediately tell you why
- Behaviour differs between environments ("works locally, fails in CI", "works in dev mode, not production")
- A fix you already tried didn't work (you are now on attempt ≥ 2 — stop guessing)
- An intermittent / flaky failure you can't reproduce on demand
- A regression: something that worked now doesn't, and you don't know which change broke it

**When NOT to use:**

- The cause is already obvious and proven (typo, off-by-one you can see, wrong constant)
- You are building a new feature, not diagnosing existing behaviour
- The "bug" is actually a missing requirement — that's a spec conversation, not a debug session

## The Four Phases

Each phase has a **success criterion**. Do not advance until it is met. Skipping ahead is the whole antipattern.

```text
Phase 1  ROOT CAUSE      gather evidence ─▶ criterion: you can state the cause in one sentence
   │                                        with evidence, not a guess
   ▼
Phase 2  PATTERN         is this cause elsewhere? ─▶ criterion: you've searched for sibling
   │                                                 instances of the same class of bug
   ▼
Phase 3  HYPOTHESIS      change ONE variable ─▶ criterion: a prediction that, if wrong,
   │                                            disproves your theory (a real test)
   ▼
Phase 4  IMPLEMENTATION  fix + regression test ─▶ criterion: a test that fails before the fix
                                                  and passes after
```

### Phase 1 — Root Cause

Collect evidence before forming a theory. The goal of this phase is a sentence of the form *"X fails because Y, and here is the observation that shows Y."*

- Read the **full** error and stack trace, not the first line. The frame that matters is often three deep.
- Reproduce deterministically. A bug you can't reproduce, you can't verify you fixed.
- Capture the actual state at the failure point. When `console.log` can't reach the state (closure variables, a paused async frame, the Electron main process, WebSocket server internals), reach for the **`node-inspect-debugger`** skill — real breakpoints and a scope-chain dump beat sprinkled logs.
- Distinguish **symptom** from **cause**. "Returns undefined" is a symptom; "the map key is built from a stale closure value" is a cause.

**Success criterion:** you can name the cause in one sentence, backed by an observation. If you can only say "I think it's the cache," you are not done with Phase 1.

### Phase 2 — Pattern

A bug is rarely unique. Before fixing this instance, ask whether the same *class* of mistake exists elsewhere.

- Grep for the same call shape / the same missing guard.
- If one handler forgot to await, check its siblings.
- Note candidates; you are cataloguing, not fixing them all now.

**Success criterion:** you've searched for sibling instances and know whether the fix is one-site or systemic.

### Phase 3 — Hypothesis

State a hypothesis that could be **wrong** — and how you'd know. A theory that can't be disproven isn't a diagnosis, it's a belief.

- Change **one** variable at a time. If you change three things and it works, you've learned nothing about which mattered — and added two new liabilities.
- Predict the outcome before you run: *"If the cause is the stale key, forcing a fresh key makes the failure disappear; if it still fails, my theory is wrong."*
- A failed prediction is a **result**, not a setback — it eliminates a branch.

**Success criterion:** you have a one-variable change and a falsifiable prediction.

### Phase 4 — Implementation

Only now do you write the fix.

- Write (or update) a **regression test first** that reproduces the bug — it must FAIL before the fix. This is the RED step; it makes the bug concrete and proves the fix later.
- Apply the minimal change that makes it pass.
- Re-run the reproduction. Then run the wider suite to confirm no collateral damage.

**Success criterion:** a test that fails before the fix and passes after, plus a green wider suite.

## The Tight Feedback Loop

Fast, captured feedback is what makes evidence cheap. Use this repo's documented convention — run once, capture, then grep the file instead of re-running to see errors:

```bash
npm test 2>&1 | tee /tmp/pi-test.log     # run once, capture everything
grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log   # find failures
grep -n -A 20 'FAIL ' /tmp/pi-test.log        # failure + context
```

Never rerun `npm test` just to re-read an error you already produced — grep the captured log. Each unnecessary rerun is latency between you and the cause.

## The Rule of Three

**After three failed fixes, STOP.** Three misses means your model of the system is wrong, not that the fourth edit is the charm. Continuing to patch against a broken model deepens the hole.

When you hit three:

1. Stop editing.
2. Hand off to the **`doubt-driven-review`** skill — spawn a fresh-context adversarial reviewer to cross-examine the *architecture* and your assumptions, not just this line. The premise you've been protecting for three attempts is the thing to doubt.
3. Reconcile its findings, then re-enter Phase 1 with a corrected model.

The Rule of Three is a circuit breaker against sunk-cost debugging. Honour it.

## Red Flags

- Editing code before you can state the cause in one sentence (skipped Phase 1)
- Changing more than one variable per attempt (Phase 3 violated — you won't know what worked)
- Reading only the first line of a stack trace
- "Let me just try X" three times in a row without a new hypothesis (Rule of Three breach)
- Fixing the symptom (`if (x == null) return`) without knowing why `x` is null
- Declaring victory with no regression test — you can't prove it's fixed or stays fixed
- Re-running the suite to re-read an error instead of grepping the captured log

## Verification

- [ ] The cause was stated in one evidence-backed sentence before any fix (Phase 1)
- [ ] Sibling instances of the bug class were searched for (Phase 2)
- [ ] Each attempt changed exactly one variable against a falsifiable prediction (Phase 3)
- [ ] A regression test failed before the fix and passes after (Phase 4)
- [ ] If three fixes failed, control was handed to `doubt-driven-review` rather than a fourth blind attempt
