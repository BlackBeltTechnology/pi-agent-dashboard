---
session: 019f279a
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [add-kb-folder-slot, project-init-skill-and-profiles]
proposal_excerpt: "The markdown knowledge base (`@blackbelt-technology/pi-dashboard-kb`) is invisible in the dashboard. Two facts about how it updates create a real trap:"
---

# How we did it: KB row on worktree session cards — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened on a housekeeping prompt — `"rebase to develop"` — but the *real*
objective surfaced immediately after and dominated the 90 minutes that followed:
**"In the worktree card I have no Kb section."** The user expected the KB affordance
(the `KB · N chunks` row) to appear on a worktree's own card, the way it does on a
regular folder card. It didn't. The true goal became: find out *why* the KB row is
missing on worktree sessions, and add it — scoped to the worktree's own `cwd`, not the
parent repo's KB.

## 2. TL;DR playbook

1. **Rebase first, cleanly.** Stash any unrelated uncommitted edit → `git rebase origin/develop` → `git stash pop`. Don't drag WIP into the rebase.
2. **Don't assume "missing UI = missing code."** Trace the render path end-to-end before touching anything: component → slot → where the slot is rendered → enablement → served build.
3. **Rule out the boring causes** in order: default-enabled plugin? live server reports it enabled? served bundle stale? hard-refresh the tab.
4. **When refresh doesn't fix it, inspect the live DOM** (browser tool) to see what actually renders vs. what you assumed.
5. **Find the grouping rule.** Here: `resolveSessionGroupPath` keys on `pin > gitWorktree.mainPath > cwd` — worktrees collapse *under the main repo's card*, so they never get their own folder card, so the folder-level KB slot never reaches them.
6. **Follow the project's established pattern**, not a hardcode: add a dedicated `worktree-card-section` slot (mirroring `session-card-flows`/`session-card-memory`) that the KB plugin claims with the existing `FolderKbSection`.
7. **Fix worktree node resolution before generating/testing:** a worktree with no `node_modules` resolves packages to the *main repo*, so your edits are invisible. Run `npm install` inside the worktree.
8. **TDD the slot:** update the manifest claim-list test, add a consumer test, add a worktree-guard integration test → run affected suites → typecheck → Biome.
9. **Commit scoped**, update per-directory `AGENTS.md` rows (caveman style), then add the spec requirement + scenarios and `openspec validate`.

## 3. How the collaboration unfolded

**Phase 1 — Rebase (5 min).** The AI detected an unrelated uncommitted edit
(`.pi/skills/manage-flows/SKILL.md`), stashed it, rebased onto `origin/develop`
(the branch's one commit was already cherry-picked into develop), and restored the
stash. Clean, no conflicts. *Why it worked:* it isolated the WIP instead of letting it
contaminate the rebase, and kept it uncommitted throughout the session.

**Phase 2 — False leads on "missing KB row" (~15 min).** The AI reasoned the code was
fully wired: `FolderKbSection` registered in `sidebar-folder-section`, default-enabled,
live server reporting `kb => True`. It concluded **stale browser bundle** and told the
user to hard-refresh. *This was wrong* — and the user's next two prompts corrected it.

**Phase 3 — Live DOM inspection (the turning point).** After `"No. Page refresh does not
resolve"`, the AI stopped theorizing and opened the browser to read the actual DOM. It
found the KB row *was* rendering on every **folder** card — but the worktree session was
a `listitem` nested *under* the `pi-agent-dashboard` folder card, showing the **main
repo's** KB (14,594 chunks), not its own. The user's clarification —
*"the slot included in session card"* — pinned the real gap.

**Phase 4 — Root cause in the grouping rule.** The AI read `session-group-path.ts` and
found the grouping key `pin > gitWorktree.mainPath > cwd`: worktree sessions collapse
under the main repo, so `SidebarFolderSectionSlot` (rendered once per folder group)
never reaches them. The archived `add-kb-folder-slot` design had *assumed* a worktree
renders as its own folder card — a false premise.

**Phase 5 — Design + implement (dedicated slot).** Rather than hardcode `"kb"` in
`SessionCard`, the AI followed the repo's pattern (`session-card-flows`→`FlowsSubcard`)
and introduced a `worktree-card-section` slot claimed by the KB plugin with the existing
`FolderKbSection`. Mid-implementation it hit the worktree `node_modules` trap (see §7),
fixed it with a worktree-local `npm install`, regenerated the plugin registry, and
rendered the slot in `SessionCard` guarded to worktree sessions and scoped to the
worktree cwd.

**Phase 6 — Verify + land.** TDD: manifest claim-list test, `WorktreeCardSectionSlot`
consumer test, worktree-guard `SessionCard` integration test. Ran affected suites
(runtime 237, kb-plugin 47, SessionList 26, SessionCard 102), root `tsc --noEmit`,
Biome. Updated per-directory `AGENTS.md` rows. On `"commit"` → scoped commit
`1ffc4fc9c` (13 files, excluded the unrelated SKILL.md). On `"update specs and commit"`
→ added the requirement + two scenarios to `kb-folder-slot/spec.md`, validated, committed
`1a1385bfd`.

## 4. Prompts that worked

- **Goal prompt** — `"In the worktree card I have no Kb section"` was concrete about the
  *symptom* but ambiguous about *which* card. A stronger kickoff: *"On a worktree
  session card, the KB row that appears on folder cards is missing — I want the
  worktree's own KB shown there."* That states surface + expected behavior + scope up
  front and would have skipped the stale-bundle detour.
- **High-leverage correction** — `"No. Page refresh does not resolve"` (4 words) killed
  the wrong hypothesis instantly and forced live inspection. Cheap, decisive.
- **Scope pin** — `"the slot included in session card"` redirected from folder-card to
  session-card, which *was* the actual design intent.
- **Terminal prompts** — `"commit"` and `"update specs and commit"` let the AttendAI run
  the full land sequence (scoped stage → commit → spec requirement → validate → commit)
  without micromanagement, because the discipline was already established.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Conclude "code is wired → must be a stale bundle" and prescribe a hard refresh | "No. Page refresh does not resolve" | Inspect the **live DOM** before blaming the build; treat "code exists" as necessary, not sufficient |
| Assume the KB row belonged on the *folder* card | "Session card in worktree… the slot included in session card" | Confirm **which surface** the user means before tracing — screenshot/DOM first |
| Trust the archived design's premise (worktree = own folder card) | (implicit — user knew the worktree collapses) | Verify the grouping rule (`resolveSessionGroupPath`) before trusting a design doc's layout assumptions |
| Nearly get blocked by the generator not seeing new slot id | (AI self-corrected) | Remember: a worktree with no `node_modules` resolves to the **main repo** — install locally first |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted this session, but the workflow is clearly
repeatable and two skills *should* exist:

- **"diagnose-missing-dashboard-plugin-slot"** — the ordered rule-out ladder (component
  registered? slot rendered where? plugin enabled? served bundle fresh? live DOM? grouping
  rule) plus the worktree-`node_modules` resolution gotcha. Removes the stale-bundle
  false-lead that cost ~15 min here. *(Note: a `diagnose-spawn-register-timeout` and
  `isolated-ui-verification` skill already exist in this repo's memory — a slot-diagnosis
  peer belongs alongside them.)*
- **"add-dashboard-card-slot"** — the mechanical recipe for a dedicated slot:
  `slot-types.ts` + `slot-props.ts` → plugin `package.json` claim →
  `npm run generate:plugin-registry` → `*Slot` consumer in `slot-consumers.tsx` → render
  in the card → TDD (manifest claim-list + consumer + guard) → `AGENTS.md` rows. Makes
  the "follow the `session-card-flows` pattern" reproducible.

## 7. Pitfalls & dead ends

- **Stale-bundle red herring.** The AI's first diagnosis ("hard-refresh the tab") was
  confidently wrong. *If a plugin slot is missing but the code is present, inspect the
  live DOM before blaming the build.*
- **Worktree `node_modules` resolution.** The plugin-registry generator and tests
  validated against the **main repo's** `packages/shared` (the worktree had no
  `node_modules`), so the new `worktree-card-section` slot id was invisible → "not a
  known slot id". *Fix: run `npm install` inside the worktree so npm workspaces symlink
  to the worktree's own packages.*
