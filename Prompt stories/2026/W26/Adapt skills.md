---
session: 019f05ec
week: 2026/W26
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [add-authoring-skills, add-code-quality-skill]
proposal_excerpt: "The user maintains a personal skill library under `~/Documents` (mirrored across `.claude`/`.gemini`/`.opencode`/`.agents`/`.pi`). A scan found three families:"
---

# How we did it: Adapt personal skills into the monorepo — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** — a thinking-partner stance, not an
implementation run. The first prompt was the `openspec-explore` skill body:
*"Enter explore mode. Think deeply… you must NEVER write code or implement
features… You MAY create OpenSpec artifacts."*

The **real objective** clarified quickly through steering: *survey the user's
personal skill library under `~/Documents` (mirrored across `.claude`/`.gemini`/
`.opencode`/`.agents`/`.pi`), decide which skills are genuinely general-purpose
and missing from the pi-dashboard monorepo, and capture the port plan as an
OpenSpec proposal* — without writing any application code. The output was
`add-authoring-skills`: a validated, committed OpenSpec change proposing a new
`packages/authoring-toolkit` plus a `doc-summarizer` addition to `document-converter`.

## 2. TL;DR playbook

1. Enter explore mode (`/skill:openspec-explore`) so the AI thinks and plans but
   never implements.
2. Ask for a **deduplicated** scan of `~/Documents` skills across all tool mirrors
   (`.gemini`/`.opencode`/`.claude`/`.agents`/`.pi` copy the same skills) cross-checked
   against what the monorepo already ships.
3. Have the AI sort candidates by **portability** (project-independent vs personal/
   infra-bound) — not by feature.
4. Steer: *"fold the doc-pipeline / copy and adapt / yes"* → then insist it **read the
   actual skill bodies** to confirm no hardcoded `~/Documents` paths or personal config.
5. Let the AI discover overlaps against shipped code (`document-converter/engine/`
   already has `frontmatter_filler` + `markdown_table_profiler`) → drop those ports.
