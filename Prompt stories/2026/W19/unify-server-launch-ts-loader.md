---
session: 019e0d7e
week: 2026/W19
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [server-launch-smoke-suite, unify-server-launch-ts-loader]
proposal_excerpt: "Change `unify-server-launch-ts-loader` collapsed five duplicate dashboard-server spawn sites into one shared `launchDashboardServer` primitive. Unit coverage is comprehensive (launcher tests, `ToolResolver.resolveJiti…"
---

# How we did it: Unify five server-launch call sites into one shared primitive — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with the standard `/opsx:apply` command — "Implement tasks from an
OpenSpec change." No change name was passed, so the real objective was inferred from
the active change: **`unify-server-launch-ts-loader`** — collapse the five duplicated
dashboard-server spawn sites (Bridge extension, server CLI, Electron `spawnFromSource`,
Electron legacy V1, restart-helper) into a single shared `launchDashboardServer`
primitive, plus a unified `ToolResolver.resolveJiti` 4-anchor resolution chain. This is
a hot-path refactor of the code that boots the server, so the bar was: unify without
regressing any starter, with comprehensive unit coverage and a clean per-phase smoke
plan for the runtime paths that can't be unit-tested.

## 2. TL;DR playbook

1. `/opsx:apply unify-server-launch-ts-loader` — let the apply skill read `proposal.md`,
   `tasks.md`, and the spec; confirm the phase plan (35 tasks / 4 phases) before coding.
2. **Phase A first, additive only** — build the new `ToolResolver.resolveJiti` +
   `launchDashboardServer` primitive and its tests WITHOUT touching any call site.
   Get shared package green (938 tests) and `npm run build` clean before migrating.
3. **Migrate call sites one phase at a time** (B: Bridge/CLI/Electron, C: restart-helper,
   D: deletions), running the affected package's vitest suite after each.
4. When a suite shows red, **isolate pre-existing failures** with `git stash` / git-log
   on the test file before assuming your change broke it.
5. Update the lint allow-list (`no-raw-node-import`), `AGENTS.md`, and `CHANGELOG.md`
   as their own tasks — don't fold them into code edits.
6. Ask "Create a new proposal for the smoke tests and close in this" → spin the deferred
   runtime-smoke work into a **followup change** (`server-launch-smoke-suite`) instead
   of blocking the refactor on manual smoke runs.
7. Run `/opsx-verify`, **fix every WARNING** it raises (orphan exports, seam-name drift,
   spec-vs-impl constant mismatch) before archiving.
8. `/opsx-archive` → syncs the delta spec into the main spec, then `commit`.

## 3. How the collaboration unfolded

**Phase 0 · Discovery (18:08–18:10).** The apply skill parsed `openspec status` +
`instructions apply`, read the proposal/spec/tasks, and surveyed the current code
(`binary-lookup.ts`, `node-spawn.ts`, `server-launcher.ts`, all five spawn sites). The
AI announced a **35-task / 4-phase plan and committed to stopping at Phase A** for
verification before touching call sites — the effective move on a hot path: prove the
new primitive in isolation first.

**Phase A · Build the primitive (18:10–18:15).** Created `server-launcher.ts`
(`launchDashboardServer` with typed errors `JitiNotFoundError` / `PortConflictError` /
`EarlyExitError` and a 4-condition readiness loop), added `resolveJiti` to `ToolResolver`
with the full managed-pi → system-pi → caller-anchor → argv[1] chain, and
`buildNodeImportArgvParts` to `node-spawn.ts`. Ported 13+13 tests, added POSIX-vs-Windows
URL-wrap pin tests, ran the whole shared suite (938 green) and `npm run build`. **No call
site touched, `resolve-jiti.ts` still in tree.**

**Phase B–C · Migrate the five sites (18:16–18:35).** Bridge extension `launchServer`
became a thin wrapper (with a forwarding-contract test), CLI `cmdStart` migrated and its
tsx fallback deleted, Electron `spawnFromSource` migrated with the `logFd` lifecycle moved
into the launcher (`main.ts` now passes `logFile`), and the legacy V1 path took **option
(b) migrate** — `launchServer`'s body delegates to the new primitive while keeping its
signature so source-substring tests survive. Restart-helper routed through
`buildNodeImportArgvParts`.

**Phase D · Deletions + housekeeping (18:36–18:43).** Tightened the `no-raw-node-import`
lint allow-list (had to reword a comment that tripped the regex), removed the dead
`resolve-jiti.ts`, verified the tarball no longer ships it, updated `AGENTS.md` and
`CHANGELOG.md`. Final full sweep: pre-existing failures only.

**Decision point · Defer the runtime smokes (18:53–18:58).** The human steered: *"Create
a new proposal for smoke tests and close in this."* Rather than block the refactor on
manual per-starter smoke runs, the AI authored a **new** `server-launch-smoke-suite`
change (proposal + spec with 4 requirements / 9 scenarios + 18 tasks), marked the 5 smoke
tasks in the original change as deferred with inline pointers, and cross-linked the
CHANGELOG so the deferred trail is discoverable from release notes.

**Phase E · Verify → fix → archive → commit (18:58–19:19).** `/opsx-verify` reported no
CRITICAL but three WARNINGs; the AI fixed each (see §5), tightened the symbol-presence
spec regex to invocations-only, re-verified zero matches, then `/opsx-archive` synced the
delta spec into a new main spec and `commit` landed `6b0c7f2e` (31 files, +2011/-1006).

## 4. Prompts that worked

- **The goal prompt** (`/opsx:apply`) — effective because it delegates change-selection
  and phase-planning to the apply skill; the operator didn't have to hand-list tasks.
  Stronger form when the change is known: `/opsx:apply unify-server-launch-ts-loader` to
  skip the inference step.
