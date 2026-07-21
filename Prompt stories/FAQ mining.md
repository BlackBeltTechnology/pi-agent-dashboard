# How we did it: Mining hermes memory into FAQ — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with "what about faq-mine skill?" — shorthand for: is it working, is it
complete, how could it be better? Initial context: `faq-mine` was an FAQ-generation
orchestrator that extracted recurring "how-to" / "what-is" questions from `README.md` +
`docs/*.md` and folded them into `docs/faq.md`. But it was **missing an entire source class**:
the pi-agent-dashboard runtime problems buried in hermes memory stores
(`~/.pi/agent/projects-memory/pi-agent-dashboard/MEMORY.md` and global failures.md),
which never reached the FAQ — so users couldn't find answers to "Why does X fail?" or
"How do I fix Y?". The real objective (after steering): **upgrade the skill to harvest
hermes memory as a first-class source, ship 10 approved runtime-problem FAQ entries in
one run, and wire the harvest into ship-change as an opt-in, non-blocking gate.**

## 2. TL;DR playbook

1. **Investigate the gap** — run bash commands to enumerate hermes stores (project MEMORY +
   global failures.md) and grep existing faq.md headings (118) to confirm the stores hold
   unaccessible runtime problems.
2. **Analyze candidates** — filter hermes entries against faq.md headings + repo relevance
   to find strong (new, repo-specific, concrete fix) vs. weak (cross-project noise) entries.
   Dry-list 10 approved, 0 borderline.
3. **Rewrite the skill** — surgical edits to `.pi/skills/faq-mine/SKILL.md`:
   - Add hermes stores to Phase 0 (enumerate).
   - Split Phase 2 into docs-mining (2A) and memory-mining (2B) with distinct subagent prompts.
   - Update Phase 3–4 (dedupe, merge) and Rules (memory format notes).
   - Add `--docs skip --memory <off|project|failures|all>` CLI flags (default `failures`).
4. **Dispatch first-run subagents** — one `general-purpose` to author FAQ entries from
   memory stores (symptom-first format, caveman style), a second to refresh `faq.agent.md`
   (doc-protocol delegation, per AGENTS.md Rule 6).
5. **Verify & merge** — confirm 0 heading collisions with existing 118 via `comm -12`,
   run install-hints test suite (8/8 pass), mechanically merge draft into faq.md.
6. **Wire into ship-change** — add Step 10.5 (opt-in FAQ harvest via `RUN_FAQ_MINE=1`
   flag), memory-only mode (`--docs skip --memory failures`), non-blocking + reset-soft
   on protected-branch rejection.
7. **Update documentation** — edit `.pi/skills/AGENTS.md` tree row + sidecar
   `.pi/skills/faq-mine/SKILL.md.AGENTS.md` to reflect v2.0 (hermes memory source,
   memory-only mode, v2.0 tag, "See change:" history).
8. **Commit** — stage only own files (not unrelated concurrent-session modifications),
   git add + commit.

## 3. How the collaboration unfolded

### Phase 1: Discovery & gap analysis (2 min, ~5 commands)
The AI ran a **diagnostic sweep** to understand the current state:
- Listed hermes stores + their locations: project-scoped MEMORY.md, global failures.md
- Grepped existing faq.md headings (118) and size stats
- Scanned docs/ and the distill-session-knowledge package

