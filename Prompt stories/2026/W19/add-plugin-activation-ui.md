---
session: 019e0e64
week: 2026/W19
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-plugin-activation-ui]
proposal_excerpt: "Today every discovered dashboard plugin is enabled-by-default and there is no UI to turn one off. The only override is hand-editing `~/.pi/dashboard/config.json#plugins.<id>.enabled = false`. Worse, disabling a plugin…"
---

# How we did it: Reconcile & lock an OpenSpec proposal before implementation — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened on the `add-plugin-activation-ui` OpenSpec change with a deliberately
open question — the first prompt was literally:

```
IS there anything to clarify?
```

then, one turn later, sharpened to `Proposal: add-plugin-activation-ui Is there anything to clarify?`.

The **real objective**, once the steering clarified it, was: *before writing a single
line of implementation code, audit the change's four artifacts (`proposal.md`,
`design.md`, `tasks.md`, `specs/dashboard-plugin-loader/spec.md`) for internal
contradictions, surface every open design choice as a decision-forcing question, and
— on a one-word "go" — apply all the decisions inline so `openspec validate --strict`
passes.* The session is a **planning / spec-hardening** pass, not a build. It ended at
the implementation boundary: the AI read the relevant source, produced a phased plan,
and stopped to confirm before touching code.

## 2. TL;DR playbook

1. Point the AI at a specific OpenSpec change and ask **"is there anything to clarify?"** — not "start implementing."
2. Have it enumerate the change's files (`find openspec/changes/<name> -type f`) and read all four artifacts.
3. Ask it to split findings into **inconsistencies to reconcile** (concrete artifact-vs-artifact conflicts) and **open design choices** (things the proposal flags but never decides).
4. Review the numbered list; reply with a single terse token (**"a"**, "all", "go") to authorize applying the AI's recommended resolution for every item.
5. Let it apply decisions **inline across all four files in one pass**, then run `openspec validate <name> --strict` to prove coherence.
6. Only *after* validation passes, move to `/opsx-apply` — and require the AI to read source + present a **phased plan with verifiable end states** before writing code.
7. Confirm the plan (or steer phases) — do not let it start on 43 tasks unprompted.

## 3. How the collaboration unfolded

**Phase 1 — Disambiguate the ask (Discovery).**
The very first prompt (`IS there anything to clarify?`) had no object, and the AI
correctly *refused to guess*: it replied with three interpretations and asked which
one. The human's second prompt supplied the missing noun (`Proposal:
add-plugin-activation-ui`). *Why it worked:* the AI treated an ambiguous prompt as a
question to the user rather than an excuse to invent scope.

**Phase 2 — Audit the artifacts (Gather + Analyze).**
The AI listed the change directory, then read all four artifacts (13 `read` calls
total). It produced two buckets: **inconsistencies** (e.g. install location: proposal
D8 says `~/.pi/dashboard/plugins/<id>/` but D9 + the loader spec say pi resolves into
its git/npm cache with entries only in `<scope>/settings.json#packages[]`; 202-vs-200
response codes; an over-broad `alsoExtension` keyword set that would cause false
positives) and **open design choices** the proposal flagged but never settled. *Why
it worked:* framing conflicts as "artifact X says P, artifact Y says Q — pick one"
makes each item a decision, not an essay.

**Phase 3 — One-word authorization → batch apply (Decide + Generate).**
The human replied **`a`**. The AI interpreted it as "apply your recommended
resolutions" and enumerated **10 explicit decisions** (install location → pi-cache +
scope-managed `packages[]`; sync response → 200 everywhere; `alsoExtension` →
`pi-extension` only; ghost-remove → no restart banner; uninstall built-in → 409; keep
both `installed` + `source` with invariant `installed === (source !== "ghost")`;
cycle detection → soft-fail not hard-throw; restart banner keys on
`/api/health.startedAt`; etc.) then edited all four files in a single pass and ran
`openspec validate --strict` → **passes**. *Decision point:* the human delegated the
*resolution* of every item to the AI's stated recommendation with one character.

**Phase 4 — Cross the boundary to implementation, then stop (Plan).**
The final steering turn pasted the `/opsx-apply` command. The AI announced the change,
ran `openspec status` + `openspec instructions apply`, read the loader/route source
(`loader.ts`, `plugin-status-store.ts`, `server.ts`), and — citing AGENTS.md's "confirm
the plan before any major change" — produced a **7-phase (A–G) plan** with tasks,
touched surfaces, and a *verifiable end state per phase*, then **halted for
confirmation** rather than writing any of the 43 tasks.

## 4. Prompts that worked

