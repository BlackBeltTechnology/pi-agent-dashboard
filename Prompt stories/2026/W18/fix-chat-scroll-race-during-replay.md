---
session: 019dd0df
week: 2026/W18
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (11 user prompts)"
upgrade_status: pending
openspec_changes: [fix-openspec-design-detection, fix-chat-scroll-race-during-replay, fix-openspec-flag-rename-bug, extract-flows-as-plugin, accordion-workspace-folders]
proposal_excerpt: "The dashboard's session-card buttons for an attached OpenSpec change (`[Continue] [FF]` vs `[Apply]` vs `[Verify] [Archive]`) are derived from `deriveChangeState(change)`, which trusts the per-artifact `status` return…"
---

# How we did it: Making the dashboard's OpenSpec button detection ignore the CLI's design.md verdict — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** ("Enter explore mode. Think deeply… you must NEVER
write code or implement features"). The real objective surfaced once the thinking landed:
the dashboard's session-card action buttons (`[Continue] [FF]` vs `[Apply]` vs
`[Verify] [Archive]`) are derived from `deriveChangeState(change)`, which trusts the
per-artifact `status` the OpenSpec CLI returns. The CLI treats `design.md` as an
**unconditional hard dependency** of `tasks`, so a change that legitimately needs *no*
design (a trivial fix), or whose design was split into `design-X.md`/`design-Y.md`, shows
`[Continue] [FF]` when the user actually needs `[Apply]`. The goal: make the dashboard's
detection **deterministic and locally-owned** — override the CLI's design verdict with our
own on-disk evidence, promote-only, never demote — and ship it end-to-end (proposal →
design → specs → tasks → implementation → archive → commit).

## 2. TL;DR playbook

1. **Start in explore mode** to map the failure before touching code. Ask the AI to trace
   the real detection chain in source (`openspec status --json` → `buildOpenSpecData()` →
   `deriveChangeState()`), not to reason from docs.
2. **Nail the root cause in one sentence**: `design.status === "ready"` (CLI verdict)
   propagates through `allDone`, flipping the button set. Both failure modes collapse to
   the same symptom.
3. **Answer the AI's framing questions crisply** (recurring? forked CLI? user-prompt?) so
   it locks the constraint: *deterministic, in-dashboard, no CLI fork, no user prompt.*
4. **Create the OpenSpec change from inside explore mode** (`create proposal` → `/opsx:ff`)
   — artifacts are "capturing thinking," which explore mode permits.
5. **Exit explore mode before implementing** — explore mode *forbids* writing the actual
   module; the AI will (correctly) refuse `/opsx:apply` until you leave. `exit explore mode`
   then re-issue `/opsx:apply <change>`.
6. **Let it run TDD**: one shared module `openspec-design-evidence.ts` (R1/R2/R3 rules),
   red tests first, then wire `buildOpenSpecData` + `DirectoryService`.
7. **Add a repo-lint** that blocks any skill from calling `openspec status --json` directly,
   plus a shared `effective-status.sh` wrapper — kills future skill↔dashboard drift.
8. **Verify full repo green** (`npm test` → 3382 passing), **restart the server**
   (`curl -X POST .../api/restart`) so the override loads, then **archive + sync specs +
   commit**.

## 3. How the collaboration unfolded

