---
session: 019de93e
week: 2026/W18
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [add-shadow-gitignore]
proposal_excerpt: "The `.shadow/` directory holds jj workspace clones (per `.pi/skills/jj-workspace/SKILL.md`). These are local-only working trees that must never be committed to the main repo, but `.gitignore` does not currently exclud…"
---

# How we did it: Ignore `.shadow/` jj workspaces — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user wanted to add `.shadow/` to `.gitignore` so that jj workspace clones (created
per `.pi/skills/jj-workspace/SKILL.md`) never get committed to the main repo. The very
first prompt didn't say that plainly, though — it was the raw `/opsx:new` slash-command
template ("Start a new change using the experimental artifact-driven approach"). The
*real* objective only became clear as the operator marched the change through the full
OpenSpec pipeline: **new → fast-forward → apply → archive → commit**, producing a
properly-specced, archived, and committed one-line `.gitignore` edit.

## 2. TL;DR playbook

1. Name the change in kebab-case and scaffold it: `openspec new change "add-shadow-gitignore"`.
2. Check the build order: `openspec status --change add-shadow-gitignore --json`.
3. Fast-forward all artifacts (`/opsx:ff`): proposal → design + specs → tasks in one pass.
4. Apply (`/opsx:apply`): make the one-line edit — add `.shadow/` to `.gitignore` near the other working-tree exclusions.
5. Verify with the tasks.md checks: `git check-ignore -v .shadow/anything`, create `.shadow/_test/x` and confirm `git status` is clean, `git ls-files .shadow/` is empty.
6. Archive (`/opsx:archive`): moves the change to `openspec/changes/archive/<date>-…/` and syncs the new `repo-hygiene` spec into `openspec/specs/`.
7. Commit **only the related files** — `git add` them explicitly, never `git add .`, because the working tree had unrelated changes.

## 3. How the collaboration unfolded

**Phase 1 — Scaffold + a sanity-check offer (`/opsx:new`).**
The AI ran `openspec new change`, read the status, and surfaced the proposal template
fields. Crucially it *paused* and pointed out the mismatch: "this is a trivial one-line
change — the full spec-driven workflow is heavy for it," offering three routes (do it
directly, continue the workflow, or pick a lighter schema). This was the right instinct:
flag over-engineering before spending effort on it.

**Phase 2 — Fast-forward the artifacts (`/opsx:ff`).**
The operator chose to keep the full workflow anyway. The AI generated all four artifacts
in one pass — proposal, design (chose `.shadow/` with trailing slash for consistency,
grouped with existing exclusions), a new `repo-hygiene` capability spec with one
requirement + two scenarios, and a tasks.md with one edit + three verifications.

**Phase 3 — Apply + verify (`/opsx:apply`).**
The single `.gitignore` edit landed at line 3. All three verifications passed: the ignore
rule matched, a test file under `.shadow/` stayed out of `git status`, and no tracked
files existed under `.shadow/`.

**Phase 4 — Archive (`/opsx:archive`).**
The change was moved to the dated archive folder and the delta spec was synced into the
main `openspec/specs/repo-hygiene/spec.md`.

**Phase 5 — Commit (the decisive steer).**
Told simply to "commit," the AI first ran `git status` and noticed a messy working tree
full of *unrelated* changes. It committed only the seven files belonging to this change,
explicitly listing them, and left everything else untouched.

## 4. Prompts that worked

- **The goal prompt (`/opsx:new` template).** It kicked off the pipeline but buried the
  actual intent. A stronger kickoff states the goal in one line first, e.g.
  *"/opsx:new add-shadow-gitignore — add `.shadow/` (jj workspace clones) to .gitignore
  so they're never committed."* Give the AI the *why* and the *name* together.
- **High-leverage follow-ups.** The chained slash commands `/opsx:ff`, `/opsx:apply`,
  `/opsx:archive` each advanced a whole workflow stage with a single paste. They're the
  reason a 4-minute session produced a fully-specced, archived, committed change.
- **`commit`** — one word, but it triggered the AI's own guardrail of scoping the commit
  to related files only.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Offer to short-circuit the workflow for a "trivial" change | Ignore the offer and continue with `/opsx:ff` | Decide up front whether you want the full spec trail (audit/archive value) vs a raw edit, and say so |
| Need explicit stage advancement | Paste each `/opsx:*` command in sequence | Chain new → ff → apply → archive as your standard OpenSpec cadence |
| Risk staging a dirty working tree on "commit" | Rely on the AI to self-scope, then confirm | Say "commit ONLY this change's files" and never `git add .` when the tree is dirty |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session rode entirely on the existing OpenSpec
`/opsx:*` slash commands. The reusable asset it *produced* is the new `repo-hygiene`
capability spec (`openspec/specs/repo-hygiene/spec.md`), now a permanent home for
repo-cleanliness requirements.

**Worth saving:** a project convention — *"jj workspace clones live in `.shadow/` and
must stay gitignored"* — so future agents don't re-litigate it. And the commit-scoping
rule (**never `git add .` on a dirty tree; add the change's files explicitly**) is a
strong candidate for a saved memory.

## 7. Pitfalls & dead ends

- **Over-engineering a one-liner.** The full spec-driven workflow is heavy for a single
  `.gitignore` line. It's justified only if you value the archived spec trail; otherwise
  a direct edit is faster. The AI correctly flagged this — heed the flag consciously.
- **Dirty working tree at commit time.** The repo had several unrelated in-flight changes
  (add-openspec-jj-bridge, auto-scroll-selected-session-card, npm-trusted-publishing
  rename, an adapt-windows-integration-pr9 deletion). A blanket `git add .` would have
  swept them into the commit. Always inspect `git status` first and add explicitly.

## 8. Reproduce it faster — checklist

- [ ] State the goal + kebab name in the kickoff prompt (don't bury it in a template).
- [ ] `openspec new change "add-shadow-gitignore"` → `openspec status --change … --json`.
- [ ] `/opsx:ff` to generate proposal + design + spec + tasks in one pass.
- [ ] `/opsx:apply` → make the `.gitignore` edit, run the three verifications.
- [ ] `/opsx:archive` → confirm the delta spec synced to `openspec/specs/`.
- [ ] `git add <explicit files>` (never `.`) → `git commit`.

**Inputs to have ready:** the change name/intent, knowledge of where jj workspaces live
(`.shadow/`), a clean idea of which files belong to *this* change.

**Artifacts produced:**
- `openspec/changes/archive/2026-05-02-add-shadow-gitignore/` (proposal, design, specs, tasks)
- `openspec/specs/repo-hygiene/spec.md`
- `.gitignore` (+`.shadow/` at line 3)
- commit `4c4498b` — *chore: ignore .shadow/ jj workspace directories*

---

_Generated from session `019de93e-18fe-7140-acb2-cb7ceae36a1e` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-02. Source extract: `/tmp/session-facts.XXXXXX.md`._
