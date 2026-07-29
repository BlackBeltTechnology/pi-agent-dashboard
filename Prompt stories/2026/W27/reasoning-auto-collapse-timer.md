---
session: 019f2ca1
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [reasoning-auto-collapse-timer]
proposal_excerpt: "The reasoning-display capability (archived `2026-03-24-reasoning-display`) renders a finished reasoning block **collapsed the instant it finishes**. This is not a timer — it is a mount swap. While the model streams th…"
---

# How we did it: reasoning-auto-collapse-timer — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change reasoning-auto-collapse-timer`. No prose — the entire spec of intent lived in the OpenSpec change already on disk. The **real** objective, once the tasks were read: replace the instant "mount-swap" collapse of a finished reasoning block with a genuine **timer** — a live reasoning block stays open while it streams, holds open for a user-configurable window after it finishes (default 30 s, `0` = never auto-collapse), then collapses; and a *replayed/rehydrated* block still renders collapsed with no flash-open. This required a new preference (`reasoningAutoCollapseMs`), server persistence + legacy backfill, a **provenance flag** (`streamedLive`) so the reducer can tell a live stream from a replay, the timer UI itself, a settings control, and full test coverage. Two later prompts steered it from "implement" → "add Playwright/Docker E2E" → "ship it."

## 2. TL;DR playbook

1. **Read the whole spec first.** `cat` the change's `proposal.md`, `design.md`, and `tasks.md` before touching code — the design already dictated the schema, the provenance flag, and the streaming-vs-replay split.
2. **Work bottom-up through the layers:** shared preference schema → server persistence + legacy backfill → reducer provenance flag → component timer → settings UI → tests. Each layer got its unit tests *in the same step*.
3. **Add the provenance flag as an options arg**, not a positional param: `reduceEvent(state, event, { isLive })`. A bare 3rd positional silently breaks every `Array.reduce(reduceEvent, …)` call site (reduce passes `index:number` there).
4. **In a worktree, run `npm ci` before trusting `tsc`.** Without worktree `node_modules`, TypeScript resolves workspace packages to the **stale main-repo** copy and you'll chase phantom "field doesn't exist" errors.
5. **Gate quality on your *authored* files, not the whole repo.** `biome --changed` can't diff an uncommitted worktree; run biome explicitly on the new/small files — huge pre-existing files (`event-reducer.ts`) drown the signal with unrelated warnings.
6. **For E2E, reuse the existing faux scenario.** `[[faux:thinking-text]]` already streams `thinking_start/delta/end` through the live event path — no LLM key needed (`PI_E2E_SEED=1`). Add `data-testid`s, PATCH `reasoning:true` + a short `reasoningAutoCollapseMs` before the prompt.
7. **Pre-build the Docker image manually** when the first cold build exceeds globalSetup's 180 s health window, then attach the spec via `PW_E2E_PORT`.
8. **Ship via the ship-change discipline:** verify gate (build + full suite) → `openspec archive` (syncs specs) → commit → PR → watch CI → wait out CodeRabbit rate-limit → squash-merge → clean up the worktree from the parent repo.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read the spec, map the code).** The AI `cat`'d proposal/design/tasks, then grepped for the exact seams: `thinking_start/thinking_end`, `reduceEvent`, `ChatMessage`, `DisplayPrefs`, the settings `NumberField`. *Why it worked:* the OpenSpec design had already made the hard architectural calls (provenance flag, streaming-collapsed state), so discovery was about *locating* the seams, not inventing them.

**Phase 2 — Implement bottom-up.** Shared schema (`display-prefs.ts`, all 3 presets default `30000`) → server merge + `backfillDisplayPrefs` helper → reducer `streamedLive` stamp → a full `ThinkingBlock.tsx` rewrite for the timer → a seconds `NumberField` in settings (stored as ms). Each task shipped with its unit tests. *Decision point:* the AI extracted `backfillDisplayPrefs` as a helper specifically to keep `createPreferencesStore`'s complexity under the Biome ceiling rather than inlining another branch.

**Phase 3 — Fight the worktree toolchain.** `tsc` failed with "field doesn't exist" — the AI traced it to the worktree lacking `node_modules`, so TypeScript resolved `pi-dashboard-shared` to the stale main-repo copy. Running `npm ci` in the worktree fixed resolution. Separately, the new 3rd param to `reduceEvent` broke `.reduce(reduceEvent, …)` call sites; the AI wrapped those behavior-preservingly.

**Phase 4 — Steered into E2E.** Human asked "*Is it possible to test with playwright and docker test*." The AI discovered the existing `[[faux:thinking-text]]` faux scenario streams reasoning through the live path, added `data-testid`s, and wrote two specs (held-open-then-collapse + `ms=0` stays open). *Decision point:* the cold Docker build blew past the 180 s health timeout, so the AI pre-booted the container with `docker/test-up.sh` and attached via `PW_E2E_PORT=18026`.

