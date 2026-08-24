---
session: 019ea150
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); heavy steering (8 user prompts); large facts sheet (~12049 tok)"
upgrade_status: pending
openspec_changes: [add-inline-terminal-card]
proposal_excerpt: "The dashboard has two terminal modes with a gap between them."
---

# How we did it: Inline interactive terminal card — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a single slash command: `/skill:openspec-apply-change add-inline-terminal-card`. The *real* objective — clear only after the steering turns — was to **take a fully-planned OpenSpec change (proposal/design/tasks all written, zero code) all the way to merged**: implement the inline interactive terminal card across four packages, verify it in a real browser, archive the change, sync specs, open a PR, get CI green, merge, and remove the worktree. In short: drive an idle "apply" from 0% implementation to a squash-merged PR on `develop`.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <name>` — kick off the apply.
2. When it stalls, say **"openspec stucked"** — force the AI to re-check *filesystem reality* (git status + task checkboxes), not the tasks.md checkbox state.
3. Have the AI read the context files, then **stop and flag any spec-vs-codebase design conflict via `ask_user` before coding** (here: tasks said "extension spawns PTY" but the codebase spawns terminals client→server).
4. Confirm the direction (Option A — client-driven) so tasks.md gets rewritten to match reality.
5. Implement bottom-up: `shared` types → `server` handlers/manager → `client` components/reducer/composer. Typecheck each layer.
6. Say **"Create a separated env (home, ports) and test with browser"** — isolated `HOME` (short path!) + non-default ports, then a browser-driven WS protocol test.
7. `/skill:openspec-archive-change <name>`, then **"sync stuck"** → do the spec sync directly when the subagent stalls.
8. **"commit, push and create PR, monitor CI"** → fix the one cross-package type error CI catches (worktree can't typecheck against the parent's `node_modules`) → green.
9. **"merge PR"** (squash) → **"delete branch and worktree"**.

## 3. How the collaboration unfolded

**Phase 1 — Unstick the apply (Discovery).** The apply had stalled with *all 23 tasks unchecked and git clean* — i.e. artifacts complete, zero implementation. Prompted by "openspec stucked", the AI checked `git status` + task state and correctly concluded no code existed yet, then read the context files. *Why it worked:* trusting filesystem reality over the checkbox let it restart cleanly.

**Phase 2 — Investigate before coding, flag the conflict (Design).** ~30 `grep`/`read` calls mapped the terminal spawn flow and event pipeline. The AI found a genuine **design conflict**: tasks.md said the *extension* detects bare `!!` and spawns the PTY, but the extension has no terminal-manager — terminals are spawned client → server → `terminalManager.spawn()`. It paused and used `ask_user` to present Option A (client-driven, matches existing flow) vs Option B. *Decision point:* the human picked A; tasks.md was rewritten to match.

**Phase 3 — Implement bottom-up (Generate).** `shared` (`ephemeral` flag, two new event data types, `open_/close_inline_terminal` browser messages) → `server` (`spawn(cwd,{ephemeral})` + `getTranscript`, two handlers, `broadcastEvent` wiring) → `client` (new `InlineTerminalCard`, reducer arms, `ChatView`/composer button, ephemeral filter in `TerminalsView`). Typechecking per layer surfaced that the **worktree has no own `node_modules`** — imports resolve to the *main* checkout's `packages/shared`, so in-worktree `tsc` can't see the edits (but runtime tests can, since shared edits are type-only).

