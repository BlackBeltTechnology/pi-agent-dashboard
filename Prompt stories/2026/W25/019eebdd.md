---
session: 019eebdd
week: 2026/W25
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-automation-slot-parity-and-routing, accordion-workspace-folders]
proposal_excerpt: "The sidebar **Automations** row (added by `add-automation-plugin`) does not match the **OPENSPEC** row beside it, and its link is dead:"
---

# How we did it: Fix the Automations sidebar row (parity + dead link) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened **explore mode** (`openspec-explore`) with a stance prompt — *"Think
deeply. Visualize freely. Follow the conversation wherever it goes… NEVER write code
or implement features."* — and pointed at a concrete UI defect: the sidebar
**Automations** row (added by the `add-automation-plugin`) "doesn't have the same
design" as the **OPENSPEC** row beside it, and its link "does not open the
Automations page."

The *real* objective, once the explore stance clarified it, was **diagnosis before
implementation**: prove *why* the two rows look different and *why* the link is dead,
visualize the target design, then capture the fix as an OpenSpec **proposal** — not a
code change. Two later one-word steering turns ("create proposal", then "commit")
turned the diagnosis into a committed, validated OpenSpec change:
`fix-automation-slot-parity-and-routing`.

## 2. TL;DR playbook

1. Enter explore mode with the `openspec-explore` skill so the AI **investigates but
   never implements** — the right stance for a "why is this broken?" defect.
2. Grep the file-index for the feature (`grep -rni "automation" docs/file-index*.md`)
   to find the plugin + slot components fast, without reading source blind.
3. Read the **two mismatched components side by side** — the plugin slot
   (`FolderAutomationSection.tsx`) vs the first-class shell component
   (`FolderOpenSpecSection.tsx`) — to prove the design divergence.
4. Trace the routing: follow the button's `setLocation("/automation?…")` target
   against how the slot is actually mounted — discover the `command-route` slot's
   consumer is **never mounted**, so the link is dead.
5. Build a throwaway HTML mockup (`/tmp/automation-mockup.html`) and view it in the
   **browser** to make the target design concrete before writing any spec.
6. Say **"create proposal"** — scaffold the OpenSpec change (proposal + design +
   tasks + delta spec) matching an existing change's conventions exactly.
7. `openspec validate <change>` until clean.
8. Say **"commit"** — stage **only** the proposal directory (surgical commit),
   leaving unrelated working-tree changes untouched.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (grep the index, not the tree).** The AI started from
`docs/file-index*.md`, immediately landing on the `automation-plugin` package. This
is the effective move: the file-index is the shortcut from a feature *name* to its
components, avoiding a blind directory crawl.

**Phase 2 — Prove the two problems.** The AI read `FolderAutomationSection.tsx`
(plugin slot) and `FolderOpenSpecSection.tsx` (shell component) together, showing the
first is a single full-width `text-[11px]` button while the second is a header row
(10px uppercase title + count + refresh ⟳ + right-aligned chips). *Different slots,
different components → never built to match.* It also debunked the user's "thick blue
box" as just the keyboard focus ring. **Root cause #1 nailed by direct comparison.**

**Phase 3 — Trace the dead link.** The AI followed `setLocation("/automation?cwd=…")`
against the slot wiring and found the button targets the retired **`command-route`**
slot whose `CommandRouteSlot` consumer is **never mounted anywhere** — while the
OpenSpec board and flows popouts use the live **`shell-overlay-route`** slot.
**Root cause #2: wrong slot, dead route.**

**Phase 4 — Visualize.** Rather than describe the fix in prose, the AI wrote a
standalone `/tmp/automation-mockup.html` and opened it in the browser — turning "make
it match OpenSpec" into a concrete, reviewable picture.

**Phase 5 — Generate the proposal ("create proposal").** The AI first checked an
existing change's `.openspec.yaml` + delta-spec format to match conventions, then
scaffolded the full change: `proposal.md`, `design.md` (3 decisions: sidebar re-skin ·
routing slot swap · page chrome), `tasks.md` (5 task groups), and a MODIFIED delta
spec for `automation-content-view`. Then `openspec validate` → clean.

**Phase 6 — Surgical commit ("commit").** The AI ran `git status` first, spotted
unrelated working-tree changes (`add-goals-folder-page/`, a deleted mockup, a
modified `directory-service.ts`), and staged **only** the proposal directory —
committing 5 files / 197 insertions as `02e83151` and leaving everything else
untouched.

