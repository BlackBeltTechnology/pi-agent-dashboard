---
session: 019e6c4b
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [add-editor-keeper-sidecar]
proposal_excerpt: "The dashboard server spawns `code-server` as a direct child. When the dashboard restarts (graceful, crash, or `/api/restart`), `editor-manager` SIGTERMs every code-server it owns and `editor-pid-registry.cleanupOrphan…"
---

# How we did it: Editor keeper sidecar — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a single guardrail — `DO NOT use jj` — then handed the AI a
ready-made OpenSpec change to build: `/skill:openspec-apply-change add-editor-keeper-sidecar`.
The *real* objective was to implement a spec-driven change (55 tasks) that makes
code-server editors **survive a dashboard restart**. Today the dashboard spawns
`code-server` as a direct child, so a graceful restart / crash / `/api/restart`
SIGTERMs every editor it owns. The fix: introduce a per-editor **keeper sidecar**
(mirroring the existing `rpc-keeper` pattern) that owns the code-server process,
plus a PID registry that adopts orphans on boot instead of killing them.

The human's role for the rest of the session was almost entirely *cadence steering*
("go on", "defer tests and mark done", archive, "no jj, commit and push") — the AI
drove the implementation end-to-end from the spec.

## 2. TL;DR playbook

1. **Set the version-control guardrail first:** open with `DO NOT use jj` so the AI
   never reaches for `jj` on commit/push.
2. **Hand it the change by name:** `/skill:openspec-apply-change add-editor-keeper-sidecar`.
   The skill loads the 55-task spec-driven plan and reads context files.
3. **Point the AI at the reference implementation:** it mirrored `rpc-keeper/` to
   build `editor-keeper/keeper.cjs` — steer it to "copy the proven sidecar pattern,
   adapt for code-server" rather than inventing one.
4. **Let it work in task order** (`§1 keeper.cjs → §2 keeper-manager → §3 editor-manager
   → §4 pid-registry → §5 server boot → §6 config+UI → §7 tests`), nudging with
   `go on` at natural pause points.
5. **Run tests hermetically:** every vitest invocation used `HOME=$(mktemp -d)` to
   avoid touching the real `~/.pi` state, then `npm test 2>&1 | tee /tmp/pi-test.log`.
6. **Delegate every `docs/` write to a subagent** (Explore) per the repo protocol;
   edit `AGENTS.md` backbone rows directly.
7. **When manual OS/binary verification blocks you, defer:** `defer tests and mark
   done` marks the 4 manual tasks done with a `— deferred` suffix for traceability.
8. **Archive + sync specs:** `/skill:openspec-archive-change add-editor-keeper-sidecar`
   (a second Explore subagent synced the delta specs and validated `--strict`).
9. **Land it:** `no jj, commit and push` — a scoped `git add` (excluding the
   unrelated `.pi/settings.json`), a conventional-commit message, `git push -u`.

## 3. How the collaboration unfolded

**Discovery (04:49–04:51).** The AI resolved the `openspec-apply-change` skill, ran
`openspec status --json` (55 tasks, spec-driven), and read context files. It then
located the **reference `rpc-keeper` implementation** and the current editor code,
shared platform helpers (`detached-spawn`, `process.isProcessAlive/killPidWithGroup`),
config, and existing tests. *Why it worked:* grounding in an existing, proven sidecar
pattern before writing a line meant the new keeper was a well-understood adaptation,
not a green-field guess.

**Implement (04:51–05:02).** Straight down the task list: `keeper.cjs` (CJS-pure
sidecar — argv parse, socket+pid paths, stale-socket retry, bind-before-spawn,
detached pgroup, JSON-line `heartbeat`/`getStatus`/`stop`, `child_exit` broadcast),
then `keeper-manager.ts` (`spawnKeeperFor`, 4-way `probe`, `discoverExistingKeepers`
adoption), the `editor-manager.ts` refactor (3-way `start`: memory→reattach→spawn;
async keeper-mediated `stop`), `editor-pid-registry.ts` (`adoptOrphans()` replaces
`register()`), server boot wiring (`adoptOrphans` *before* `cleanupOrphans`), and the
config + SettingsPanel toggle. *Decision point:* the AI recognized the legacy
`editor-manager-pid-registry.test.ts` asserted the now-removed `register()` API,
**deleted it**, and wrote keeper-based replacements — an explicit call it flagged
rather than silently mutating.

**Verify (05:00–05:10).** New tests written per §7: keeper-manager unit (11), editor-
manager 3-way/stop/stopAll (7), config round-trip, a repo-lint asserting `keeper.cjs`
imports only Node built-ins, and a live integration test with a mock code-server. Full
suite: **6359 tests pass**. *Why it worked:* the CJS-purity lint and the mock-child
integration test are the same guarantees the `rpc-keeper` pattern already trusts.

**Docs + pause (05:10–05:12).** `docs/` updates delegated to an Explore subagent
(protocol); `AGENTS.md` rows edited directly. The AI then **paused at 50/55**,
correctly identifying the last 5 as manual verification needing a running dashboard +
real `code-server` binary + multi-OS runs it couldn't perform.

