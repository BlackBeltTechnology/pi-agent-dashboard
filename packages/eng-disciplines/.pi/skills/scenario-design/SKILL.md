---
name: scenario-design
description: >-
  Draft real-life test SCENARIOS (not smoke tests) from a change/feature spec
  (OpenSpec optional). Derives edge-case, performance, frontend-quirk, and
  error-handling scenarios using ISTQB design techniques, routes each to your
  project's test levels, and writes a standalone test-plan.md catalog. When a
  scenario's
  (input · trigger · observable) triple cannot be filled from the spec, the spec
  has a gap — the skill emits decision-forcing clarification questions and (in
  proposal/design stage) STOPS to ask. Use when the user says "design test
  scenarios", "what should we test for this change", "the tasks are just smoke
  tests", "build a test plan", "find edge cases", "is this spec testable", or
  before writing the ## Tests / ## Validate sections of a tasks.md.
license: MIT
compatibility: "Optional: OpenSpec change spec as input. Reads a change/feature spec; writes test-plan.md."
metadata:
  author: robson
  version: "1.0"
---

Turn a change spec into **adversarial, real-life test scenarios** — designed to
break the system, not confirm it works. A scenario is only as good as it is
*concrete and executable*. If the spec can't supply the concrete bits, that is a
**spec defect**, surfaced as a clarification — not a guess.

**Input**: A change/feature spec. `--change <name>` (OpenSpec), or infer from
context / point the skill at any spec doc.
**Mode**: `--stage proposal|design|apply` (default: infer — see Gate).
**Output**: a standalone `test-plan.md` catalog written to your change/spec's
test-plan location (OpenSpec: `openspec/changes/<name>/test-plan.md`).

---

## Core mechanism — the Triple

Every scenario MUST resolve three concrete slots:

```text
   ┌─────────────┬──────────────────────┬────────────────────────────┐
   │  INPUT      │  TRIGGER             │  EXPECTED OBSERVABLE OUTCOME │
   │  concrete   │  the condition /     │  a measurable, visible fact  │
   │  data /     │  action that fires   │  (status, value, latency,    │
   │  state      │  the behaviour       │   DOM, log line, exit code)  │
   └─────────────┴──────────────────────┴────────────────────────────┘
```

Rule (from spec-coding edge-case practice): **if any slot is a verb without a
noun, or an adjective instead of a number, the slot is unfillable → spec gap.**
"Handles errors gracefully" is not a Triple. "POST /api/restart while server
already restarting (input) → second caller (trigger) → receives 409 within
500ms, no second orchestrator spawned (observable)" is.

**Stance: falsify, don't confirm.** For each requirement, the job is to find the
input+trigger that makes the observable *wrong*. Happy path is table stakes;
the scenario value is in the boundaries and failures.

---

## Phase 1 — Read the spec, classify requirements

1. Read what exists (OpenSpec layout shown; in a non-OpenSpec project read
   whatever spec/design/task docs the user points at — do not fail on a missing
   `openspec/` dir or CLI):
   - `openspec/changes/<name>/proposal.md` (always)
   - `openspec/changes/<name>/design.md` (if present — decisions, invariants)
   - `openspec/changes/<name>/specs/**/spec.md` (requirement deltas)
   - `openspec/changes/<name>/tasks.md` (if present — to align section numbers)

2. Extract every testable requirement (each `SHALL`/`MUST`, each scenario block,
   each acceptance criterion). For each, tag its **shape** — this picks the
   technique:

   | Requirement shape | Technique to apply | Scenario class |
   |---|---|---|
   | Input range / numeric / size / count | **Equivalence Partitioning + Boundary Value Analysis** | edge-case |
   | Multiple boolean/enum flags combine | **Decision Table** | edge-case |
   | Lifecycle / status transitions / reconnect / restart | **State-Transition** | frontend-quirk + error-handling |
   | Async / WebSocket / polling / optimistic UI | **State-convergence + invariant assertions** (not UI-visibility) | frontend-quirk |
   | Latency / throughput / memory / long-run | **tail-latency (p95/p99) + soak + threshold** | performance |
   | Depends on network / disk / subprocess / other service | **fault injection (delay + abort)** | error-handling |

   See `references/technique-cheatsheet.md` for how to apply each.

---

## Phase 2 — Generate scenarios via the Triple (or a gap)

For each requirement, walk its technique and try to emit one or more Triples.

- **EP+BVA**: emit min, just-below-min (invalid), nominal, just-below-max,
  max, just-above-max (invalid). Six Triples from one numeric requirement.
- **Decision table**: one Triple per reachable flag combination; mark
  impossible combos.
