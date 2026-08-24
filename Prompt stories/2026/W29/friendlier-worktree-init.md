---
session: 019f5b81
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts); large facts sheet (~14371 tok)"
upgrade_status: pending
openspec_changes: [friendlier-worktree-init]
proposal_excerpt: "Worktree init runs in three places, and all three surface their execution badly:"
---

# How we did it: friendlier worktree-init feedback — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single slash command: `/skill:openspec-apply-change friendlier-worktree-init`.
That is the *entire* goal statement — the operator handed the AI an already-drafted OpenSpec
change and said "implement it." The real objective, per the proposal, was: **worktree init
runs in three places (manual button, auto-init on spawn, folder action bar), and all three
surface their execution badly** — silent auto-inits, no running/done/failed feedback, no
survival across a page reload. The change makes worktree-init state a first-class, cwd-keyed,
reload-durable, concurrent-safe piece of UI feedback. Because the spec + tasks.md already
existed, the operator's job was almost entirely **steering the implementation and the ship**,
not describing the feature.

## 2. TL;DR playbook

1. **Kick off with the apply skill against a ready change:** `/skill:openspec-apply-change <name>`. Let the AI read `tasks.md` and drive section-by-section.
2. **Implement server → shared → client in dependency order.** Build the cwd-keyed registry + endpoint first, then the shared protocol types, then the client store/components — each layer typechecks before the next.
3. **Write tests per task, run them isolated with `HOME=$(mktemp -d) npx vitest run <file>`** to dodge home-dir/port flakiness. Reset global singleton stores in `afterEach`.
4. **When the operator asks "can the deferred manual QA become an e2e?", say yes and build it** as a Playwright spec against the Docker harness with `PW_CHANNEL=chrome` (system browser). Add git fixtures for a slow-success hook and a failing hook.
5. **Boot the Docker harness manually** (`docker/test-up.sh`) when Playwright's 180s health cap is shorter than the image build, then attach with `PW_E2E_USE_RUNNING`.
6. **Ship with the `ship-change` skill:** verify gate → archive+sync specs → commit → push → PR against `develop` → watch CI.
7. **Treat repeated red CI as a systemic signal, not whack-a-mole.** The real fix here was one global `afterEach(cleanup)` in the client vitest setup, not per-file patches.
8. **Address every CodeRabbit thread**, re-verify on a *fresh* container (re-used containers accumulate trust + init markers), then squash-merge and remove the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & server core (registry + endpoint).**
The AI read `tasks.md`, `openspec status`, and the existing server/route/client sources, then
implemented in dependency order: a cwd-keyed `Map<cwd, RunState>` registry with
`startRun`/`progressRun`/`finishRun`/`getActiveRuns` (terminal TTL 60s, lazy eviction) plus a
cwd fan-out (`subscribeCwd`/`sendCwd`) alongside the legacy requestId path. It added
`GET /api/git/worktree/active-inits` and a **post-trust gate re-eval** so granting trust on an
edited hook does *not* re-run it. *Why it worked:* building the authoritative state on the
server first meant the client could be a thin `useSyncExternalStore` view.

**Phase 2 — Client feedback (store + components).**
A cwd-keyed store backed by `useSyncExternalStore`, a presentational `WorktreeInitChip` reused
by the button/card/stack, a store-driven `WorktreeInitButton` with a re-trust label, and a
concurrent `WorktreeInitStack`. Tests were written per task and run in isolation.

**Phase 3 — Steering unlock: turn deferred manual QA into an e2e.**
The operator asked *"is it possible the auto-init tests — left unchecked — with e2e docker
test with playwright in system browser?"* and then *"yes."* This converted task 7.4 (a
deferred live-browser manual check) into an automated Playwright spec: two git fixtures
(`sample-hook-ok` slow-success, `sample-hook-fail`), `docker/test-entrypoint.sh` git-inits
them, and the spec drives real Chrome via `PW_CHANNEL=chrome`. *Decision point:* the AI
correctly cited the repo convention ("new browser QA → Playwright specs, not `qa/tests/*.sh`")
to justify the move rather than treating it as a workaround.