**Defer → Archive → Ship (06:39–06:47).** On `defer tests and mark done` it marked
9.1–9.4 done with `— deferred`. `openspec-archive-change` moved the change to
`archive/2026-05-28-…`, and a second Explore subagent synced deltas (new
`editor-keeper-sidecar` spec + 3 replaced `editor-manager` requirements). Final
`no jj, commit and push` → commit `52be5079`, pushed to `origin`.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-editor-keeper-sidecar`.
  Effective because all the *what* lived in the OpenSpec change already; the prompt
  just points the AI at a fully-specified 55-task plan. A stronger kickoff bundles the
  guardrail: *"Don't use jj. Apply openspec change add-editor-keeper-sidecar; mirror
  the rpc-keeper sidecar pattern; run tests with HOME=$(mktemp -d)."*
- **High-leverage follow-ups:**
  - `go on` — unblocked continuation at natural task-list pauses with zero re-explaining.
  - `defer tests and mark done` — one short line converted a stuck manual-verification
    gate into a traceable deferral so the change could ship.
  - `no jj, commit and push` — re-asserted the version-control guardrail exactly at the
    moment it mattered (landing).

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reach for `jj` (the repo's default VCS) | `DO NOT use jj` up front, repeated as `no jj, commit and push` at landing | State the VCS rule in the goal prompt; save a project memory "commit/push with git, never jj" |
| Stall at manual OS/binary verification tasks (50/55) | `defer tests and mark done` | Pre-agree the defer policy: manual multi-OS / real-binary tasks get a `— deferred` suffix, not a block |
| Wait for explicit go-ahead between task groups | `go on` | Tell it up front "work the task list end-to-end, only stop for a real decision or a blocker" |
| Leave archive/spec-sync as separate manual steps | `/skill:openspec-archive-change …` | Chain apply → archive in the same instruction once tasks are done |

Also worth noting the AI's *good* self-steering the human didn't have to correct:
it left the unrelated `.pi/settings.json` path-normalization **unstaged** and said so,
and it flagged the obsolete-test deletion rather than doing it silently.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the workflow ran entirely on
existing ones (`openspec-apply-change`, `openspec-archive-change`, Explore subagents).
The reusable asset produced is the **keeper-sidecar pattern applied to a second
subsystem**: `editor-keeper/` now mirrors `rpc-keeper/`, so a *third* long-lived child
process could follow the same three-file shape (`keeper.cjs` + `keeper-manager.ts` +
`*-pid-registry.ts` with `adoptOrphans` on boot).

**Recommended skill to create:** `restart-surviving-child-process` — capturing the
sidecar recipe (CJS-pure keeper, 4-way probe, adopt-orphans-before-cleanup boot order,
CJS-purity lint + mock-child integration test). It would remove the ~10 minutes of
"read rpc-keeper, adapt for X" discovery every time a new child needs to survive
`/api/restart`.

## 7. Pitfalls & dead ends

- **Tests touching real `~/.pi` state:** the first `npx vitest run …editor-manager.test.ts`
  was immediately re-run with `HOME=$(mktemp -d)` prefixed. *If you hit flaky/ stateful
  editor tests, run them under a throwaway HOME.*
- **Locating the skill on disk:** an early `find / -name "openspec-apply-change" -type d`
  failed (too broad). *Resolve skills via `find ~/.pi -name SKILL.md | xargs grep -l …`
  instead of a root-wide find.*
- **Obsolete tests asserting a removed API:** `editor-manager-pid-registry.test.ts`
  mocked `child_process.spawn` and the dropped `register()`. *When an architecture
  supersedes an API, delete the legacy test and replace it — don't try to make it pass.*
- **Manual verification can't run in-agent:** tasks needing a live dashboard + real
  `code-server` + multiple OSes are un-runnable from the agent. *Mark them `— deferred`,
  don't fake them.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change already authored (`openspec/changes/add-editor-keeper-sidecar/`
  with a 55-task spec-driven `tasks.md`).
- The reference `packages/server/src/rpc-keeper/` implementation to mirror.
- A clean worktree; `git` (not `jj`) as the VCS.

**Checklist:**
1. `DO NOT use jj` — set the VCS guardrail.
2. `/skill:openspec-apply-change add-editor-keeper-sidecar`.
3. Read `rpc-keeper/`; build `editor-keeper/keeper.cjs` (CJS-pure), `keeper-manager.ts`,
   refactor `editor-manager.ts` (3-way start), `editor-pid-registry.ts` (`adoptOrphans`).
4. Wire server boot: `adoptOrphans` **before** `cleanupOrphans`.
5. Add config flag + SettingsPanel toggle.
6. Write §7 tests; run each with `HOME=$(mktemp -d)`; then `npm test | tee /tmp/pi-test.log`.
7. Delegate `docs/` writes to an Explore subagent; edit `AGENTS.md` rows directly.
8. `defer tests and mark done` for manual multi-OS / real-binary tasks (`— deferred`).
9. `/skill:openspec-archive-change add-editor-keeper-sidecar` (sync deltas, validate `--strict`).
10. `no jj, commit and push` — scoped `git add` (exclude unrelated files), conventional commit, `git push -u`.

**Final artifacts produced:**
- `packages/server/src/editor-keeper/keeper.cjs`, `keeper-manager.ts`
- `packages/server/src/editor-manager.ts`, `editor-pid-registry.ts` (refactored)
- Test suite under `editor-keeper/__tests__/` + `config-editor.test.ts` (13 new, 6359 total pass)
- `openspec/specs/editor-keeper-sidecar/spec.md` (new) + updated `editor-manager/spec.md`
- Change archived → `openspec/changes/archive/2026-05-28-add-editor-keeper-sidecar/`
- Commit `52be5079` on `origin/add-editor-keeper-sidecar`

---

_Generated from session `019e6c4b-eafa-7fa4-9355-ea23d82a691d` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-28. Source extract: `/tmp/facts-8368-1784847343.md`._
