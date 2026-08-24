---
session: 019f159c
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [distinguish-offline-from-network-denied, directory-settings-page-and-scoped-md-editing]
proposal_excerpt: "GitHub issue #99 (later screenshots) + maintainer report: accessing the dashboard remotely (browser on `brass.lan` → server on `pennyroyal.lan:4040`) produces three confusing, conflated failure states. The user cannot…"
---

# How we did it: Distinguish "offline" from "network-denied" — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: **`/skill:openspec-apply-change distinguish-offline-from-network-denied`**. No prose, no clarifying preamble — just "apply this already-planned change."

The *real* objective, once the design questions were resolved in-flight, was: when the dashboard is accessed remotely (browser on `brass.lan`, server on `pennyroyal.lan:4040`), three distinct failure states were being conflated into one opaque **"Access denied"** message — (a) the server is genuinely offline/unreachable, (b) the client is on a network the server's `trustedNetworks` policy rejects, and (c) a phantom `localhost:<port> is unreachable` seed row that only makes sense on the machine running the server. The change had to make each state **self-describing** end-to-end: a machine-readable 403 body from the server, and client surfaces (ServerSelector, ConnectionStatusBanner, PathPicker) that branch on *policy-denial vs transport-failure* and route the user to Settings → Servers.

The second and only other user turn was pure steering: **"use ship-cange skill, I will do test later"** — i.e. once implementation was green, ship it via the `ship-change` flow and defer the one manual LAN-repro QA task to post-merge.

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change-name>` in the change's worktree. Let the skill read `tasks.md` + `design.md` + context files.
2. **Resolve open design questions with evidence, not assumption** — grep the auth plumbing (`isAuthenticated`, the `onRequest` hook, `/api/browse`) to learn *which* failure actually fires, then record the resolution in `design.md` before writing code.
3. Work task-by-task **TDD**: write the failing test → run it → implement the minimal change → re-run green → check off `tasks.md`. Repeat per component (server guard → ServerSelector → ConnectionStatusBanner → PathPicker).
4. Extract **pure, testable helpers** (`isLoopbackOrigin`, `buildServerEntries`) instead of testing through the component; gate UI seeds on `window.location.hostname`.
5. Give the server a **machine-readable denial body** (`{ success:false, error:"network_not_allowed", reason, hint }`) so every client can branch on the `error` literal — never string-match a human message.
6. Run the full suite; **triage integration-test timeouts by re-running them in isolation** — a 5000ms server-boot timeout that passes alone is a load flake, not your regression.
7. `openspec validate`, `tsc --noEmit` on changed packages, then the advisory code-review gate.
8. Switch to `ship-change`: mark the manual-QA task done (deferred), build, `openspec archive`, commit (via a message file to dodge shell substitution), push, open PR against `develop`.
9. Watch CI to green; fetch **actual** CodeRabbit threads (a "pass" can be a rate-limited ACK); apply only findings that touch *your* diff, add regression tests, re-push, loop until CI green + no actionable threads on your files.
10. Squash-merge with branch delete; clean up the worktree **from the parent repo** (your cwd is about to disappear).

## 3. How the collaboration unfolded

**Phase A — Discovery & design resolution (≈01:07–01:10).** The AI read the apply skill, the change context, and the source files it would touch (server guard + client components). The pivotal move: it *investigated* task 1.1 rather than guessing. Grepping the auth plugin revealed that the `onRequest` hook sets `isAuthenticated` for all non-health routes, so when auth is **enabled** an unauthenticated browse fetch gets `401` *before* the guard runs — meaning the guard's `403` "Access denied" only fires when auth is **disabled**. Conclusion: the real remedy for issue #99 is `trustedNetworks`, not auth plumbing. This was written into `design.md` before any code. *Why it worked:* it converted an ambiguous spec question into a settled fact backed by the actual request lifecycle.

**Phase B — TDD implementation, component by component (≈01:10–01:22).** Server first: a failing test for the self-describing 403 body, then the minimal reply change, then a grep to confirm no other call site string-matched the old `"Access denied"` text. Then ServerSelector: extract `isLoopbackOrigin` + `buildServerEntries` as pure helpers, gate the `localhost` "Local" seed on a loopback origin (so remote clients stop seeing the phantom unreachable row), and make probe state **tri-valued** (`available`/`unreachable`/`denied`). Then ConnectionStatusBanner (a distinct amber "Network not allowed" surface that outranks the offline banner) and PathPicker (`NetworkNotAllowedError` in `browse-api.ts` + a denial branch that surfaces a Settings link). Each component: failing test → implement → green → check the box. *Decision point:* wire `onOpenServers` through `PinDirectoryDialog` and `App.tsx` so the "go fix your network" affordance actually appears at the primary Pin-Directory surface, not just in theory.

**Phase C — Verify (≈01:25–01:33).** The full suite showed 3 failures — all 5000ms timeouts in full-server integration tests. The AI re-ran them in isolation, confirmed they passed alone (load/timing flakes, e.g. `doctor-route`'s `elapsed 4067 < 3000` assertion), and declared its own changes green. `openspec validate` + `tsc --noEmit` clean. The advisory review gate initially looked like "2 Critical" but a clean re-run returned **0 findings** — the earlier hits were a stale JSON from a different worktree plus a parser placeholder. Docs `See change:` annotations were delegated to a subagent in caveman style per the protocol.

**Phase D — Ship (≈02:59–03:35).** On the "use ship-change, I'll test later" steer, the AI marked the manual LAN-repro task done (deferred), built, and ran `openspec archive`. The archive **aborted** on a *pre-existing* structural defect — several main specs missing their `## Requirements` / `## Purpose` wrappers. The AI added the minimal wrappers (fixing a bash associative-array mangle along the way), reverted a spurious `package-lock.json` change from its earlier macOS `npm install` (which would break Linux CI), committed via a message file, and opened **PR #200** against `develop`. CI went green (8m04s). CodeRabbit posted 5 comments; the AI verified 2 belonged to *another change's* files (pre-existing on develop, empty `develop..HEAD` diff), skipped those, and applied the 3 that touched its diff — including a loopback-alias dedup fix *with a new regression test*. Re-push, CI green again (8m17s), threads on its files resolved/outdated, then squash-merge with branch delete. Final snag: cleanup couldn't run because the session cwd (the worktree) had just been removed.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change distinguish-offline-from-network-denied`.** Effective because the heavy lifting (proposal, design, tasks) already existed; the one-liner just hands the AI a fully-scoped, checkbox-driven plan. The *stronger* version for a future operator: include the deferral intent up front — "apply `<change>`; the manual LAN repro (task 6.3) I'll test post-merge, so ship via ship-change when green." That would have collapsed the two turns into one.
- **High-leverage follow-up — "use ship-cange skill, I will do test later."** Despite the typo, this unlocked the entire ship phase: it authorized deferring the one un-automatable task and picked the exact landing flow. Short, decisive, scope-clearing. Bake the deferral rule into the kickoff and you rarely need this turn at all.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at "implementation complete" and await direction on landing | "use ship-change skill, I will do test later" | Stating the landing flow + QA-deferral in the goal prompt |
| Treat an un-automatable manual task (LAN two-machine repro) as a blocker | Explicitly authorizing "I will do test later" | A convention: manual-QA tasks are marked done + deferred to post-merge, not left blocking the ship |
| Risk trusting a CodeRabbit "Review completed" as clean | (self-corrected) fetching the actual review threads | Always pull real threads via API — a "pass" can be a rate-limited ACK |
| Nearly act on findings that referenced files outside its diff | (self-corrected) checking `develop..HEAD` was empty for them | Diff-scope every review finding before touching it |

