---
session: 019e61ab
week: 2026/W22
type: other
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [fix-wizard-occluded-by-splash]
proposal_excerpt: "On Windows (and likely macOS in some workspace setups), the first-run wizard window never becomes visible because the splash window — which is `alwaysOnTop: true`, `frame: false`, `transparent: true`, and centred on s…"
---

# How we did it: Fix the first-run wizard occluded by the always-on-top splash — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a five-word kickoff: **"Proposal: fix-wizard-occluded-by-splash. Windows tested."** No paragraph, no
task list — just the name of an existing OpenSpec change plus a status flag. The
*real* objective, once the proposal was read, was to **land an already-drafted Electron
fix through the tail end of the OpenSpec lifecycle**: mark the Windows smoke test as
passing, prove macOS doesn't regress, update the docs, archive the change, sync the
delta spec, commit, and push to the right branch. The actual code fix (closing the
splash before opening the wizard, plus `ready-to-show` focus + `show:false` no-flash)
was already written and committed on `feat/enable-standalone-npm-install`. This session
was the **finish-and-ship** half, not the build half.

## 2. TL;DR playbook

1. **Point the AI at an existing proposal by name + the one fact that unblocks it**
   (`Proposal: <name>. Windows tested.`). It reads `proposal.md` + `tasks.md` and
   resumes at the first unchecked task.
2. **Let it run the pure-invariant test as a proxy** for the expensive rebuild —
   `wizard-launch-ordering.test.ts` asserts `closeSplash()` precedes `showWelcomeStep()`.
3. **For the macOS no-regression task, build the Electron app and hand off** — the AI
   builds `PI-Dashboard.app` + DMG and **stops** for a human `open` + eyeball.
4. **Reply with the launch command** (`open packages/electron/out/.../PI-Dashboard.app`)
   as your "it works" signal; the AI marks task 5 done and proceeds.
5. **Delegate every `docs/` write to a subagent** with the caveman-style rule verbatim
   (AGENTS.md Documentation Update Protocol) — the AI does this automatically.
6. **Say `yes`** to trigger `openspec-archive-change`: it moves the change to
   `archive/<date>-<name>/` and syncs the delta spec into the main spec via a second
   subagent.
7. **Say `commit`** — the AI writes a conventional-commit message to a temp file and
   commits with `jj`.
8. **Say `push to <branch>`** — the AI reconciles the `jj` bookmark/remote state and
   confirms (often the archive commit is already an ancestor → nothing to push).

## 3. How the collaboration unfolded

Group the ~40 tool calls into four phases: **Resume → Verify → Ship the docs/spec →
Land the commit.**

### Phase 1 — Resume from the proposal (Verify tasks, run the proxy test)
- **What the AI did:** Read `openspec/changes/fix-wizard-occluded-by-splash/{proposal,tasks}.md`,
  identified the first open task (Windows smoke), marked it tested on the user's word,
  then ran the `wizard-launch-ordering` repo-lint test as a cheap proxy for the
  behavioural invariant instead of rebuilding.
- **Why it worked:** The pure test reads `main.ts` source and asserts call order —
  it catches the exact regression the fix prevents without a multi-minute Electron
  build. Fast feedback on the invariant that matters.
- **Decision point:** The human's "Windows tested" was accepted as ground truth for
  task 4 — the AI didn't try to re-run a Windows build it couldn't run on macOS.

### Phase 2 — macOS no-regression (build + human handoff)
- **What the AI did:** Built the full Electron app + DMG, then **halted** and printed
  the exact `open …/PI-Dashboard.app` command with a three-point verification checklist
  (wizard appears, no double-flash, `showWelcomeStep()` resolves → main window opens).
- **Why it worked:** The AI recognised the one step it *cannot* self-verify (a human
  eyeballing window z-order) and made the handoff frictionless — a copy-pasteable
  command and a precise "look for these three things" list.
- **Decision point:** The user pasted back the very `open` command as confirmation; the
  AI treated that as a pass and marked task 5.

### Phase 3 — Docs + archive + spec sync (all delegated)
- **What the AI did:** Spawned a `general-purpose` subagent to update
  `docs/electron-bootstrap-flow.md` + `docs/file-index-electron.md` (splash/wizard
  ordering invariant + `See change:` tokens), passing the caveman-style doc rule
  verbatim. Then ran `openspec-archive-change`, which moved the change into
  `archive/2026-05-26-…` and spawned a **second** subagent to sync 2 ADDED Requirements
  into `openspec/specs/first-run-wizard/spec.md`.
- **Why it worked:** Both `docs/` writes and spec syncs are isolated, well-scoped jobs
  — perfect for subagents that keep the main context clean. The archive skill chains
  them automatically.
- **Decision point:** A single `yes` authorised the whole archive-and-sync chain.

### Phase 4 — Commit + push (jj reconciliation)
- **What the AI did:** On `commit`, wrote a conventional message to `/tmp/fwos-commit-msg.txt`
  and committed as `7ea1dbcc`. On `push to feat/enable-standalone-npm-install`, inspected
  the `jj` bookmark vs `@origin` and found the archive commit was **already an ancestor**
  of the pushed bookmark — so a dry-run push reported "Nothing changed."
- **Why it worked:** The AI checked remote state *before* pushing and explained why no
  push was needed, rather than blindly force-moving a bookmark.
- **Decision point:** The user's terse `push to <branch>` was enough; the AI figured out
  the reconciliation and reported the final commit stack.

## 4. Prompts that worked

