---
session: 019e6b54
week: 2026/W22
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [bump-pi-compat-to-0-76, bump-pi-compat-to-0-75, bump-pi-compat-to-0.75, modernize-pi-version-handling]
proposal_excerpt: "Pi 0.76.0 was published 2026-05-27 (same day as the 0.75 floor bump). The 0.75 → 0.76 delta is small from the dashboard's perspective — no Node-floor bump, no breaking surface the dashboard exercises (the one Breaking…"
---

# How we did it: Correcting a mis-diagnosed OpenSpec pi-version bump — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a terse, ambiguous line: **"The bump-pi-compat-to-0-76 proposal lost."**
"Lost" here didn't mean "we should abandon it" — it meant *"this proposal has gone
missing / fallen through the cracks, find out why."* The follow-up **"The
bump-pi-compat-to-0-76 proposal is not drafted. Why?"** made the real objective
concrete: **audit the state of the `bump-pi-compat-to-0-76` OpenSpec change, reconcile
it against what actually landed in the code for its predecessor `0-75`, correct the
proposal/design/tasks to match reality, and commit the result to `develop`.** The
deeper goal was *truth reconciliation*: the checkbox record and the working tree
disagreed, and the job was to find which one was real before writing anything.

## 2. TL;DR playbook

1. Treat "the proposal lost / is not drafted" as a **state-audit request**, not a
   delete request. Ask what's wanted only after you've looked.
2. Enumerate reality first: `ls openspec/changes/ | grep bump`, `find openspec/changes/<name> -type f`, and check `archive/` for the predecessor.
3. **Compare the archived tasks.md ticks against live code**, field by field
   (`engines.node`, `piCompatibility.minimum/recommended`, `node-guard.ts` thresholds,
   the existence of new test files).
4. **Before trusting `git HEAD`, check the working tree** — `git status --short` and
   `git diff --stat`. Uncommitted work is invisible to a `HEAD`-only read and will
   invert your whole audit.
5. If you already wrote a correction based on the wrong baseline, **revert it cleanly**
   (`git checkout HEAD -- <files>`, delete the false CORRECTION.md) and redo the
   minimal, accurate edit.
6. Keep the openspec edit **genuinely minimal** — only the bullets that are actually
   wrong (here: dead-surface smoke checks pointing at a removed `/api/bootstrap/status`).
7. `openspec validate <change>` after every rewrite.
8. Split into **two logical commits**: the uncommitted implementation vs. the doc
   correction. Flag any factually-wrong CHANGELOG claim before committing.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (what does "lost" mean?).** The AI resisted the temptation to
act on "lost" literally. It searched (`grep -ri "0.76"`), found the name existed only
as a forward-looking note in `bump-pi-compat-to-0-75/RENAMED-FROM.md`, and reported
honestly: *"I haven't been asked to draft it, and there's no evidence anyone started
it."* It also surfaced a latent mess — the `0-75` rename was half-finished, with
artifacts still under the dot-named `bump-pi-compat-to-0.75/`. **Decision point:** the
human redirected with "2 - same as 0-75 but 0-76. Maybe some tasks haven't been done,
check" — i.e. *build 0-76 on the 0-75 pattern, but verify the 0-75 tasks actually
landed.*

**Phase 2 — The (wrong) audit.** The AI built a reality-vs-ticks table comparing the
archived `0-75` tasks.md against **`git HEAD`**, and concluded the 0-75 work was
"archived with checkboxes ticked but only the bundled-extensions peer-dep bump stuck."
It rewrote `0-76`'s tasks.md into 8 phases to *absorb* the supposedly-missing 0-75 work,
rewrote proposal.md/design.md, and wrote a `CORRECTION.md` into the sealed 0-75 archive.
The human said "yes" to this plan. **This was the dead end** (see §7).

**Phase 3 — The catch.** When asked to "commit to git develop", the AI ran
`git status --short` *before committing* and saw the truth: the "missing" 0-75 work was
**sitting uncommitted in the working tree** (node-guard.ts, package.json engines bumps,
the new `bundled-node-meets-pi-floor.test.ts`). It stopped and flagged: *"my whole
previous audit was wrong — I read HEAD, not the working tree."*

**Phase 4 — Clean redo.** The AI reverted its HEAD-based rewrite (`git checkout HEAD --`
the openspec files, deleted the false CORRECTION.md), re-reviewed the *original* 0-76
draft against the now-correct baseline (0.75 implemented, just uncommitted), and made a
**minimal** edit: only the dead-surface smoke/post-merge bullets referencing the removed
`/api/bootstrap/status`. Re-validated.

**Phase 5 — Commit.** Two logical commits landed on `develop`: `deda667e` (the
uncommitted 0-75 floor implementation, 6 files) and `3542045d` (the 0-76 dead-surface
doc fix, 2 files). The AI flagged — but the session ended before resolving — a
factually-wrong CHANGELOG claim about a "red below-minimum bootstrap banner" that had
been removed under `eliminate-electron-runtime-install`.

## 4. Prompts that worked

