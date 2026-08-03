---
session: 019e9993
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (9 user prompts); large facts sheet (~11642 tok)"
upgrade_status: pending
openspec_changes: [auto-hide-headless-worker-sessions]
proposal_excerpt: "Skills that fan work out across many headless pi subprocesses (e.g. `parallel-pi-model-workers` running `pi --model M -p \"…\"` ×N) flood the dashboard sidebar with one session card per worker. Each worker is a real pi…"
---

# How we did it: auto-hide headless worker sessions — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change auto-hide-headless-worker-sessions`.
The real objective, spelled out by the attached OpenSpec proposal, was to stop headless
pi subprocesses (e.g. `parallel-pi-model-workers` spawning `pi --model M -p "…"` ×N) from
flooding the dashboard sidebar with a card per worker. Concretely: sessions with no UI
that aren't launched from the dashboard should **auto-hide on first registration**, a
manual unhide must **survive reattach** (one-shot behaviour), and explicit
`PI_DASHBOARD_HIDDEN` / `PI_DASHBOARD_VISIBLE` env vars must override the heuristic. The
session then carried the change all the way through: implement → isolated browser
verification → archive → rebase → PR → CodeRabbit fixes → merge → worktree cleanup.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — let the apply skill drive the task list; it reads the proposal/design and follows pre-recommended decisions.
2. Implement as **small pure helper modules** with unit tests (`visibility-intent.ts` + `.test.ts`), and put the state decision in the **single writer** (`memory-session-manager.register()`), not scattered across the register path.
3. `npx tsc --noEmit` after edits — in a worktree, run `npm install` first so `@blackbelt-technology/*` resolves to worktree packages, not the parent repo.
4. Revert incidental churn (`package-lock.json`, `.pi/settings.json`) before committing — keep the diff surgical.
5. For the manual UI tasks, stand up a **fully isolated dashboard**: temp `HOME`, custom ports (8123/9123), `--no-tunnel`, `autoStart:false`, and `PI_DASHBOARD_NO_MDNS=1` — never touch the live server on 8000.
6. Drive the **real protocol** (crafted `session_register` WS messages) instead of spawning real LLM workers; assert via the browser `sessions_snapshot` + UI toggles.
7. `/skill:openspec-archive-change <change>` — expect to fix pre-existing spec-corruption (stray `## ADDED Requirements` headers, missing SHALL) to satisfy the stricter parser.
8. `rebase develop` → commit → push → open PR → monitor CI to green.
9. `fix coderabbot issues`: verify each thread against live code, fix the valid ones (trust-boundary normalization, explicit env parse), reply-and-skip the false positives with rationale.
10. `merge` → `cleanup worktree` (from the **main repo**, `--force` to drop build artifacts, then delete local+remote branch and prune).

## 3. How the collaboration unfolded

**Phase 1 — Implement (spec-driven apply).** The AI read the change's context files, followed
the design's pre-recommended decisions (two booleans, VISIBLE wins), and threaded
`hasUI`/`visibilityIntent` from bridge → gateway → session manager. It extracted a pure helper
`buildVisibilityRegisterFields()` so the logic was unit-testable, and located the *single writer*
of `hidden` (`memory-session-manager.register()`) so first-register vs reattach could be
distinguished via `registerReason`. Why it worked: matching the codebase's "small pure helper +
targeted unit test" pattern kept the change reviewable and testable.

**Phase 2 — Isolated browser verification.** The human steered: "create isolated environment…
test dashboard with browser" and "do not autostart dashboard… to avoid mdns". The AI built a
temp-`HOME`, custom-port, tunnel-less server and — crucially — chose to drive the **real
`session_register` protocol over WebSocket** rather than spawn credentialed LLM workers. It
verified all 8 crafted cases (hidden/visible/override/reattach) through the real server + client
UI, then tore everything down. Decision point: when the AI found no server-side mDNS off switch,
it added a small `PI_DASHBOARD_NO_MDNS` env guard and flagged it as separable test-infra.

**Phase 3 — Archive (fighting legacy spec rot).** `openspec archive` kept aborting on
**pre-existing** corruption in canonical specs (4 stray `## ADDED Requirements` blocks, a
missing `## Requirements`/`## Purpose` section, a requirement lacking SHALL). The AI made
minimal meaning-preserving normalizations to *only the blocking file*, and recovered from a
partial run that had leaked requirements to disk before aborting.