Most of the "steering" here was **self-correction** — the AI caught its own load-flake false alarms, stale review JSON, and out-of-scope findings. The one true human steer was the ship + defer authorization.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created; the session was a clean *consumption* of the existing pipeline (`openspec-apply-change` → `ship-change`) plus two `general-purpose` subagents for docs annotation ("Annotate file-index rows", "Canonicalize file-index row paths"), delegated per the Documentation Update Protocol's caveman-style rule.

**Recommended skill to create:** a **"triage-integration-flake"** helper that, given a full-suite log, extracts the failing test names, re-runs each in isolation, and reports "flake (passes alone)" vs "real regression." This pattern recurred twice in this session and is the single highest-friction manual dance — worth making reproducible.

## 7. Pitfalls & dead ends

- **Worktree has no `node_modules`.** The first test run failed until `npm install` was run in the worktree. Do it before the first `vitest` call.
- **`npm install` on macOS prunes Linux `libc` optional deps from `package-lock.json`.** Committing that lockfile change breaks Linux CI — revert it before commit.
- **Integration tests flake at 5000ms server-boot under load.** Don't chase them as regressions; re-run in isolation to confirm. `doctor-route`'s timing assertion (`elapsed < 3000`) is machine-load-sensitive.
- **`openspec archive` aborts on pre-existing malformed main specs** (missing `## Requirements` / `## Purpose` wrappers). Add the minimal wrappers to unblock — but note it's tech debt you inherited, not yours.
- **Bash has no associative arrays in the default shell** — a per-spec purpose map got mangled (all specs got the same purpose). Fall back to per-file `Edit` calls.
- **Stale review JSON from a different worktree** looked like real "Critical" findings. Always confirm the report is from *this* run before acting.
- **Squash-merge confuses `gh --delete-branch`** — git doesn't see the branch as merged by ancestry, so it errors while the server-side merge already succeeded. Force-delete the local branch manually.
- **Cleaning up your own worktree kills your shell's cwd.** After `git worktree remove`, every subsequent `Bash` call fails its cwd check. Run cleanup from the parent repo, and do it last.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change fully planned (`proposal.md` + `design.md` + `tasks.md`) in a dedicated worktree.
- `gh` authenticated; remote is `develop`-based.
- CodeRabbit CLI available for the review gate.