- **The goal prompt** — "The bump-pi-compat-to-0-76 proposal lost." Ambiguous, but the
  AI handled it correctly by *investigating before acting*. A stronger kickoff:
  **"Audit the state of the `bump-pi-compat-to-0-76` OpenSpec change and its `0-75`
  predecessor — check the archive ticks AND the working tree against live code — then
  tell me what's real before changing anything."**
- **"2 - same as 0-75 but 0-76. Maybe some tasks haven't be done, check"** — high
  leverage: it picked an option from the AI's menu *and* injected the crucial suspicion
  (tasks maybe not done) that drove the whole audit. Terse but directional.
- **"yes"** — approved a plan; cheap, but note it approved the *wrong* plan because the
  audit baseline was wrong. Approvals are only as good as the evidence under them.
- **"commit to git develop"** — inadvertently the most valuable steer: it forced a
  `git status` that exposed the working-tree truth. Had the AI committed blindly, the
  false correction would have shipped.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Interpret "lost" as an action verb (delete?) | "…is not drafted. Why?" — reframe as an audit | Open ambiguous asks by investigating + reporting state, never acting |
| Trust archived task **checkboxes** as ground truth | "Maybe some tasks haven't be done, check" | Verify ticks against live code, field by field |
| Audit against **`git HEAD` only**, missing uncommitted work | (self-caught at commit time via `git status`) | ALWAYS `git status --short` + `git diff --stat` before auditing "what landed" |
| Write into a **sealed archive** (CORRECTION.md) on a bad premise | Revert once the premise collapsed | Don't mutate archives until the baseline is confirmed real |
| Expand the openspec rewrite into 8 phases | Redo as a minimal one-hop `0.75 → 0.76` fix | Prefer the smallest diff that makes the doc true |

The load-bearing quality bar the human imposed implicitly: **accuracy over motion.**
The AI's own instinct to `git status` before committing is what saved it — reward and
institutionalize that instinct.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created in this session. The workflow is clearly repeatable and
**should** be captured as a project skill — call it something like
`audit-openspec-vs-reality`:

- **What it would capture:** the "reconcile OpenSpec ticks against live code" loop, with
  the **hard rule to read the working tree (not just HEAD)** before concluding what
  landed, and the field-by-field checklist (`engines.node`, `piCompatibility.*`,
  `node-guard.ts` thresholds, new test-file existence).
- **Why it's effective:** it removes the single most expensive mistake in this session —
  a whole audit + rewrite + false archive note built on a `HEAD`-only read — by making
  the working-tree check step 1, not an accident discovered at commit time.
- **When to invoke:** any "did this change actually land / why is this proposal in a weird
  state" question, especially around pi-version / compat bumps.

## 7. Pitfalls & dead ends

- **`HEAD`-only audit inverts reality.** The AI concluded 0-75 "never landed" because it
  diffed against `HEAD`; the implementation was uncommitted in the working tree. *If you're
  auditing what shipped, `git status --short` + `git diff --stat HEAD` come FIRST.*
- **Writing a CORRECTION.md into a sealed archive on a false premise.** It had to be
  deleted. *Don't mutate archives until the baseline is confirmed.*
- **Over-scoping the fix.** The first rewrite ballooned tasks.md to 8 phases to absorb
  phantom work. The correct fix was a small one-hop `0.75 → 0.76` edit. *When the baseline
  turns out to be fine, the diff should shrink, not grow.*
- **Path/naming drift** (`bump-pi-compat-to-0.75` dot-dir vs `-0-75` hyphen-dir) caused a
  failed `ls` and confusion. *Normalize the rename before building the successor.*
- **Stale CHANGELOG claim** about a "red below-minimum bootstrap banner" that no longer
  exists (removed under `eliminate-electron-runtime-install`). Flagged, not fixed — *verify
  CHANGELOG user-facing claims against the current UI surface.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:** repo at `pi-agent-dashboard` on `develop`;
the target change name (`bump-pi-compat-to-0-76`) and its predecessor (`0-75`); knowledge
of the compat fields (`engines.node`, `piCompatibility.minimum/recommended`,
`node-guard.ts`, `bundled-node-meets-pi-floor.test.ts`).

- [ ] `ls openspec/changes/ | grep bump` and `find openspec/changes/<name> -type f` — map what exists.
- [ ] **`git status --short` + `git diff --stat HEAD`** — capture uncommitted work BEFORE auditing.
- [ ] Compare archived predecessor ticks vs live code, field by field.
- [ ] Make the **minimal** true edit to proposal.md / design.md / tasks.md (fix only wrong bullets).
- [ ] `openspec validate <change>` after each rewrite.
- [ ] If you built on a wrong baseline: `git checkout HEAD -- <files>`, delete any false archive notes, redo.
- [ ] Verify CHANGELOG user-facing claims against the current UI.
- [ ] Commit in two logical parts: implementation vs. doc correction.

**Final artifacts produced:**
- `openspec/changes/bump-pi-compat-to-0-76/{proposal,design,tasks}.md` (corrected, minimal)
- Commits on `develop`: `deda667e` (pi 0.75 floor impl, 6 files), `3542045d` (0-76 dead-surface fix, 2 files)

---

_Generated from session `019e6b54-d478-7e03-9046-8a886238b0e3` · `pi-agent-dashboard` · 2026-05-28. Source extract: `/tmp/facts-95942-6390.md`._
