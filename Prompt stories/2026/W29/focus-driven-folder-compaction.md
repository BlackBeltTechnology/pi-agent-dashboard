---
session: 019f5950
week: 2026/W29
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [focus-driven-folder-compaction]
proposal_excerpt: "Each folder group in the session sidebar renders a heavy header (folder name + git info + action bar + plugin slots + OpenSpec section) plus all session cards, even when the user is not working in that folder. With 6+…"
---

# How we did it: Validating & reshaping the focus-driven-folder-compaction proposal — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a deceptively small prompt: **"Is this proposal valid?"** The
real objective — clarified across the next five turns — was much larger: *pressure-test
an OpenSpec change (`focus-driven-folder-compaction`) for structural AND semantic
coherence, map exactly what concepts it changes against the shipped code, then reshape
it into a shippable design* — accordion-style folder compaction made an **opt-in global
setting** with **Classic as the default**, backed by a UI mockup, and finally committed.
So "valid?" became "validate → map → design the setting → mockup → reframe as opt-in →
commit."

## 2. TL;DR playbook

1. **Disambiguate first.** With many proposals present, ask which one (the AI did:
   "There are many proposals. Which one do you mean?"). Name the change explicitly.
2. **Run the structural gate:** `npx openspec validate <change> --strict`. Green here
   only means *well-formed*, not *coherent*.
3. **Read for coherence, not just schema.** Grep every file/symbol the proposal
   references against the real tree — stale paths are the #1 defect.
4. **Map current-vs-proposed concepts** in a table (what exists today, where, and what
   each new concept adds). This exposes NET-NEW ideas like `activeCwd`/focus.
5. **Enumerate the truth table's full input space** (here 2⁴ = 16 combos) to prove the
   mode resolver is exhaustive + mutually exclusive, then flag the *semantic seams* a
   sound table still hides.
6. **Find the real home for the setting** by grepping the settings pages; match the
   mockup to the actual `ToggleField`/`SelectField` + theme tokens.
7. **Build a self-contained interactive mockup**, `serve_mockup` + screenshot to verify.
8. **Reframe on the user's steer** ("Classic default, Accordion opt-in") — gate all new
   logic behind `mode === "accordion"`, add config field + parse-fallback + spec scenarios.
9. **Re-validate `--strict`, then commit only this change's artifacts** — leave unrelated
   untracked/modified files alone.

## 3. How the collaboration unfolded

**Phase A — Disambiguate & structural validate.** The AI refused to guess among many
proposals and asked which. Once named, it ran `openspec validate --strict` (valid) but
explicitly said structural-valid ≠ coherent, and went to read the content.

**Phase B — Coherence audit.** The high-value move: it grepped the referenced files and
found **two stale references** — `collapsed-groups.ts` (the persistence actually lives in
`session-filter-storage.ts`) and `docs/file-index-client.md` (RETIRED per AGENTS.md; the
per-directory `AGENTS.md` tree is now the record). These would have tripped the
implementer. *Why it worked:* validate passes on schema; the defects were in prose that
only source-grepping catches.

**Phase C — Concept mapping.** On "check current state what concept changes?" the AI
produced a current-vs-proposed concept table (binary collapse, collapse gesture,
force-expand on filter, attention surfacing) and named the NET-NEW `focus`/`activeCwd`
concept. This is what turns a vague "is it valid" into a decision the human can steer.

**Phase D — Truth-table proof + seams.** On "yes", it enumerated all 16 input combos
(focused × collapsed × userExpanded × hasAttention) against the 5-row table, proving no
gaps/overlaps, THEN surfaced four semantic seams the table hides (e.g. persisted collapse
silently overridden). Those seams became new tasks (5.4, 6.9) and a design open-question.

**Phase E — Setting + mockup.** On "make this accordion style be in global settings.
Create mockup for ui", it investigated the settings system *in parallel* with applying
the agreed edits, located the **Sessions** settings page (already has `ToggleField`),
grabbed studio theme tokens, and built a self-contained interactive HTML mockup with a
live sidebar preview, served + screenshotted it.

**Phase F — Reframe + commit.** On "classic be default" it gated all focus-driven logic
behind `config.folderListMode === "accordion"` (default `"classic"`), added the config
field + parse-fallback, a spec requirement with 5 scenarios, re-validated strict, and on
"commit" scoped the commit to only this change's artifacts, deliberately leaving
`groups.json` and an unrelated untracked change untouched.

