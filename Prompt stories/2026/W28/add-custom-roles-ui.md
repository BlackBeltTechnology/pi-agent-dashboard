---
session: 019f5467
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); large facts sheet (~11692 tok)"
upgrade_status: pending
openspec_changes: [add-custom-roles-ui]
proposal_excerpt: "The role-name schema is already user-editable on disk — `2026-07-08-add-agent-role-model-tools` made `DEFAULT_ROLE_NAMES` a seed (not a const), added the `roleNames`/`removedRoles` markers, and shipped `addRoleName()`…"
---

# How we did it: Add/remove custom roles from the dashboard UI — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single slash-command: `/skill:openspec-apply-change add-custom-roles-ui`.
The real objective: **implement an already-designed OpenSpec change** that lets a user
add and remove custom role names from the dashboard's Roles settings UI — end to end,
TDD-first, across the shared-protocol / extension-bridge / server-gateway / roles-plugin
stack — then land it. The on-disk schema already supported custom role names (a prior
change made `DEFAULT_ROLE_NAMES` a seed with `roleNames`/`removedRoles` markers); this
change wired the **UI + the message plumbing** so a human could actually do it. The later
prompts turned the ask from "apply the change" into "apply it, prove the removal path is
wired all the way through, then ship it to `develop`."

## 2. TL;DR playbook

1. From the worktree, resolve OpenSpec skills from the **main repo root** and pull the
   change's `tasks.md` + `openspec instructions apply --json`. Announce progress (0/N).
2. Implement each task **TDD-first**: write the failing test, then the minimal code, run
   the scoped suite with `HOME=$(mktemp -d) npx vitest run <file>`.
3. First time a cross-package import fails in a worktree, run `npm install` **inside the
   worktree** — its `node_modules` symlinks otherwise resolve to the *main* checkout and
   your new shared file is invisible.
4. For a new client→bridge WS message, wire **all four** points: `shared` protocol type,
   extension bridge routing, **server gateway forwarding**, and the client sender. Unit
   tests pass with only two of them — they bypass the wire.
5. At the discipline checkpoint, run a **cross-model** doubt review: first `probe` the
   reviewer model for reachability, then hand it **ARTIFACT + CONTRACT only** (the diff +
   the invariant), no CLAIM. Reconcile findings against real code before acting.
6. Fix any red the review surfaces red→green with a fresh regression test; re-run the
   affected suites + `tsc --noEmit` + `biome` (compare base-vs-mine to prove **zero new**
   findings).
7. Ship: sync delta specs into main specs, archive, commit, PR against `develop`, watch CI.
8. If CI never queues, check `mergeStateStatus` — `UNKNOWN`/stale-branch suppresses runs;
   **merge `develop` in** to create a fresh push event, then squash-merge and remove the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (worktree orientation).** The AI recognized it was in
`.worktrees/os-add-custom-roles-ui`, resolved skills from the parent repo per OpenSpec
conventions, and grepped the protocol/bridge/tests to build a full picture before
touching code. *Why it worked:* it mapped the existing `roles_list`/`role_set`/
`role_preset_*` message shapes first, so new code matched the established pattern.

**Phase 2 — TDD implementation (Tasks 1–5).** Shared `role-name-validation.ts` (one trust
boundary: `isValidRoleName`), then protocol + bridge (`builtinRoleNames`, `role_remove`
message, `roles:remove` handler), then the client grouping (`computeRoleGroups`, Built-in
vs Custom pills, inline add flow, × on custom pills only). Every task was red→green with a
scoped `vitest run`. *Decision point:* a repeating 6× payload shape prompted a small DRY
helper rather than copy-paste.

**Phase 3 — The worktree node_modules trap.** Extension tests failed because the `shared`
symlink resolved to the *main repo*, not the worktree, so the new file wasn't visible.
`npm install` inside the worktree installed workspace symlinks and unblocked the suite.

**Phase 4 — Discipline checkpoints (the payoff).** `security-hardening` STRIDE over the
role-name → `providers.json` boundary confirmed double-validation and prototype-pollution
rejection. Then `doubt-driven-review` demanded a **cross-model** second opinion. Three
subagent spawns (`gpt-5.4`, `gemini-3.1-pro`, `deepseek-v4-pro`) returned **empty output** —
surfaced as a failure, not swallowed. The AI then **probed `zai/glm-5.2` for reachability
first**, then ran the review — and glm-5.2 caught a **HIGH-severity gap the green tests
hid**: the **server gateway forwarded every sibling role message but not `role_remove`**,
so removal was dead end-to-end. Fixed red→green (`RoleRemoveBrowserMessage` + gateway case
+ regression test). A project memory was saved about the four wiring points.

**Phase 5 — Ship.** `ship-change`: QA/manual task deferred, build gate, delta specs synced
into main specs, archived, committed, PR #282. CI passed on the first commit. CodeRabbit
was rate-limited; a manual `@coderabbitai full review` bypassed it → 3 nitpicks applied,
3 skipped-with-reason.