**Phase 5 — Ship.** Human: "*I will test later, ship-change*." The AI ran the verify gate, hit a **pre-existing** `node-electron-resolution` failure (confirmed untouched by the diff, Linux-CI-only), archived the change — which required normalizing a stale `## ADDED Requirements` delta header in the main spec — committed, opened PR #235, waited out CodeRabbit's rate-limit for a real review (0 actionable), squash-merged, and cleaned up the worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change reasoning-auto-collapse-timer`. Effective *because the spec carried the intent*: a well-formed OpenSpec change means the kickoff can be one line. The lesson for a future operator: **invest the detail in proposal/design/tasks, not the chat prompt.**
- **High-leverage follow-up #1** — "*Is it possible to test with playwright and docker test*." A question, not a command, but it unlocked a whole verification phase. Stronger version: "*Add a Playwright E2E using the existing faux reasoning scenario; PATCH a short auto-collapse window first.*"
- **High-leverage follow-up #2** — "*I will test later, ship-change*." Short, decisive: it deferred manual QA and handed off to the ship discipline in one breath. This is the ideal shape of a ship prompt — it names the deferral *and* the next skill.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at unit tests and call the feature done | "Is it possible to test with playwright and docker test" | Naming the E2E expectation up front — spec the browser-level acceptance test as a task, not an afterthought |
| Treat remaining optional/manual tasks as blockers | "I will test later, ship-change" | Marking tasks `(Optional)` / `(Manual)` in tasks.md so the ship skill knows what to defer vs. stop on |
| Assume the worktree toolchain matched main | (self-corrected) | Running `npm ci` in a fresh worktree *before* the first `tsc`/test run |
| Run repo-wide quality gates and drown in pre-existing noise | (self-corrected) | Scoping Biome to authored files; treating huge pre-existing files' warnings as out-of-scope |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this session *consumed* existing project discipline (`openspec-apply-change`, `ship-change`, the faux E2E harness). Two workflow lessons are worth persisting:

- **Worktree toolchain gotcha** — "in a git worktree, `tsc` resolves workspace packages to the stale main-repo copy until `npm ci` runs in the worktree." A high-value project memory; it cost several diagnostic commands here.
- **Provenance-flag-as-options** — passing a new reducer param as `{ isLive }` instead of a positional arg avoids silently breaking `Array.reduce` call sites. A reusable code-convention note.

Both are strong candidates for a project memory so the next worktree change doesn't rediscover them.

## 7. Pitfalls & dead ends

- **Stale package resolution in worktrees.** `tsc` reported a just-added field as missing → root cause was the worktree having no `node_modules`; workspace imports resolved to the main repo. **Fix:** `npm ci` in the worktree.
- **`reduceEvent` 3rd positional param.** `Array.reduce(reduceEvent, …)` passes `index:number` as the 3rd arg. **Fix:** make it an options object `{ isLive }` and wrap bare reduce call sites.
- **Auto-collapse effect fired on the *streaming* block.** The mount effect force-collapsed live blocks. **Fix:** gate the auto-collapse machinery to non-streaming blocks only.
- **Docker cold build vs. 180 s health timeout.** First build (`npm install && npm run build`) exceeds globalSetup's window; RUN layers only cache on completion, so it never finished in time. **Fix:** pre-boot with `docker/test-up.sh` (no timeout), then attach via `PW_E2E_PORT`.
- **`openspec archive` aborted on a malformed main spec.** A prior archive left a `## ADDED Requirements` delta header inside `reasoning-display/spec.md`, so requirements sat outside `## Requirements`. **Fix:** normalize the header to `## Requirements`, then re-archive.
- **`gh pr merge --delete-branch` errored on the local branch.** Known worktree pitfall — the local branch can't be deleted while `develop` is checked out in the parent. The *server-side merge still succeeded*; delete the remote branch explicitly and `git worktree remove` from the parent.
- **`node-electron-resolution.test.ts` fails locally.** Asserts a packaged-app node path (`/Applications/PI-Dashboard.app/…`) absent on a dev machine. Pre-existing, deterministic, Linux-CI-only — **not a blocker**; confirm your diff touches no electron/tool-registry files.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a well-formed OpenSpec change (proposal + design + tasks); a git worktree for the change; Docker running; system Chrome (`PW_CHANNEL=chrome`) to skip the chromium download.

**Checklist:**
1. `cat` proposal.md / design.md / tasks.md — absorb the schema, provenance flag, and streaming-vs-replay split before coding.
2. `npm ci` in the worktree (avoids stale-package `tsc` failures).
3. Implement bottom-up: shared schema → server persist + legacy backfill → reducer provenance (`{ isLive }`) → component timer → settings control → tests-per-layer.
4. Gate the streaming block out of the auto-collapse effect.
5. Run `tsc` + targeted vitest; scope Biome to authored files.
6. E2E: add `data-testid`s, drive `[[faux:thinking-text]]`, PATCH `reasoning:true` + short `reasoningAutoCollapseMs`; pre-boot Docker via `docker/test-up.sh`, attach with `PW_E2E_PORT`.
7. Ship: verify gate → `openspec archive` (normalize any stale delta header first) → commit → PR → watch CI → wait out CodeRabbit rate-limit → squash-merge → `git worktree remove` from parent + delete remote branch.

**Final artifacts:** `packages/client/src/components/ThinkingBlock.tsx` (timer), `packages/shared/src/display-prefs.ts` (`reasoningAutoCollapseMs`), `packages/server/src/preferences-store.ts` (persist + backfill), `packages/client/src/lib/event-reducer.ts` (`streamedLive`), `tests/e2e/reasoning-auto-collapse.spec.ts`, PR #235 (merged, sha `0a48ccd`).

---

_Generated from session `019f2ca1-c7e5-7d80-bd0b-3abc6e68c45e` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-04. Source extract: `/tmp/facts-11932-1784849431.md`._