**Checklist:**
- [ ] `npm install` in the worktree (no `node_modules` yet).
- [ ] Read `design.md` open questions → resolve each with a grep of the real code path → write the answer back into `design.md` *before* coding.
- [ ] Per component, TDD: failing test → minimal impl → green → check `tasks.md`. Extract pure helpers; gate UI seeds on origin.
- [ ] Server denial body is machine-readable (`error:"network_not_allowed"`); clients branch on the literal, never the message text.
- [ ] Full suite → isolate any timeout failures → confirm flakes.
- [ ] `openspec validate` + `tsc --noEmit` on changed packages + advisory review gate.
- [ ] Mark manual-QA tasks done (deferred to post-merge).
- [ ] Build → `openspec archive` (fix any pre-existing spec-wrapper defects) → revert spurious lockfile churn → commit via message file → push → PR vs `develop`.
- [ ] Watch CI green; fetch **actual** CodeRabbit threads; apply only in-diff findings + regression tests; re-push; loop until green + no actionable threads.
- [ ] Squash-merge + delete branch; force-delete local branch if needed; remove the worktree **from the parent repo, last.**

**Artifacts produced:** PR [#200](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/200) (squash-merged to `develop`, SHA `fd440c37`); archived change `2026-06-30-distinguish-offline-from-network-denied`; 4 synced main specs; edits across `packages/server/src/localhost-guard.ts`, `packages/client/src/components/{ServerSelector,ConnectionStatusBanner,PathPicker,PinDirectoryDialog}.tsx`, `packages/client/src/lib/browse-api.ts`, `App.tsx`, plus their tests.

---

_Generated from session `019f159c-f8bb-743b-a2d3-245aefbb6562` · `pi-agent-dashboard` · 2026-06-30. Source extract: `/tmp/facts-66664-1784847435.md`._
