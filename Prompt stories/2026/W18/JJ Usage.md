---
session: 019defe1
week: 2026/W19
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (13 user prompts)"
upgrade_status: pending
openspec_changes: [jj-plugin-server-driven-flows]
---

# How we did it: From "jj feels bizarre" to a server-driven jj-plugin OpenSpec change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened as a pure **learning question**, not a build request:

> *"What is the optimal usage of jj with git? Currently it seems a little bit bizarre"*

The real objective only surfaced through steering. What started as "explain jj" became:
**"our `.shadow/<change>` jj-workspace convention feels wrong — redesign the Phase-5
jj-plugin flow (workspace-add, fold-back, dialogs) and capture the redesign as a
reviewable OpenSpec change, grounded against the code that actually ships."** The
finished artifact is a 4-file OpenSpec proposal (`jj-plugin-server-driven-flows`) whose
claims are anchored to real, shipped pi/dashboard APIs — not plan-doc vaporware.

## 2. TL;DR playbook

1. **Ask the mental-model question first.** "What's the optimal usage of jj with git?" —
   let the AI establish the framing (jj = daily driver, git = dumb transport, working
   copy *is* a commit, no staging/dirty state) before touching any design.
2. **Drill into the concept that confuses you** with one narrow follow-up each
   ("how is dirty handled?", "bookmark vs workspace?", "is a workspace always a
   different directory?"). One concept per turn keeps answers surgical.
3. **Anchor the abstract concept to THIS repo**: "which docs mention shadow?" forces the
   AI to `grep` the real convention (`docs/plans/openspec-jj-bridge.md`,
   `.pi/skills/jj-workspace/`) instead of answering generically.
4. **State the redesign as constraints, not code**: "add workspace, do not create
   `.shadow`, do not reset git, attach to the session." Constraints become the
   proposal's BREAKING decisions.
5. **Make the AI verify a capability before designing on it**: "can I set cwd on the fly
   without stopping the session?" → it greps for `process.chdir`, confirms *no*, and
   pivots to the supported respawn primitive.
6. **Unlock scope with a short "all three feasible?" turn** — bundle the redesign asks
   (respawn on +Workspace, async fold-back dialog, custom dialog system) and let the AI
   lay out tradeoffs before committing.
7. **Scaffold via the OpenSpec skill**, not by hand: paste the `/opsx:ff` fast-forward
   instructions → `openspec new change` → proposal → design → specs → tasks, validating
   at each step.
8. **Close with a grounding pass**: "update proposal: check pi API because respawn
   exists." The AI greps the server package, finds the routes/primitive that already
   ship, and rewrites all four artifacts to cite real signatures.

## 3. How the collaboration unfolded

**Phase 1 — Concept teaching (prompts 1–2, 5–8).** The AI explained jj's model in prose:
no staging area, working copy *is* `@`, change-ids survive rewrites, bookmarks ≠ branches,
workspace = git-worktree equivalent (always its own directory), traceability via revsets
(`jj log -r 'trunk()..my-bookmark'`). *Why it worked:* the operator asked one atomic concept
per turn, so each answer stayed a crisp reference card instead of a wall.

**Phase 2 — Ground the concept in the repo (prompts 3–5).** "Which docs mention shadow?"
and "git commit is forbidden…" pushed the AI to `grep docs/ .pi/skills/` and map the actual
`.shadow/<change>` lifecycle to files (`docs/plans/openspec-jj-bridge.md`,
`docs/file-index-plugins.md`, the `jj-workspace` + `jj-workspace-fold-back` skills). *Decision
point:* the operator revealed the real pain — "after archive I want a git commit, but
`git commit` is forbidden" — and the AI corrected the misconception (fold-back already
produces a real git commit via `jj git push --bookmark`).

