---
session: 019de0f5
week: 2026/W18
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [resume-button-in-session-header]
proposal_excerpt: "When the session a user is currently viewing transitions to `status === \"ended\"` — most commonly after a dashboard server reload, a pi process crash, or the bridge disconnecting — the chat panel freezes in place with…"
---

# How we did it: Resume/Fork pills in the desktop session header — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** — a thinking-only stance ("You may read files, search
code, and investigate… but you must NEVER write code"). There was no concrete feature request
in prompt 1; the operator wanted the AI to *find* the gap. The AI mapped it immediately: when a
viewed session flips to `status === "ended"` (dashboard reload, pi crash, bridge disconnect),
the **desktop `SessionHeader` has no resume affordance** — only the sidebar `SessionCard` and
the mobile kebab do. To continue, the user must navigate back to the sidebar, find the card,
click Resume, and re-navigate. Annoying.

The **real objective**, once explore surfaced it: add **Resume + Fork pills to the desktop
`SessionHeader`** when `status === "ended" && sessionFile`, reusing the existing
`handleResumeSession` plumbing — a pure UI surface addition with **zero server/protocol
changes**. This was then driven end-to-end through the full OpenSpec lifecycle
(propose → ff → apply → verify → archive → commit).

## 2. TL;DR playbook

1. **Start in explore mode** to let the AI locate the gap instead of pre-specifying it. Ask it
   to diagram the current state (sidebar vs header, desktop vs mobile).
2. Once the gap is clear, say **`make proposal`** — the AI runs `openspec new change` and drafts
   `proposal.md` scoping the `session-resume` capability modification.
3. **`/opsx:ff`** — fast-forward the remaining artifacts (`design`, `specs`, `tasks`) in one shot;
   the change is small enough to justify skipping the step-by-step.
4. **`/opsx:apply`** — implement TDD-first: write `SessionHeader.resume.test.tsx`, watch it fail
   (5/9), then add the `onResume` prop + `isEnded` gate + pills, watch it go 9/9 green.
5. Run **`npm test`** (full suite green: 385 files / 3953 passing) and **`npm run build`** (clean).
6. Manually smoke-test, tell the AI **"it works, so mark task ok"** to tick the manual-QA tasks.
7. **`/opsx:verify`** then **`/opsx:archive`** — sync the spec delta into the main spec and move
   the change to `archive/<date>-…`.
8. **`commit`** — but the working tree has crossover from other in-progress changes; make the AI
   **cherry-pick only this change's hunks** (see §5) before committing.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore mode).** The AI read `SessionHeader.tsx`, `SessionCard.tsx`,
`App.tsx`, grepped for `onResume`/`handleResume`/`status.*ended`, and produced an ASCII diagram
contrasting the sidebar (has Resume/Fork), the mobile kebab (has Resume), and the desktop header
(nothing). It found the plumbing already existed — `App.tsx:838` passes `onResume` into
`mobileActions` — so desktop just needed to consume it. *Why it worked:* explore mode kept the AI
from jumping to code and let it establish that this was a **reuse**, not a new mechanism.

**Phase 2 — Propose (`make proposal`).** `openspec new change "resume-button-in-session-header"`,
then a `proposal.md` that framed the *why* (post-reload frozen chat) and *what* (Resume/Fork pills
replacing the meaningless elapsed-time span; mirror the card's green/blue pill language; `resuming`
flag disables to prevent double-spawn). Modified capability: `session-resume`.

