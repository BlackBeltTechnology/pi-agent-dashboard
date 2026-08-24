---
session: 019de14b
week: 2026/W18
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-extension-ui-rjsf-form, extension-ui-system]
proposal_excerpt: "Phase 4 of the Generalized Extension UI System (see design extension-ui-system). Adds a rjsf-form view type that renders user-supplied JSON Schema (JSONSchema7) via react-jsonschema-form with a Tailwind-themed…"
---

# How we did it: Fast-forward the `add-extension-ui-rjsf-form` OpenSpec artifacts — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator invoked the `/opsx:ff` fast-forward workflow to **generate every OpenSpec
artifact needed to start implementing `add-extension-ui-rjsf-form`** in one shot — no
step-by-step artifact review. The change is Phase 4 of the Generalized Extension UI
System: a new `rjsf-form` view type that renders a user-supplied JSON Schema
(`JSONSchema7`) through `react-jsonschema-form` with a Tailwind theme and a pure-pi
fallback. The `proposal.md` already existed; the real objective was to produce the
missing **design.md**, the **specs delta** for `extension-ui-system`, and a
**tasks.md** — all passing `openspec validate --strict` — then commit *only those
three files* despite a messy working tree.

## 2. TL;DR playbook

1. Confirm the change dir exists and read the apply order:
   `openspec status --change add-extension-ui-rjsf-form --json`.
2. Pull the per-artifact instructions the workflow expects:
   `openspec instructions design|specs|tasks --change <name> --json`.
3. Ground the design in the *existing* system: read the parent
   `extension-ui-system` design + the current `openspec/specs/extension-ui-system/spec.md`
   so the delta modifies, not duplicates.
4. Write **design.md** — Context, goals/non-goals, and the handful of *key decisions*
   (library choice, lazy bundle, theme, submit semantics, fallback contract, schema
   shape) with risks/trade-offs.
5. Write the **specs delta** as ADDED Requirements with concrete WHEN/THEN scenarios;
   validate immediately (`openspec validate <name>`).
6. Write **tasks.md** grouped by work area (types → bridge → bundle → theme → lifecycle
   → wiring → docs → verification).
7. Gate on `openspec validate --strict` before declaring done.
8. Before committing, run `git status` + `git diff --stat`, then stage **only** the new
   artifact paths explicitly — never `git add -A` in a dirty tree.

## 3. How the collaboration unfolded

**Phase 1 — Orient (bash × several).** The AI checked whether the change already existed
(`ls … | grep -i rjsf`), then read the OpenSpec status/instructions JSON to learn the
required artifacts and their dependency order. This is the correct opening move for
`/opsx:ff`: let the tool tell you what "apply-ready" means instead of guessing.

**Phase 2 — Ground in the existing system (read × 2, bash).** Rather than inventing a
schema from scratch, it read the parent `extension-ui-system` design and the current
spec file, greping for the `RJSF` section. *Why it worked:* the deliverable is a **delta**
against an existing capability, so anchoring on the current spec keeps the ADDED
requirements coherent and avoids re-stating what's already specified.

**Phase 3 — Generate the three artifacts (write × 3).** In sequence: design.md → specs
delta → tasks.md, validating after the spec. The design captured 6 key decisions; the
spec added 5 Requirements with 14 WHEN/THEN scenarios (including a security invariant:
no `dangerouslySetInnerHTML`); tasks.md broke the build into 8 groups / ~36 checkboxes.

**Phase 4 — Validate, then commit surgically (bash).** `openspec validate --strict`
passed. The human then said only **"commit changes"** — and the key decision point
followed: the AI noticed the working tree was full of *unrelated* work (flows-plugin
extraction, other openspec changes, stray `.js`/`.d.ts` build output) and chose to stage
**only the three new artifact paths** explicitly, leaving everything else untouched.
Committed as `85dc7be` on `develop`.

## 4. Prompts that worked