6. Pick capture format: **Option A = OpenSpec proposal**.
7. Run a coherence check against active/archived changes before scaffolding.
8. Scaffold `openspec/changes/add-authoring-skills/` manually (this CLI has **no
   `change new` subcommand`), matching a recent change's exact artifact shape.
9. `openspec validate add-authoring-skills --strict` → must pass.
10. Commit **only** the proposal dir — leave unrelated working-tree changes untouched.

## 3. How the collaboration unfolded

**Phase 1 · Discovery (scan & dedup).** The AI listed the three skill families,
then immediately re-ran to get a *deduplicated* picture — the raw listing was noisy
with cross-tool mirrors. It pulled real descriptions for the pi-native set
(`~/Documents/.pi/skills/`, 16 entries) and the `.claude`/`.agents`-only candidates.
*Why it worked:* deduping first stopped the whole analysis from double-counting 35
unique skills as ~150.

**Phase 2 · Sort by portability.** It rendered a landscape diagram mapping
`~/Documents` skills → pi global → pi-dashboard packages, showing the openspec (12)
and doc-conversion families were **already covered**. The live question became *what
is general-purpose, project-independent, and missing.* **Human decision point:**
steering prompt `1. fold the doc-pipeline  2. copy and adapt  3. yes`.

**Phase 3 · Read the bodies (verify coupling).** The AI opened the Tier-1 skill
bodies to confirm project-independence. This produced two hard verdicts:
`system-architect` → **rejected** (a pasted blog post, no frontmatter, ends with
*"Would you like me to refine this prompt further?"*), and an adaptation-cost table
per surviving candidate. **Human decision point:** `1. document-converter  2. adapt
3. verify`.

**Phase 4 · Overlap discovery (the plan-changer).** Checking `document-converter/
engine/` revealed `frontmatter_filler/` + `markdown_table_profiler/` **already
shipped** with CLI subcommands and a TS facade. The user's round-1 "fold the
doc-pipeline" was already done — porting them would duplicate shipped code. The
AI also verified that a **pure-skill package needs only a `package.json` manifest**
(no `extension.ts`). **Human decision:** `A` → capture as OpenSpec.

**Phase 5 · Capture & verify.** Coherence check against active/archived changes
(no duplicate), scaffold the change dir manually per AGENTS.md, write proposal /
design / tasks / spec, then `openspec validate --strict` (pass) and `openspec list`
(registered, `0/16 tasks · active`).

**Phase 6 · Surgical commit.** Steering `commit`. The AI noticed a large pile of
**unrelated** in-flight work (honcho/jj plugin removals, client/server edits) and
committed **only** `openspec/changes/add-authoring-skills/`, leaving the rest untouched.

## 4. Prompts that worked

- **Goal prompt (`openspec-explore`)** — effective because it set a *stance*: think,
  visualize, plan OpenSpec artifacts, but never implement. It kept a 27-minute
  session from prematurely writing package code.
- **`fold the doc-pipeline / copy and adapt / yes`** — a 3-line numbered answer to
  the AI's option menu. High-leverage: one line resolved three open threads at once.
- **`1. document-converter  2. adapt  3. verify`** — the `verify` token is the star:
  it forced the AI to read the actual skill bodies rather than trust descriptions,
  which is what surfaced the already-shipped overlap.
- **`A`** — single-character selection of the capture format. Cheap, unambiguous.
- **`capture openspec` / `commit`** — terse finishing commands; worked because the
  plan was already fully formed on disk.

*Stronger rewrite of the goal:* pair explore mode with the concrete target up front —
*"Explore my `~/Documents` skills, dedup across tool mirrors, and propose (as an
OpenSpec change) which are general-purpose and missing from this monorepo. Read the
skill bodies to confirm no personal/hardcoded coupling before recommending a port."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Judge candidates from descriptions alone | `…verify` / read the bodies | State up front: "confirm project-independence by reading each skill body, not its description" |
| Treat "fold the doc-pipeline" as new work | (AI self-corrected on overlap discovery) | Ask it to diff candidates against shipped `document-converter/engine/` **first** |
| Present a single path | Answered menus with `1/2/3` numbered picks | Offer the AI explicit option menus; answer by number |
| Risk committing the whole dirty tree | `commit` (AI scoped it itself) | Say "commit ONLY the proposal dir; leave unrelated changes alone" |
| Keep a weak candidate | AI rejected `system-architect` | Set a quality bar: "reject anything without description frontmatter + a real procedure" |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created in-session — the deliverable was an **OpenSpec
proposal** (`add-authoring-skills`), which is itself the reusable artifact. It
captures: the scan verdict (PORT `skill-creator`, `session-to-guideline`,
`doc-summarizer`; SKIP the already-shipped `markdown-table-profiler` +
`frontmatter-filler`; REJECT `system-architect`), a wiring spec (pure-skill package
= `package.json` manifest only), and 6 task groups / 16 tasks each with a verify.

*What should become a skill:* the repeatable move here — **"scan a personal skill
library, dedup across tool mirrors, sort by portability, diff against shipped code,
and emit an OpenSpec port plan"** — is a clean candidate for a project skill. Invoke
it whenever adopting external/personal skills into the monorepo.

## 7. Pitfalls & dead ends

- **Cross-tool mirror noise.** `~/Documents/.gemini`/`.opencode`/`.claude`/`.agents`/
  `.pi` mostly mirror the same skills. *If the listing looks huge, dedup before
  analyzing* — 35 unique, not ~150.
- **Descriptions lie about coupling.** `markdown-table-profiler` + `frontmatter-filler`
  looked portable but were **already folded into `document-converter/engine/`**. *If a
  candidate seems obviously useful, grep the monorepo for it before proposing a port.*
- **Not every "skill" is a skill.** `system-architect` was a pasted prompt/blog post.
  *If there's no description frontmatter and no procedure, reject it.*
- **No `openspec change new` subcommand.** *Scaffold the change dir manually* at
  `openspec/changes/<name>/` (never nested under `active/`/`archive/`), copying a
  recent change's artifact shape.
- **Dirty working tree.** Unrelated in-flight changes were present. *`git add` only
  your proposal dir explicitly; never `git add -A`.*

## 8. Reproduce it faster — checklist

- [ ] Enter explore mode (`/skill:openspec-explore`) — plan only, no code.
- [ ] Dedup-scan `~/Documents` skills across all tool mirrors; cross-check vs shipped packages.
- [ ] Sort by portability (project-independent vs personal/infra-bound).
- [ ] Read the actual skill bodies to confirm no hardcoded paths / personal config.
- [ ] Grep `document-converter/engine/` (and packages) for already-shipped overlaps.
- [ ] Reject non-skills (no frontmatter / no procedure).
- [ ] Choose capture format = OpenSpec proposal.
- [ ] Coherence-check vs active/archived changes; scaffold `openspec/changes/<name>/` manually.
- [ ] `openspec validate <name> --strict` → pass; `openspec list` → registered.
- [ ] Commit ONLY the proposal dir.

**Inputs to have ready:** access to `~/Documents` skill mirrors; the monorepo checked
out; `openspec` CLI.
**Final artifacts:** `openspec/changes/add-authoring-skills/{proposal,design,tasks}.md`
+ `specs/authoring-skills/spec.md` + `.openspec.yaml`; commit `d292da73`.

---

_Generated from session `019f05ec-6ab4-77d6-a368-dd004fb7a20e` · `pi-agent-dashboard` · 2026-06-27. Source extract: `/tmp/facts-1784853403N.md`._
