---
session: 019f3cdf
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts); large facts sheet (~12152 tok)"
upgrade_status: pending
openspec_changes: [enhance-tool-call-grouping]
proposal_excerpt: "Tool-call grouping (change `2026-07-06-group-tool-call-bursts`) only kicks in at 3+ consecutive calls, so single and paired tool calls render as bare rows — the timeline mixes framed groups with loose rows and reads i…"
---

# How we did it: enhance tool-call grouping — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a single command:

```
/skill:openspec-apply-change enhance-tool-call-grouping
```

The real objective, spelled out in the attached proposal, was a **timeline
consistency fix**: tool-call grouping previously only framed 3+ consecutive calls,
so single and paired calls fell through as bare rows and the chat timeline mixed
framed groups with loose rows. The change lowers the formation threshold to 1 (every
tool run forms a group), folds opening/concluding reasoning *inside* the group frame,
adds a per-kind icon+count breakdown for multi-member groups, a `toolGroupDefaultCollapsed`
preference, and streaming liveness affordances — then lands it end-to-end (implement →
docker/faux verify → Playwright E2E → code review → ship).

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change>` — let the apply skill read
   the proposal, tasks, and context files before touching code.
2. Work the tasks **TDD-first**: rewrite the failing tests (threshold 3 → 1), then
   the formation logic in `group-tool-bursts.ts`, then the component.
3. When shared-package edits don't resolve, **`npm ci` inside the worktree** — a fresh
   worktree has no `node_modules` workspace symlinks, so imports drift to the main repo.
4. Verify live: `run in docker test and check it with faux model` — build the image so
   your changes bake in, spawn a faux session, drive the browser to eyeball the UI.
5. Lock the behavior with **Playwright against the running container + system Chrome**
   (`PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome`) — new browser scenarios go in `tests/e2e/`.
6. Run the review gates: `code-quality` (Biome + tsc + tests) and `code-review`
   (CodeRabbit over the uncommitted diff) — triage before commit.
7. `ship change` — verify gate, archive + sync specs, commit, PR against `develop`,
   watch CI, drain CodeRabbit PR threads, squash-merge, remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (apply skill).** The AI read the change's proposal/tasks/context,
then mapped the existing surface: `group-tool-bursts.ts`, `tool-summary.ts`,
`display-prefs.ts`, `ChatView`, `ChatViewMenu`, `SettingsPanel`, the mock and the
collapsed-group icons. Grounding in the real files before editing kept the multi-file
change coherent.

**Phase 2 — Implement TDD-first.** Task 1 (formation) began by rewriting the
threshold-3 tests to the new universal-grouping expectations, *then* changing the logic
(threshold → 1, leading + trailing transparent absorption, a lone-`×N` bare-group
exception to avoid double-framing). Then the icon map, the `toolGroupDefaultCollapsed`
pref wired through shared + server + both UI toggles, the CSS liveness animations, and
the `ToolBurstGroup.tsx` rewrite with a unified `GroupFrame`.

**Phase 3 — Resolve the worktree import trap.** A shared-package edit wasn't picked up:
the worktree resolved `@blackbelt-technology/pi-dashboard-shared` to the **main** repo.
`npm ci` inside the worktree created the workspace symlinks; tsc then went clean.

**Phase 4 — Live verify (docker + faux).** Prompted by *"run in docker test and check it
with faux model"*, the AI added two faux scenarios (`grp-single`, `grp-reasoning`),
rebuilt the image so they baked in, spawned a session, and drove the browser to confirm
the unified header + folded reasoning rendered.

**Phase 5 — Playwright E2E.** *"is it possible to make playwright test for it?"* unlocked
`tests/e2e/enhance-tool-call-grouping.spec.ts` (3 specs) run against the live container
with system Chrome. The E2E surfaced a real logic bug — a lone `×N` poll double-framed
when leading debug rows got buffered — fixed so **structural** transparents stay bare and
only **reasoning** wraps, then locked with a regression test.

**Phase 6 — Review gates.** *"Is there a skill to review the changes / code"* → *"yes"*
ran `code-quality` (Biome ratchet: fixed a `noExcessiveCognitiveComplexity` by extracting
helpers) and `code-review` (CodeRabbit: 2 minor doc-accuracy nits from mid-work pivots,
both fixed).

**Phase 7 — Ship.** *"ship change"* ran the verify gate (9408 tests), archived + synced
specs (aligning a renamed MODIFIED requirement header so archive could match the base),
opened PR #256, drained a 6-finding CodeRabbit PR round (5 applied, 1 skipped with a
posted rationale), squash-merged (SHA `6f87fcc7`), and removed the worktree.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change enhance-tool-call-grouping`. Effective
  because the proposal already carried the tasks and acceptance criteria; the skill
  self-directs from there. A good kickoff = a well-formed change, not a long prose brief.
- **`run in docker test and check it with faux model`** — high-leverage: shifts from
  unit-green to *real rendered UI* on a deterministic faux backend (no API keys), which
  is where the interesting bugs actually live.
- **`is it possible to make playwright test for it? Playwright can use my system browser`**
  — unlocked durable regression coverage; the hint about the system browser pointed the
  AI at the existing `PW_CHANNEL=chrome` / `PW_E2E_USE_RUNNING=1` harness affordances.