- **The goal prompt** (the `/opsx:ff` template): effective because it front-loads the
  whole contract — derive a kebab name, scaffold via `openspec new change`, read
  `openspec status --json` for the apply order, and build artifacts *in dependency
  sequence* until apply-ready. A future operator should keep that structure and, when
  the change already exists, add one line: *"proposal.md already exists — produce only
  the missing artifacts."*
- **High-leverage follow-up: "commit changes."** Two words, but it worked *because the
  AI treated it as "commit the artifacts I just made," not "commit the tree."* The
  reusable lesson is in the guardrail below — a bare "commit" is safe only if the agent
  scopes the stage itself.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat "commit changes" as potentially "commit the whole tree" | (implicitly) trusting the AI to scope — which it did, but only after inspecting `git status` | State up front: *"commit ONLY the new `<change>` artifacts; leave all other working-tree changes alone."* |
| Risk duplicating spec content when writing a delta | Reading the parent design + current spec first | Always read `openspec/specs/<cap>/spec.md` before drafting an ADDED-requirement delta |
| Declare "done" on a green non-strict validate | Requiring `--strict` | Make `openspec validate <name> --strict` the definition of done |

The dirty working tree was the real hazard here: flows-plugin extraction, other openspec
changes, and accidental compiled `.js`/`.d.ts` output all coexisted. The safe behavior —
explicit path staging, no `git add -A` — is the single most important thing to carry
forward.

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created this session — it was a straight execution of the
`/opsx:ff` fast-forward workflow plus OpenSpec's own tooling
(`openspec new change` / `status` / `instructions` / `validate --strict`). That toolchain
is the reusable asset: it turns "make the artifacts" into a deterministic,
dependency-ordered checklist with a machine-checkable done state.

*Recommendation:* the one repeatable pattern worth capturing is the **surgical commit in
a dirty tree** — inspect `git status`, then stage only the intended artifact paths. If
this recurs, save it as a small project memory/skill so a bare "commit" prompt never
risks sweeping in unrelated build output.

## 7. Pitfalls & dead ends

- **Zero failed commands** this run — but the near-miss was the commit. If you hit a
  dirty tree with unrelated changes, do **not** `git add -A`; run `git status` +
  `git diff --stat`, then `git add <explicit artifact paths>`.
- **Stray build output** (`.js`/`.d.ts`) sitting in the tree is a smell — it will silently
  get swept into a broad `git add`. Leave it for separate handling; don't let a planning
  commit carry compiled artifacts.
- **Non-strict validate is not "done."** Passing `openspec validate` without `--strict`
  can hide issues; always gate on `--strict`.

## 8. Reproduce it faster — checklist

- [ ] `openspec status --change <name> --json` → read `applyRequires` + artifact order.
- [ ] `openspec instructions design|specs|tasks --change <name> --json`.
- [ ] Read parent design + `openspec/specs/<capability>/spec.md` before the delta.
- [ ] Write design.md (context + key decisions + risks).
- [ ] Write specs delta (ADDED Requirements + WHEN/THEN scenarios + security invariants).
- [ ] Write tasks.md (grouped by work area, ~one checkbox per unit).
- [ ] `openspec validate <name> --strict` → must pass.
- [ ] `git status` + `git diff --stat`, then `git add <explicit artifact paths>` and commit.

**Inputs to have ready:** an existing `proposal.md`, the parent capability's current spec,
a clean-enough git tree (or the discipline to stage explicitly).

**Artifacts produced:**
- `openspec/changes/add-extension-ui-rjsf-form/design.md`
- `openspec/changes/add-extension-ui-rjsf-form/specs/extension-ui-system/spec.md`
- `openspec/changes/add-extension-ui-rjsf-form/tasks.md`
- Commit `85dc7be` on `develop` (only the three artifacts staged).

---

_Generated from session `019de14b-4726-771c-b30d-3437b2ac0444` · `pi-agent-dashboard` · 2026-05-01. Source extract: `/tmp/session_facts.95880.1784851508.md`._