**Phase 4 — Isolated browser verification (Verify).** Prompted by "Create a separated env", the AI built an isolated `HOME=/tmp/pi-it` + ports 8123/9123 + Vite on 5173. Unit tests (34) passed. The full interactive test hit a **pre-existing bridge `hasUI` crash** that crash-looped keepers and, worse, the spawned pi bridges **defaulted to piPort 9999 (the user's real dashboard)** and burned API credits — the AI had to kill its own keepers, accidentally took down the user's dashboard, and restored it. It then fell back to a **zero-LLM browser-driven WebSocket protocol test** that drove `open → PTY exec → close` against the real server (transcript 446 bytes, `hasEcho=true`). This incident produced the one saved memory.

**Phase 5 — Archive, sync, ship (Land).** `/skill:openspec-archive-change`, then the spec-sync subagent stalled ("sync stuck") so the AI did the sync directly (created `inline-terminal/spec.md`, modified `terminals-view`). Committed (excluding dev-run noise files), pushed, opened PR #92. First CI run failed `npm run lint` on exactly the cross-package type error the worktree couldn't see (`getTranscript` missing from a strict mock) — fixed, green. Squash-merged, remote+local branch and worktree removed.

## 4. Prompts that worked

- **`/skill:openspec-apply-change add-inline-terminal-card`** — good kickoff: names the exact change and delegates to the skill. Stronger next time: append *"if 0 tasks are done, verify git reality before assuming progress."*
- **"openspec stucked"** — tiny prompt, high leverage: forced the AI to distinguish "artifacts done" from "code done" and restart.
- **"Create a separated env (home, ports) and test with browser"** — unlocked the whole verification phase. Stronger: *"use a SHORT isolated HOME and confirm the spawned bridge points at the isolated pi-port, not 9999, before spawning any session."*
- **"commit, push and create PR, monitor CI"** — one prompt chained five steps and caught the type error the worktree couldn't.
- **"sync stuck" / "merge PR" / "delete branch and worktree"** — terse redirections that kept momentum when a subagent hung or a phase completed.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat a stalled apply as "in progress" | "openspec stucked" | Check `git status` + task checkboxes first; artifacts-done ≠ code-done |
| Wait passively when a subagent hung | "sync stuck" | Set a stall timeout; do the sync/spec work directly if a spawned subagent doesn't return |
| Assume isolated ports fully isolate a spawned pi | "Create a separated env (home, ports)" | The bridge defaults to piPort **9999** (the user's dashboard) unless the isolated pi-port is enforced — verify before spawning |
| Use a long `mktemp` HOME | (incident) | Unix socket path >~104 chars → `listen EINVAL`; use a short HOME like `/tmp/pi-it` |
| Follow tasks.md literally over the codebase | Confirm Option A | Pause via `ask_user` on any spec-vs-reality conflict *before* implementing |

## 6. Skills, tools & memory created — and why they're effective

**Memory saved (project scope):** *"Isolated dashboard testing: isolating server ports (`--port`/`--pi-port`) is NOT enough — a dashboard-spawned pi session's bridge defaults to piPort 9999 (the user's dashboard) unless [enforced]."*
- **What it captures:** the exact reason an "isolated" test can still hit the real dashboard and burn API credits.
- **Why it's effective:** it turns a costly incident (killed the user's dashboard, spent real credits) into a one-line pre-flight check.
- **When to invoke:** any time you spin up a second dashboard/pi environment for verification.

**Recommended skill to create** (not created this session): an **"isolated dashboard UI verification"** procedure — short HOME, enforced isolated pi-port, prefer a **zero-LLM browser-driven WebSocket protocol test** over spawning live sessions when the goal is to exercise server/protocol code. This session did it ad-hoc; codifying it would remove ~30 min of trial-and-error and the credit-burn risk. *(A project skill matching this — `isolated-ui-verification` — is the right home.)*

## 7. Pitfalls & dead ends

- **Worktree has no `node_modules`** → in-worktree `tsc` resolves shared types from the *main* checkout, so cross-package type errors (e.g. a mock missing a new method) are invisible until CI. Mitigate: pull the full lint log in one pass; expect CI to catch strict-mock drift.
- **Long isolated HOME breaks the RPC keeper** → `listen EINVAL` (Unix socket >104 chars). Use `/tmp/pi-it`.
- **Spawned bridge defaults to piPort 9999** → connects to the *user's* dashboard, spawns a respawn loop that burns API credits. Kill only processes with `HOME=/tmp/pi-it` (filter by env, not a broad grep).
- **Pre-existing bridge `hasUI` getter crash** crash-loops keepers — don't fight it; fall back to a protocol-level WS test.
- **Subagents stalled twice** (docs update, spec sync) — have a fallback to do the work inline.
- **Dev-run noise files** (`.pi/settings.json` source rewrite, regenerated `plugin-registry.tsx`) appear in git — exclude them from the feature commit.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-apply-change <name>` — if stalled, verify **git reality** (status + task checkboxes) before assuming progress.
- [ ] Investigate the real data/spawn flow; **`ask_user` on any spec-vs-codebase conflict** before coding.
- [ ] Implement bottom-up: `shared` → `server` → `client`; typecheck each layer.
- [ ] Verify in isolation: **short** `HOME=/tmp/pi-it` + non-default ports; **enforce the isolated pi-port** (bridge defaults to 9999); prefer a zero-LLM browser-driven WS protocol test.
- [ ] Run touched-area unit tests; confirm any failures are pre-existing on the baseline.
- [ ] `/skill:openspec-archive-change <name>`; if spec-sync subagent stalls, sync directly.
- [ ] Exclude dev-run noise files; commit, push, open PR against `develop`, monitor CI.
- [ ] Fix the cross-package type error CI surfaces (worktree can't typecheck against parent `node_modules`).
- [ ] Squash-merge; delete remote+local branch; `git worktree remove` from the main repo.

**Key inputs to have ready:** an OpenSpec change with all artifacts written; a working `pi` + `pi-dashboard` + `agent-browser`; the user's auth/model seeded into the isolated HOME.
**Final artifacts:** `InlineTerminalCard.tsx`, reducer + server handler tests, `inline-terminal/spec.md`, squash-merged PR #92 (`b91a6b93`) on `develop`.

---

_Generated from session `019ea150` · `pi-agent-dashboard/.worktrees/os-add-inline-terminal-card` · 2026-06-07. Source extract: deterministic facts sheet (session-to-guideline)._
