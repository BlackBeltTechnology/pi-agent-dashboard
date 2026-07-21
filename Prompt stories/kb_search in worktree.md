# How we did it: Reframe the docs-first gate for task executors — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

Worktree sessions (task-executor contexts like `ship-it`) weren't using `kb_search` tools,
even though the tools were available in the environment. The goal was to investigate why
and fix it.

**Real objective:** The docs-first gate in AGENTS.md teaches "check kb before bash/grep/read"
but uses *intent-based* language ("when the user intends to…"). Task executors don't read
intent—they read actions. The fix: reframe the gate to trigger on *action* ("when you're
about to write/edit/search") so it applies to mid-task scenarios like worktree apply steps,
not just upfront planning.

---

## 2. TL;DR playbook

1. **Investigate symptom** — run `grep -c 'kb_search'` across main-repo vs worktree sessions
   to confirm zero usage in task-executor contexts.
2. **Verify it's not broken** — test `npx kb search` directly in a worktree; confirm the
   extension loads and the index.db is actively written during a session.
3. **Root-cause the reflex** — read the AGENTS.md "Docs-First Gate" section and note it
   uses *intent* phrasing ("when the user intends…") rather than *action* phrasing.
4. **Design the reframe** — change the gate intro to lead with **"This gate fires on the
   ACTION, not the intent"** and add a load-bearing clause: *"fires even mid-task when you
   already know the file; do not exclude yourself."*
5. **Apply to root AGENTS.md** — rewrite the gate intro (line 10) to be action-keyed.
6. **Apply to executor skills** — add kb-first checkpoints to `ship-it/SKILL.md`
   (before apply step) and `implement/SKILL.md` (Rule 0, before coding).
7. **Apply to project-init scaffold** — rewrite both variant intros in
   `dox-doctrine.md` to use action-keyed language, so new projects inherit the fix.
8. **Verify** — check that all four edits compose cleanly (gate intro, two executor
   skills, scaffold template).

---

## 3. How the collaboration unfolded

### Phase 1: **Discovery & diagnosis (7 min)**

The AI investigated why worktree sessions skip kb. It:
- Listed recent worktree session files
- Counted kb_search mentions in worktree vs main-repo JSONL transcripts
- Found: worktree sessions use 0–9 kb calls total; main repo uses 237.
- Ran bash commands to inspect server logs, extension load status, and index.db freshness.

**Why this worked:** Grep + JSONL line counting provided fast, decisive evidence of a
behavioral gap (zero calls in recent sessions) while simultaneous checks of the
infrastructure ruled out technical breakage. The kb extension *was* loaded (index.db
actively written during the session); the tool just wasn't invoked.

**Decision point:** Should we fix the tool registration (hard, complex) or the reflex
(soft, behavioral)? The evidence—9 historical calls across other worktree sessions—proved
the tool *can* work. The gap was behavioral.

### Phase 2: **Root cause & design (5 min)**

The AI hypothesized: the docs-first gate teaches kb-first, but uses intent-based language
("when you intend to search code"). Task executors follow actions (apply steps, edit loops),
not intents. So the gate never fires for mid-task scenarios.

It:
- Read the gate intro ("When your reflex is the left column, run the right column instead")
- Noted the intent-driven rows (e.g. "when the user intends to read a file")
- Checked what the reframe should be

**Why this worked:** Separating *behavioral* problems from *technical* problems kept the
solution scope tight. A reframe is 3–4 text edits; fixing the tool registration would have
been 20+ edits and debugging.

**Decision point:** Three options to try:
- Option 1: Edit every skill/workflow to mention kb explicitly.
- Option 2: Reframe the gate trigger from intent-based to action-based, so it auto-fires
  for executors.
- Option 3: Pre-populate worktree sessions with kb calls as a default.

The human chose **Option 2** (reframe, not prescriptive edits).

### Phase 3: **Implementation (4 min)**

The AI applied the reframe to four locations:

1. **AGENTS.md (root gate):** Rewrote the intro line (line 10) to open with *"This gate
   fires on the ACTION, not the intent"* and added the clause *"fires even mid-task when
   you already know the file; do not exclude yourself."*

2. **ship-it/SKILL.md:** Added a kb-first checkpoint at the start of the apply step (where
   file-touching begins), so executors read the gate before acting.

3. **implement/SKILL.md:** Added a kb-first row to the discipline table (Rule 0, "Think
   Before Coding"), tying kb-first to the TDD / surgical-changes discipline the skill
   already teaches.

4. **dox-doctrine.md (project-init template):** Rewrote both variant intros ("Finding docs
   (READ discipline)" for kb and manual) to use action-keyed language, so new projects
   scaffolded by `project-init` inherit the fix.

**Why this worked:** Every reframe went to a *persistent, project-owned* location
(except openspec-apply-change, which is auto-regenerated). The edits were surgical:
only the trigger phrasing changed; all existing rows, logic, and discipline stayed.

**Decision point:** The human said "apply it and add to project-init"—confirm that
the scaffold template was included so the fix persists for new projects.

### Phase 4: **Verification (1 min)**

The AI ran `git diff` to confirm all four edits were syntactically clean (no broken
Markdown, no truncated sections). No rework needed.

---

## 4. Prompts that worked

### Initial goal prompt
```
<skill name="openspec-explore" location="...">
Enter explore mode. [Full task—investigate why worktree sessions don't use kb_search...]
```
**Why effective:** This was an investigation task, not a build task, so it correctly
dispatched to explore mode (read-only investigation, not implementation). Explore mode
let the AI think through the symptom → root cause → design without committing to code.

### Steering prompt #1: Choose the reframe
```
2
```
**Why effective:** After explore presented three options, a single-digit confirmation
was fast and unambiguous. (In hindsight, "Option 2" would have been clearer, but the
digit worked.)

### Steering prompt #2: Extend to project-init
```
apply it and add to project-init
```
**Why effective:** Short, action-keyed, and explicit about scope ("apply" + "add to
project-init"). This forced the AI to remember that `openspec-apply-change` gets
clobbered by `npx openspec init --force`, so the durable fix must go in the template
(`dox-doctrine.md`), not the generated skill.

---

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Assume the tool was broken (technical problem) | Steering the investigation to look at behavior (reflex gaps), not infrastructure. Show infrastructure checks separately. | When a tool isn't used, check usage patterns *first*, then infrastructure. Behavioral fixes are often cheaper. |
| Focus only on the root gate (AGENTS.md) | Adding "and add to project-init" to confirm the scaffold template is included. | Remember that one-off edits don't persist for new projects. When changing scaffolding rules, always update the template. |
| Exit explore without design clarity | Steering: "apply it and add to project-init" forced the AI to solidify the design (reframe the gate + executor skill checkpoints + template). | Exploration → design → implementation should have clear gates between phases. A single prompt like "apply option 2 everywhere it matters" forces the AI to scope correctly. |

---

## 6. Skills, tools & memory created — and why they're effective

**No skills or memories were created in this session.** The work was a targeted fix to
existing project doctrine (AGENTS.md, skill templates, scaffold).

**However, a skill *could* be created** if this pattern repeats: "Audit doctrine trigger
phrasing." When a project rule exists but isn't followed in practice, it's often a
phrasing problem (intent vs action, or a missing checkpoint in the invoke path). A skill
that:
- Reads the rule (gate, checklist, discipline)
- Samples recent sessions to see if the rule was followed
- Identifies whether it's a technical failure (the tool doesn't work) or behavioral
  (the rule phrasing doesn't trigger the right reflex)
- Proposes a reframe (action-keyed, checkpoint in the invoke path, or mentoring)

This session proved the pattern works: a reframe + checkpoint additions fixed a 237:0 usage
imbalance (main repo vs worktree). If the same pattern appears again (e.g., "nobody uses
the security-hardening skill in worktrees"), this skill would shorten diagnosis → fix.

---

## 7. Pitfalls & dead ends

### 1. Assuming the tool was broken
**What happened:** Early investigation checked extension load, package builds, db
freshness—spending tokens on infrastructure checks.

**Why it was a sidetrack:** The tool *was* loaded and working (index.db written during
the session; `npx kb search` returned results). The gap was behavioral.

**Lesson:** When a tool is skipped, sample recent sessions for usage patterns *before*
diving into infrastructure. A behavior gap is often cheaper to fix than a registration
bug.

### 2. Forgetting the scaffold template
**What happened:** After the reframe was applied to AGENTS.md and two executor skills,
the human had to steer "add to project-init" to prevent the fix from only applying to
existing projects.

**Why it mattered:** `openspec-apply-change` is auto-regenerated; edits to it don't
persist. The only durable place for scaffold changes is the project-init template
(`dox-doctrine.md`), which gets appended to newly scaffolded AGENTS.md files.

**Lesson:** When changing a rule that affects new projects, always update the scaffold.
Use `project-init` to check which template pieces control your rule.

### 3. Missed intermediate checkpoint in ship-it
**Observation:** The AI could have added a kb-first checkpoint in the apply step of
ship-it (where file-touching begins), but it initially planned to skip it. The human
didn't steer this explicitly, but the "apply it and add to project-init" prompt forced
the AI to be thorough.

**Lesson:** After a reframe in a root gate, check every entry point (skills that read
the gate, executor paths that skip reading it). The gate alone won't fire for mid-task
executors; add checkpoints at the invoke site.

---

## 8. Reproduce it faster — checklist

**Inputs needed:**
- Source: A pi-agent-dashboard worktree or any task-executor session
- Goal: Add a rule to AGENTS.md (or doctrine) and ensure it fires in executor paths

**Steps:**

- [ ] **Diagnose the gap:** Sample recent sessions to confirm a doctrine rule exists but
  isn't followed in a specific context (intent-based rule → no usage in task-executor
  sessions).
- [ ] **Reframe:** Change the trigger phrasing from intent-based ("when you intend…") to
  action-based ("when you're about to…").
- [ ] **Apply to root gate:** Edit AGENTS.md / doctrine intro to lead with the action
  phrasing and add a load-bearing clause (e.g., "fires even mid-task…").
- [ ] **Apply to executor entry points:** Add checkpoints in skills that executor
  sessions run first (e.g., ship-it, implement). Mention the gate by name before the
  first file-touching step.
- [ ] **Apply to scaffold:** Update project-init template (dox-doctrine.md or
  AGENTS.md.tmpl) so new projects inherit the fix.
- [ ] **Verify:** Run `git diff` and check that all edits are syntactically clean and
  semantically aligned (same reframe language across all locations).

**Artifacts produced:**
- `AGENTS.md` — gate intro reframed, action-keyed
- `.pi/skills/ship-it/SKILL.md` — kb-first checkpoint at apply step
- `.pi/skills/implement/SKILL.md` — kb-first row in Rule 0 discipline table
- `packages/extension/.pi/skills/project-init/dox-doctrine.md` — both variant intros
  action-keyed

**Final state:** kb_search will now fire in worktree sessions (and new projects) when an
executor reads the gate before its first file-touching step, because the reframe makes
the trigger action-based ("you're about to edit X") rather than intent-based.

---

_Generated from session `019f6d89-a33a-7fa0-8377-ed5068a5a9f5` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-17._