- **The goal prompt — `Proposal: fix-wizard-occluded-by-splash. Windows tested.`**
  Effective because it names an existing artifact (the AI knows where to read) *and*
  supplies the single external fact that unblocks the next task (Windows was validated
  off-machine). A stronger version for a cold start would add the finish line:
  *"Resume the fix-wizard-occluded-by-splash change. Windows is user-tested — mark task 4,
  verify macOS no-regression, update docs, archive, sync specs, and push to
  feat/enable-standalone-npm-install."*
- **High-leverage follow-ups:** `yes` (authorised the full archive+spec-sync chain),
  `commit`, and `push to feat/enable-standalone-npm-install`. Each is one word / one
  line and unlocks a whole lifecycle stage because the OpenSpec skills already know the
  sequence.
- **`open packages/electron/out/PI-Dashboard-darwin-x64/PI-Dashboard.app`** as a reply
  doubled as both the confirmation signal and a record of exactly what was launched.

## 5. Steering & corrections (what to watch for)

The steering here was **light and confirmatory**, not corrective — the human mostly
advanced the AI through stages it had queued up. The guardrails are about *where the
human gate belongs*.

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop and ask for a manual macOS launch to prove no-regression | Reply with the `open …app` command as the pass signal | Stating up front "I will run the macOS launch; proceed to docs on my OK" so the AI knows the handoff shape |
| Wait for authorisation before archiving | A single `yes` | Pre-authorising in the goal prompt: "archive + sync specs without stopping" |
| Ask whether to move the `jj` bookmark before pushing | `push to feat/enable-standalone-npm-install` | Naming the target branch in the goal prompt so the push target is unambiguous |
| Leave commit staging as a separate confirm gate | `commit` | Saying "commit each lifecycle stage as you finish it" if you want fewer gates |

Also worth noting: the AI **correctly flagged** a pre-existing structural issue in the
`first-run-wizard` main spec (missing `## Purpose`/`## Requirements` headers) and made
clear it was *not* introduced by this sync — good instinct to surface, not silently fix,
historical debt.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — this session *consumed* existing ones. The
reusable machinery it leaned on:

- **`openspec-archive-change`** — one `yes` moves the change to `archive/<date>-<name>/`
  and chains the delta-spec sync. Invoke when a change's tasks are all done (or the
  remainder is explicitly deferred).
- **The caveman-style `docs/` subagent delegation** (AGENTS.md Documentation Update
  Protocol) — the AI never edits `docs/` directly; it spawns a `general-purpose`
  subagent with the style rule passed verbatim. Keeps prose consistent and main context
  clean.
- **`wizard-launch-ordering.test.ts` repo-lint pattern** — a pure source-reading test
  that asserts call order (`closeSplash()` before `showWelcomeStep()`). This is the
  reusable idea worth copying: **encode a fragile ordering invariant as a source-lint
  test so a rebuild isn't needed to catch a regression.**

If anything *should* be captured as a skill: a **"finish-and-ship an OpenSpec change"**
project skill that scripts the tail — mark tested tasks → build+handoff for anything
visual → delegate docs → archive → sync → commit → push — so the human only supplies
external facts (test results) and the branch name.

## 7. Pitfalls & dead ends

- **Don't rebuild the whole Electron app just to check an invariant.** The pure
  `wizard-launch-ordering` test is the fast proxy; reserve the full build for the
  genuine macOS-visual no-regression check.
- **`jj` push can be a no-op and that's correct.** When the archive commit is already an
  ancestor of the pushed bookmark, `jj git push --dry-run` says "Nothing changed." Don't
  force-move the bookmark — verify ancestry first (the AI did).
- **One task (`2.3`) and one artifact (`design.md`) were intentionally left incomplete.**
  `2.3` was belt-and-braces the simpler fix made unnecessary; `design.md` was never
  warranted for a <60 LOC change. Archiving with justified gaps is fine — record *why*.
- **A pre-existing spec-header defect will trip the validator.** The `first-run-wizard`
  main spec lacks `## Purpose`/`## Requirements`. Flag it as historical, don't fold a
  fix into an unrelated change.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- An existing OpenSpec change with the code fix already committed (here on
  `feat/enable-standalone-npm-install`).
- The external validation fact the AI can't get itself (Windows: "tested").
- The target push branch name.
- A machine that can build + launch the Electron app for the visual check.

**Sequence:**
1. `Proposal: <change-name>. <external-fact>.` → AI reads proposal/tasks, resumes.
2. AI runs the pure invariant test (`*-ordering.test.ts`) as the fast proxy.
3. AI builds `PI-Dashboard.app` + DMG → **you** `open …app`, eyeball wizard z-order.
4. Reply with the `open …app` command as the pass signal.
5. `yes` → docs subagent + `openspec-archive-change` + delta-spec sync subagent.
6. `commit` → conventional message + `jj` commit.
7. `push to <branch>` → AI reconciles bookmark/remote, confirms.

**Artifacts produced:**
- `openspec/changes/archive/2026-05-26-fix-wizard-occluded-by-splash/`
- `openspec/specs/first-run-wizard/spec.md` (+2 ADDED Requirements, +28 lines)
- Docs: `docs/electron-bootstrap-flow.md`, `docs/file-index-electron.md`
- Commit `7ea1dbcc` (`docs(openspec): archive fix-wizard-occluded-by-splash`, 6 files,
  +170/−44) on `feat/enable-standalone-npm-install`.

---

_Generated from session `019e61ab-7f99-73a2-b2ac-1dda2a561e10` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-26. Source extract: `/tmp/facts-1784862771-82392.md`._