**Phase 3 — Fast-forward artifacts (`/opsx:ff`).** `design.md` (5 decisions, 4 risks — notably
"replace the duration span, not a banner" and "top-level `onResume` prop, not nested under
`mobileActions`"), `specs/session-resume/spec.md` (2 requirements / 9 scenarios), and `tasks.md`
(6 groups / 18 checkboxes). All apply-ready. *Decision point:* the AI offered step-by-step vs
fast-forward; the operator chose ff because the change was small.

**Phase 4 — Implement TDD (`/opsx:apply`).** Test first: `SessionHeader.resume.test.tsx` — 9 tests
across render gating, click semantics (`continue`/`fork`), `resuming` disable, and mobile
non-regression. Ran red (5/9 fail, 4 negative cases pass), then edited `SessionHeader.tsx` (prop +
`@mdi/js` icon imports + `isEnded` gate + conditional pills) and one-line-wired `App.tsx`. Green
9/9, then 24/24 SessionHeader tests, then full suite **3953 passing / 0 failing**; `npm run build`
clean. Docs updated (`AGENTS.md` row, `CHANGELOG.md` `[Unreleased] → Added`).

**Phase 5 — Verify + archive (`/opsx:verify`, `/opsx:archive`).** A spec→impl→test trace matrix
confirmed all 9 scenarios covered. The delta had 2 ADDED requirements the main spec lacked → the
AI spawned a `general-purpose` subagent to sync specs, then archived to
`archive/2026-05-01-resume-button-in-session-header/`.

**Phase 6 — Surgical commit (`commit`).** The working tree had heavy crossover from three other
in-progress changes (`session-card-unread-stripes`, `extract-flows-as-plugin`,
`strip-token-backgrounds-in-code-blocks`) — even `SessionHeader.tsx` carried an unrelated
`FlowLaunchDialog` import. The AI **paused and asked for intent** before committing, then
cherry-picked only this change's hunks (§5) into a clean 11-file commit.

## 4. Prompts that worked

- **The goal prompt (explore mode).** Not a feature request — a *thinking stance* that let the AI
  discover and diagram the gap itself. Effective when you suspect a problem but haven't pinned the
  fix. A stronger kickoff still names the symptom: *"Explore: after a dashboard reload the viewed
  session freezes with no way to resume from the header — map where the resume affordance exists
  and where it's missing."*
- **`make proposal`** — a two-word unlock that converted the explored understanding straight into
  an OpenSpec artifact. High-leverage because the AI already held all the context.
- **`/opsx:ff` → `/opsx:apply` → `/opsx:verify` → `/opsx:archive`** — the OpenSpec slash-commands
  each moved a whole lifecycle stage. Chaining them is the fast path once a proposal exists.
- **"It seems work, so test task ok"** — a short human-in-the-loop confirmation that let the AI
  tick the *manual* QA tasks (desktop/mobile smoke) it cannot self-verify.
- **`commit`** — deliberately terse; its value was that the AI *refused to blindly run it* and
  surfaced the dirty working tree first (see §5).

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to implement while still in explore mode | Explore-mode stance forbids writing code — exit first via a change proposal | Keep explore/implement as distinct phases; only `make proposal` bridges them |
| Not know if manual-QA tasks passed | "It seems work, so test task ok" — human confirms live behavior | State up front which tasks are manual-smoke so the AI marks them only on your say-so |
| Reach for `git commit` on a dirty tree | The AI itself paused: working tree had 3 other changes' hunks; it asked intent before committing | Tell it up front: **"commit ONLY this change's hunks; the tree has unrelated in-progress work"** |
| Risk committing crossover hunks | Cherry-pick: temporarily revert unrelated hunks per file → stage → restore working tree; unstage pre-staged flows-plugin renames | Learn the revert-stage-restore dance (§7) for multi-change working trees |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session rode existing assets:

- **OpenSpec slash-commands** (`/opsx:ff`, `/opsx:apply`, `/opsx:verify`, `/opsx:archive`) — the
  spec-driven lifecycle. Effective because each command is self-contained and status-aware
  (`openspec status --json` gates the next artifact), so the AI always knows what's unlocked.
- **`general-purpose` subagent — "Sync resume-button specs"** — isolated the delta→main-spec sync
  so the reasoning stayed out of the main context. Invoke a subagent for mechanical spec merges.

*Recommended skill to create:* a **surgical-commit-from-a-dirty-tree** procedure (the
revert-stage-restore-per-file dance in §7) — this session re-derived it by hand, and it recurs
whenever multiple OpenSpec changes share a working tree.

## 7. Pitfalls & dead ends

- **Vitest picked up the real `$HOME`** — one test run needed `HOME=$(mktemp -d) npx vitest run …`
  to isolate from user config. If a client test behaves oddly, sandbox `HOME`.
- **One failed grep** (`rg mdiSourceFork|mdiPlayCircleOutline` before the import existed) — cheap,
  self-corrected by grepping the actual `@mdi/js` import line.
- **Dirty working tree with 3 other changes' hunks** — the big one. `git commit` would have
  captured unrelated work. Fix (per file):
  1. Stage 100%-mine files directly.
  2. For a mixed file (`SessionHeader.tsx`): `git checkout HEAD -- <file>`? No — instead
     temporarily revert only the *unrelated* hunk, `git add` the clean result, then restore the
     working tree copy.
  3. `git reset HEAD <unrelated pre-staged renames>` to drop the flows-plugin `R` renames that
     were already in the index.
  4. `git diff --cached --stat` to confirm the staged set is exactly yours before commit.
- **Leftover working-tree diff after commit** is expected — the unrelated `FlowLaunchDialog`
  import stays for whoever owns `extract-flows-as-plugin`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a running dashboard to smoke-test against; a clean-ish working tree (or
be ready to cherry-pick); the OpenSpec toolchain.

1. `explore` the gap → get the AI to diagram sidebar vs header, desktop vs mobile.
2. `make proposal` → `openspec new change` + `proposal.md` scoping `session-resume`.
3. `/opsx:ff` → design + specs + tasks in one shot (small change).
4. `/opsx:apply` → **test first** (`SessionHeader.resume.test.tsx`, red), then prop + `isEnded`
   gate + pills in `SessionHeader.tsx`, one-line wire in `App.tsx` (green 9/9).
5. `npm test` (full green) + `npm run build` (clean).
6. Smoke-test live; tell the AI "works, mark manual QA ok".
7. `/opsx:verify` (trace matrix) → `/opsx:archive` (sync delta, move to archive).
8. `commit` **only this change's hunks** — revert-stage-restore per mixed file; unstage stray
   pre-staged renames; `git diff --cached --stat` to confirm.

**Final artifacts:** commit `e952ccf` (11 files / +486 / −4) — `SessionHeader.tsx`, `App.tsx`,
new `SessionHeader.resume.test.tsx`, `AGENTS.md`, `CHANGELOG.md`, synced
`openspec/specs/session-resume/spec.md`, and the archived change dir.

---

_Generated from session `019de0f5` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-01. Source extract: `/tmp/facts-1784863610N.md`._