- **State-transition**: one Triple per legal edge AND per *illegal* edge
  (event fired in a state that shouldn't accept it).
- **Async/convergence**: assert the eventual invariant and the intermediate
  states, never "element is visible after N ms".
- **Performance**: state the workload, the metric (p95/p99/RSS), the threshold,
  and the measurement window. No threshold in spec → gap.
- **Fault injection**: for each dependency, a delay Triple and an abort Triple;
  assert retry/timeout/degradation behaviour.

**When a slot won't fill → STOP generating that scenario. Record a gap** with
the unfillable slot named (see Gate). Do not invent the missing value.

---

## Phase 3 — The clarification Gate (configurable)

Whether an unfillable Triple blocks or just annotates depends on stage:

```text
   stage = proposal | design   →  HARD gate
   stage = apply               →  SOFT gate
   (no --stage)                →  infer: tasks.md absent ⇒ proposal/design (hard)
                                          tasks.md present ⇒ apply (soft)
```

- **HARD gate**: collect all gaps, then **call `ask_user`** with decision-forcing
  questions and STOP. Do not write test-plan.md until answered. The spec is not
  yet testable; clarify before locking scenarios.
- **SOFT gate**: write the scenario row with a `[NEEDS CLARIFICATION: <slot> —
  <question>]` marker, continue, and list all markers in a banner at the top of
  test-plan.md.

**Decision-forcing question rules** (from ambiguity-detection practice):
- Name the missing slot and *why* it blocks a scenario.
- Offer concrete candidate answers, never propose a solution/implementation.
- One question per genuine decision; do not pad.

Example: *"Restart quiesce window: tasks say bridges 'suppress auto-start for
the quiesce window'. To test the boundary I need the exact value — is it 5s
(restart) / 60s (shutdown) per AGENTS.md, or spec-defined elsewhere? Without a
number I cannot write the just-after-window re-spawn scenario."*

---

## Phase 4 — Route each scenario to a test level

Every scenario carries a **level** tag fixing where it would be authored, and a
**disposition** (`automated` | `manual-only`). Map each scenario's *nature* to
one of **your project's actual test levels** — the routing *method* is fixed; the
level names and paths are yours to fill. Do not assume a level/harness the
project lacks.

| Scenario nature | Route to the project level that is… |
|---|---|
| pure logic / boundary / decision table / pure state | the fast in-process unit tier |
| process / install / spawn / multi-OS runtime | the process/CLI smoke tier (NO rendered-UI asserts) |
| rendered UI / WS-driven view / convergence / quirk | the browser/e2e tier |
| micro perf (fn-level) | the unit tier, timed |
| process/load perf, soak | the smoke tier (or a dedicated perf harness) |
| aesthetics / hardware / "feels right" / subjective | `manual-only` → no fold, no test task (disposition=manual-only, level —) |

Keep the rendered-UI-vs-smoke boundary sacred: a UI-visible assertion never
lives in a process/CLI smoke row.

> **Example — pi-agent-dashboard levels** (this repo's concrete routing; other
> projects substitute their own). Honour the AGENTS.md hard rule: rendered-UI
> assertions are Playwright only; qa/ stays CLI/process smoke.
>
> ```text
>    ┌────────────────────────────┬──────────────────────────────────────────┐
>    │ Scenario nature            │ Level → location                          │
>    ├────────────────────────────┼──────────────────────────────────────────┤
>    │ pure logic / boundary /    │ L1 unit  → packages/*/src/**/__tests__/   │
>    │ decision table / state pure│            *.test.ts (vitest)             │
>    │ process / install / spawn  │ L2 smoke → qa/tests/*.sh|*.ps1            │
>    │  / multi-OS runtime        │            (NO rendered-UI asserts)       │
>    │ rendered UI / WS-driven    │ L3 e2e   → tests/e2e/*.spec.ts            │
>    │  view / convergence / quirk│   (Playwright vs docker harness port †)   │
>    │ micro perf (fn-level)      │ L1 unit (timed)                           │
>    │ process/load perf, soak    │ L2 smoke (or dedicated harness)           │
>    │ aesthetics / hardware /    │ manual-only → no fold, no test task       │
>    │  "feels right" / subjective │   (disposition=manual-only, level —)      │
>    └────────────────────────────┴──────────────────────────────────────────┘
> ```
>
> † The docker e2e harness port is NOT a fixed `:18000` — `docker/test-up.sh`
> hash-derives a free port per worktree and records it in `.pi-test-harness.json`
> (`dashboardPort`). An L3 scenario's observable is read against that derived
> port; never hardcode `:18000`.

**`manual-only` routing outcome** (additive to L1/L2/L3): a scenario whose
expected observable is a human judgment with no automatable signal — visual
aesthetics, a hardware behaviour, "feels right / looks correct", subjective UX —
is NOT routed to a test level. Its manifest row records `disposition:
manual-only` (level `—`), and no test task is folded for it; it is deferred to
post-merge manual verification by `ship-change`. Every routable scenario keeps
its L1/L2/L3 level and `disposition: automated` — this outcome only diverts the
truly un-automatable rows; existing L1/L2/L3 logic is unchanged.

If a scenario implies a brand-new level/harness, flag it in the plan's "New
infra needed" section rather than silently assuming it exists.

---

## Phase 5 — Write test-plan.md

Write the `test-plan.md` to your change/spec's test-plan location (OpenSpec:
`openspec/changes/<name>/test-plan.md`) using
`references/test-plan-schema.md`. It is a **standalone catalog**, separate from
tasks.md. Each scenario is a numbered row with: id, class, technique, level,
**disposition** (`automated` | `manual-only`), the full Triple, and (soft gate)
any clarification marker. The `disposition` column is mandatory on every row —
it is the manifest's source-of-truth signal that the fold step (in
`plan-proposal`) and the defer rule (in `ship-change`) both read.

End with a short offer (do not auto-act): *"Want me to fold these into the
`## Tests` / `## Validate` sections of tasks.md as checklist items?"* — folding
is a separate, explicit step.

---

## Guardrails

- **Never invent a missing value** to make a scenario "work" — that hides the
  spec gap this skill exists to expose.
- **Never write app/test code here** — this skill drafts the *catalog*. Authoring
  the actual `*.test.ts` / `*.spec.ts` is implementation (use `implement` /
  `openspec-apply-change`).
- **Don't downgrade scenarios to smoke** to make them easy. A scenario that only
  checks "it exists / exit 0" belongs in qa/ smoke already — this skill's output
  is the layer *above* that.
- **Honour the level boundary** — no rendered-UI assertion in a qa/ smoke row.
- **Offer, don't auto-fold** into tasks.md.

## References

- `references/technique-cheatsheet.md` — how to apply each ISTQB + resilience
  technique, with project-specific examples.
- `references/test-plan-schema.md` — exact test-plan.md layout.
