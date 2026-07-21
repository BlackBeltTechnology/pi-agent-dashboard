# How we did it: Integrate Hermes Memory into Skills — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains how to audit
> pi's persistent memory (hermes) for integration with kb (knowledge base), discover
> that skills are already phase-scoped memory carriers, and systematize the pattern.

---

## 1. Goal (the ask)

The user wanted to understand how pi-hermes memory (277 SQLite records of failures,
insights, corrections, tool quirks) could be better integrated with kb (markdown-only
indexing). The real question emerged via steering: **Can we distill memory entries
per-skill so context loads only when relevant to that skill's phase?** Example: docker
failure entries don't belong in proposal phase; they belong in Docker-specific skills
during debug/deploy. The user's intuition: "everything important is already done over
skills, so phase-specific memory belongs there, not as global context."

## 2. TL;DR playbook

1. **Load the explore skill** and ask to investigate hermes + kb integration.
2. **Map both systems:** Run targeted bash greps to find where hermes lives
   (`~/.pi/agent/pi-hermes-memory/`) and how kb defines its sources.
3. **Audit the raw data:** Query hermes SQLite for memory counts by category
   (failure/correction/insight/tool-quirk) and understand what kb actually indexes
   (markdown only).
4. **Ground the scope question:** Confirm hermes project filtering is trivial (basename
   match); kb runs per-cwd so "filter by project" needs no new kb column.
5. **Test the kb-refresh claim:** Read indexer.ts to confirm kb_search self-freshens
   on each call (file-change detection). The only thing needing a trigger is export
   (SQLite → .md), not indexing.
6. **Flip the problem:** Instead of "how do we feed hermes to kb", ask "how do skills
   already carry context" — read implement/SKILL.md and discover sidecar patterns.
7. **Validate the pattern:** Query memories by topic and match them to existing skills
   (implement, debug-dashboard, docker, etc). Confirm that memories genuinely cluster
   by phase.
8. **Distill the insight:** Recognize that the pattern already happened ad hoc in
   `~/.pi/agent/projects-memory/pi-agent-dashboard/skills/` — memories got distilled
   into phase-triggered skills by hand. Systemization is the next step.

## 3. How the collaboration unfolded

### Phase 1: Research Setup
The user entered explore mode and asked for investigation. The AI started with
bash commands to locate hermes and kb source trees. **Why this worked:** Concrete
file locations (not speculation) are the foundation for all subsequent diagnosis.

### Phase 2: Data Architecture Audit
The AI queried the hermes SQLite schema to count memory records, then read kb's
config.ts and indexer.ts to understand indexing boundaries. Key finding: **hermes
has 277 raw records but exports ~50 lines of consolidated markdown** — the recall
the user wanted lives in SQLite, not in the lossy .md export. **Why this worked:**
Moving from "kb doesn't reach hermes" to "kb can't index SQLite, only files" reframed
the problem as a data-shape mismatch, not a tool limitation.

### Phase 3: Decision Grounding
The user's first steering was terse ("filter project - no cross memory", "both", "a")
but the AI correctly interpreted it as preference for solution approach A (not B1/B2
complexity). Before proceeding, the AI grounded whether project filtering was
mechanical or required schema changes. Finding: **hermes.project == basename(cwd)**.
**Why this worked:** Confirming mechanical simplicity early prevented design waste.

### Phase 4: The Inversion
The user's second steering question was longer and different: "Can we distill memory
entries for corresponding skills?" This inverted the problem from "feed hermes to kb"
to "where does phase-scoped memory already live?" The AI **stopped theorizing about
kb integration and started reading how skills work**. **Why this worked:** The user's
intuition — "everything important is done over skills" — was the load-bearing
insight; following it led to discovering existing machinery.

### Phase 5: Pattern Recognition
The AI read implement/SKILL.md and discovered it already loads sidecar lesson files
(`references/rebuild-matrix.md`, etc). Then found that memories already got distilled
into skills by hand in `~/.pi/agent/projects-memory/pi-agent-dashboard/skills/`. Then
queried memories and matched them to existing skills. **Why this worked:** Evidence
from the codebase itself (not speculation) that the pattern exists and works.

