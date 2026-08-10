---
session: ebba6e24
week: 2026/W15
type: documentation
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
---

# How we did it: From a startup crash to committed changes and reconciled docs — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened on an error, not a task: `Warning: Dashboard server failed to
start: Server process exited immediately`. The real objective evolved through the
steering turns — it started as *"get the dashboard server running again,"* drifted
through a couple of quick ops questions (uninstalling a `.deb`, the Electron app
name), and landed on the substantive work: **commit a large backlog of uncommitted
changes with a meaningful message, then reconcile the project docs (README,
architecture, AGENTS.md) against what the code actually does now.** One session, three
distinct micro-jobs, each triggered by a terse one-line prompt.

## 2. TL;DR playbook

1. **Reproduce the failure with the real entrypoint.** `npx pi-dashboard start 2>&1; echo "EXIT: $?"` — the bare `pi-dashboard` binary wasn't on PATH; `npx` resolves the workspace bin.
2. **Confirm health, don't assume.** `curl -s http://localhost:8000/api/health` to prove the server is actually up (PID, mode, session count) before declaring victory.
3. **Survey before committing.** `git status --short` + `git diff --stat` to see the blast radius (19 files) before staging anything.
4. **Stage and commit, then immediately inspect.** `git add -A && git commit`, then `git log --oneline -5` and `git diff --stat HEAD~1 HEAD` to verify what actually landed.
5. **Rewrite a weak commit message from the diff, not from memory.** `git diff HEAD~4 HEAD --name-only | sort` to derive the true scope, then `git commit --amend -m "feat: …"`.
6. **Diff code vs docs to find real drift.** Read the changed source (`provider-auth-*.ts`, editor detection, `.dockerignore`) and classify each change: *doc-worthy* vs *internal-only*.
7. **Fix only the genuine discrepancies.** Here: one behavioral change (`autoShutdown` default `true`→`false`) across README + architecture.md, plus a broken markdown table separator in AGENTS.md.
8. **Commit the doc fixes separately** with a scoped `docs:` message.

## 3. How the collaboration unfolded

**Phase A — Triage the startup crash.** The AI treated the warning as a symptom, not a
bug. It tried `pi-dashboard status`/`start` (both failed — not on PATH), pivoted to
`npx pi-dashboard start`, captured the exit code, and then *verified* with a health
curl. The effective move: it distinguished "the launcher couldn't find the binary"
from "the server itself is broken," diagnosed the former, and offered `npm link` as
the permanent fix. Root cause was environmental, not code.

**Phase B — Two throwaway ops questions.** `How to uninstall the deb package` and
`pi-dashboard electron` were answered inline (apt remove/purge; the Electron package
name). No files touched. These are the kind of context-switches a real working session
accumulates — the AI answered tightly and moved on.

**Phase C — Commit the backlog.** `commit changes` on a tree with 19 modified files.
The AI surveyed with `git status`/`git diff --stat` first, committed, then read the log
back to confirm. When the user said `Change last commit messages related to changes`,
the AI derived the true scope from `git diff HEAD~4 HEAD --name-only` and amended to a
descriptive Conventional-Commits message instead of guessing.

**Phase D — Reconcile docs with reality.** `update docs and spec if there is something
new` is an open-ended audit request. The AI diffed recent commits, enumerated every
change, and **classified each as doc-worthy or internal**. It resisted the urge to
document everything: of ~6 changes it found, only the `autoShutdown` default flip was a
user-visible behavioral change worth updating (README + architecture.md), plus an
incidental broken table separator in AGENTS.md. The `.dockerignore` was correctly
identified as prep for an unimplemented change and left undocumented.

## 4. Prompts that worked

- **The goal prompt** (`Warning: Dashboard server failed to start…`) — pasting the raw
  error verbatim is a *good* kickoff for triage: it gives the AI the exact string to
  reason from. It would be stronger with one line of context ("this fired when I opened
  the Electron app") to point at the auto-start path immediately.
- **High-leverage follow-up:** `Change last commit messages related to changes` — short,
  but it unlocked the right behavior: the AI re-derived scope from the diff rather than
  reusing the throwaway "About changes" message.
- **High-leverage follow-up:** `update docs and spec if there is something new` — a
  broad audit prompt that works *because* the AI has repo conventions (the docs-first
  gate, AGENTS.md routing) to scope it. In a repo without that structure this would
  produce over-documentation.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reach for the bare `pi-dashboard` binary that isn't on PATH | (implicit) the failures forced the pivot to `npx` | State up front: "use `npx pi-dashboard` — the bin isn't linked." |
| Commit with a placeholder message ("About changes") | `Change last commit messages related to changes` | Ask for a diff-derived Conventional-Commits message in the first commit prompt. |
| Risk documenting every code change indiscriminately | The repo's doc-routing conventions kept it scoped | Say "only doc user-visible/behavioral changes; skip internal refactors" explicitly. |

The through-line: each prompt was terse, and the AI filled the gap with a survey-first,
verify-after loop. When left unconstrained (commit message, doc scope) it needed one
redirect to reach the right granularity.

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created this session — it was a hands-on ops-and-docs pass,
not a workflow that generalized. **What *should* be captured:** the "reconcile docs
against code drift" loop (Phase D) is a repeatable procedure — diff recent commits,
classify each change as doc-worthy vs internal, update only user-visible/behavioral
docs, commit with a scoped `docs:` message. If this recurs, a small project skill
("audit-docs-drift") would remove the manual classification each time and encode the
project's doc-routing rules (README = setup, architecture.md = data flow/config,
AGENTS.md = per-file rows) as the routing table.

## 7. Pitfalls & dead ends

- **`pi-dashboard status`/`start` fail with "not found."** The workspace bin isn't on
  PATH. → Use `npx pi-dashboard start`, or run `npm link` once for a global shim.
- **"Server process exited immediately" is often environmental, not a code bug.** →
  Verify the server is actually down with `curl /api/health` before debugging code; the
  warning here came from the bridge's auto-start attempt, and the server was fine.
- **A placeholder commit message ("About changes") hides scope.** → Derive the message
  from `git diff <base> HEAD --name-only | sort`, then `git commit --amend`.
- **Over-documenting code changes.** → Not every diff needs a doc edit. Internal helpers
  (`resolveAuthJsonKey`, `buildSpawnEnv`, `mkdirSync` fixes) and prep files
  (`.dockerignore` for an unimplemented change) stay undocumented.

## 8. Reproduce it faster — checklist

- [ ] Reproduce the crash with `npx pi-dashboard start 2>&1; echo "EXIT: $?"`.
- [ ] Prove server state with `curl -s http://localhost:8000/api/health`.
- [ ] `git status --short` + `git diff --stat` before staging.
- [ ] Commit, then `git log --oneline -5` + `git diff --stat HEAD~1 HEAD` to verify.
- [ ] For a weak message: `git diff HEAD~N HEAD --name-only | sort` → `git commit --amend -m "feat: …"`.
- [ ] Diff code vs docs; classify each change doc-worthy vs internal.
- [ ] Update only user-visible/behavioral docs (here: `autoShutdown` default in README + architecture.md); fix incidental doc bugs (AGENTS.md table separator).
- [ ] Commit doc fixes with a scoped `docs:` message.

**Inputs needed:** a running repo checkout on the `develop` branch; `npx`/workspace bins
resolvable; git write access.
**Artifacts produced:** amended feature commit; edits to `README.md`, `docs/architecture.md`, `AGENTS.md`; a `docs:` fix commit.

---

_Generated from session `ebba6e24-afb6-4548-82a3-f471841e4ced` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-13. Source extract: `/tmp/facts-9105-1685.md`._
