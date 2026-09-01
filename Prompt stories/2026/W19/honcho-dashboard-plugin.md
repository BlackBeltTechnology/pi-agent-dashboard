---
session: 019e0473
week: 2026/W19
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [honcho-dashboard-plugin]
proposal_excerpt: "`pi-memory-honcho` (acsezen) ships persistent cross-session memory for pi via Honcho, but every user-facing surface lives behind TUI slash-commands (`/honcho:setup`, `/honcho:doctor`, `/honcho:interview`, …). Dashboar…"
---

# How we did it: Implementing a 55-task OpenSpec plugin change with a delegated subagent — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator invoked the standard OpenSpec apply flow — first prompt was the
`/opsx:apply` template: *"Implement tasks from an OpenSpec change… Select the change,
check status to understand the schema, get apply instructions, implement the tasks."*
The real objective, once the AI loaded the change, was concrete and large: **stand up a
brand-new `packages/honcho-plugin/` dashboard plugin** — 55 in-scope tasks across six
phases (scaffold → shared types → config persistence → Honcho SDK → docker lifecycle →
model aggregation) — that exposes the `pi-memory-honcho` memory system as dashboard UI
instead of TUI-only slash-commands. Get it to compile, get its tests green, and mark the
`tasks.md` checkboxes done. All of it in one ~54-minute session.

## 2. TL;DR playbook

1. Kick off with `/opsx:apply honcho-dashboard-plugin`; let the AI announce the change,
   schema (`spec-driven`), and total task count from `openspec status --json`.
2. **Make it scope-check BEFORE coding.** The AI correctly flagged "103 tasks, huge" and
   narrowed to the 55 in-scope tasks (Phases 1–5b), deferring 6–103. Confirm that split.
3. Have it **peek at one sibling plugin first** (`packages/jj-plugin/`) to lock package
   layout, `tsconfig`, and server-entry conventions — do this before any file is written.
4. **Delegate the bulk build to a general-purpose subagent** running in-place at
   `packages/honcho-plugin/`, with instructions to TDD each phase and tick `tasks.md`.
5. Do **not** pass an unsupported model override on the spawn — launch with the default
   model (see Pitfalls: `claude-sonnet-4` was rejected by the routed provider).
6. When the subagent goes quiet, **verify against disk, not the agent's report**: `find`
   the files, run `npx tsc --noEmit -p <pkg>/tsconfig.json`, then `npx vitest run --project
   <pkg-name>`.
7. Close the gaps the reaped subagent left: run `npm install` for the missing dep, fix the
   trivial test typing, and hand-write the missing `src/server/index.ts` registerPlugin
   entry that mounts everything.
8. Re-run typecheck + tests until **0 errors / all green**, then mark the in-scope
   `tasks.md` checkboxes with a scripted edit.

## 3. How the collaboration unfolded

**Phase A — Select & scope (00:03–00:06).** The AI ran `openspec status` and
`instructions apply`, announced *Using change: honcho-dashboard-plugin, schema spec-driven,
0/103 tasks*, and — crucially — **paused to reality-check the size** before writing
anything. It read the context files, recognised the work as net-new package scaffolding,
and drew the in-scope line at 55 tasks. *Why it worked:* stating the scope split up front
kept a 103-task monster from being attempted (and half-done) on the main thread.

**Phase B — Lock conventions (00:06).** Before launching anything, the AI `cat`'d
`packages/jj-plugin/`'s `package.json` + `tsconfig.json` and walked its `src/` tree to
mirror the monorepo plugin layout. *Why it worked:* one sibling read replaces a dozen
downstream "how do we structure this" guesses.

**Phase C — Delegate the build (00:06–00:09).** The AI spawned a `general-purpose`
subagent to scaffold + implement phases 1–5b in-place, TDD-style, ticking `tasks.md` as it
went. The first spawn **failed** (`claude-sonnet-4` not supported by the routed provider);
the AI immediately re-launched **without the model override** and the default-model agent
took over. *Decision point:* delegate rather than grind 55 tasks inline — the right call
for volume, but see the reaping pitfall below.

**Phase D — The silent stall (00:53).** The only human steering turn of the whole
session — *"is it running?"* — arrived ~45 min in. The AI checked, found ~32 files on disk
but the agent file last modified 35 minutes prior, and `get_subagent_result` returning
"not found / cleaned up". **The subagent had been reaped mid-batch — no error, just silent
termination.** No `tasks.md` ticks, no final typecheck/test run.

**Phase E — Recover from disk (00:54–00:57).** The AI treated the disk as ground truth: it
`find`'d the 32 files, ran `tsc --noEmit` (only 2 errors: 1 missing-install, 1 trivial test
typing), ran `npm install` + `vitest` (**46/46 pass**), spotted the one structural gap
(**missing `src/server/index.ts` registerPlugin entry**), hand-wrote it, re-ran everything
to **46/46 tests + 0 type errors**, and scripted the `tasks.md` checkbox update to
**54/103 done** (all in-scope, task 1.6 skipped per the monorepo override).

## 4. Prompts that worked

- **The goal prompt** (`/opsx:apply honcho-dashboard-plugin`) — effective because the
  template forces the AI to *select → status → instructions → implement* deterministically,
  so it self-loads the schema and task count instead of guessing scope.
