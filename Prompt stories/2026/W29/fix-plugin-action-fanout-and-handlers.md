---
session: 019f6c81
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-plugin-action-fanout-and-handlers]
proposal_excerpt: "The dashboard's intended way to drive any extension from a client is one generic message: `{type:\"plugin_action\", pluginId, sessionId, action, payload}`. As-built it does not generalize:"
---

# How we did it: fix-plugin-action-fanout-and-handlers — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single skill invocation — `/skill:openspec-ff-change
fix-plugin-action-fanout-and-handlers` — against an OpenSpec change whose **proposal
and specs already existed** but whose `design.md` and `tasks.md` were still missing.
The *real* objective, once the two follow-ups landed (`commit`, then a paste of the
`ship-it` skill), was end-to-end: **fast-forward the remaining artifacts, then fully
implement, test, review, and land the change through a PR into `develop`.**

The change itself: make `plugin_action` a real universal seam. As-built, the gateway
keyed handlers by *message type* (`Map<type,Handler>`), so the `goal` plugin's
registration silently overwrote `flows` — last-writer-wins. The goal was to fan out by
`pluginId` and give flows/kb/automation **real** handlers dispatching through in-process
cores (not HTTP re-entry).

## 2. TL;DR playbook

1. `/skill:openspec-ff-change <change>` — fast-forward the missing artifacts (design → tasks).
2. Before writing `design.md`, **grep the live source** to ground every decision (registry shape, where `plugin.manifest.id` is in scope, each plugin's core functions).
3. Write `design.md` with numbered decisions + explicit *rejected alternatives*; then generate `tasks.md`.
4. `commit` the artifacts with the repo's `plan(<change>): …` message convention.
5. Invoke **`ship-it`** (paste the skill) to run the worktree implementation phase headless.
6. TDD each layer: failing contract test first, then the gateway fan-out registry, then per-plugin handlers, each with its own handler test.
7. If cross-package imports fail tsc in a worktree → **`npm install` inside the worktree** to create workspace symlinks (see §7).
8. Typecheck clean + `npm test` green (ignore the known doctor-route timing flake), then run the **docker harness as a boot smoke** to prove all plugins still load.
9. Drive `ship-change` inline: archive+sync specs, commit, push, open PR, watch CI, triage CodeRabbit (**only your files**), squash-merge, remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Fast-forward the artifacts (Discovery → Design).** The AI read the existing
proposal/specs, then ran ~15 grep/sed probes against the real code *before* writing a word
of design: the `customHandlers` registry, the `createContext: (plugin) => …` wiring (which
proved `plugin.manifest.id` was in scope at `server.ts:1776`), and each plugin's server
core. It then wrote `design.md` as 5 grounded decisions — each with the rejected
alternative — and generated `tasks.md`. *Why it worked:* grounding design in greps, not
guesses, made every later implementation task a mechanical fill-in.

**Phase 2 — Implement TDD, layer by layer (Generate).** After `commit` and the `ship-it`
paste, the AI merged `origin/develop` (backstop), then implemented in dependency order:
shared protocol type (`PluginActionErrorMessage`) → failing gateway contract test → the
fan-out registry + dispatch branch → per-plugin handlers (flows, kb, automation), each
preceded by studying that plugin's existing core so the handler dispatched through the
*same* in-process function as the REST route. It refactored kb/automation cores to export
minimal shared functions (DRY, no HTTP re-entry).

**Phase 3 — Verify (Test).** tsc + `npm test` (10565 passed), plus a **docker harness boot
smoke** to prove the `server.ts` wiring change didn't break plugin loading — all 8 plugins
loaded. The lone test failure was a pre-existing doctor-route timing flake, confirmed by
re-running in isolation.

**Phase 4 — Ship (Review → Land).** `ship-change` inline: archive+sync specs, commit,
push, PR #343, watch CI to green, triage 14 CodeRabbit comments (**most belonged to other
changes' files** — only 3 targeted this change), apply the 3, re-verify, squash-merge, and
clean up the worktree.

**Decision points the human owned:** the initial ff invocation, the explicit `commit`, and
handing over `ship-it` to authorize the full implement-and-land run.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-ff-change fix-plugin-action-fanout-and-handlers`.
  Effective because it named the exact change and delegated the "which artifact next"
  decision to the skill. A stronger version states the end state up front: *"ff the missing
  artifacts for `<change>`, then ship-it end-to-end."*
