---
session: 019ebd87
week: 2026/W24
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [resolve-global-prompt-templates-from-dashboard, fix-slash-dispatch-delivery, retire-rpc-keeper-when-dispatchcommand-available, enable-rpc-keeper-by-default]
proposal_excerpt: "Two leftover fixes from the now-archived `fix-slash-dispatch-delivery` change. Its Issues 1 & 2 (delivery param, Path D error feedback) already landed; these two did not."
---

# How we did it: Reconcile a diverged OpenSpec proposal — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a single sharp prompt:

> _"Recheck proposal fix-slash-dispatch-delivery for current state, because the codebase diverged"_

The **real objective** — once the recheck surfaced reality — was *not* "implement the
proposal." It was **triage a stale proposal against a moved codebase**: prove which of its
items already landed via other PRs, identify which text is now *wrong* (references removed
config knobs), archive the mostly-done change without polluting main specs with its stale
delta, and split the genuine remainder into a fresh, well-scoped change. In 15 minutes the
session went from "is this still relevant?" to a committed archive + a new proposal.

## 2. TL;DR playbook

1. **Read the proposal artifacts first** (`proposal.md`, `design.md`, `tasks.md`, delta
   `specs/`) — get the full list of claimed changes before touching code.
2. **Grep each referenced symbol in the live tree** (`slash-dispatch.ts`, `bridge-context.ts`,
   `prompt-expander.ts`, `command-handler.ts`) and check the tests — build an
   item-by-item ✅ done / ⚠️ stale / ❌ remaining matrix backed by *file:line* evidence.
3. **Cross-reference git history** (`git log --oneline -- <file>`, PR numbers) to attribute
   what landed and *why* the wording diverged (which later PR removed the referenced knob).
4. **Add a SUPERSEDED banner** to the old `proposal.md` capturing the recheck findings.
5. **Archive with `--skip-specs`** (`npx openspec archive <name> --skip-specs -y`) so stale
   delta specs are NOT merged into main specs.
6. **Scaffold a fresh small change** for the real remainder — `npx openspec new change <name>`
   (note: `openspec change new` is wrong; discover the real subcommand via `--help`).
7. **Write the 4 artifacts** (proposal/design/tasks + delta `spec.md` with complete MODIFIED
   requirement text and scenarios), reading the target main-spec requirement blocks first so
   the delta is well-formed.
8. **Validate** (`npx openspec validate <name> --strict`) then commit both moves in one
   descriptive commit.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read the claim).** The AI read the four proposal artifacts before
looking at any implementation. Effective because it front-loaded the *complete* list of
claimed modification points, so the verification pass had a checklist to grade against
rather than wandering the codebase.

**Phase 2 — Verification (grade against reality).** The AI grepped each referenced symbol in
the live source and inspected the existing tests, producing a three-bucket matrix:
✅ *already implemented* (Issue 1 `delivery` param → `streamingBehavior`; Issue 2 Path-D
error feedback via PR #30), ⚠️ *stale* (Path-D message still references the removed
`useRpcKeeper: true` / `config.json` knob), ❌ *genuinely remaining* (global prompt-template
resolution + `hasDispatchCommand`). The winning move: **every verdict carried file:line or
PR evidence**, not vibes.

