---
session: 019f2af0
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "large facts sheet (~13177 tok)"
upgrade_status: pending
openspec_changes: [attribute-openspec-poll-eventloop-stalls]
proposal_excerpt: "Users report the dashboard \"sometimes seems stuck\" — chatlog loading and other interactions freeze for a fraction of a second, intermittently. Live measurement against a running production server (`/api/health`) repro…"
---

# How we did it: Attribute & fix the ~700ms OpenSpec-poll event-loop stall — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with `/skill:openspec-apply-change attribute-openspec-poll-eventloop-stalls` — implement an existing OpenSpec change. The change's real objective: users reported the dashboard "sometimes seems stuck," with chatlog loading and other interactions freezing for a fraction of a second, intermittently. The proposal already suspected the OpenSpec directory poll. But the true goal wasn't "write code from the tasks list" — it was a **measure-first investigation**: instrument the server to *attribute* the recurring event-loop stall to a specific turn, confirm the culprit with live data, then apply the one fix the evidence indicts — and prove the stall class disappears on the live instance.

## 2. TL;DR playbook

1. Run `/skill:openspec-apply-change <change>` and read every context/spec file before touching code.
2. Split the change into **phases by determinism**: Phase 1 (observability) is fully deterministic → build it now with TDD. Phase 0 (live config) and Phase 2 (the fix) are **blocked on real attribution data** → pause and hand back.
3. Build the instrumentation: a bounded ring buffer + a **dedicated** `monitorEventLoopDelay` sampler (never reuse the `/api/health` boot histogram — reset-on-read races), surfaced additively on `/api/health`, plus per-turn `performance.now()` self-records that are **never summed across an await**.
4. Deploy the instrumentation as a **reversible file overlay** into the main checkout (the live server runs from there, not the worktree) + `POST /api/restart`. Keep a one-line revert ready.
5. Let it collect for one poll interval, then `poll` the live `/api/health`, merging spikes by timestamp so the capacity-50 buffer rotation loses nothing.
6. Read the attribution: 21/21 ticks were `tickOpen`, corroborated by the `turn:null` sampler at matching `:07` timestamps → the culprit is `tickFolderHeads()` doing synchronous `execSync` git-HEAD reads.
7. Apply **only** the indicted fix branch: make folder-head reads async/non-blocking (`execFile` + bounded concurrency), awaited before the openspec fan-out to preserve `git_head_update → openspec_update` ordering.
8. Redeploy the overlay, collect ~3 ticks, prove **0 `tickOpen` spikes** (was 100% reliable) and 0 slow-turn log warnings while ticks keep firing.
9. Revert the overlay (restore clean `develop`, preserve the user's unrelated dirty work), then `/skill:ship-change` to rebase-clean, PR, watch CI, and squash-merge.

## 3. How the collaboration unfolded

**Phase A — Discovery & phase-split (deterministic vs blocked).** The AI read all context and spec files, mapped the poll wiring (`directory-service.ts`, `server.ts`, `folder-head-poll.ts`), and made the key call: this is a two-phase *measure-first* change. It refused to guess the fix and instead scoped Phase 1 (observability) as the only deterministic work, pausing Phase 0/2 on live data. *Why it worked:* separating "what I can build blind" from "what needs evidence" prevented a speculative fix.

**Phase B — Build the instrumentation (TDD).** New `eventloop-spike-metrics.ts` (newest-first ring buffer) and `eventloop-sampler.ts` (dedicated ELD histogram), wired into `server.ts`, surfaced additively + failure-isolated on `/api/health`, with per-turn records in `directory-service.ts` for `tickOpen`/`dirPollPre`/`dirPollPost`. A test proved pre/post-await are *separate* turns. *Decision point:* a flaky sampler test led to debugging the libuv histogram commit delay — the AI proved the reset-on-read race only occurs when sample cadence ≈ histogram resolution, and that production's 1000ms cadence is safe, then made the test use a realistic cadence rather than deleting the assertion.

**Phase C — Deploy overlay + collect (human: "prepare the deploy" → "poll").** The AI discovered the live server runs from the **main checkout on `develop`** (dirty with unrelated kb-plugin work), not the worktree (empty `node_modules`). It chose a **reversible measurement overlay**: copy only the 5 runtime files into the main checkout, restart, keep a one-line revert. On "poll," it merged spikes by timestamp across samples.

**Phase D — Attribution & the one fix.** Live data: 21/21 ticks were `tickOpen` at 640–705ms every 180s, corroborated by the sampler's `turn:null` spikes at the same timestamps. That indicted `tickFolderHeads()` — 3 synchronous `execSync` git spawns × ~11 folders ≈ 33 blocking subprocesses per turn. The AI implemented **only** branch 3.1 (async `readHeadDisplayAsync` via `execFile` + `mapBounded`), preserving ordering, and marked the alternative branches N/A per the tasks' explicit "implement ONLY the branch 2.1 indicts."

**Phase E — Verify live, revert, ship (human: "use ship-change skill").** Redeployed, collected ~3 ticks → **0 `tickOpen` spikes**, 0 slow-turn warnings, ticks still firing. Reverted the overlay cleanly (user's dirty work untouched). `ship-change` caught a **stale branch base** carrying 3 unrelated proposal commits and rebased `--onto origin/develop` to drop them, then PR #228 → CI green → squash-merge.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change attribute-openspec-poll-eventloop-stalls`. Effective because the change already carried a measure-first design; the skill + spec did the heavy scoping. A future kickoff is stronger if it names the invariant up front: *"apply this change; it's measure-first — don't apply any fix branch until live attribution data indicts one."*
- **`prepare the deploy`** — high-leverage: it forced the AI to discover the live-server launch topology (main checkout, not worktree) and design the reversible overlay before acting.
- **`poll`** — one word that triggered the timestamp-merged live collection loop; the AI already knew what to gather.
- **`use ship-change skill`** — delegated the entire land-it pipeline; the skill caught the stale-base pollution the human never had to think about.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after Phase 1 and wait | "prepare the deploy" | State up front that deploy+collect is in-scope, not just code |
| Wait passively for data to accrue | "poll" | Pre-agree a collection window (e.g. one poll interval) and auto-poll |
| Leave landing implicit | "use ship-change skill" | Name the ship skill in the kickoff so PR/CI/merge is automatic |

Self-imposed quality bars the AI held without prompting (worth keeping as guardrails): additive `/api/health` fields only; per-turn timings **never summed across an await**; the reversible overlay with a one-line revert; not clobbering the user's unrelated dirty `develop` work; implementing **only** the indicted fix branch and marking the rest N/A.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the workflow rode existing skills (`openspec-apply-change`, `ship-change`) and one `general-purpose` subagent to write `docs/architecture.md` in caveman style (Rule 6). That subagent delegation is the effective, reusable move: docs prose under `docs/` is always handed to a subagent with the caveman rule verbatim so the main agent never edits prose directly.

*Recommended skill to create:* a **`measure-first-eventloop-attribution`** procedure capturing the reusable pattern — dedicated `monitorEventLoopDelay` sampler (never the boot histogram), per-turn `performance.now()` self-records that don't cross awaits, reversible overlay deploy into the live main checkout, timestamp-merged `/api/health` polling, and the "implement only the branch the data indicts" discipline.

## 7. Pitfalls & dead ends

- **Sampler test flake:** reusing/resetting a histogram at a cadence ≈ its resolution races libuv's delayed commit → reads 0. *Fix:* dedicated instance + realistic (1000ms) cadence; don't delete the assertion, make it deterministic with an injected fake histogram plus one lenient real-block check.
- **Wrong deploy target:** the worktree can't run standalone (empty `node_modules`); the live server runs from the **main checkout on `develop`**. *Fix:* overlay the runtime files into the main checkout and restart — after confirming they're byte-identical to live `develop` so the copy is purely additive.
- **Stale branch base:** the branch carried 3 unrelated OpenSpec proposal commits not on `origin/develop`. *Fix:* `git rebase --onto origin/develop` after confirming zero file overlap.
- **Full-suite flakes:** `doctor-route`, `event-wiring-source-stamp`, and Jimp `resize.test.ts` fail under parallel load but pass in isolation; `node-electron-resolution` fails on clean develop too. *Don't* treat these as your regression — prove them pre-existing/environmental in isolation.
- **CodeRabbit rate-limited** ("Review limit reached") — advisory, warn-and-continue, never blocks; re-run in the PR later.
- **Worktree-removal collision:** removing the worktree deletes the running session's cwd; do it as the final action.

## 8. Reproduce it faster — checklist

- [ ] Read all spec/context files; split the change into deterministic vs data-blocked phases.
- [ ] Build the observability phase with TDD: dedicated ELD sampler + ring buffer + additive `/api/health` field + per-turn `performance.now()` records (never across awaits).
- [ ] Confirm the live-server launch path (main checkout vs worktree); verify target files match live `develop`.
- [ ] Deploy a reversible overlay + `POST /api/restart`; keep the one-line revert handy.
- [ ] Collect ≥1 poll interval; `poll` `/api/health`, merging spikes by timestamp.
- [ ] Read attribution (turn name + corroborating `turn:null`); implement **only** the indicted fix branch; mark alternatives N/A.
- [ ] Redeploy; prove the spike class is gone (before: 100% of ticks; after: 0) with logs showing ticks still fire.
- [ ] Revert the overlay (preserve unrelated dirty work); run `/skill:ship-change` → rebase-clean → PR → CI → squash-merge.

**Inputs to have ready:** running production dashboard on `:8000` (`/api/health`, `/api/restart`, `/api/config`), the OpenSpec change with a measure-first design, worktree + main checkout both present.

**Artifacts produced:** `packages/server/src/eventloop-sampler.ts`, `eventloop-spike-metrics.ts`, edits to `directory-service.ts` / `server.ts` / `routes/system-routes.ts` / `git-operations.ts` / `folder-head-poll.ts`, updated `docs/architecture.md` + AGENTS rows; merged via PR #228 (squash `d072de41`).

---

_Generated from session `019f2af0-7821-74cb-9b95-daef2f33ac77` · `pi-agent-dashboard` · 2026-07-04. Source extract: `/tmp/facts-session.md`._
