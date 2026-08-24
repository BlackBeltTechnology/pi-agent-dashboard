---
session: 019f74c5
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
---

# How we did it: Make the whole directory header clickable — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) — a thinking stance, no
implementing. The real objective, once framed, was small and concrete: **make a
folder/directory header in the session list behave like a session card** — clicking
anywhere on the row should *open the directory home page*, instead of only a tiny `⧉`
icon doing it while the name-row merely toggled collapse. The user wanted the whole row
to be the click target (selection affordance), for **all folders**, and the change
implemented, committed, and reflected in the OpenSpec spec.

## 2. TL;DR playbook

1. Enter explore/investigation with a precise target: "how does a directory card select
   vs how does SessionCard select on whole-card click?"
2. Let the AI locate the two components (`SessionList.tsx` `renderGroup`, `SessionCard.tsx`)
   and surface the current split: name-row = collapse, `⧉` icon = navigate.
3. Confirm the design tradeoff **before editing** — repurpose name-row to navigate, move
   collapse ownership solely to the chevron (`folder-toggle-btn`), keep `⧉` as redundant.
4. Verify no existing test relies on name-row-collapse (collapse tests use the chevron),
   and that `navigate` + `buildFolderHomeUrl` are in scope.
5. Make the one-line handler swap: `handleToggleCollapse(cwd)` → `navigate(buildFolderHomeUrl(cwd))`;
   add `data-testid="folder-home-row-<cwd>"`.
6. Add a test for whole-row navigation; run vitest with an **ephemeral `HOME`**
   (`HOME=$(mktemp -d) npx vitest run --project <pkg> -t "open affordance"`).
7. Update the per-file record `SessionList.tsx.AGENTS.md` (Documentation Update Protocol).
8. `commit` — stage **only your files**, deliberately excluding unrelated working-tree
   drift (`openspec/groups/groups.json`).
9. `update specs` — add a `Requirement: Whole-row open affordance` to
   `openspec/specs/directory-home-page/spec.md`, `openspec validate`, commit separately.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (kb + grep).** The AI used `kb_search` (×4) and targeted
`grep`/`read` to find where directory selection lives, comparing `SessionCard`'s
whole-card click against the folder header's `renderGroup`. It correctly named the
existing affordances: name-row → collapse, `⧉` (`folder-open-home-<cwd>`, `mdiOpenInNew`)
→ navigate (pinned/workspace only), chevron (`folder-toggle-btn`) → collapse. *Why it
worked:* it framed the fix as "which existing behavior to repurpose" instead of adding
new UI.

**Phase 2 — Design decision (surfaced, not silent).** The AI spotted a tradeoff (name-row
currently collapses; repurposing it removes that) and **paused to confirm** rather than
guessing. It also checked the **eligibility guard**: non-pinned/non-workspace cwd lands on
a "not available as a home page" notice — relevant because the user wanted navigation for
*all* folders.

**Phase 3 — Implement + test.** One-line handler swap in `renderGroup`, a new testid, and
a whole-row navigation test added next to the existing open-affordance tests. First vitest
run needed the **ephemeral HOME** invocation to isolate; after that all 6 tests passed.

**Phase 4 — Document + commit.** Updated `SessionList.tsx.AGENTS.md`, then committed only
the 3 intended files, explicitly leaving out unrelated `groups.json` drift.

**Phase 5 — Spec sync ("update specs").** No OpenSpec *change* was scaffolded (direct
commit), so the AI updated the **main spec** directly: added `Requirement: Whole-row open
affordance` with 4 scenarios, `openspec validate` (valid), separate commit.

## 4. Prompts that worked

- **Goal prompt (explore-mode kickoff).** Effective because it set a *thinking* stance
  first — the AI investigated and surfaced the design tradeoff instead of jumping to code.
  Stronger next time: state the acceptance criterion up front — *"whole folder header row
  navigates to the directory home for ALL folders; collapse stays on the chevron; keep the
  ⧉ icon."*
- **`commit`** — a one-word high-leverage follow-up. It worked because the AI already knew
  the intended file set and self-excluded unrelated drift.
- **`update specs`** — two words that unlocked the whole spec-sync phase (find the right
  requirement, add scenarios, validate, commit).

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementing, not persist the change | `commit` | State "implement, then commit only my files" in the goal |
| Treat spec as out of scope after a direct commit | `update specs` | Add "reflect in the directory-home-page spec" to the ask |
| Risk scoping "pinned/workspace only" (matching the old `⧉`) | design confirmation before edit | Say explicitly "for ALL folders, incl. non-eligible → eligibility notice" |

The AI already did the right defensive things unprompted: paused on the collapse-vs-navigate
tradeoff, checked eligibility-guard behavior, and excluded unrelated `groups.json` drift.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created — this was a small, well-scoped UI change. The workflow is
repeatable enough that the **existing** repo assets carried it: `openspec-explore` (think
before touching code), the **Documentation Update Protocol** (update the `*.AGENTS.md`
per-file record), and `openspec validate` for spec sync. If anything recurs, the reusable
nugget worth a memory is the **ephemeral-HOME vitest invocation** for client tests.

## 7. Pitfalls & dead ends

- **Vitest needs an isolated HOME.** A plain `npx vitest run <file>` needed re-running as
  `HOME=$(mktemp -d) npx vitest run --project @blackbelt-technology/pi-dashboard-web -t "open affordance"`.
  If client tests behave oddly, add the ephemeral HOME + `--project`.
- **Unrelated working-tree drift.** `openspec/groups/groups.json` (OpenSpec board grouping
  state) was already modified. Don't blind-`git add -A` — stage only your intended files.
- **No OpenSpec change scaffolded.** Because this was a direct commit, "update specs" means
  editing the **main** `openspec/specs/.../spec.md`, not an `openspec/changes/<name>/` delta.

## 8. Reproduce it faster — checklist

- [ ] Explore first: compare `SessionCard` whole-card click vs `SessionList.tsx renderGroup`.
- [ ] Confirm the tradeoff: name-row → `navigate(buildFolderHomeUrl(cwd))`; collapse → chevron only; keep `⧉`.
- [ ] Verify no test relies on name-row collapse; confirm `navigate` in scope.
- [ ] Swap the handler + add `data-testid="folder-home-row-<cwd>"`.
- [ ] Add whole-row nav test; run `HOME=$(mktemp -d) npx vitest run --project <pkg> -t "open affordance"`.
- [ ] Update `SessionList.tsx.AGENTS.md`.
- [ ] Commit only your files (exclude `groups.json` drift).
- [ ] Add `Requirement: Whole-row open affordance` to `directory-home-page` spec; `openspec validate`; commit.

**Inputs to have ready:** running repo checkout on `develop`; knowledge of the folder-home
route (`/folder/:encodedCwd`) and eligibility guard. **Artifacts produced:**
`SessionList.tsx`, `SessionList.test.tsx`, `SessionList.tsx.AGENTS.md`,
`openspec/specs/directory-home-page/spec.md` (commits `72990999a`, `ab6fa5f0b`).

---

_Generated from session `019f74c5` · `pi-agent-dashboard` · 2026-07-18. Source extract: `/tmp/facts-wuWNXy.md`._