**Phase 3 — Attribution (why did it drift?).** `git log` on the touched files tied the
divergence to a concrete later change: `enable-rpc-keeper-by-default` (PR #47) removed the
config knob the proposal's Path-D wording assumed. That single fact justified the whole
archive-don't-implement decision.

**Phase 4 — Archive (preserve without polluting).** The AI wrote a SUPERSEDED banner into the
old proposal, then archived with `--skip-specs` — the key decision point: the change was
*mostly done but its delta specs were stale*, so merging them into main specs would corrupt
truth. `--skip-specs` archives the paper trail while leaving main specs clean.

**Phase 5 — Split (scope the remainder).** The AI scaffolded a new change
`resolve-global-prompt-templates-from-dashboard`, read the two target main-spec requirement
blocks so the MODIFIED delta was complete and valid, wrote all four artifacts, and validated
`--strict`.

**Phase 6 — Land.** On the user's one-word `commit changes`, both moves went into a single
commit `e2b6f55b` with a body explaining the recheck outcome. Working tree clean.

## 4. Prompts that worked

- **The goal prompt** — _"Recheck proposal X for current state, because the codebase
  diverged."_ Excellent kickoff: it names the artifact, states the *suspicion* (divergence),
  and implies the deliverable (a reconciliation), without prescribing the fix. It licenses
  the AI to conclude "don't implement — archive."
- **High-leverage follow-up** — _"commit changes."_ Two words that closed the session,
  trusting the AI's staged reconciliation. Works because Phase 1–5 had already produced a
  clean, self-describing set of changes.

**Stronger version to reuse:** _"Recheck proposal X against `develop`. For each claimed item,
tell me done / stale / remaining with file:line or PR evidence, then recommend
archive-vs-implement and do it."_ — bakes in the evidence bar and the decision the AI
reached organically.

## 5. Steering & corrections (what to watch for)

This session needed almost **no** correction — the goal prompt was precise and the AI's
evidence-first instinct matched the task. The guardrails are mostly about *not* skipping
the discipline that made it clean:

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| (risk) treat a proposal as a to-do list to implement | goal framed it as a *recheck* | Always ask "is this still true?" before implementing an aging proposal |
| guess the openspec subcommand (`openspec change new`) | — (self-corrected via `--help`) | Discover CLI verbs with `--help` before assuming word order |
| potentially merge stale delta specs on archive | — (chose `--skip-specs`) | When a change is *mostly* landed but its delta drifted, archive `--skip-specs` |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session. But the workflow is textbook-repeatable and
**should** be captured as a skill — call it **`recheck-diverged-proposal`**:

- **What it would capture:** the read-proposal → grep-live-tree → git-attribute →
  ✅/⚠️/❌ matrix → archive-`--skip-specs`-or-implement → split-remainder loop.
- **Why effective:** it removes the biggest failure mode of stale specs — blindly
  implementing text that a later PR already made wrong — and it keeps main specs honest by
  never merging drifted deltas.
- **When to invoke:** any time a proposal predates significant `develop` movement, or before
  picking up an old OpenSpec change to implement.

## 7. Pitfalls & dead ends

- **`openspec change new` does not exist.** The command failed; the real form is
  `npx openspec new change <name>`. → When an openspec verb errors, run
  `npx openspec --help` / `npx openspec new --help` and read the actual subcommand shape.
- **Archiving without `--skip-specs` would have merged stale deltas** (the removed
  `useRpcKeeper` wording) into main specs. → For a mostly-superseded change whose delta is
  wrong, always `--skip-specs`.
- **Grading a proposal from memory instead of the live tree** is the trap this whole session
  avoids — every "done" needs a file:line or PR number.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the proposal name, a clean checkout of `develop`, `openspec` CLI
(`npx openspec`), git history access (PR numbers help attribution).

- [ ] Read all proposal artifacts (`proposal/design/tasks/specs`).
- [ ] Grep each referenced symbol in live source + check tests → build ✅/⚠️/❌ matrix with
      file:line evidence.
- [ ] `git log --oneline -- <file>` to attribute what landed and why wording drifted.
- [ ] Add SUPERSEDED banner to the old `proposal.md`.
- [ ] `npx openspec archive <name> --skip-specs -y`.
- [ ] `npx openspec new change <remainder-name>`; write proposal/design/tasks + complete
      MODIFIED delta `spec.md` (read target main-spec requirement blocks first).
- [ ] `npx openspec validate <remainder-name> --strict`.
- [ ] `git add -A && git commit` with a body summarizing the recheck outcome.

**Artifacts produced:**
- `openspec/changes/archive/2026-06-12-fix-slash-dispatch-delivery/` (archived, specs skipped)
- `openspec/changes/resolve-global-prompt-templates-from-dashboard/` — `proposal.md`,
  `design.md`, `tasks.md`, `specs/command-routing/spec.md`
- commit `e2b6f55b`

---

_Generated from session `019ebd87-adc3-7598-b726-d4a8edc79bf9` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-12. Source extract: `/tmp/session_facts.f1q9R9.md`._