## 4. Prompts that worked

- **The goal prompt — "Is this proposal valid?"** Weak on its own (ambiguous target), but
  effective *because* the AI disambiguated and treated "valid" as two gates (structural +
  coherence). Stronger version: *"Validate openspec change `<name>` — run `--strict`, then
  check every referenced file/symbol still exists and the truth table is exhaustive."*
- **"check current state what concept changes?"** — high leverage. Forces a
  current-vs-proposed concept map instead of an abstract review. Reusable verbatim.
- **"yes"** — a cheap unlock that let the AI go deep on the 16-combo enumeration. Works
  because prior turns already framed the options.
- **"yes. And I would like to make this accordion style be in global settins. Create
  mockup for ui"** — expands scope crisply: turns analysis into a concrete artifact.
- **"seems ok, classic be default"** — the pivotal design steer; one clause reframed the
  whole change to opt-in. Bake in earlier: state default/opt-in posture up front.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Treat `openspec validate --strict` = "valid" | "Is this proposal valid?" (meaning coherent too) | Always pair `--strict` with a source-grep coherence pass |
| Review the proposal abstractly | "check current state what concept changes?" | Ask for a current-vs-proposed concept table by default |
| Ship accordion as the always-on behavior | "classic be default" | State default/opt-in posture in the first prompt |
| (risk) Commit everything staged | "commit" | Scope commits to the change's own dir; leave unrelated files |

Quality bars the user imposed implicitly: the mockup had to match *real* UI (exact
`ToggleField`/`SelectField` + theme tokens), and the design had to preserve today's
behavior for non-adopters (zero drift under Classic).

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted this session. But the workflow is clearly
repeatable and deserves one: **"validate-openspec-coherence"** — a skill that (1) runs
`--strict`, (2) greps every referenced file/symbol/path against the tree flagging stale
refs (retired `docs/file-index*.md`, moved persistence modules), (3) builds a
current-vs-proposed concept table, and (4) enumerates any truth table's full input space
for exhaustiveness/overlap and lists semantic seams. Invoke it whenever asked "is this
proposal valid?" so the coherence gate never gets skipped for the schema gate.

Tools that carried the session: `serve_mockup` + `browser`/`score_mockup` for
verified-real mockups; `openspec validate --strict` as the structural gate; plain `grep`
as the coherence gate.

## 7. Pitfalls & dead ends

- **Stale references pass `--strict`.** The proposal pointed at `collapsed-groups.ts` and
  `docs/file-index-client.md` — both nonexistent/retired. *If you hit this:* grep every
  path/symbol the proposal names before trusting validation.
- **A logically sound truth table can still hide semantic seams.** The 16-combo proof was
  clean, yet persisted-collapse override and filter-active override lived *outside* the
  resolver. *Do:* add explicit tasks/tests for behavior that lives outside the mapped fn.
- **Task-number collisions on insert.** Adding a settings section collided with an
  existing task 8.3 (CHANGELOG). *Do:* re-check numbering after inserting sections.
- **Dirty working tree at commit.** `groups.json` (modified) and an unrelated untracked
  change were present. *Do:* `git add <change-dir>` explicitly; never blanket-add.

## 8. Reproduce it faster — checklist

- [ ] Name the exact OpenSpec change (disambiguate if many exist).
- [ ] `npx openspec validate <change> --strict` → structural gate.
- [ ] Grep every referenced file/symbol/path against the tree → coherence gate.
- [ ] Build a current-vs-proposed concept table; name NET-NEW concepts.
- [ ] Enumerate the truth table's full input space; list seams outside the resolver.
- [ ] Locate the real settings home; match mockup to actual fields + theme tokens.
- [ ] `serve_mockup` + screenshot to verify the mockup renders.
- [ ] Apply the default/opt-in reframe; add config field + parse-fallback + spec scenarios.
- [ ] Re-validate `--strict`; commit ONLY the change's own artifacts.

**Inputs to have ready:** the OpenSpec change dir, repo checkout with the settings pages
+ theme CSS, `openspec` CLI.
**Artifacts produced:** edited `proposal.md` / `design.md` / `tasks.md` /
`specs/folder-focus/spec.md`, new `mockups/accordion-setting.html`, committed as
`d6f794531`.

---

_Generated from session `019f5950` · `pi-agent-dashboard` · 2026-07-13. Source extract: `/tmp/facts-A3myLY`._
