---
session: 019f548b
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [instrument-event-store-trim]
proposal_excerpt: "`fix-stuck-tool-card-on-dropped-event` instrumented the two transport **drop** hops (server→browser fanout back-pressure, bridge→server ring eviction) and surfaced them on `GET /api/health#droppedFrames`. But the thir…"
---

# How we did it: Instrument event-store trim on /api/health — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single slash command:

```
/skill:openspec-apply-change instrument-event-store-trim
```

The real objective: take an already-designed OpenSpec change (`instrument-event-store-trim`)
and *implement it end to end*. A prior change had instrumented two transport **drop** hops and
exposed them at `GET /api/health#droppedFrames`; this change adds the **third** missing hop —
the in-memory event store's own trim/evict — as a new additive `storeTrim` telemetry field on
`/api/health`. The whole thing is telemetry only: no behavior, protocol, or cap change. One
later steering turn ("I will tests later, ship-change") flipped the session from *implement* to
*ship*: land the PR now, defer the single post-deploy live-observation task.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change-name>` — let the apply skill select the change and load its proposal/design/tasks.
2. Read every source file the tasks touch **before editing** (`memory-event-store.ts`, `system-routes.ts`, `server.ts`) so edits match exact anchors.
3. Implement store-first: add closure counters + a `getTrimStats()` handle, then surface the field on `/api/health` mirroring the existing `droppedFrames` shape.
4. Write the store unit tests and a health-shape test **mirroring the sibling `droppedFrames` test** — reuse the proven pattern, don't invent a new one.
5. Run the change's own tests in isolation with an ephemeral HOME (`HOME=$(mktemp -d) npx vitest run --root packages/server …`) to prove they pass, separate from flaky full-suite timeouts.
6. Prove your diff is isolated: `git diff --stat`, scope `biome`/`tsc` to your changed files/lines, and confirm pre-existing failures live in files you never touched.
7. Update the directory `AGENTS.md` rows for the edited source files (source-tree rows → edit directly).
8. On "ship": build gate → `openspec archive` **without `--skip-specs`** when the change adds a spec requirement → commit with `git commit -F` → push → open PR against `develop`.
9. Watch CI, triage CodeRabbit findings against the design (apply the valid one, skip the design-justified ones with a written rationale), then squash-merge and clean up the worktree manually.

## 3. How the collaboration unfolded

**Phase 1 — Load context (apply skill).** The AI ran the openspec-apply skill, which resolved
the change, printed its status, and read the proposal/design/tasks plus the three source files
it would modify. *Why it worked:* reading the health handler and the `server.ts` call site up
front meant every subsequent `edit` matched a real anchor on the first try (one arrow-char edit
missed and was re-narrowed immediately).

**Phase 2 — Implement store-first.** Edits landed in dependency order: counters +
`evictIfNeeded`/`trimBufferToLimit` return values + `getTrimStats()` in the store, then the
`storeTrim` field on `system-routes.ts` and its wiring in `server.ts`. The `tool_execution_end`
tally was folded into the **same single O(n) trim pass** to preserve the
`preserve-chat-head-on-event-trim` contract. *Decision point:* keep it purely additive and
cumulative (counters never reset), matching the design.

**Phase 3 — Test, mirroring the sibling.** New store unit tests + a health-shape test cloned
from the existing `droppedFrames` shape test. *Why it worked:* the health route already had a
proven test idiom; copying it kept the new assertions consistent and cheap.

**Phase 4 — Prove isolation against a flaky suite.** The full `npm test` showed 14 failing
files. The AI did **not** assume its change broke them — it re-ran the affected files in
isolation with a single fork and ephemeral HOME, showing every failure was a 5000ms
server-startup timeout under parallel contention on a loaded machine, and its own new
`storeTrim` test was never among them. It then scoped `tsc --noEmit` and `biome` to only its
changed files/lines to prove it introduced zero new type or lint issues (pre-existing warnings
lived in `image-fit-extension` and untouched functions).

**Phase 5 — Ship (steering turn #1).** On "I will tests later, ship-change", the AI marked the
lone post-deploy verify task deferred, ran the build gate, archived the change (correcting an
accidental `--skip-specs` because this change *adds* a spec requirement), committed with `-F`,
pushed, and opened PR #280.

**Phase 6 — CI + CodeRabbit triage.** CI went green (10m22s). CodeRabbit raised 3 actionable
findings that failed to post inline (embedded in the review body). The AI triaged each against
the design: **applied** the one real bug (`trimmedEventsBySession` Map leaked entries after
evict/delete, contradicting design D1 — added a lifecycle-cleanup test), and **skipped** two
with written design rationale (try/catch would break intentional symmetry with `droppedFrames`;
throwing-provider test only matters if that try/catch is added). Round-2 CI green (9m55s),
GraphQL confirmed 0 unresolved threads, squash-merged. The worktree `gh pr merge` local
branch-switch failed (parent worktree lock) but the remote merge succeeded — cleaned up
branch + worktree manually.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change instrument-event-store-trim`. Effective because
  the heavy lifting (scope, design decisions D1–D3, task list) already lived in the OpenSpec
  change. A one-line slash command was enough kickoff; the skill supplied the rest.
