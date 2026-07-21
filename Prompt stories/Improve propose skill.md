# How we did it: Add archive+sync gates to ship-it/ship-change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user wanted to improve the `ship-it` and `ship-change` skills by adding explicit safety
gates that **prevent merging a PR and deleting the branch/worktree unless the proposal is
verified as archived and specs are synced**. Currently, `ship-change` *calls* archive at an
intermediate step, but there's no re-verification gate before the destructive operations
(squash-merge, branch delete, worktree removal). The goal was to surface this gap and close it
by adding a hard checkpoint that detects and prevents shipping an incompletely archived change.

The secondary exploration (steering #3–4) pivoted to understanding whether `plan-proposal`
could be automatically triggered when a proposal is drafted, as a quality gate. This became a
research-only task — no implementation, but a design dossier for future consideration.

## 2. TL;DR playbook

1. **Load both skills** (`ship-change` and `ship-it`) to understand the current flow and where
   archive+sync happens.
2. **Identify the gap:** locate the squash-merge and branch-delete steps; confirm they run
   *after* archive but *without re-verifying* archive success.
3. **Add step 8.5 to `ship-change`:** a new **archive+sync gate** that runs filesystem checks
   before any destructive operations:
   - Verify `openspec/changes/<change>/` is removed
   - Verify `openspec/changes/archive/*-<change>/` exists
   - Verify `openspec status --change` reports archived/synced
   - Verify the archive move is committed (`git status --porcelain openspec/` empty)
   - STOP and return to step 3 if any check fails
4. **Update step 9 and guardrail** in `ship-change`: make it explicit that merge only happens
   after step 8.5 passes.
5. **Mirror the gate into `ship-it`** (step 6) since it drives `ship-change` inline; carry the
   same invariant and escape-hatch logic.
6. **Add guardrail bullets** to both skills summarizing the new rule: "proposal must be
   archived and specs synced before merge/branch-delete/worktree-removal."
7. *(Optional, steering #3–4)* **Explore auto-trigger design** for `plan-proposal`: detect when
   a proposal exists outside the orchestrated flow and auto-inject the trigger into a live main
   session. Document findings (detection mechanisms, constraints, re-entrancy smell) in
   `docs/research/` as a design record for later pickup.
8. **Commit** the four changed files (two skills, research dossier, catalogue row).

## 3. How the collaboration unfolded

### Phase 1: Discovery — Is this repo-local or part of a distribution?

**What the AI did:**  
Investigated scope. Ran filesystem checks (`ls -la .pi/skills/`), examined `package.json` `files`
arrays to see whether `ship-it` and `ship-change` are shipped with the npm package, and searched
for any references in packaged skills.

**Why that worked:**  
Before touching the skills, confirming they're repo-local (not distributed) meant the changes
would land only in this codebase, with no package rebuild/republish needed.

**Decision point:**  
User asked "Is this part of any plugin/extension?" — clarifying scope before deep edits. Answer:
repo-local, no distribution impact.

### Phase 2: Understanding the current flow — Where is archive? Where are the dangerous steps?

**What the AI did:**  
Read both skill files top-to-bottom, mapped their steps, and identified that `ship-change` calls
archive at step 3 (within the `openspec-apply` flow), but steps 9–10 (squash-merge, branch
delete, worktree removal) run after that with no re-verification.

**Why that worked:**  
Step-by-step reading of existing prose revealed the implicit ordering assumption. No new tool
invented; existing skills already had the right conceptual shape — just no explicit gate.

**Decision point:**  
Recognized the invariant: "nothing destructive until verified archived." This became the
guardrail.

### Phase 3: Implementing the gate — Add step 8.5

**What the AI did:**  
Edited both `SKILL.md` files inline:
- Added a new numbered substep (8.5) to `ship-change` listing four filesystem/git checks.
- Reworded step 9 to say "Only after step 8.5 passes."
- Added a guardrail bullet capturing the rule.
- Mirrored the gate into `ship-it` (step 6) with the same logic.

**Why that worked:**  
Inserting a numbered step into existing prose is mechanical and low-risk; it sits exactly
where the gate belongs (after CI/CodeRabbit review, before destructive ops). Guardrails
translate checks into future-operator guidance.

**Decision point:**  
User confirmed via silence — no steering on the gate design itself, which meant the step
was clear and actionable.

### Phase 4: Exploration — Can plan-proposal auto-trigger?

**What the AI did:**  
Analyzed `plan-proposal` constraints (main-session-only, `ask_user` gates, not headless). Mapped
three candidate auto-trigger mechanisms (git hook, workflow monitor, proposal-watcher agent),
identified re-entrancy (drafting step *is* `openspec-new-change`, so firing on draft would
trigger on its own output), and concluded that "full auto-run is blocked by design" — only
auto-detect + human-present trigger is realistic.

**Why that worked:**  
Grounded reasoning in concrete skill constraints (the frontmatter and `ask_user` calls), rather
than guessing. Re-entrancy smell forced clarity: the clean seam is external *detection* +
optional *launch* into a live session, not end-to-end automation.

**Decision point:**  
User asked "Is it possible? How?" — steering to exploration, not implementation. Then "Save it
as a docs/research document" — capturing findings without shipping code.

### Phase 5: Documentation — Research dossier + catalogue

**What the AI did:**  
Delegated the `docs/` write to a subagent (per AGENTS.md Rule 6 — main agent never edits
`docs/` directly). Subagent created:
- `docs/research/auto-trigger-plan-proposal.md` — 4.1 KB dossier with six sections (Question →
  Verdict → Re-entrancy smell → Mechanisms A/B/C → Constraints → Sources), plus Mermaid decision
  flow.
- Updated `docs/AGENTS.md` to catalogue the research file.

**Why that worked:**  
Subagent delegation keeps large prose writes out of the main session budget, enforces caveman
style on `docs/` writes per the protocol, and surfaces the research for future grep/kb searches.

**Decision point:**  
User explicitly said "Save it as docs/research" — no steering needed; the path was clear.

### Phase 6: Commit — Stage only the target files

**What the AI did:**  
Ran `git status` to see what changed, then explicitly staged the four modified files:
- `.pi/skills/ship-change/SKILL.md`
- `.pi/skills/ship-it/SKILL.md`
- `docs/research/auto-trigger-plan-proposal.md`
- `docs/AGENTS.md`

Left unrelated pre-existing changes (`openspec/groups/groups.json`, `package-lock.json`)
unstaged.

**Why that worked:**  
Surgical commit — only the intended changes go in. Clean history, no noise.

**Decision point:**  
User said "commit" — implicit go-ahead. Session ended with the push (commit 551684d7b on
`develop`).

## 4. Prompts that worked

| Prompt | Why it worked |
|--------|---------------|
| Goal: "Update ship-it skills to not merge PR and delete branch / worktree while proposal is not archived and sync" | Crystal clear: one invariant, two skills, four operations. Minimal words, maximum precision. The AI didn't guess scope. |
| Steering #1: "Is this skills part of any plugin / extension?" | Disambiguated scope before edits. Saved the step of discovering distribution rules later. |
| Steering #2–3: "Is it possible to run automatically when a proposal was drafted? How can be it made. Do not do it, we are thinking about it." | Explicit gate on execution ("Do not do it"). The "How" prompted systematic design thinking; "thinking about it" signalled this was exploration, not a task. |
| Steering #5: "Save it as a docs/research document, maybe I will pickup later" | Named the output format (research dossier) and time-shifted the decision (future review). AI didn't question whether to implement it. |
| Steering #6: "commit" | Minimal, unambiguous go-ahead. No "should I?" — just do it. |

**Stronger kickoff for a future session with the same goal:**
"Update ship-it and ship-change skills to add a **step 8.5 archive+sync gate** (filesystem + git
checks) before step 9 (squash-merge). Both skills must verify the proposal is archived and
specs synced before any branch-delete or worktree-removal. Repo-local skills, no plugin impact."

This version leads with the *what*, *where*, and *scope* upfront, saving discovery time.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Assume the task was implementation-only | Asking "Is it possible to run automatically?" → Pivoting to exploration | State upfront if you want exploration vs. implementation. "How can we do X?" often means "teach me the design space," not "ship it." |
| Treat "Do not do it" as a full stop | User said "Do not do it, we are thinking about it" — AI correctly pivoted to design writing instead | On exploration tasks, explicitly say "design / research only, no code changes" if needed. The "Do not do it" was clear enough here. |
| Jump to skill edits without confirming scope | Asking "Is this part of any plugin/extension?" paused the edits | Before touching distributed code, always check: "Does this change affect npm packages?" and confirm the answer. |
| Write `docs/` prose directly | User redirected to AGENTS.md Rule 6 → Delegated to subagent | **Iron-clad rule:** never write to `docs/` from the main agent. Use a subagent. The subagent enforces caveman style and keeps prose out of main-session budget. |
| Over-state automation possibilities | User's "Do not do it" + "we are thinking about it" caught over-optimism | When exploring automation, ground every claim in concrete constraints (like `ask_user` in the skill or "main-session-only" in frontmatter). Don't say "we could X" without naming the blocker. |

## 6. Skills, tools & memory created — and why they're effective

### No new skills created in this session.

However, the session **reinforced three existing skill workflows** and surfaced a future
skill opportunity:

1. **`ship-change` + `ship-it`** — These were improved in-place by adding the gate.
   The improvement makes them **more reliable** by catching incomplete archives before
   destructive operations. Next time you touch them, the new step 8.5 is the canonical gate.

2. **AGENTS.md Rule 6 (docs-write delegation)** — The session *applied* this rule.
   When you need to write anything under `docs/`, spawn a `general-purpose` subagent with
   caveman-style rule verbatim in the prompt. This keeps large prose writes out of the main
   session and enforces style. **When to invoke:** before any `docs/` file is created/edited
   by the main agent (not by a skill, not by a subagent — only the subagent can write `docs/`).

3. **`docs/research/auto-trigger-plan-proposal.md`** — A new research dossier.
   It captures the design space for auto-triggering `plan-proposal`, including the concrete
   blockers (main-session-only constraint, re-entrancy smell). This dossier is effective
   because it's **decision-forcing**: the Mermaid flow and constraints list make it clear
   *why* a certain approach won't work, so anyone picking it up later doesn't re-explore
   the same dead end. **When to invoke:** if you later decide to implement auto-trigger
   or similar orchestration, read this first.

4. **Potential future skill: `archive-verify` or `gate-before-destructive`** — This session
   didn't create a skill, but it *could* have. If you find yourself adding similar
   "verify before destructive op" gates to other skills, extract a shared subagent or
   library function that encapsulates the checks. Right now the gate is baked into the prose
   steps; centralizing it would remove duplication and make the invariant easier to test.

## 7. Pitfalls & dead ends

No command failures or dead ends in this session. The flow was linear:
1. Discover scope → confirm repo-local ✓
2. Read skills → find the gap ✓
3. Edit skills → add step 8.5 ✓
4. Explore auto-trigger → design dossier ✓
5. Delegate docs write → subagent ✓
6. Commit → push ✓

**Potential pitfalls to watch for in *future* similar work:**

- **Forgetting to verify archive *after* step 3:** If you modify `ship-change` step 3, make
  sure step 8.5's checks still apply. The gate assumes `openspec archive` ran; if the command
  changes, the checks might need updating.
- **Merging ship-it and ship-change logic:** These skills were kept separate for a reason
  (ship-change is reusable, ship-it orchestrates it). Don't collapse them; keep the gate in
  both places so the invariant holds wherever the step appears.
- **Skipping the `openspec status --change` check:** The filesystem checks (dir exists/absent)
  are necessary but not sufficient — a partially-synced state can pass file checks but fail
  the status command. Include all four checks in step 8.5 or the gate has gaps.

## 8. Reproduce it faster — checklist

### Prerequisites
- [ ] Working checkout of `pi-agent-dashboard` on `develop` branch
- [ ] Both `ship-change` and `ship-it` skill files (`/.pi/skills/ship-change/SKILL.md` and
  `/.pi/skills/ship-it/SKILL.md`)
- [ ] Git configured (for commit + push)

### Steps
1. [ ] Read current `ship-change` SKILL.md and locate step 9 (squash-merge)
2. [ ] Add new step 8.5 with four filesystem/git checks (see section 3, Phase 3 for exact checks)
3. [ ] Reword step 9 to say "Only after step 8.5 passes"
4. [ ] Add guardrail bullet: "proposal must be archived and specs synced before merge/delete/remove"
5. [ ] Mirror step 8.5 logic into `ship-it` (step 6 logic)
6. [ ] Update guardrails in both skills
7. [ ] *(Optional)* Run `bash` to confirm `openspec archive` command and status format (so
  step 8.5 checks match reality)
8. [ ] Commit both skill files (`git add .pi/skills/ship-*/SKILL.md && git commit -m "..."`
9. [ ] If exploration needed (e.g., "should we auto-trigger plan-proposal?"), create a
  `docs/research/` dossier by delegating to subagent, then update `docs/AGENTS.md`
10. [ ] Push to `develop` (or branch if WIP)

### Final artifacts
- `/.pi/skills/ship-change/SKILL.md` — step 8.5 gate + guardrail added
- `/.pi/skills/ship-it/SKILL.md` — step 6 gate + guardrail added
- Commit hash on `develop` (e.g., `551684d7b`)
- *(Optional)* `docs/research/auto-trigger-plan-proposal.md` + catalogue row in `docs/AGENTS.md`

---

_Generated from session `019f6cd3-2f07-7ab8-b62e-439ac6986b92` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-16 23:27:50 → 2026-07-17 01:47:40 (2h 19m, 6 user prompts, 23 assistant messages). Source extract: `/tmp/facts_019f6cd3.md`._