**Why it worked:** The diagnostic isolated the **root gap** immediately — faq-mine had no
visibility into hermes stores. This grounded every downstream design decision (why add
memory? because it's there). The human confirmed the gap was real by adding steering
("There are a ton of runtime problems there").

### Phase 2: Candidate analysis (1 min, dry-list only)
The AI analyzed hermes entries against the 118 existing faq.md headings + a repo-relevance
filter (pi-agent-dashboard-specific vs. cross-project noise):
- **10 strong candidates** (new, repo-specific, concrete fix): openspec scaffold order ·
  automation run stuck · shared-worktree commit leak · vitest HOME guard · playwright
  CDN timeout · Unicode folder-route encoding · worktree opsx-skills missing ·
  agent-browser eval echo · jsdom-can't-render-mermaid · pi-hermes stuck-in-thinking
- **0 borderline** (no decision needed)

**Why it worked:** Analyzing *before* dispatching subagents meant 100% of the work was on
real, high-signal problems. No drafting, no backtracking. The human said "yes" (prompt 3)
immediately.

### Phase 3: Skill rewrite — surgical edits (3 min, 5 edits)
The AI edited `.pi/skills/faq-mine/SKILL.md` in **five targeted blocks**:
1. **Frontmatter** — updated description + triggers to cover hermes memory, added
   `--memory` input, compatibility note, v2.0 bump
2. **Phase 0 (pre-flight)** — added logic to resolve + ls hermes stores (missing paths
   skip silently), excluded docs/faq.agent.md from mining
3. **Phase 2 (extraction)** — split into 2A (docs, unchanged) and 2B (memory, new subagent
   prompt with symptom-first format)
4. **Phases 3–4 (dedupe + merge)** — updated glob, added faq.agent.md refresh step
5. **Rules + Anti-patterns** — added memory-format notes

**Why it worked:** Each edit was **minimal and surgical** — one phase per edit, no
refactoring unrelated code. The human never had to review a giant rewrite; they trusted
the structure because it was modular.

### Phase 4: First-run synthesis (2 min, 2 subagent dispatches)
The AI **delegated doc-writing to subagents** (per project AGENTS.md Rule 6 — main agent
never writes `docs/` prose):
- Subagent 1: "Author FAQ draft from hermes runtime problems" — turned the 10 approved
  candidates into Markdown entries (caveman style, §-delimited symptom-fix pairs,
  timestamp metadata)
- Subagent 2: "Append runtime-problems section to faq.agent.md" — summarized the
  harvest for the metadata document

**Why it worked:** Isolation kept the main session focused on *architecture*, not
*prose*. The subagents had clear, concrete output requirements (exact format, no
hedging). And it respected the project's caveman-style rule — specialist writers
produce better prose than a general model trying to juggle style while thinking.

### Phase 5: Verification & merge (1 min, mechanical)
The AI **verified before merge**:
- `comm -12` on 118 existing + 10 new headings → **0 collisions**
- Ran `install-hints.test.ts` → **8/8 pass** (the docsAnchor→heading contract holds)
- Mechanically merged draft into faq.md (concatenate, rm drafts, check count)

**Why it worked:** Verification happened *after* draft completion but *before* merge —
catching collisions early cost seconds, fixing them post-merge would have been rework.

### Phase 6: Wiring into ship-change (3 min, design + edit)
The human asked "When faq-mine is called?" — revealing that faq-mine had no caller.
The AI proposed wiring it into ship-change as **Step 10.5: opt-in FAQ harvest**:
- **Opt-in flag** `RUN_FAQ_MINE=1` (default skip) mirrors the CodeRabbit gate → headless
  `ship-it` runs skip FAQ harvest (no manual interaction)
- **Memory-only mode** `--docs skip --memory failures` (non-interactive, fast)
- **Placement** after merge + worktree removal, on the parent `develop` checkout → FAQ
  entries are a **separate docs-only commit, not part of the feature PR**
- **Safety** non-blocking (warn + continue), protected-branch rejection → reset-soft +
  note for manual docs PR

The human approved the design ("yes" on prompt 3) and said "Add to ship-change" (prompt 5).

**Why it worked:** The design respected the shared-worktree concurrency model and the
ship-change philosophy (never block a ship). By running on the parent checkout post-merge,
it avoided races. By making it opt-in, it let maintainers harvest FAQ opportunistically
without slowing every release. By using memory-only mode, it kept the run fast and
non-interactive (Playwright hangs, doc parsing takes time).

### Phase 7: Documentation update (1 min, 2 edits)
The AI updated `.pi/skills/AGENTS.md` (tree row) and created a sidecar
`.pi/skills/faq-mine/SKILL.md.AGENTS.md` (companion for large-skill documentation):
- Tree row: one-line summary + pointer to sidecar
- Sidecar: full detail (phases, v2.0 tag, new source class, "See change" history)

**Why it worked:** The sidecar pattern keeps the main AGENTS.md tree compact (<30 KB,
the auto-inject budget). Large skills get a companion doc; small files stay in-tree.
The human never asked for it; it's automatic per the split-large-agents.mjs ratchet.

### Phase 8: Commit & clean (1 min, final check + git)
The human said "commit" (prompt 6). The AI:
- Verified that concurrent sessions had modified implement/SKILL.md and ship-it/SKILL.md
  (race condition, not its files)
- Scoped the commit to only its changes (faq-mine skill + ship-change skill + AGENTS.md)
- Ran `git reset -q && git add <files> && git commit`

**Why it worked:** Respecting the shared-worktree concurrency model meant checking `git
status` *right before* commit, not relying on prior analysis. The atomic `reset + add +
commit` pattern in one Bash call (see Steering §3) prevented index corruption that
concurrent resets could cause.

## 4. Prompts that worked

### The goal prompt (Prompt 1)
```
what about faq-mine skill?
```
**Why it worked:** Terse, open-ended, and context-heavy (the human and AI had prior
context on the skill from other sessions). It triggered a full diagnostic rather than a
narrow bug fix. In a fresh session, a stronger opener would be: "Is the faq-mine skill
complete? What sources does it currently mine, and are there any sources we're missing?"

### High-leverage follow-ups

**Prompt 2** (steering #1):
```
improve faq-mine to use hermes memory extraction. There are a ton of runtime problem
which can be extracted from there - the distilled faq entries haven't be presented on faq
anymore. Check in recent session the docs/faq.md usages
```
**Why it worked:** Concrete problem statement + specific source class (hermes memory) +
validation hint ("check recent sessions"). This *unlocked* the investigation — the AI
understood what to look for and didn't have to ask clarifying questions.

**Prompt 3** (steering #2):
```
yes
```
**Why it worked:** In context — the AI proposed 10 candidates and asked "Approved?" The
human's "yes" gave it the green light to dispatch subagents. Short affirmations in
context save tokens and keep momentum.

**Prompt 5** (steering #4):
```
Add to ship-change
```
**Why it worked:** The AI had proposed the design; the human just needed to authorize the
edit. One sentence. In a cold start, this would need more: "Wire faq-mine into
ship-change as an opt-in step (after merge, memory-only mode, default skip)."

**Prompt 6** (steering #5):
```
commit
```
**Why it worked:** Final green light, explicit enough in context (everything was staged
and ready). In isolation, it would be vague; in a live session, it's a strong signal.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|---|
| Read faq.md passively, miss that 118 headings are test-referenced (`docsAnchor`) | Clarified: "Can we add entries safely?" → Prompted investigation of install-hints.test.ts | State up front: "Any entries we add must not break the docsAnchor→heading contract. Run install-hints.test.ts after merge." |
| Treat hermes stores as monolithic, mine all global failures → risk cross-project noise | Clarified: "Filter for pi-agent-dashboard relevance, not all global failures" → Proposed repo-relevance filter + dry-list approval before dispatch | Guardrail: "Global hermes memory is noisy. Always dry-list candidates and ask for approval before drafting." |
| Propose wiring faq-mine as a scheduled hook / automatic caller | Clarified: "faq-mine is a skill, not code. It has no automatic caller." | Guardrail: "Skills load on NL trigger, not hooks. If you want automatic caller behavior, that requires wiring in code (ship-change, server start, etc.)." |
| Draft documents in the main session instead of delegating to subagents | Human corrected via AGENTS.md Rule 6: "Doc writing goes to subagents per caveman-style delegation." | Guardrail: "Any write under `docs/` (prose AND `docs/AGENTS.md`) goes to subagents. The main agent stages the output only, never writes it directly." |
| Forget to check for concurrent-session file races in shared worktree | Human recalled from prior session memory: "Use atomic `git reset + add + commit` in ONE Bash call, never separate commands." | Guardrail: "In shared worktrees, `git status` can drift between commands. Always `reset -q && add <files> && commit` atomically in one Bash call." |

## 6. Skills, tools & memory created — and why they're effective

### Skill: `faq-mine` v2.0 (updated in this session)

**What it captures:** An orchestrator for building/extending docs/faq.md by mining:
- (v1.0) `README.md` + `docs/*.md` — long-form docs
- (v2.0 NEW) Hermes stores — pi-agent-dashboard MEMORY + global failures.md (runtime
  problems, quirks, fixes)

**The reusable problem it solves:** FAQ entries scattered across docs and runtime memory
were hard to aggregate. Operators had to manually read stores *and* docs. Now:
1. A single command (`faq-mine` or `faq-mine --docs skip --memory failures`) gathers both
2. Candidates are dry-listed for approval before drafting (no surprises)
3. Dedupe + caveman-style formatting happens mechanically
4. faq.agent.md (metadata) refreshes automatically

**Why it's effective:** Hermes stores accumulate *as you develop* — failures, corrections,
runtime quirks. They're the distilled pain history. But they never reached the FAQ because
no tool looked at them. By making them a first-class source (alongside docs), the skill
captures institutional knowledge that would otherwise get lost. The opt-in memory-only
mode + non-blocking ship-change integration means you can harvest FAQ entries on *every*
release (if wanted) without slowing or complicating the release.

**When to invoke it next time:**
- When you notice the hermes stores have accumulated a lot of new entries (failures.md
  grew, project MEMORY.md has new notes)
- When you ship a major change and want to capture its quirks + debugging tips in the FAQ
  (run `faq-mine --docs skip --memory failures` in ship-change with `RUN_FAQ_MINE=1`)
- Periodically (monthly?) to keep FAQ in sync with real runtime experience

## 7. Pitfalls & dead ends

**Pitfall: Confusing `faq-mine` (a skill) with `distill-session-knowledge` (a separate
miner)**  
If you think faq-mine should mine sessions → FAQ, you'll propose chaining them. They're
separate: distill-session-knowledge extracts lessons from transcripts and populates
project MEMORY + skills/. faq-mine then reads that MEMORY + docs and builds FAQ. The
human had to clarify the boundary ("They don't chain"). Guardrail: faq-mine is a FAQ
builder, not a session processor.

**Pitfall: Treating hermes memory as authoritative per-project structure**  
The global failures.md is **noisy** — it holds pi-agent-dashboard quirks *mixed* with
Marp, OAuth, rclone, and unrelated projects. If you mine all of it, you pollute the FAQ.
The solution: filter by repo relevance + dry-list approval. The session did this via
investigation + candidate analysis before any drafting happened.

**Pitfall: Drafting FAQ prose in the main agent session**  
AGENTS.md Rule 6: doc writing (prose + AGENTS.md tree rows) goes to subagents. If you
try to draft in the main session, you burn context and violate the caveman-style
standard. The human didn't have to steer this (the skill's earlier version already
delegated), but it's a frequent mistake in doc-writing tasks.

**Pitfall: Concurrent-session `git` races in shared worktrees**  
The session ran in a worktree where another session was also editing. If you run `git
status`, then later `git add`, something could have changed in between (the other session
reset the index). Solution: atomic `git reset -q && git add <files> && git commit` in
one Bash call. The human had prior memory of this ("git-index-clobber in shared worktree"
from project MEMORY); it came up when commit time arrived.

## 8. Reproduce it faster — checklist

### Inputs you'll need

- [ ] Hermes memory stores accessible (`~/.pi/agent/projects-memory/<proj>/MEMORY.md` +
      `~/.pi/agent/pi-hermes-memory/failures.md`)
- [ ] Current `docs/faq.md` (with existing headings you want to dedupe against)
- [ ] A prompt that clarifies the goal (see §4: Prompt 2 is a good template)

### Steps (the short version)

1. Run `faq-mine` (or explicitly `faq-mine --docs skip --memory failures`) in a pi session
2. Confirm the dry-listed candidates (if `faq-mine` is up to date with v2.0)
3. Approve ("yes") to dispatch subagents
4. Verify test suite passes (`install-hints.test.ts`)
5. Inspect the merged faq.md for quality (new entries + size)
6. (Optional) Inspect faq.agent.md for the runtime-problems summary
7. Commit the result

### If you want to wire it into release/ship-change

1. Add `RUN_FAQ_MINE=1` (environment var) to your ship-change command
2. Confirm Step 10.5 (opt-in FAQ harvest) is present in ship-change SKILL.md
3. Run ship-change normally; it will skip FAQ harvest by default (or run it if you set
   the env var)

### Artifacts produced

- `docs/faq.md` — extended with new entries (verify via `grep '^## ' | wc -l`)
- `docs/faq.agent.md` — updated with runtime-problems summary
- `.pi/skills/faq-mine/SKILL.md` — v2.0 (if upgrading from v1.0)
- `.pi/skills/faq-mine/SKILL.md.AGENTS.md` — companion docs (if faq-mine SKILL is large)
- (Optional) Changes to ship-change/SKILL.md if wiring Step 10.5

---

_Generated from session `019f6dcb-5b04-7a3a-b9e4-3a53770608ae` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-17_