- **High-leverage follow-up** — `I will tests later, ship-change`. Short, but it did two things at
  once: authorized deferring the single non-code verify task, and switched the workflow from
  implement to the full ship pipeline (archive → commit → PR → CI → merge → cleanup). One clause
  unlocked the entire back half of the session.

*Rewrite for next time:* make the defer explicit — e.g. "defer the post-deploy verify task (5.1),
ship-change now" — so the AI never has to infer which task you mean.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the full suite's flaky timeouts as its own regression | (self-corrected, no human turn) | State up front: "full suite has known parallel-startup timeouts; prove *your* files in isolation with `HOME=$(mktemp -d)`" |
| Want to run the flaky full suite again before shipping | "I will tests later, ship-change" | Say "test later" explicitly to skip the re-run; the change's own tests + CI cover it |
| Archive with `--skip-specs` | (self-caught) | Remember: a change that **adds a spec requirement** must sync the delta — never `--skip-specs` |
| Apply every CodeRabbit finding | (self-triaged) | Triage against the design: apply real contract violations, skip anything that breaks intentional symmetry — with a one-line rationale each |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session rode entirely on existing project skills
(`openspec-apply-change`, `implement`, `ship-change`) and the directory-`AGENTS.md` doc protocol.
That is itself the lesson: a well-scoped OpenSpec change plus the apply/ship skills is enough to
carry a telemetry-only feature from slash-command to merged PR with no bespoke tooling.

*If you repeat this shape often:* the "prove-your-diff-is-isolated-against-a-flaky-suite" move
(re-run affected files with ephemeral HOME + single fork, scope biome/tsc to changed lines) is a
reusable procedure worth capturing as a debug/verify skill.

## 7. Pitfalls & dead ends

- **Full-suite timeouts ≠ your regression.** `npm test` showed 14 red files; all were 5000ms
  `createTestServer()` startup timeouts under parallel load. Re-run affected files alone with
  `HOME=$(mktemp -d) npx vitest run --root packages/server … --pool=forks --poolOptions.forks.singleFork=true` to confirm.
- **`biome check --changed` returned 0 files** in the worktree (base-branch diff resolution). Fall
  back to `biome check` on the explicit changed file paths.
- **Pre-existing tsc noise.** `tsc --noEmit` reports errors in `image-fit-extension` and package
  config quirks — filter them out (`grep -v image-fit`) and confirm none are in your files.
- **`openspec archive --skip-specs` drops a spec delta.** This change adds a requirement to
  `incremental-event-sync`; archive *without* `--skip-specs` so the delta syncs, then verify the
  requirement landed in `openspec/specs/…`.
- **`git commit` with backticks in the message** — use `git commit -F <file>` to avoid shell
  interpolation.
- **Worktree `gh pr merge` fails the local branch-switch** (target branch checked out in the
  parent worktree). The remote merge still succeeds — verify with `gh pr view --json state,merged`,
  then delete the remote branch and `git worktree remove` from the parent manually.

## 8. Reproduce it faster — checklist

- [ ] Have the OpenSpec change ready with proposal + design (decisions numbered) + tasks.
- [ ] `/skill:openspec-apply-change <change-name>`.
- [ ] Read all target source files before editing; match existing sibling patterns (`droppedFrames`).
- [ ] Implement additive/telemetry-only; keep the trim tally in the existing O(n) pass.
- [ ] Add tests mirroring the sibling health-shape test.
- [ ] Prove isolation: run your files with `HOME=$(mktemp -d)` + single fork; scope biome/tsc to changed lines.
- [ ] Update the edited files' directory `AGENTS.md` rows.
- [ ] Ship: build gate → `openspec archive` (NO `--skip-specs` if a spec requirement is added) → `git commit -F` → push → PR vs `develop`.
- [ ] Watch CI; triage CodeRabbit against the design (apply real bugs, skip design-justified with rationale).
- [ ] Squash-merge; if in a worktree, verify remote merge + clean up branch/worktree manually.

**Key inputs:** a designed OpenSpec change; `gh` auth; CodeRabbit on the repo.
**Artifacts produced:** `memory-event-store.ts`, `system-routes.ts`, `server.ts` + tests edited;
`storeTrim` on `/api/health`; spec requirement synced; PR #280 merged (squash `d73a28fc` → `develop`).

---

_Generated from session `019f548b` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-12. Source extract: facts sheet._