- **Biome reformatting inflated the diff.** `SessionCard.tsx` showed ~60 changed lines
  for a ~9-line functional add — the enforced import-sort ratchet. *Keep the formatting
  (CI would reformat it anyway); verify the functional diff is just your block.*
- **Design-doc premise was false.** The archived `add-kb-folder-slot` design assumed a
  worktree renders as its own folder card; the grouping rule collapses it under the
  parent. *Verify layout assumptions against the actual grouping code.*
- **6 of 85 bash commands failed** — mostly `grep`/`find`/`curl` probes with no match or
  a bad flag; each was a cheap narrowing step, not a real block.

## 8. Reproduce it faster — checklist

- [ ] Rebase cleanly: stash unrelated WIP → `git rebase origin/develop` → `git stash pop`.
- [ ] Symptom is "missing dashboard plugin slot"? **Inspect live DOM first** (browser tool), don't assume stale build.
- [ ] Identify the exact surface (folder card vs session card) via screenshot/DOM before tracing.
- [ ] Read `resolveSessionGroupPath` — grouping key `pin > gitWorktree.mainPath > cwd` explains worktree collapse.
- [ ] Add a dedicated slot following `session-card-flows`/`session-card-memory` (never hardcode a plugin id in core).
- [ ] **Run `npm install` inside the worktree** before generating the registry or running tests.
- [ ] `slot-types.ts` + `slot-props.ts` → plugin `package.json` claim → `npm run generate:plugin-registry` → `*Slot` consumer → render guarded to worktree + scoped to worktree cwd.
- [ ] TDD: manifest claim-list test, consumer test, worktree-guard integration test → affected suites + `tsc --noEmit` + Biome.
- [ ] Update per-directory `AGENTS.md` rows (caveman style, with change tag).
- [ ] Commit scoped (exclude unrelated WIP); add spec requirement + scenarios; `openspec validate`; commit.

**Key inputs to have ready:** a running dashboard (port 8000), the browser tool for DOM
inspection, and write access to `packages/shared`, `packages/kb-plugin`,
`packages/dashboard-plugin-runtime`, `packages/client`.

**Final artifacts:** commit `1ffc4fc9c` (13-file implementation) + `1a1385bfd`
(`openspec/specs/kb-folder-slot/spec.md` requirement "KB row on worktree session cards"
with two scenarios).

---

_Generated from session `019f279a` · `pi-agent-dashboard` · 2026-07-03. Source extract: session facts sheet._