- **`commit`** — a one-word unlock that checkpointed the artifacts before the risky
  implementation phase. High-leverage: clean git state before `ship-it`.
- **Pasting the `ship-it` skill** — authorized the entire worktree implement→test→review→land
  pipeline in one move, headless. The highest-leverage prompt of the session.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after creating artifacts | `commit`, then paste `ship-it` | State "ff **then** ship-it" in the goal prompt so it runs continuously |
| Treat the whole CodeRabbit batch as in-scope | (self-corrected) isolate comments to *this change's* files only | Make "only touch files in this diff" an explicit surgical rule up front |
| Trust worktree tsc that resolved to the **parent** repo's stale `packages/` | (self-corrected) `npm install` in the worktree | Save the worktree-install fix as a memory/skill (see §7) |

The session was low on human corrections — the `ship-it` skill carried the quality bars
(TDD, no-weakening, surgical changes, harness gate) so the AI self-steered.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session was a clean *application* of existing
ones (`openspec-ff-change`, `openspec-apply-change`, `ship-it`, `ship-change`, the docker
harness). The reusable asset worth noting is the **worktree module-resolution fix** (§7);
if this recurs it should become a project memory:
*"cross-package imports invisible to tsc/vitest in a `.worktrees/*` checkout → run `npm
install` inside the worktree to create self-referential workspace symlinks."*

## 7. Pitfalls & dead ends

- **Worktree cross-package imports resolve to the parent repo.** tsc flagged
  `plugin_action_error` "not in the union" — because the worktree's empty `node_modules`
  made `@blackbelt-technology/pi-dashboard-shared` resolve to the *parent* repo's
  `packages/shared` (which lacked the edit). Fix: `npm install` inside the worktree. tsc
  went from spurious errors to 0.
- **The `edit` tool applies one oldText/newText per edit.** A second replacement in the
  same call was silently ignored — verify and re-apply.
- **Doctor-route timing flake.** `npm test` showed one failure (`elapsed < 3000`, got
  4149ms) unrelated to the change; confirmed flaky by re-running in isolation on a quiet
  machine. Don't chase it.
- **CodeRabbit reviewed files from *other* changes** (add-cloud-sync-connector,
  add-universal-network-guard). Only 3 of 14 comments targeted this change's files — apply
  those, skip the rest (surgical rule).
- **Squash-merge branch-collision on cleanup.** The trailing `gh` git error after merge is
  the documented worktree pitfall — the remote merge succeeded; only the local `develop`
  checkout failed. Removing the worktree deletes the shell's cwd, so re-anchor to the parent
  repo before finishing cleanup.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-ff-change <change>` — ground design in greps, write decisions + rejected alternatives, generate tasks.
- [ ] `commit` the artifacts (`plan(<change>): …`).
- [ ] Invoke `ship-it`; it merges develop, applies TDD (failing test → impl → per-layer tests), runs tsc + `npm test` + docker harness smoke, then ship-change (archive, PR, CI, CodeRabbit, squash-merge, cleanup).
- [ ] If worktree tsc/vitest sees stale cross-package types → `npm install` in the worktree.
- [ ] Triage CodeRabbit to **this change's files only**; ignore the doctor-route flake.

**Inputs to have ready:** an OpenSpec change with proposal+specs present; a working docker
daemon for the harness; `gh` auth for the PR.

**Artifacts produced:** `design.md`, `tasks.md`; gateway fan-out (`browser-gateway.ts`,
`server.ts`, `browser-protocol.ts`); real handlers in flows/kb/automation plugins;
`bus-client` allow-list; 4 new test files; merged **PR #343** (SHA `91f140b5`).

---

_Generated from session `019f6c81` · `pi-agent-dashboard/.worktrees/os-fix-plugin-action-fanout-and-handlers` · 2026-07-16. Source extract: `/var/folders/qb/m1_q3v6d5bnfzbpmc0dkkqx40000gn/T/session_facts.PERfvgn98D.md`._