**Phase 4 — Harness wrestling.**
The e2e fought infrastructure, not logic: image build exceeded Playwright's 180s health cap
(fixed by booting the harness manually + `PW_E2E_USE_RUNNING`); a fixture name that was a
*prefix* of another (`sample-hook` ⊂ `sample-hook-fail`) matched two PathPicker options
(renamed to `sample-hook-ok`); and re-used containers accumulated trust + `.initialized`
markers, so tests only passed deterministically on a **fresh** container.

**Phase 5 — Ship & the CI cleanup saga.**
`ship-change` archived+synced specs (after fixing an ADDED-vs-MODIFIED delta-spec mismatch),
opened PR #303 against `develop`, and hit **four** red CI rounds. Each red was a client test
in a file the AI never touched (`ChatView.copy-fidelity`, `faux-renderers`), failing with
`window is not defined` from React's scheduler firing after jsdom teardown. Root cause: the 4
new test files shifted `pool:forks` scheduling and surfaced a latent leak in ~40 client specs
that never unmount their React trees. *The winning move:* one **global `afterEach(cleanup)`**
in the client vitest setup (verified safe because no client spec renders in `beforeAll`),
which superseded the earlier per-file patch. A `develop` merge-conflict on an `AGENTS.md` tree
row was union-merged. CI went green; squash-merged; worktree removed.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change friendlier-worktree-init`.** Effective
  because the change was fully drafted (proposal + spec + tasks.md). A one-line skill invocation
  against a ready change is the highest-leverage kickoff in this repo: the AI reads the tasks and
  self-drives. *Reuse it as-is when a change is ready.*
- **`ship-change`** — a single word that triggers the full land pipeline (verify → archive →
  PR → CI watch → CodeRabbit → merge → cleanup). High leverage: it turned "I'm done coding"
  into a merged PR without further per-step prompting.
- **The e2e unlock: "is it possible the auto-init tests … with e2e docker test with playwright
  in system browser?" → "yes".** A short, exploratory question that unlocked a whole extra
  deliverable. *Stronger version to reuse:* "Convert the deferred manual QA task into a
  Playwright e2e against the Docker harness using system Chrome (`PW_CHANNEL=chrome`)."
- **"how to enable autoinit?"** — a mid-implementation clarification that surfaced the exact
  UX contract (Settings → Sessions toggle, TOFU-trust gate, `autoInitWorktreeOnSpawn` pref).

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at the tasks.md line (7.4 = "deferred manual browser check") | Asking "can that be a Playwright e2e in system browser?" | Stating up front: "any deferred manual QA that *can* be a Playwright e2e, make it one" |
| Leave auto-init behavior implicit | Asking "how to enable autoinit?" | Documenting the enable path (Settings toggle + TOFU + pref key) in the proposal's UX section |
| Finish coding and pause | Saying `ship-change` | Chaining apply → ship as the default end-state when all non-manual tasks are green |
| Re-verify e2e on a *re-used* container (accumulated trust + markers) | (self-corrected) demand a fresh container per definitive run | Always boot a fresh harness for the final e2e run; never trust a re-used container's pass/fail |
| Patch CI flakes per-file (whack-a-mole) | (self-corrected after 3 rounds) root-cause the scheduling shift | When ≥2 *untouched* files fail the same way, look for a systemic fix (global cleanup), not per-file patches |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created in this session — the work rode existing repo skills
(`openspec-apply-change`, `ship-change`) and conventions. What's worth capturing as reusable
knowledge:

- **The global-cleanup pattern for jsdom React tests.** *Problem it solves:* adding test files
  shifts `pool:forks` scheduling and surfaces latent "un-unmounted React tree fires after jsdom
  teardown" (`window is not defined`) failures in *other* files. *Fix:* a global
  `afterEach(cleanup)` in the client vitest `setupFiles` — safe iff no spec renders in
  `beforeAll`. *When to invoke:* any CI red where untouched client specs fail with a
  scheduler/`window`-undefined error after you added test files. This deserves a project memory.
- **System-browser e2e recipe.** `PW_CHANNEL=chrome` + manual harness boot (`docker/test-up.sh`)
  + `PW_E2E_USE_RUNNING` to bypass Playwright's 180s health cap on slow image builds. Reusable
  any time an e2e's build exceeds the health window.

## 7. Pitfalls & dead ends

- **Worktree symlink hides `packages/shared` edits from bare `tsc`.** The worktree resolves
  `@blackbelt-technology/*` to the *main repo's* shared via a hoisted symlink, so plain `tsc`
  doesn't see worktree shared edits (vitest's alias does). Known limitation — the type gate
  resolves correctly at merge; don't chase it as a bug.
- **Playwright 180s health cap < Docker image build.** Boot the harness manually and attach with
  `PW_E2E_USE_RUNNING` instead of letting `globalSetup` time out.
- **Fixture name prefixes collide in the PathPicker.** `sample-hook` matched both itself and
  `sample-hook-fail`. Give fixtures non-prefix names (`sample-hook-ok`).
- **Re-used containers accumulate state.** Prior runs leave TOFU trust + `.initialized` markers,
  so tests pass/fail nondeterministically. Boot a **fresh** container for the definitive run.
- **`docker restart` degrades the session-spawn harness** (tmpfs re-seed + cold pi-flows jiti
  cache). Tear down and boot fresh rather than restart.
- **BSD `sed` has no `\|` alternation.** Use `perl -i -pe` to bulk-flip tasks.md checkboxes on macOS.
- **`openspec archive` validates delta specs.** A requirement your delta marks MODIFIED must
  already exist in main; if it's new, mark it ADDED. Fix the delta, then re-archive.
- **CI red on files you never touched** is usually a pre-existing flake OR a scheduling-shift
  leak — confirm `develop` is green, then apply the systemic fix.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- A drafted OpenSpec change (`openspec/changes/<name>/` with proposal + spec + tasks.md).
- Docker installed; system Chrome (for `PW_CHANNEL=chrome`).
- `develop` up to date (to pre-empt merge conflicts).

**Steps:**
1. `/skill:openspec-apply-change <name>` — let the AI drive tasks.md.
2. Implement server → shared → client in dependency order; typecheck each layer.
3. Write per-task tests; run isolated with `HOME=$(mktemp -d) npx vitest run <file>`; reset singleton stores in `afterEach`.
4. Convert any deferrable manual QA into a Playwright e2e (git fixtures + `PW_CHANNEL=chrome`); boot the harness manually if the build is slow (`PW_E2E_USE_RUNNING`).
5. Run the final e2e on a **fresh** container.
6. `ship-change` — verify → archive+sync → PR vs `develop` → watch CI.
7. On repeated CI red in untouched client specs: add global `afterEach(cleanup)` to the client vitest setup.
8. Resolve CodeRabbit threads, re-verify fresh, squash-merge, remove the worktree.

**Artifacts produced (merged via PR #303):**
- `packages/server/src/worktree-init-registry.ts` (+ test), `routes/git-routes.ts`, `server.ts`
- `packages/shared/src/browser-protocol.ts` (cwd-carrying subscribe types + `ActiveWorktreeInit`)
- `packages/client/src/lib/{worktree-init-bus,worktree-init-store,auto-init-worktree,git-api}.ts`
- `packages/client/src/components/{WorktreeInitChip,WorktreeInitButton,WorktreeInitStack}.tsx`
- `docker/fixtures/sample-hook-ok/`, `docker/fixtures/sample-hook-fail/`, `docker/test-entrypoint.sh`
- `tests/e2e/worktree-init-feedback.spec.ts` (+ helper testids)
- Global `afterEach(cleanup)` in the client vitest setup; AGENTS.md + FAQ doc rows.

---

_Generated from session `019f5b81` · `pi-agent-dashboard` · 2026-07-13. Source extract: `/tmp/facts-session.XXXXXX.md`._