- **`Is there a skill to review the changes / code` → `yes`** — a two-word unlock that ran
  both review gates before commit.
- **`ship change`** — one word that drove the full archive→PR→CI→merge→cleanup pipeline.

Rewrite of the vaguer ask: instead of *"check it with faux model"*, state the target up
front — *"rebuild the docker image so my client changes bake in, then run tests/e2e
against the running container with system Chrome"* — to skip the rebuild-forgot loop.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| stop at unit-green | "run in docker test and check it with faux model" | make live docker+faux verification a standing step of the apply loop |
| verify visually only (ephemeral) | "is it possible to make playwright test for it?" | default new UI behavior to a `tests/e2e/` spec, not a one-off screenshot |
| leave the review implicit | "Is there a skill to review the changes / code" | run `code-quality` + `code-review` before every commit |
| treat "implement done" as done | "ship change" | chain apply → ship as one motion |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was saved this session — it was driven by existing project skills
(`openspec-apply-change`, `code-quality`, `code-review`, `ship-change`) and the docker +
Playwright harnesses. The reusable assets it produced:

- **Two faux scenarios** (`grp-single`, `grp-reasoning` in `qa/fixtures/faux-scenarios.ts`)
  — deterministic, no-API-key replays that exercise single-call grouping and reasoning-in-group.
- **`tests/e2e/enhance-tool-call-grouping.spec.ts`** — 3 specs that lock the framed-group,
  per-kind breakdown, and folded-reasoning behaviors against the live container. Invoke
  whenever the burst-grouping renderer changes.

If anything deserved a memory, it's the **worktree import trap** (below) — a recurring
gotcha worth a project note.

## 7. Pitfalls & dead ends

- **Worktree resolves shared imports to the main repo.** A fresh `.worktrees/<name>`
  checkout has no `node_modules` workspace symlinks, so edits to `packages/shared` don't
  take effect. → `npm ci` inside the worktree, then re-run tsc.
- **Forgot to rebuild the docker image after editing client/scenarios.** The container
  serves a baked bundle; scenario/client edits need `docker` image rebuild before they
  appear. → rebuild the image, not just restart, whenever client or `qa/fixtures` change.
- **Faux/harness degrades after several turns in one run.** Later spawns land on the
  dashboard list and the session never opens — a harness limitation, not your logic.
  → tear down + bring up a **fresh** container and run the suspect spec first/alone to
  distinguish a real bug from flakiness.
- **A `thinking` block sharing a message with a tool call replays unreliably** in faux.
  → author scenarios with the proven trailing-`thinking`+text pattern instead.
- **PATCH `{reasoning:true}` on unseeded prefs hides tool calls.** `setDisplayPrefs`'s
  base default is `toolCalls: false`, so the PATCH poisoned prefs and no group rendered.
  → keep tools visible in the PATCH and reset the container's prefs.
- **BSD `sed` lacks `\|` alternation.** → use `perl -i -pe` for the tasks.md checkbox flips.
- **`biome --changed` finds 0 files in a worktree** (base-detection quirk). → run Biome
  explicitly on the changed file list.
- **OpenSpec archive can't match a renamed MODIFIED requirement header.** Archive locates
  MODIFIED requirements by the existing base header. → align the delta header back to the
  base wording so it applies (the new content still lands).
- **CodeRabbit's literal suggestion can regress the suite.** Restoring a `scrollTo` shim
  to `undefined` broke sibling `EditorFileTree` tests that rely on the leaked global shim.
  → skip that fix, keep the existing leak pattern, and reply on the PR thread with the
  rationale + resolve it.

## 8. Reproduce it faster — checklist

- [ ] Start from a well-formed OpenSpec change; run `/skill:openspec-apply-change <change>`.
- [ ] TDD each task: rewrite tests to the new expectations, then the implementation.
- [ ] In a worktree, `npm ci` before trusting shared-package imports.
- [ ] Rebuild the docker image (not restart) after client / `qa/fixtures` edits.
- [ ] Verify live on docker+faux; then lock behavior in a `tests/e2e/` spec run against
      the running container with system Chrome (`PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome`).
- [ ] Isolate E2E flake by tearing down + fresh-up the container and running the spec alone.
- [ ] Run `code-quality` (Biome + tsc + tests) and `code-review` (CodeRabbit) before commit.
- [ ] `ship change`: verify gate → archive+sync specs → PR → CI → drain CodeRabbit threads
      → squash-merge → remove worktree.

**Inputs to have ready:** the OpenSpec change committed, docker toolchain, a system Chrome
for Playwright, gh authenticated.

**Final artifacts:** PR [#256](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/256)
squash-merged (SHA `6f87fcc7`); `ToolBurstGroup.tsx`, `group-tool-bursts.ts`, `tool-summary.ts`,
the `toolGroupDefaultCollapsed` pref, `tests/e2e/enhance-tool-call-grouping.spec.ts`, two faux
scenarios; specs archived → `openspec/changes/archive/2026-07-07-enhance-tool-call-grouping/`.

---

_Generated from session `019f3cdf-b399-7207-9fff-0ad50c0a0a0c` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-07. Source extract: deterministic facts sheet._
