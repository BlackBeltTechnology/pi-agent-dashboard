# How we did it: Auto-run cross-model review in doubt-driven-review — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was asked, how it was built with the AI, what had to be steered, and how to reproduce the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user wanted to improve the `doubt-driven-review` skill to make cross-model review automatic when a `@propose-review-N` role is configured, rather than prompting the user each cycle. This eliminates friction when the operator has already decided they want a cross-model review — the configured role is the standing decision.

---

## 2. TL;DR playbook

1. Open `/packages/eng-disciplines/.pi/skills/doubt-driven-review/SKILL.md` in an editor.
2. Locate the cross-model review logic and the role-resolution step.
3. Rewrite the flow: if `@propose-review-N` resolves, run the subagent **automatically** (no prompt). Announce that it ran.
4. Ensure the interactive prompt only fires when **no** reviewer role is configured.
5. Update the Red Flags section to clarify silent skipping is only a red flag when no role is set.
6. Audit the skill for any external CLI execution paths (e.g., `which gemini`, `codex exec`) and **remove them entirely**. The only automated reviewer is the in-process subagent.
7. Update the fallback offer from "external review CLI" to "manual external review" (the user pastes into a model themselves).
8. Verify no stray CLI references remain via grep.
9. Commit the changes.

---

## 3. How the collaboration unfolded

### Phase 1: Understand the goal and rewrite the logic (00:44–00:46)
The user's initial prompt was terse ("In doubt-driven-skill I would like when propose-review-x model set do not as for secondary review, do it automatically"), so the AI expanded the intent: make cross-model review non-interactive when a `@propose-review-N` role is configured. The AI located the skill's verification checklist and cross-model escalation logic, then rewrote the step-by-step flow to run the subagent automatically with an announcement, moving the interactive offer only to the no-role path. This change reduced friction by eliminating redundant per-cycle prompts when the user's standing decision (the configured role) already covers the case.

### Phase 2: Remove external CLI paths (00:46–00:48)
The user steered with "Remove external CLI execution" — a single-word correction that shifted from "auto-run the configured role" to "audit and remove any reference to shelling out to external tools." The AI searched for CLI keywords (`cli`, `gemini`, `codex`, `shell`, `which`, `sandbox`), found the old CLI path (including `which` checks, `--version` tests, bash examples with `codex exec` / `gemini --approval-mode`), and **deleted the entire Step 2 block** that assumed an external CLI was an option. This locked the design to two paths: the in-process `@propose-review-N` subagent (the primary, auto-run path) or manual external review (the fallback, user-driven).

Why this approach worked: A grep-first audit before rewriting made it clear *where* the old assumption lived. Deleting the entire legacy block rather than patching it was cleaner — no half-measures or residual cruise-ship code.

### Phase 3: Commit the refined skill (00:53)
The working tree had unrelated changes scattered across other skills and config files. The AI cherry-picked **only** the `doubt-driven-review/SKILL.md` edits, committed them with a clear message, and left the unrelated changes unstaged. This kept the commit atomic and reviewable.

---

## 4. Prompts that worked

| Prompt | Why it worked |
|--------|---------------|
| **Initial goal prompt** (paraphrased by the AI: "auto-run cross-model when a role is set, don't prompt each cycle") | The user's shorthand was decoded into the full intent, and the AI translated it into a concrete step-by-step rewrite. Effective because it forced clarification of the real problem (friction from redundant prompts). |
| **"Remove external CLI execution"** | A one-word steering that unlocked the design. Effective because it was unambiguous and forced a full re-audit. The AI responded by grepping for CLI keywords, finding all references, and deleting the legacy block cleanly. |
| **"commit"** | A one-word signal to finalize the work. Effective because the AI was already positioned to do it (edits complete, diff staged) — the prompt just triggered the final gate. |

**For a future operator:** Start with the paraphrased goal ("auto-run this path when config says so, only prompt when no config") to align expectations. Follow up with crisp, directional steering ("remove all X paths") rather than iterative tweaks. One-word final prompts work because the AI's state is already set.

---

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Assume the CLI path was acceptable as a fallback | Redirect with "Remove external CLI execution" | **State up front:** "No shelling out to external tools — only the in-process subagent or manual review." This rule is a non-negotiable design constraint, not a nice-to-have. |
| Assume the user wanted iterative tweaks to the prompt logic | Clarify via paraphrasing and then proceeding decisively to edits | **Be explicit early:** "I'm about to rewrite the whole flow, not patch it. OK?" Decisive moves need pre-approval when they span multiple sections. |

---

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created in this session, but the session **refined an existing skill** (`doubt-driven-review`). The refinement is worth documenting:

**`doubt-driven-review` skill** (updated):
- **What it now captures:** A decision-review flow that runs cross-model review automatically when a `@propose-review-N` role is configured, with a fallback to manual external review if no role is set.
- **Why this version is effective:** 
  - **Eliminates friction:** If the operator has decided (via config) that cross-model review is wanted, the skill respects that decision and runs automatically, not prompting every cycle.
  - **Cleaner design:** By removing the external CLI path, the skill now has a single, clear automation path (the subagent) and a straightforward fallback (manual review). No branching on external tool availability.
  - **Auditable:** The absence of CLI calls makes the skill's behavior deterministic and reviewable — no dependence on `$PATH` or installed tools.
- **When to invoke it next time:** Use this skill whenever a change to `doubt-driven-review` needs to be reviewed *before* it stands (e.g., when adding a new step or changing the entry condition). The skill is a checkpoint, not a feature — invoke it at decision gates.

---

## 7. Pitfalls & dead ends

**Unrelated working-tree changes:** When the edits were complete, the working tree had several unrelated changes across other skills, openspec artifacts, and package-lock files. The AI initially staged all changes, then unstaged the unrelated ones and committed only the target file. **Lesson:** Always check `git status` before committing; cherry-pick the narrowest changeset that addresses the user's ask. This keeps commits atomic and reviewable.

**CLI keyword grep false positives:** Grepping for `cli`, `shell`, `which` found 3 matches, but only one was a CLI execution (line 81 was in a Red Flag *claim* matching the word "cli" as forbidden behavior). The AI read each match carefully and confirmed only the intended path was deleted. **Lesson:** Post-audit with grep is necessary but not sufficient — read the context of each match.

---

## 8. Reproduce it faster — checklist

- [ ] Open `packages/eng-disciplines/.pi/skills/doubt-driven-review/SKILL.md`
- [ ] Locate the cross-model review step and rewrite to auto-run when a `@propose-review-N` role resolves
- [ ] Move the interactive prompt-offer to the no-role path only
- [ ] Audit for external CLI references: `grep -niE 'cli|gemini|codex|shell|which |sandbox|invoke.*external' SKILL.md`
- [ ] Delete any `which` checks, `--version` tests, or bash examples with external tool invocation
- [ ] Reword fallback from "CLI" to "manual external review"
- [ ] Verify no stray CLI references remain
- [ ] Check `git status` for unrelated changes
- [ ] Stage only `doubt-driven-review/SKILL.md`: `git add packages/eng-disciplines/.pi/skills/doubt-driven-review/SKILL.md`
- [ ] Commit with a clear message: `git commit -m "docs(doubt-driven-review): auto-run cross-model when role configured; remove CLI paths"`

---

_Generated from session `019f6d18-eb29-75bc-b47c-93a072929e8f` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-17. Source extract: `/tmp/facts_019f6d18.md`._
