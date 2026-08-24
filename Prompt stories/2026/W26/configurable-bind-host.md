---
session: 019f065e
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [configurable-bind-host]
proposal_excerpt: "The dashboard HTTP server binds to `0.0.0.0` unconditionally (`packages/server/src/server.ts` — `fastify.listen({ port, host: \"0.0.0.0\" })`), and the pi gateway WebSocket server binds all interfaces by omitting `host`…"
---

# How we did it: Configurable bind host — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user kicked off with a single skill invocation:

```
/skill:openspec-apply-change configurable-bind-host
```

The real objective, once the proposal was read: **stop binding the dashboard to every
network interface by default.** Both listeners — the Fastify HTTP server (hardcoded
`host: "0.0.0.0"`) and the pi gateway WebSocket server (omitting `host`, so all
interfaces) — should default to loopback `127.0.0.1`, with an explicit opt-in chain
(`--host` flag → `PI_DASHBOARD_HOST` env → `config.bindHost` file → `127.0.0.1`)
mirroring how `port` already resolves. Docker keeps `0.0.0.0` so the published port
stays reachable. A Settings UI picker exposes the choice with an exposure warning, and
`bindHost` is restart-required. The one steering turn — *"I will test later, use
ship-change skill"* — told the AI to carry the change all the way through the ship
pipeline (archive, PR, CI, CodeRabbit, merge) rather than stopping for manual QA.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change configurable-bind-host` — read `proposal.md` +
   `design.md` + `tasks.md`, then the source files each task touches.
2. **Plumb config bottom-up**: add `bindHost` to `DashboardConfig` +
   `DEFAULTS.bindHost = "127.0.0.1"` in `packages/shared/src/config.ts`; add `host` to
   `ServerConfig` and the `--host → env → file → default` chain in `cli.ts`.
3. **In the worktree, run `npm install` FIRST** — a fresh worktree has no
   `node_modules`, so imports resolve to the *parent* repo's `packages/shared` and your
   edits are invisible to `tsc`. Install makes the workspace symlinks point local.
4. **Wire the listeners**: `fastify.listen({ host: config.host })` in `server.ts`;
   `piGateway.start(port, host?)` → `new WebSocketServer({ port, host })`.
5. **Fix every inline `ServerConfig` fixture** — `host` is now required, so all test
   constructors break. Typecheck (`npx tsc --noEmit`), batch-add `host`, repeat to 0.
6. **Write a real-socket bind test** (bind, then assert loopback-only vs all-interfaces
   reachability) — use port `0` + poll `address()` since `listen` is async.
7. **Settings UI + Docker + docs**: 3-way listen-interface picker (restart-required);
   `PI_DASHBOARD_HOST=0.0.0.0` in `docker/compose.yml`; delegate all `docs/` prose to a
   subagent with the caveman-style rule verbatim.
8. **Ship**: `openspec archive`, commit via a message *file* (avoid backtick issues),
   push, open PR, watch CI, triage CodeRabbit, loop until green + no actionable threads,
   squash-merge, delete branch, remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery.** The AI read the change artifacts and every file a task
referenced (`server.ts`, `pi-gateway.ts`, `config-api.ts`, the CLI, the Settings panel,
existing config tests) *before* writing a line. This front-loading meant the resolution
chain and restart-wiring landed correctly on the first pass.

**Phase 2 — Config plumbing (bottom-up).** Shared config → CLI resolution → listeners.
Doing it in dependency order kept each typecheck failure local and explainable. The
decision to **mirror the existing `port` precedence** rather than invent a new pattern
made the diff reviewable and the tests obvious.

**Phase 3 — The invisible-edits trap.** `tsc` reported errors that made no sense until
the AI realized the worktree had **no `node_modules`** — imports were resolving to the
parent repo's built `packages/shared`. Running `npm install` in the worktree repointed
the workspace symlinks and the edits became visible. This was the single biggest time
sink and the most reusable lesson.

**Phase 4 — Test fixture fan-out.** Making `host` required on `ServerConfig` broke every
inline fixture. The AI drove typecheck-to-zero as a loop: run `tsc`, grep the broken
files, batch-add `host`, re-run. It also wrote a focused **real-socket** bind test
instead of a mock, catching actual reachability.

**Phase 5 — UI, Docker, docs.** A 3-way picker (loopback / all / specific-NIC) with an
exposure warning, wired restart-required. Docker gained `PI_DASHBOARD_HOST=0.0.0.0` in
the base compose (which the test overlay inherits → port 18000 stays reachable). Per
AGENTS.md, **all `docs/` writes were delegated to a subagent** with the caveman-style
rule passed verbatim.

**Phase 6 — Ship & the CodeRabbit loop.** After *"use ship-change"*, the AI archived,
committed, pushed, opened PR #171, and ran **three CI rounds**. CodeRabbit's most
valuable catch: the AI had "fixed" an IPv6 flake by switching fixtures to bind `0.0.0.0`
— which *doesn't* fix the ambiguity (0.0.0.0 is IPv4-wildcard; `localhost`→`::1` still
misses it) *and* eroded loopback-default coverage. The correct fix was **uniform IPv4
loopback on both ends**: revert bind to `127.0.0.1` and switch connect URLs to
`127.0.0.1`. Merged as squash `2d665356`.

## 4. Prompts that worked

**The goal prompt** — `/skill:openspec-apply-change configurable-bind-host`. Effective
because the OpenSpec artifacts (proposal/design/tasks) already encoded the objective,
the resolution chain, and a 26-task checklist. The skill turns a one-liner into a fully
scoped implementation. *Lesson: front-load the spec so the kickoff prompt can be tiny.*

**High-leverage follow-up** — *"I will test later, use ship-change skill"*. A 9-word
steer that (a) authorized marking the one manual task done for post-merge verification
and (b) delegated the entire archive→PR→CI→merge pipeline. It removed a stop-and-ask
boundary and let the AI run autonomously to a merged PR.

A stronger version to reuse: *"Manual cross-host check is deferred — mark 8.2 for
post-merge and run ship-change through to squash-merge; document any CodeRabbit deferrals
as PR comments."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human / reviewer had to steer by… | Bake this in next time by… |
|-------------------|----------------------------------------|----------------------------|
| Edit worktree files while `tsc` resolved imports to the **parent repo** | (self-caught) run `npm install` in the worktree first | Make "worktree → `npm install` before typecheck" step 0 of any worktree change |
| "Fix" an IPv6 loopback flake by binding `0.0.0.0` | CodeRabbit: 0.0.0.0 doesn't fix `::1` ambiguity + erodes coverage | Use **uniform IPv4 `127.0.0.1`** on both bind and connect URLs |
| Assert `address()` immediately after `start()` | Poll until bound — `WebSocketServer.listen` is async | Use port `0` + poll `address()` in socket tests |
| Stop at "25/26, 8.2 is manual" | *"I will test later, use ship-change"* | State deferral policy up front so manual tasks don't block the pipeline |
| Consider writing `docs/` prose directly | AGENTS.md rule | Always delegate `docs/` writes to a subagent with caveman-style rule verbatim |
| `gh pr merge` tried to switch local to `develop` (checked out in parent worktree) | delete remote branch explicitly, run cleanup via sandbox shell with explicit cwd | Expect the merge to abort the local switch from inside a worktree; verify remote merge, then clean up manually |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session ran on existing ones
(`openspec-apply-change`, `ship-change`, the implement/review gates). The workflow is,
however, highly repeatable, and two lessons deserve durable capture:

- **"Worktree needs `npm install` before typecheck"** — a project-scoped memory/skill.
  It removes the single most confusing failure mode (edits invisible to `tsc` because
  imports resolve to the parent repo). Invoke whenever starting an OpenSpec change in a
  fresh `.worktrees/*` directory.
- **"IPv4 loopback uniformity in socket tests"** — bind and connect must both use
  `127.0.0.1` (not `0.0.0.0` + `localhost`) to avoid IPv6 `::1` flakes *and* preserve
  loopback-default regression coverage.

## 7. Pitfalls & dead ends

- **Invisible edits.** No `node_modules` in the worktree → imports hit the parent repo's
  `packages/shared` → your edits don't typecheck. Fix: `npm install` in the worktree.
- **`0.0.0.0` is not a loopback flake fix.** It's the IPv4 wildcard; `localhost` may
  resolve to `::1` and still miss it, and it weakens the loopback-default test. Fix:
  `127.0.0.1` on both ends.
- **Async `address()`.** `WebSocketServer` binds asynchronously; `address()` is `null`
  right after `start()`. Poll it. Prefer port `0` for ephemeral binding.
- **Commit messages with backticks.** Write the message to a temp file
  (`git commit -F /tmp/commit-msg.txt`) to dodge shell backtick expansion.
- **`gh pr merge` from inside a worktree.** It tries to switch local to `develop`, which
  the parent worktree already has checked out, and aborts. The remote squash-merge still
  succeeds — verify it, then delete the remote branch and remove the worktree manually
  via a shell with an explicit cwd (the Bash tool stays pinned to the deleted dir).
- **Flaky unrelated timeout.** `search-files-ranking.test.ts` timed out under
  back-to-back full-suite load (10.5s vs 5s) — not caused by the change; it passed in
  isolation. Don't chase unrelated load-flakes when CI is already green.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; a worktree at
`.worktrees/os-<change>`; `gh` auth for the PR/merge; CodeRabbit enabled on the repo.

- [ ] `/skill:openspec-apply-change <change>` — read proposal/design/tasks + touched src
- [ ] **`npm install` in the worktree** (repoint workspace symlinks) before any typecheck
- [ ] Plumb config bottom-up: `bindHost` in shared → `host` + resolution chain in `cli.ts`
- [ ] Wire listeners: `fastify.listen({ host })`, `WebSocketServer({ port, host })`
- [ ] `npx tsc --noEmit` loop → add `host` to every inline `ServerConfig` fixture → 0 errors
- [ ] Real-socket bind test: port `0`, poll `address()`, `127.0.0.1` both ends
- [ ] Settings picker (restart-required) + `PI_DASHBOARD_HOST=0.0.0.0` in `docker/compose.yml`
- [ ] Delegate `docs/` writes to a subagent with the caveman-style rule verbatim
- [ ] Full suite (`npm test`), `openspec validate`, Biome on changed files
- [ ] `ship-change`: archive → commit via `-F` file → push → PR → CI → triage CodeRabbit →
      loop to green → squash-merge → delete branch → remove worktree

**Final artifacts:** PR #171 (squash-merged `2d665356`), archived change
`2026-06-27-configurable-bind-host`, spec `openspec/specs/server-bind-host/`, new test
`packages/server/src/__tests__/pi-gateway-bind-host.test.ts`.

---

_Generated from session `019f065e-4cf9-74a2-a6ea-eaef8666fb03` · `pi-agent-dashboard` · 2026-06-27. Source extract: session facts sheet._