- **The goal prompt** — `Proposal: add-plugin-activation-ui Is there anything to
  clarify?` Naming the artifact + asking for *clarifications* (not "implement") is
  what turned the session into a spec-hardening pass. A stronger version bakes in the
  split you actually want:
  > *"Audit the `add-plugin-activation-ui` change. List (1) inconsistencies between
  > proposal/design/tasks/spec and (2) undecided design choices, each as a numbered
  > decision I can approve."*
- **`a`** — the highest-leverage follow-up in the whole session. One character
  authorized applying ten resolutions. It worked *only because* the AI had already
  laid out its recommended answer for each item, so "a" = "yes to all your
  recommendations." Reproduce with "apply all your recommendations" when you trust the
  analysis.
- **The pasted `/opsx-apply` block** — a precise, self-describing command that told the
  AI exactly how to select the change, read status, and fetch apply instructions.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Not know *which* proposal an object-less prompt referred to | Naming it: `Proposal: add-plugin-activation-ui` | Always lead with the change name in the first prompt |
| Wait for per-item approval on 10 decisions | Replying `a` to authorize the whole batch | Say "apply your recommended resolution for every item" once the list looks right |
| (Correctly) want to rush into 43 implementation tasks | The AGENTS.md rule forced a plan-first stop | Keep "confirm the phased plan before writing code" as a standing rule |
| Trust the local `openspec` on PATH | Fell back to `~/.pi-dashboard/node/bin/openspec` when the first invocation misbehaved | Know the dashboard ships its own openspec binary |

The quality bar the human imposed was implicit but firm: **no implementation until the
artifacts are internally consistent and `--strict` validation is green.**

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created in this session. But the workflow is squarely
repeatable and *should* be captured as a project skill — call it
**`harden-openspec-proposal`**:

- **What it would capture:** the "clarify → bucket conflicts vs. open choices →
  one-token batch-apply → `validate --strict`" loop for any OpenSpec change, plus the
  guardrail to stop at the implementation boundary with a phased plan.
- **Why it's effective:** it removes the most expensive class of rework — discovering
  an artifact contradiction *after* code is written — by forcing coherence up front,
  and it makes the reconcile step a single-pass, validation-gated operation.
- **When to invoke:** any time a change has ≥2 artifacts (proposal/design/tasks/spec)
  and you're about to `/opsx-apply`. This project already ships a `doubt-driven-review`
  discipline skill for irreversible steps — pair it with that.

## 7. Pitfalls & dead ends

- **Object-less prompts stall the AI.** `IS there anything to clarify?` produced a
  "which do you mean?" round-trip. Always name the target artifact.
- **`openspec` on PATH can be the wrong one.** The session ran `which openspec` and
  fell back to the dashboard-bundled binary at `~/.pi-dashboard/node/bin/openspec`. If
  `openspec validate` behaves oddly, check *which* binary you're hitting.
- **Over-broad keyword matching is a silent trap.** The spec had widened
  `alsoExtension` to match `pi-extension | extension | extensions` — a false-positive
  generator. The fix locked it to `pi-extension` only. Watch for spec scenarios that
  quietly broaden a proposal's intent.
- **Contradictions hide across files.** The install-location conflict lived in a
  proposal diagram (D8) vs. a design section (D9) vs. the loader spec — none wrong in
  isolation. Read *all* artifacts before trusting any one.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change name (here: `add-plugin-activation-ui`).
- A working `openspec` binary (prefer the dashboard's `~/.pi-dashboard/node/bin/openspec` if PATH is ambiguous).

**Steps:**
1. `find openspec/changes/<name> -type f` → read every artifact.
2. Ask the AI to bucket findings: **inconsistencies** vs. **open design choices**, numbered.
3. Review; authorize with one token ("apply all your recommendations").
4. Let it edit all artifacts in one pass.
5. `openspec validate <name> --strict` → must pass.
6. `/opsx-apply <name>` → require a phased plan with verifiable end states.
7. Confirm the plan before any code is written.

**Artifacts produced (this session):**
- `openspec/changes/add-plugin-activation-ui/proposal.md` (edited)
- `openspec/changes/add-plugin-activation-ui/design.md` (edited)
- `openspec/changes/add-plugin-activation-ui/tasks.md` (edited)
- `openspec/changes/add-plugin-activation-ui/specs/dashboard-plugin-loader/spec.md` (edited)
- A confirmed 7-phase (A–G) implementation plan, ready for `/opsx-apply`.

---

_Generated from session `019e0e64-efc2-708b-aad9-111d07332f08` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-09. Source extract: session facts sheet._