**Phase 6 — The CI stall.** New commits **never queued a CI run** (synchronize ×2,
close/reopen, empty commit — all failed). Root cause: the branch was **13 commits behind
`develop`**, so `mergeStateStatus: UNKNOWN` suppressed the Actions check-suite. **Merging
`develop` in** (resolving 2 `AGENTS.md` conflicts by taking develop's version + re-applying
own rows) created a fresh push event → CI ran green → squash-merge `93c9e8e9` → worktree removed.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-custom-roles-ui`. Effective
  because the change was already fully designed (proposal + tasks.md); the slash-command
  hands the AI a complete work order and it self-drives the TDD loop. *Stronger version
  for a fresh reader:* same command, but the design work must exist first — this only works
  when `openspec/changes/<name>/tasks.md` is populated.
- **High-leverage follow-up** — `"I will tests later, ship-change"`. One short line pivoted
  the whole session from implement-mode to land-mode, telling the AI to defer manual/E2E QA
  and drive the archive→PR→CI→merge pipeline.
- **`"Maybe its can run now"`** — a terse nudge that unblocked the CI stall investigation
  (the AI kept re-triggering and ultimately diagnosed the stale-branch cause). *Stronger
  version:* "CI isn't queuing — check `mergeStateStatus` and whether the branch is behind
  `develop`."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust green unit tests as end-to-end proof | The discipline checkpoint forced a cross-model review that found the gateway gap | State up front: "a new WS message needs all four wiring points; unit tests bypass the wire" |
| Want to squash-merge while CI was merely rate-limited on CodeRabbit | Hold at the irreversible step until CI was actually green | Treat CodeRabbit as advisory but require a real CI pass on the current head |
| Re-trigger CI mechanically (reopen, empty commit) when it wouldn't queue | `"Maybe its can run now"` → led to diagnosing stale-branch `mergeStateStatus: UNKNOWN` | When CI never queues, check branch-behind + merge `develop` first, don't retrigger blindly |
| Accept every CodeRabbit nitpick | Triage each against real code — apply valid, skip-with-reason the inconsistent ones | Only apply fixes that don't introduce inconsistency with sibling handlers |

## 6. Skills, tools & memory created — and why they're effective

- **Project memory (the four-wiring-points rule).** Captured: *"adding a new client→bridge
  WS message requires FOUR wiring points, not one — shared protocol, bridge routing, server
  gateway, client sender. Missing any drops the message silently; unit tests pass because
  they bypass the wire."* This is the single most reusable asset from the session — it turns
  a HIGH-severity class of bug (dead-end message plumbing) into a checklist. **Invoke it**
  whenever adding any dashboard message type.
- **Cross-model doubt-review pattern (probe-then-review).** No skill file was written, but
  the workflow is clearly repeatable and worth codifying: (1) probe the reviewer model with
  a trivial prompt to confirm SDK reachability, (2) hand it ARTIFACT + CONTRACT only — no
  CLAIM, no reasoning — so it can't rubber-stamp, (3) reconcile its findings against real
  code before acting. This is exactly what caught the gateway bug. **Recommend creating a
  skill** for it if the pattern recurs.

## 7. Pitfalls & dead ends

- **Worktree cross-package imports resolve to the main repo.** New `shared` file invisible
  to tests → run `npm install` inside the worktree to install workspace symlinks.
- **Subagent reviewers returning empty output.** `gpt-5.4`, `gemini-3.1-pro`, and
  `deepseek-v4-pro` spawns each returned nothing. Don't swallow it — surface as a failure,
  and **probe a model for reachability before relying on it** (glm-5.2 worked).
- **`biome --changed` finds nothing in a worktree** (VCS diff base mismatch). Lint your
  specific files directly and compare base-vs-mine (stash/`git show HEAD:`) to prove **zero
  new** findings against pre-existing noise.
- **CI won't queue on new commits.** Reopen / empty-commit retriggers all failed. Cause:
  branch 13 commits behind `develop` → `mergeStateStatus: UNKNOWN` suppresses the Actions
  check-suite. **Merge `develop` in** to fix the merge state and create a fresh push event.
- **`AGENTS.md` merge conflicts on the develop-merge.** Take develop's version, then
  re-apply only your own rows at the correct alphabetical slot (anchors drift).
- **Pre-existing failing tests** (server-spawn timeouts, perf smoke). Confirm they
  reproduce on baseline (stash your diff) before assuming your change broke them.
- **Post-merge worktree removal is "dirty"** only from the untracked `node_modules` you
  installed — `git worktree remove --force` is the intended path; run cleanup from the
  parent checkout, not the removed worktree.

## 8. Reproduce it faster — checklist

- [ ] From the worktree, resolve OpenSpec skills from the **parent repo**; read `tasks.md`.
- [ ] `npm install` inside the worktree before running any cross-package test.
- [ ] Implement each task TDD-first; scope suites with `HOME=$(mktemp -d) npx vitest run <file>`.
- [ ] For any new client↔bridge message, wire **shared type + bridge route + server gateway
      + client sender** (four points). Add a gateway regression test.
- [ ] At the discipline checkpoint: `probe` a non-author-architecture model, then run the
      cross-model review with ARTIFACT + CONTRACT only. Reconcile before fixing.
- [ ] Prove **zero new** `tsc`/`biome` findings via base-vs-mine comparison.
- [ ] Ship: sync deltas → main specs, archive, PR against `develop`, watch CI.
- [ ] If CI won't queue: check branch-behind + `mergeStateStatus`; merge `develop` in.
- [ ] Squash-merge only on a **green CI run on the current head**; then `git worktree remove --force`.

**Key inputs to have ready:** a fully-designed OpenSpec change (`tasks.md` populated); a
reachable non-Anthropic reviewer model for the doubt pass; `gh` auth for the PR pipeline.

**Final artifacts:** `packages/shared/src/role-name-validation.ts` (+ test),
`packages/server/src/__tests__/browser-gateway-role-remove.test.ts`, edits across
`shared`/`extension`/`server`/`roles-plugin` + their `AGENTS.md` rows, synced specs, and
PR #282 squash-merged to `develop` as `93c9e8e9`.

---

_Generated from session `019f5467` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-12. Source extract: deterministic facts sheet._