### Phase 6: Synthesis
The session ended with a clear insight: **Phase-specific memory should live as
sidecar lessons attached to skills, loaded only when that skill fires.** The
machinery is already there; systemization is the next step.

## 4. Prompts that worked

**The goal prompt** — loading the explore skill + asking for investigation created
space to think. Explore mode's "think deeply, visualize freely" stance mattered.

**Steering #1** — terse preferences ("filter project", "both", "a") forced precision.
The AI had to read the code to know what "filter" meant mechanically.

**Steering #2** — "Is it possible to distill memory entries for corresponding skills?"
was the high-leverage prompt. It reframed the whole problem and unlocked the inversion.

**If repeating this:** Start with "Investigate how hermes memory could integrate with
skills as phase-scoped context. What's already there? What would systematization look
like?" This sets the inversion earlier.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Theorize about kb integration as a data-plumbing problem | Asking "is it possible to distill *for skills*?" | Frame the goal as "phase-scoped context" not "kb indexing" |
| Over-complicate project filtering | Insisting "no cross memory" | Confirm project filtering is trivial (basename match) before designing |
| Miss the existing sidecar pattern | Noting that "everything important is done over skills" | Ask "what's already there" before designing new patterns |
| Recommend new scheduler/trigger for exporting hermes to .md | User pivoting to "attach to skills instead" | Frame the question as "where should this context live in the workflow" not "how do we expose it globally" |

## 6. Skills & pattern created — and why they're effective

**No new skill was created**, but the session surfaced an existing pattern that should
be systematized:

- **What it captures:** Phase-specific memories (failures, corrections, insights, tool
  quirks) distilled and attached to skills as sidecar lessons.
- **Why it's effective:** Context loads only when the skill fires (implement loads
  debug tips; docker skill loads docker failures). This removes global context bloat
  and makes memory actionable rather than archival.
- **When to invoke it:** When distilling a completed session's lessons, file them
  under the skill that triggered the discovery (e.g., a docker-failure memory becomes
  a sidecar in docker/references/ or docker-specific skills).
- **Recommendation:** Formalize the pattern as a skill or subagent that routes raw
  hermes records to skill-specific sidecar files. The machinery (kb's sidecar loading,
  skill scope) already exists; only the routing discipline is new.

## 7. Pitfalls & dead ends

- **Assumption drift:** The AI initially focused on "how do we make kb index hermes"
  before realizing kb is markdown-only by design. Ground data-shape assumptions early.
- **Scheduler complexity:** Don't design a new export/refresh scheduler for hermes→.md
  without first asking "where should this data live in the workflow." The answer (in
  skills) may need no scheduler at all.
- **Missing the obvious:** The pattern already happened ad hoc. If the user hadn't
  mentioned "everything important is done over skills", it would have taken longer to
  discover the existing machinery. Listen for hints about what's already working.

## 8. Reproduce it faster — checklist

**Inputs needed:**
- Access to hermes SQLite (`~/.pi/agent/pi-hermes-memory/sessions.db`)
- Ability to read skill source files (implement/SKILL.md, etc)
- Access to git/bash to query the codebase

**Steps:**
- [ ] Map hermes structure (find sessions.db, count memory records by category)
- [ ] Map kb sources (read config.ts, confirm markdown-only indexing)
- [ ] Audit project filtering mechanics (confirm hermes.project == basename(cwd))
- [ ] Read skill sidecar patterns (implement/SKILL.md, debug-dashboard/references/)
- [ ] Query hermes memories and match to existing skills
- [ ] Confirm pattern already happened (check projects-memory/pi-agent-dashboard/skills/)
- [ ] Synthesize insight (phase-specific context belongs in skills, not global kb)
- [ ] Recommend next step (formalize routing + systematize distillation)

**Artifacts produced:**
- Deeper understanding of hermes as a SQLite store (not just lossy .md exports)
- Confirmation that kb's sidecar pattern can carry phase-scoped memory
- Mental model: memory lives where it's used (in skills), not in a global store

---

_Generated from session `019f6d5e-4b2e-7781-b8d1-3be73cdffaa2` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-17._