## 4. Prompts that worked

- **The goal prompt (explore-mode stance):** loading `openspec-explore` up front was
  the highest-leverage decision. It framed the whole session as *diagnose, don't
  fix*, which is exactly right for a "why is this broken?" defect — you get a proven
  root cause before a line of code is proposed.
- **"create proposal"** — a two-word follow-up that unlocked the entire OpenSpec
  scaffold. It worked because the diagnosis phase had already produced everything the
  proposal needed (root causes, target design, the right slot).
- **"commit"** — one word, but the AI correctly interpreted it as *commit only my
  work*, not *commit the whole dirty tree*.

Stronger versions for next time: the goal prompt could name the two suspected
symptoms explicitly ("the row styling differs AND the link is dead — find the root
cause of each"), so the AI splits the investigation from the first turn.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| stay in open-ended explore mode | "create proposal" | say "diagnose, then propose" once the root cause is proven |
| leave the fix as prose diagnosis | building a browser mockup | ask for a visual mockup as part of "show me the target design" |
| (risk) commit the whole dirty tree | "commit" → AI self-checked `git status` and staged only its dir | state "commit ONLY the proposal files" when the tree is dirty |

The session had light steering (two one-word turns) because the explore stance did
the heavy lifting. The key guardrail is the **surgical commit**: when the working
tree has unrelated changes, the AI must `git status` first and stage a specific path,
never `git add -A`.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created. The reusable pattern, though, is clear and worth
codifying:

- **"Diagnose a UI-parity + dead-link defect via explore mode → OpenSpec proposal."**
  The effective loop is: file-index grep → compare the two divergent components →
  trace the slot/route wiring → browser mockup → scaffold proposal matching an
  existing change → `openspec validate` → surgical commit. Invoke it whenever a
  plugin-contributed sidebar row doesn't match a first-class shell row, or a slot
  link is dead — the `command-route` (retired) vs `shell-overlay-route` (live)
  distinction is the recurring trap.

## 7. Pitfalls & dead ends

- **The `command-route` slot is retired.** Its `CommandRouteSlot` consumer is never
  mounted, so any `setLocation("/automation?…")` targeting it silently dead-ends. If
  a plugin link "does nothing," check whether it points at `command-route` and move
  it to **`shell-overlay-route`** (the pattern OpenSpec board + flows popouts use),
  routing on `/folder/:encodedCwd/automations`.
- **A "thick blue box" in a screenshot is a focus ring, not a border.** Don't chase
  it as a styling bug.
- **Dirty working tree at commit time.** Unrelated changes
  (`add-goals-folder-page/`, a deleted mockup, `directory-service.ts`) were present.
  One `grep -rn "CommandRouteSlot"` command also failed mid-investigation — recovered
  by narrowing with `grep -rln`. Always `git status` before staging; commit a
  specific path, not `-A`.

## 8. Reproduce it faster — checklist

- [ ] Load `openspec-explore` — investigate, do **not** implement.
- [ ] `grep -rni "<feature>" docs/file-index*.md` to find the plugin + slot files.
- [ ] Read the plugin slot component and the first-class shell component **side by
      side** to prove any design divergence.
- [ ] Trace the button's `setLocation(...)` target vs how the slot is mounted; watch
      for the dead **`command-route`** slot.
- [ ] Build `/tmp/<feature>-mockup.html`, open in the browser to fix the target
      design.
- [ ] "create proposal" → check an existing change's `.openspec.yaml` + delta format,
      then scaffold `proposal.md` / `design.md` / `tasks.md` / `specs/*/spec.md`.
- [ ] `openspec validate <change>` until clean.
- [ ] `git status`, then stage **only** the change directory; "commit" surgically.

**Inputs needed:** the failing UI screenshot / defect description, repo checkout with
`openspec` CLI available.
**Artifacts produced:** `openspec/changes/fix-automation-slot-parity-and-routing/`
(`proposal.md`, `design.md`, `tasks.md`, `specs/automation-content-view/spec.md`,
`.openspec.yaml`) + throwaway `/tmp/automation-mockup.html`; committed as `02e83151`.

---

_Generated from session `019eebdd-308f-7d42-8eee-112175dff401` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-21. Source extract: session facts sheet (Fix Automation)._