- **High-leverage follow-up: "is it running?"** — three words that triggered the entire
  recovery. A single liveness check exposed a silently-reaped subagent and pivoted the
  session from "waiting" to "verify against disk and close the gaps." Stronger version to
  bake in: *"Check the subagent's liveness AND verify progress on disk — don't trust its
  report; run typecheck + tests on what's actually written."*

Rewrite of the implicit kickoff a future operator should say up front:
> *"Apply honcho-dashboard-plugin. It's ~103 tasks — split in-scope vs deferred first, read
> one sibling plugin for conventions, then delegate the build to a subagent with the
> default model. Verify its output against disk (find + tsc + vitest), not its report."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Fire-and-forget the subagent, then wait passively for a report | "is it running?" | Poll subagent liveness on a timer; if the agent file goes stale, assume reaping and verify on disk |
| Spawn with an explicit model override (`claude-sonnet-4`) that the routed provider rejects | (self-corrected) re-launch with default model | Never pass an unsupported model on `Agent` spawn — omit the override or use a role alias known to route |
| Trust `get_subagent_result` / the agent's own tick of `tasks.md` | Re-derive status from disk (`find`, `tsc`, `vitest`) | Treat disk + a clean typecheck/test run as the source of truth for "done", not the checkbox |
| Attempt the full 103-task change as one unit | Scope-split to 55 in-scope tasks up front | State the in-scope/deferred boundary before writing any file |

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created in this session (Premium candidate: no). But the
workflow is clearly repeatable and **should be captured as a skill**:

- **Proposed skill: `delegate-and-verify-large-openspec-apply`.** Captures the loop that
  worked here — scope-split → read a sibling for conventions → delegate the bulk to a
  general-purpose subagent → **verify against disk, not the agent's report** → close the
  gaps (missing entry file, missing install, trivial typing) → re-run to green → tick
  `tasks.md`. Invoke it whenever an OpenSpec change is too large for the main thread
  (≳40 tasks / net-new package) and delegation is warranted. Its highest-value guardrail:
  *a delegated subagent can be silently reaped mid-batch — always reconcile with disk.*

## 7. Pitfalls & dead ends

- **`claude-sonnet-4` not supported by routed provider.** The first subagent spawn died
  instantly on the model override. *If you hit it:* re-launch with **no model override**
  (default) or a role alias you know routes; don't pass raw provider model ids the router
  can't resolve.
- **Subagent reaped mid-batch, silently.** 32 files written, then the agent terminated with
  no error and `get_subagent_result` returned "not found / cleaned up" — no `tasks.md`
  ticks, no final test run. *If you hit it:* stop waiting; `find` the package tree and run
  `tsc --noEmit` + `vitest` to see the real state.
- **Missing `src/server/index.ts` registerPlugin entry.** The subagent scaffolded every
  phase's files but never wrote the entry that mounts them. *If you hit it:* hand-write the
  registerPlugin entry with lifecycle init gated on config; it's the glue the phase files
  assume exists.
- **`vitest` needs an isolated HOME.** The passing test runs used `HOME=$(mktemp -d) npx
  vitest run --project <pkg>` to avoid the real home's config bleeding into the run.
- **Two failed `grep`/`find` commands** were harmless probes into the not-yet-written tree —
  expected while the subagent was still producing files.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name (`honcho-dashboard-plugin`), a sibling
plugin to mirror (`packages/jj-plugin/`), a subagent model that routes (default / a known
role alias — NOT a raw `claude-sonnet-4`).

1. `/opsx:apply <change>` → let it announce schema + task count.
2. Scope-split: confirm in-scope vs deferred tasks before any file is written.
3. `cat packages/jj-plugin/{package.json,tsconfig.json}` + walk its `src/` for conventions.
4. Spawn a `general-purpose` subagent, in-place at `packages/<plugin>/`, default model, TDD,
   tick `tasks.md`.
5. Poll liveness; on staleness, **verify on disk**: `find packages/<plugin> -type f`.
6. `npx tsc --noEmit -p packages/<plugin>/tsconfig.json` → fix.
7. `npm install` (for any missing dep) → `HOME=$(mktemp -d) npx vitest run --project <pkg>`.
8. Hand-write any missing `src/server/index.ts` registerPlugin entry.
9. Re-run tsc + vitest to 0 errors / all green.
10. Script the `tasks.md` checkbox update for the in-scope tasks.

**Final artifacts produced:**
- `packages/honcho-plugin/` — 32 files across `src/{client,server,shared,__tests__}/`
  (scaffold, shared types + redact/merge, config persistence, Honcho SDK client, docker
  lifecycle, model aggregation).
- `packages/honcho-plugin/src/server/index.ts` — hand-written registerPlugin + auto-start
  lifecycle entry.
- Edits to `vitest.config.ts` and `packages/honcho-plugin/src/__tests__/redact.test.ts`.
- `openspec/changes/honcho-dashboard-plugin/tasks.md` — 54/103 marked done (all in-scope).
- Result: **46/46 tests pass, 0 type errors.**

---

_Generated from session `019e0473` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-08. Source extract: `session_facts.XXXXXX.HZRKctM0ua`._