**Phase 1 — Explore & root-cause (explore mode).** The AI read the `spec-driven` schema
source and proved the contradiction: the schema YAML makes `design` an *unconditional*
`requires` of `tasks`, while the schema's own prose says design is *conditional* ("create
only if any apply"). It drew the detection chain and both failure modes (Case A: no
design.md needed; Case B: design split across files) as ASCII diagrams. *Why it worked:*
it grounded in the actual `openspec-poller.ts` / `deriveChangeState` call sites instead of
trusting AGENTS.md descriptions. **Decision point:** the human's answers (`recurring`, `no
prompt — button activity depends on OUR detection`, `no fork`) reframed the whole problem
to a deterministic in-dashboard override.

**Phase 2 — Scaffold the change (still explore mode).** `create proposal` → `/opsx:ff`
generated proposal.md, design.md (D1–D5 decisions + full detection matrix), a new
capability spec `openspec-detection/spec.md` (4 ADDED requirements, 14 scenarios), and
tasks.md (8 groups, ~25 checkboxes, TDD-ordered). *Decision point:* the validator forced
declaring the new capability spec now (it requires ≥1 delta) rather than punting.

**Phase 3 — The explore-mode wall.** The user issued `/opsx:apply` — three times. The AI
held the line each time: explore mode forbids implementation; artifacts were fine, but
writing `openspec-design-evidence.ts` is not. Only after `exit explore mode` did it start.

**Phase 4 — TDD implementation.** Shared module + red tests → impl (23/23) → wire
`buildOpenSpecData` post-processor (37/37) → wire `DirectoryService` (+2) → `effective-status.sh`
wrapper (7/7) → repo-lint blocking raw `openspec status --json` in skills (1) → docs.

**Phase 5 — Verify, archive, commit.** Full repo `npm test` = 3382 passing / 0 failing,
`openspec validate` clean, server restarted (uptime 7s → override live). Synced the delta
into a canonical `openspec/specs/openspec-detection/spec.md`, archived the change, then
un-ignored `.pi/skills/openspec-shared/` (it was caught by a `skills/openspec-*/**`
gitignore) and committed `6cf0759` — 17 files, 1180 insertions.

## 4. Prompts that worked

- **The goal prompt (explore-mode preamble).** Effective *as a thinking primer* — it forced
  root-causing before code and produced the diagrams that located the exact failing bit.
  A stronger kickoff would name the target file up front: *"Explore mode. Root-cause why
  dashboard session-card buttons show `[Continue][FF]` instead of `[Apply]` for changes
  that need no design.md. Trace `deriveChangeState` and `buildOpenSpecData` in source; don't
  trust the docs."*
- **High-leverage follow-up: `1. recurring / 2. no prompt, because the button activity …
  depends on our detection logic / 3. no fork`.** Three terse answers that collapsed the
  solution space to *deterministic, in-dashboard, promote-only*. This one line saved the
  most time.
- **`create proposal` then `/opsx:ff`.** Unlocked the full artifact set in one pass while
  still inside explore mode (legal because artifacts are "capturing thinking").
- **`exit explore mode` → `/opsx:apply`.** The unlock that let implementation begin.
- **`assumes its tested` / `commit changes`.** Terminal nudges that accepted the deferred
  manual-QA tasks and closed out the session.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Consider delegating detection to a user-prompt or a forked CLI | "no prompt… depends on OUR detection logic / no fork" | State the constraint in the goal: *deterministic, in-dashboard, no CLI fork, promote-only.* |
| Refuse to implement, then offer more *thinking* work while blocked | Re-issue `/opsx:apply` (3×), then finally `exit explore mode` | Know explore mode forbids code — leave it before apply; don't fight the refusal. |
| Pause and ask "continue to design.md or review first?" after the proposal | Push straight through with `/opsx:ff` | Use `/opsx:ff` when you already want the full apply-ready artifact set. |
| Punt on creating a capability spec in the proposal | Let the validator force it ("requires ≥1 delta") | Declare the new capability spec upfront when the change owns new behavior. |
| Leave the new `effective-status.sh` invisible to git (gitignored) | Spot the `.pi/.gitignore` `skills/openspec-*/**` exclusion, un-ignore `openspec-shared/` | Remember `.pi/skills/openspec-*` is gitignored — add an exception for OUR (non-upstream) additions. |

## 6. Skills, tools & memory created — and why they're effective

No pi *skill/memory* object was saved, but three durable, reproducible assets landed:

- **`packages/shared/src/openspec-design-evidence.ts`** — the single source of truth for the
  design-satisfaction rules (R1 `^design.*\.md$`, R2 `design/*.md`, R3 `tasks.md` has
  `- [ ]`). Consumed by *both* the dashboard (`buildOpenSpecData`) and the skill wrapper.
  *Effective because* it removes the CLI's over-strict design verdict from the button logic
  and guarantees dashboard and skills agree.
- **`.pi/skills/openspec-shared/scripts/effective-status.sh`** — a CLI-side wrapper that
  applies the same override so skills see the corrected status. *Invoke it* wherever a skill
  needs effective (not raw) OpenSpec status.
- **The repo-lint test `no-raw-openspec-status-in-skills.test.ts`** — fails CI if any skill
  calls `openspec status --json` directly. *Effective because* it structurally prevents the
  drift this whole change fixed from ever coming back. A future refactor can't silently
  bypass the override.

If you repeat this pattern (dashboard behavior that must override an upstream tool's verdict),
the reusable recipe is: **one shared evidence module + one CLI wrapper + one anti-drift lint.**

## 7. Pitfalls & dead ends

- **Vitest needs an isolated HOME.** Bare `npx vitest run` failed until commands used
  `HOME=$(mktemp -d) npx vitest run …`. Prefix test runs with a throwaway HOME.
- **Explore mode blocks `/opsx:apply`.** Re-issuing the apply command does nothing — you must
  `exit explore mode` (or start a fresh session) first. Don't waste turns retrying.
- **`.pi/.gitignore` hides `skills/openspec-*/**`.** New wrapper scripts under
  `.pi/skills/openspec-shared/` won't be committed until you add an un-ignore exception.
- **The validator forces ≥1 delta.** A proposal that "punts" on spec creation won't validate;
  declare the capability spec.
- **`/api/restart` matters.** The override won't take effect in the running dashboard until
  the server restarts — verify with `/api/health` uptime.
- **Two unrelated working-tree changes** (`openspec-activity-detector.*`) were left unstaged
  by design — don't sweep unrelated prior work into your commit.

## 8. Reproduce it faster — checklist

- [ ] Explore mode: trace `deriveChangeState` → `buildOpenSpecData` → `openspec-poller.ts`
      in **source**; confirm the failing bit is `design.status` propagating through `allDone`.
- [ ] Answer the constraint questions crisply: deterministic, in-dashboard, no fork, promote-only.
- [ ] `create proposal` → `/opsx:ff` (proposal + design + capability spec + tasks, TDD-ordered).
- [ ] `exit explore mode`, then `/opsx:apply <change>`.
- [ ] Build the shared `openspec-design-evidence.ts` (R1/R2/R3) TDD-first; wire
      `buildOpenSpecData` + `DirectoryService`.
- [ ] Add `effective-status.sh` wrapper + the `no-raw-openspec-status-in-skills` lint.
- [ ] `HOME=$(mktemp -d) npm test` → full green; `openspec validate` clean.
- [ ] `curl -X POST http://localhost:8000/api/restart`; confirm `/api/health` uptime resets.
- [ ] Sync delta → canonical spec, archive the change, un-ignore `openspec-shared/`, commit.

**Key inputs to have ready:** a running local dashboard (port 8000), the `spec-driven`
schema installed, and write access to `.pi/skills/openspec-*`. **Final artifacts:** the
shared module + 4 test files (43 tests), the wrapper script, the anti-drift lint, the
`openspec-detection` capability spec, and commit `6cf0759`.

---

_Generated from session `019dd0df-dee9-724c-aedc-fd99cc39dbea` · `pi-agent-dashboard` · 2026-04-28. Source extract: `/tmp/session_facts.zL94X6.md`._