**Phase 3 — Verify a primitive before designing (prompts 8–11).** "Set cwd on the fly?"
→ AI greps for `process.chdir`, confirms it's impossible and *why* (cwd is captured at spawn
and read everywhere downstream), then surfaces the supported answer: SIGTERM + respawn same
JSONL with new cwd. "How does +Workspace work?" → it read `JjActionBar.tsx` and flagged the
server side as scaffold. *Why it worked:* every design claim got backed by a code read first.

**Phase 4 — Scope unlock + scaffold (prompts 11–12).** "All three feasible?" bundled the
redesign; the AI produced a tradeoff table and then, invoking the project's OpenSpec skill,
fast-forwarded `openspec new change` → proposal → design → specs → tasks (41 checkboxes),
validating each artifact.

**Phase 5 — Ground against shipped reality (prompt 13).** "Update proposal: check pi API
because respawn exists." The AI greps the **server** package and finds the proposal was
wrong twice: the routes already exist in `packages/server/src/routes/jj-routes.ts`, and the
respawn primitive is the *shipped* `handleHeadlessReload` (`headlessPidRegistry.killBySessionId`
+ `spawnPiSession(cwd, { sessionFile, mode: "continue", strategy })`), not the plan-doc's
imagined `resumeJsonl` API. All four artifacts were rewritten and re-validated.

## 4. Prompts that worked

- **The goal prompt** — *"What is the optimal usage of jj with git? Currently it seems a
  little bit bizarre."* Effective because it asks for a **mental model**, not a command.
  The AI's framing ("jj = daily driver, git = dumb transport, working copy *is* a commit")
  dissolved the confusion that every later design decision depended on.
- **Atomic concept follow-ups** — *"How is dirty handled?"*, *"bookmark vs workspace?"*,
  *"is a workspace always a different directory?"* One concept per turn = surgical answers.
- **Repo-grounding turn** — *"Which docs shadow is mentioned?"* Forces `grep` over the real
  convention so the redesign amends *actual* files, not a generic jj tutorial.
- **Capability-check turn** — *"Is it possible to set cwd on the fly without session stop?"*
  High-leverage: it made the AI verify (`grep process.chdir`) instead of assume, and the
  *no* answer produced the respawn design the whole proposal rests on.
- **Scope-unlock turn** — *"Is it possible that +Workspace respawns the current session…
  and the whole path handled by a custom dialog system?"* Bundled three asks; the AI
  answered "all three feasible" with a tradeoff table before touching code.
- **Grounding turn** — *"Update proposal: check pi API because respawn exists."* The single
  most valuable prompt: it caught two factual errors before implementation started.

  **Rewrite for next time:** fold the grounding demand into the scaffold prompt itself —
  *"Draft the OpenSpec change, but every API/primitive you cite must be grepped and quoted
  from the shipping source (server package + skills), not from plan docs."* That collapses
  Phase 5 into Phase 4.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Answer jj questions generically | "Which docs mention shadow?" | Tell it up front to ground every concept in `docs/` + `.pi/skills/` of THIS repo |
| Treat "git commit forbidden" as a real blocker | Explaining the actual need: a real git commit after archive | State the outcome you want ("a real git commit on origin"), not the mechanism you think is blocked |
| Batch several design questions at once | Cancelling the batch `ask_user` | Ask design questions **one at a time**; the AI itself later offered "I'll re-ask one at a time" |
| Cite a plan-doc primitive (`openspec-jj-bridge`) as if it shipped | "check pi API because respawn exists" | Require every cited API be grepped from the **server package** + quoted with its real signature |
| Assume Phase-5 routes didn't exist yet | Same grounding turn | Grep `packages/server/src/routes/` before claiming a route is missing |

Key correction cascade: the proposal claimed `spawnPiSession({ resumeJsonl, cwd, taskDescription })`
with a `10s timeout / SIGKILL`. Reality: `spawnPiSession(cwd, { sessionFile, mode: "continue",
strategy })` with idempotent `headlessPidRegistry.killBySessionId` (SIGTERM-by-PID, no SIGKILL).
The fix rippled proposal → design → spec → tasks.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — it was a **planning/spec** session that
produced an OpenSpec change rather than a reusable procedure. But two existing assets carried
the load and are worth invoking deliberately:

- **`openspec-new-change` / `/opsx:ff` fast-forward** — scaffolds `proposal → design →
  specs → tasks` with `openspec new change` + `openspec validate` at each gate. Invoke it
  the moment a design discussion converges; it turns a chat consensus into a reviewable,
  validated artifact set (here: 4 files, 41 task checkboxes).
- **`jj-workspace` + `jj-workspace-fold-back` skills** — the operational rules for working
  inside `.shadow/<change>/`. Read them first when a jj-workspace question arises; they are
  the source of truth the redesign amends.

**Skill that *should* exist (recommendation):** a **"ground-the-proposal"** discipline —
before finalizing any OpenSpec proposal that cites an API/primitive, grep the shipping
source and replace every plan-doc reference with a quoted real signature. This session
proves its value: it caught two vaporware claims. (The repo's `doubt-driven-review` skill
is the closest fit — invoke it on any proposal asserting "primitive X already exists.")

## 7. Pitfalls & dead ends

- **Plan-doc ≠ shipped code.** `docs/plans/openspec-jj-bridge.md` described a
  SIGTERM-and-respawn primitive that was never implemented as written. If a proposal says
  "reuse the existing primitive from `<plan-doc>`," grep for it — the real one was in a
  *different* file (`session-action-handler.ts`) under a *different* change
  (`headless-reload-via-respawn`).
- **`openspec validate` fails right after `proposal.md` alone** — that's expected
  ("no deltas yet"), not an error. Continue to design/specs before trusting validation.
- **cwd cannot be mutated live.** Don't design any "change directory on the fly" flow —
  there's zero `process.chdir` in pi/dashboard and everything reads cwd captured at spawn.
  The only supported path is respawn (SIGTERM by PID → `spawnPiSession(..., mode:"continue")`).
- **Batched `ask_user` design questions get cancelled.** Ask one design decision per turn.
- **`+ Workspace` server side was scaffold** at read time — the button flow existed in
  `JjActionBar.tsx` but `POST /api/jj/workspace/add` behavior lived in the server package,
  not the plugin's empty `server/` scaffold. Check both when tracing a plugin endpoint.

## 8. Reproduce it faster — checklist

- [ ] Open with the **mental-model** question, let the AI set framing before any design.
- [ ] Drill one atomic jj concept per turn (dirty, bookmark-vs-workspace, workspace-dir,
      traceability revset).
- [ ] Force **repo grounding** early: "which docs/skills define this convention?"
- [ ] State the redesign as **constraints** ("no `.shadow`, don't reset git, attach to
      session"), not code.
- [ ] Make the AI **verify each primitive** (`grep process.chdir`, `grep spawnPiSession`)
      before designing on it.
- [ ] Bundle the redesign asks in one "all three feasible?" turn → get a tradeoff table.
- [ ] Scaffold via `openspec new change` + fast-forward → proposal → design → specs → tasks,
      `openspec validate` each step.
- [ ] **Grounding pass**: require every cited API be quoted from the shipping **server
      package** + skills, not plan docs. Re-validate.

**Inputs to have ready:** the repo checked out (`packages/server/`, `packages/jj-plugin/`,
`.pi/skills/jj-*`), the `openspec` CLI, and the OpenSpec fast-forward skill.

**Artifacts produced:** `openspec/changes/jj-plugin-server-driven-flows/{proposal.md,
design.md, specs/jj-fold-back-server/spec.md, specs/jj-workspace-plugin/spec.md, tasks.md}`.

---

_Generated from session `019defe1-0460-716e-a99b-dcbf6e1c5cf9` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-04. Source extract: deterministic facts sheet (session-to-guideline)._