**Phase 4 — Ship.** `rebase develop` (branch had no commits ahead → stash, fast-forward, pop),
commit, push, PR #83, watch CI to green. Then `fix coderabbot issues`: 5 threads triaged →
3 fixed (trust-boundary input normalization, explicit env parse, spec wording), 2 skipped as
false positives with rationale posted to the threads. Merge (repo uses merge commits), then
worktree cleanup from the main repo.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change auto-hide-headless-worker-sessions`. Effective because the change already had a proposal/design/tasks; the skill drives itself. Stronger form when no change exists yet: run the openspec new/plan flow first so apply has a task list.
- **`create isolated environment, means separate directory, ports and test dashboard with browser`** — high leverage: forced true isolation instead of a risky test against the live server, and unlocked the real-protocol verification approach.
- **`do not autostart dashboard in settings to avoid mdns`** — one line that surfaced a real network-safety gap and produced the reusable `PI_DASHBOARD_NO_MDNS` guard.
- **`fix coderabbot issues`** — short, but the AI correctly treated each thread as an untrusted report to verify, not an order to obey.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Consider testing against the running/live dashboard | "create isolated environment… separate directory, ports… test with browser" | State up front: verify UI changes in an isolated temp-HOME + custom-port server, never the live one on 8000. |
| Leave mDNS advertising on for the test server | "do not autostart dashboard… to avoid mdns" | Default test spin-ups to `autoStart:false` + `PI_DASHBOARD_NO_MDNS=1` + `--no-tunnel`. |
| Accept every CodeRabbit suggestion as valid | (implicit) verify before applying | Triage each review thread against live code; fix real issues, reply-and-skip false positives with reasons. |
| Pause and ask whether to keep the separable test-infra env guard | Kept it | Decide the commit-split policy (feature vs test-infra) before committing. |

## 6. Skills, tools & memory created — and why they're effective

No new pi skill/memory was created in this session, but the workflow is highly repeatable and
the session **updated** the `parallel-pi-model-workers` SKILL to document the new auto-hide
behaviour (workers now auto-hide, so the flood problem it caused is fixed at the source).

Recommended asset to create: an **"isolated-dashboard-verification"** procedure capturing the
exact recipe — temp `HOME`, ports 8123/9123, `--no-tunnel`, `autoStart:false`,
`PI_DASHBOARD_NO_MDNS=1`, drive `session_register` over the gateway WS, assert via browser
`sessions_snapshot`, always tear down. (Such a skill already exists in this repo as
`isolated-ui-verification`; invoke it instead of hand-rolling the setup.) It removes the manual,
error-prone spin-up and makes UI changes verifiable without spawning credentialed workers or
risking the live server.

## 7. Pitfalls & dead ends

- **Worktree tsc can't see local edits** — a worktree with no `node_modules` resolves imports up to the parent repo. Run `npm install` in the worktree first so `@blackbelt-technology/*` maps to worktree packages.
- **Combined curl+start commands get blocked / server dies** — write a clean `start-isolated.sh` and probe health via a file, rather than chaining server start with a curl guard in one shell.
- **Blank page after dismissing the first-run modal with dead sockets** — sessions must stay *active* for a stable visual test; run a persistent driver that keeps all WS connections heartbeating before reloading the browser.
- **`openspec archive` aborts on pre-existing spec corruption** — canonical specs predating the stricter parser have stray `## ADDED Requirements` blocks, no single `## Requirements`/`## Purpose`, or requirements with SHALL only in scenarios. Normalize *only the blocking file*, minimally, preserving meaning.
- **Partial archive leaks to disk before aborting** — an aborted run can still have written some requirements; excise them so openspec can re-apply both specs atomically.
- **Naïve `existing ? existing.hidden` defeats auto-hide** — the gateway auto-creates a placeholder (`source:"unknown"`, `hidden:false`) *before* the real register, so preserving any-existing hidden state clobbers first-register hide. Gate preservation on `registerReason === "reattach"`.
- **`--delete-branch` aborts on the local git error** — merging while `develop` is checked out in the main worktree can abort the branch delete; the remote branch may survive. Verify origin and delete it explicitly.
- **Shell loses cwd when you delete the worktree under it** — run `git worktree remove` from the **main repo**, not from inside the worktree.

## 8. Reproduce it faster — checklist

- [ ] Have an OpenSpec change with proposal/design/tasks ready; run `/skill:openspec-apply-change <change>`.
- [ ] Implement as pure helper + unit test; put state decisions in the single writer; distinguish first-register vs reattach via `registerReason`.
- [ ] `npm install` in the worktree, then `npx tsc --noEmit`; revert `package-lock.json`/`.pi/settings.json` churn.
- [ ] Spin up isolated dashboard (temp HOME, ports 8123/9123, `--no-tunnel`, `autoStart:false`, `PI_DASHBOARD_NO_MDNS=1`); drive `session_register` WS messages; assert via browser; tear down.
- [ ] `/skill:openspec-archive-change <change>` — fix only the blocking spec-corruption, minimally.
- [ ] `rebase develop` → commit → push → PR → CI green.
- [ ] Triage CodeRabbit threads: fix valid, reply-and-skip false positives.
- [ ] Merge → cleanup worktree from the main repo (`--force`, delete local+remote branch, prune).

**Key inputs:** the OpenSpec change dir, a free port pair, no live-server dependency.
**Artifacts produced:** `packages/extension/src/visibility-intent.ts` (+test), edits to
`protocol.ts` / `bridge.ts` / `memory-session-manager.ts` / `pi-gateway.ts` / `event-wiring.ts` /
`server.ts`, the archived openspec change, updated `parallel-pi-model-workers` SKILL, PR #83
(merged as `e091bcf7`).

---

_Generated from session `019e9993` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-05. Source extract: session facts sheet (deterministic)._