- **"Create a new proposal for smoke tests and close in this"** — a high-leverage one-liner
  that unblocked the whole change by splitting deferrable runtime work into its own
  followup, instead of arguing about manual smoke coverage inside the refactor.
- **`/opsx-verify` then `apply`** — running verify as its own gate, then applying its
  WARNING fixes, is what caught the orphan export and the spec/impl constant drift before
  archive. Reuse this pair every time.
- **`commit`** — trusted the session to stage only the related set; it explicitly left
  32 unrelated unstaged files untouched (good hygiene worth stating up front).

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to run manual per-starter smoke tests inline, stalling the refactor | "Create a new proposal for smoke tests and close in this" | State up front: defer un-unit-testable runtime coverage into a followup OpenSpec change, don't block. |
| Leave an orphan `resolveJitiFromPi` export with no callers | `/opsx-verify` flagged it; then delete it | Treat "removed predecessors" spec scenarios (git-grep = zero) as hard gates in the apply pass, not just at verify. |
| Keep a stale injection-seam name (`deps.resolveJitiFromAnchor`) after semantics changed | Verify → rename seam + 7 test refs to `deps.resolveJiti` | Rename seams when their meaning changes, in the same edit that changes the behavior. |
| Ship a spec scenario constant (`healthTimeoutMs: 5000`) that no longer matched impl (`30000`) | Verify caught the mismatch; update spec | Keep spec constants and impl constants in one edit; re-grep after changing a timeout. |
| Assume a red test was its own regression | `git stash` / git-log the test file | Isolate pre-existing failures before debugging — several electron failures (dependency-detector, `--help`) were unrelated in-flight work. |

## 6. Skills, tools & memory created — and why they're effective

No new pi skill or memory was created — the session ran entirely on the existing
OpenSpec workflow skills (`openspec-apply-change`, `openspec-new-change`,
`openspec-verify-change`, `openspec-archive-change`). One subagent was spawned:

- **`general-purpose` subagent — "Sync server-launch delta spec."** Isolated the
  mechanical delta-→-main spec sync so it stayed out of the main context. Effective
  because spec-sync is self-contained (delta in, main spec out) and doesn't need the
  refactor's working context.

**Recommended skill to create:** a `deferred-smoke-followup` procedure — when an OpenSpec
change contains runtime/manual smoke tasks that can't be unit-tested, spin them into a
sibling `*-smoke-suite` change, mark the originals deferred with inline pointers, and
cross-link the CHANGELOG. This session executed that pattern by hand; it's clearly
repeatable.

## 7. Pitfalls & dead ends

- **Lint regex false-positive on comment text.** The `no-raw-node-import` guard matched a
  comment in `server-launcher.ts`. Fix: reword the comment; don't add code to the
  allow-list to dodge a comment match.
- **`git stash` mid-refactor is risky.** One stash/pop attempt failed (8 bash errors total
  in the session). Prefer `git log`/`git diff HEAD -- <testfile>` to prove a failure is
  pre-existing without moving your working tree.
- **Source-substring tests pin function names.** Legacy V1's test pinned `ensureServer`
  by source substring, forcing **option (b) migrate** (keep the signature, swap the body)
  over option (a) delete. Check what tests assert by substring before choosing delete.
- **Pre-existing failures masquerade as yours.** `packages/electron` sat at 242/253 and
  `packages/shared` at 919/927 from unrelated in-flight proposals (`replace-tsx-with-jiti`,
  dependency-detector). Track the baseline pass counts (919/625/242) so you can tell your
  breakage from the noise.
- **Symbol-presence scenarios need invocation-scoped regexes.** A naive `git grep` matched
  local reincarnations and comments; the spec scenario had to be tightened to
  non-comment invocations only, and two local symbols renamed, to reach zero matches.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an active OpenSpec change with `proposal.md` + `tasks.md` +
delta spec; a clean-ish working tree; baseline per-package test pass counts.

- [ ] `/opsx:apply <change>` — confirm the phase plan before writing code.
- [ ] Build the new primitive + tests **additively**; leave all call sites and the old
      module in place. Get the owning package green + `npm run build` clean.
- [ ] Migrate call sites one phase at a time; run that package's vitest after each.
- [ ] For each red test, `git log`/`git diff HEAD -- <file>` to separate pre-existing
      failures from your breakage before debugging.
- [ ] Do lint allow-list, `AGENTS.md`, `CHANGELOG.md` as their own tasks.
- [ ] Defer un-unit-testable runtime smokes into a sibling `*-smoke-suite` change; mark
      originals deferred with inline pointers + CHANGELOG cross-link.
- [ ] `/opsx-verify` → fix **every** WARNING (orphans, seam-name drift, spec/impl
      constant mismatch) → re-verify zero symbol matches.
- [ ] `/opsx-archive` (syncs delta into main spec) → `commit` (stage only the related set).

**Final artifacts:**
`packages/shared/src/server-launcher.ts`, `packages/shared/src/platform/binary-lookup.ts`
(`resolveJiti`), `packages/shared/src/platform/node-spawn.ts`
(`buildNodeImportArgvParts`); migrated call sites in `packages/extension`,
`packages/server`, `packages/electron`; new change
`openspec/changes/server-launch-smoke-suite/`; archived
`openspec/changes/archive/2026-05-09-unify-server-launch-ts-loader/`; commit `6b0c7f2e`.

---

_Generated from session `019e0d7e-d122-7615-9bd9-369e55fa2840` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-09. Source extract: session facts sheet (mktemp)._
