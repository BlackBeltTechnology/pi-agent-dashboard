---
session: 019de134
week: 2026/W18
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [fix-extension-slash-commands-in-dashboard]
proposal_excerpt: "Pi extensions that register slash commands via `pi.registerCommand(name, { handler })` are silently broken in dashboard sessions. When the user types e.g. `/ctx-stats` or `/curator` in chat, the registered handler n…"
---

# How we did it: Harden an OpenSpec proposal for extension slash-command routing — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a vague `Is anything to clarify?` (the AI correctly refused
to guess and asked back). The **real objective**, once the first steering turn landed,
was: take the already-scaffolded OpenSpec change `fix-extension-slash-commands-in-dashboard`,
**verify its technical assumptions against the actual pi source**, and **close the gaps
between its `tasks.md`, `spec.md`, and `design.md`** so the plan is safe to implement.
The underlying bug the proposal addresses: typed extension slash commands
(`/ctx-stats`, `/curator`, `/flows:new`, …) fall through to `pi.sendUserMessage(...)`
in dashboard chat and get silently leaked to the LLM as plain text instead of running
their registered handler.

## 2. TL;DR playbook

1. Point the AI at the named change: `proposal fix-extension-slash-commands-in-dashboard`.
2. Have it read the whole change dir (`proposal.md`, `design.md`, `tasks.md`,
   `specs/command-routing/spec.md`, `notes/`) and run `openspec validate <name> --strict`.
3. Ask the load-bearing safety question directly: *"can `pi.getCommands()` cause a
   problem?"* — force an empirical answer from the installed pi source, not a guess.
4. Let the AI grep the real pi dist (`loader.js` → `runner.js` → `agent-session.js`)
   to prove the API is synchronous, side-effect-free, and only fails on stale ctx.
5. Ask the audit question: *"Check the task list. What is missing?"* — cross-check
   `tasks.md` against `spec.md` + `design.md` + `notes/preflight-*.md`.
6. Approve the fix (`yes`) and let it patch `tasks.md` (add error-handling, stale-ctx
   guard, regression tests) and `spec.md` (delete routing steps that don't match code).
7. Re-run `openspec validate --strict` to confirm the change still passes.

## 3. How the collaboration unfolded

**Phase 1 — Orient (don't guess).** The opening prompt was noise (pasted help text +
"clarify?"). The AI declined to invent a task and asked what the user wanted. Worth
repeating: a genuinely ambiguous kickoff should get a clarifying question, not a
confident wrong turn.

**Phase 2 — Load the change.** Given the change name, the AI read every artifact in
`openspec/changes/fix-extension-slash-commands-in-dashboard/` and ran strict
validation. It produced a crisp status summary: what the change fixes, the two-step
approach (Path D detect-and-error now, Path B `pi.dispatchCommand` upstream later),
and the bridge-only scope.

**Phase 3 — Empirically verify the risky call.** The key decision point: instead of
reasoning about whether `pi.getCommands()` is safe to call in the slash-fallback, the
AI grepped the **actual installed pi dist** and traced `loader.js:243` →
`runner.js:355` → `agent-session.js:1684`. It proved the call is synchronous, cheap,
idempotent, exposes no handler, and only throws on a stale (disposed) ctx — which the
bridge already guards against by re-capturing `pi`/`ctx` on every `session_start`.

**Phase 4 — Commit confusion (a real dead end).** The `commit` prompt hit a wall: the
named proposal was already committed and clean, while the working tree was full of
**unrelated** dirty changes (`extract-flows-as-plugin`, `session-card-unread-stripes`,
stray build artifacts). The AI correctly refused to commit blindly and asked for
direction rather than sweeping everything in.

**Phase 5 — Gap audit + patch.** "What is missing?" triggered a three-way cross-check.
The AI found real gaps: no error path when `pi.dispatchCommand` rejects, and
spec routing steps 8/9 (`flows:new-request`/`flows:edit-request`) that **don't reflect
code** (`MANAGEMENT_COMMAND_EVENTS` is `{}`). On `yes`, it patched `tasks.md`
(7 new/reworked items) and `spec.md` (deleted the phantom steps, renumbered), then
re-validated strict-clean.

## 4. Prompts that worked

- **The goal prompt (rewrite).** `Is anything to clarify?` was too vague and cost a
  round-trip. A stronger kickoff: *"Review the OpenSpec change
  `fix-extension-slash-commands-in-dashboard` — is it internally consistent and safe
  to implement? Flag anything to clarify."*
- **High-leverage follow-up — the safety probe.** `Check that pi ctx can cause problem
  to get commands or it is ok.` This forced an *empirical* answer from source, not a
  hand-wave. Reusable pattern: name the exact call and demand a source-backed verdict.
- **High-leverage follow-up — the audit.** `Check the task list. What is missing?`
  Short, and it unlocked a full spec↔tasks↔design reconciliation.
- **The approval.** `yes` — a one-word go after the AI had laid out the exact patch
  set. Effective because the plan was already concrete.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Face a vague opener with no context | Naming the concrete change (`proposal fix-…`) | Open with the change name + the actual question |
| Trust that a helper call is "probably safe" | Asking *"can pi ctx cause a problem?"* explicitly | Always demand source-backed proof for load-bearing API calls |
| Interpret `commit` literally on a dirty tree | Being asked *which* changes — AI refused to guess | State the exact paths to commit; keep unrelated WIP out |
| Treat `tasks.md` as complete because it validates | `Check the task list. What is missing?` | Make gap-audit vs spec+design a standing step before implement |
| Assume spec routing steps reflect code | Confirming `MANAGEMENT_COMMAND_EVENTS = {}` in source | Verify spec claims against code before locking the plan |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created in this session. The workflow is clearly repeatable and
**should** be captured as a project skill — call it something like
`audit-openspec-change`: given a change name, read all artifacts, run
`openspec validate --strict`, verify every load-bearing API assumption against the
installed pi source, then cross-check `tasks.md` against `spec.md`/`design.md`/`notes/`
and emit the missing-tasks list. It removes the manual three-way diff and the
"is this call safe?" source spelunking every planning pass needs.

## 7. Pitfalls & dead ends

- **`commit` on a dirty tree.** The named proposal was already committed; the tree had
  unrelated WIP + stray build artifacts. *If you hit this, don't `git add -A`* — list
  the dirty groups and ask which to commit (the AI did exactly this).
- **Trusting spec routing order.** Spec steps 8/9 named `flows:new-request` handlers
  that don't exist — `MANAGEMENT_COMMAND_EVENTS` is empty. *If a spec asserts a code
  path, grep for it before you plan against it.*
- **Assuming `getCommands()` is safe by name.** Its only failure mode is a stale ctx
  after `dispose()`. *Confirm the bridge re-captures `pi`/`ctx` on `session_start`
  before relying on it in the slash-fallback.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change name (`fix-extension-slash-commands-in-dashboard`).
- Path to the installed pi dist (here:
  `~/.nvm/.../@mariozechner/pi-coding-agent/dist`) for source verification.

**Steps:**
1. `openspec validate <change> --strict` — baseline the change is well-formed.
2. Read `proposal.md`, `design.md`, `tasks.md`, `specs/**/spec.md`, `notes/`.
3. For each load-bearing API call, grep the pi dist and prove sync/side-effect/failure
   behavior.
4. Cross-check `tasks.md` against spec + design + notes; list missing/under-specified
   tasks.
5. Patch `tasks.md` (add error paths, guards, regression tests) and `spec.md` (delete
   claims that don't match code); renumber.
6. `openspec validate <change> --strict` again — confirm strict-clean.

**Artifacts produced:**
- `openspec/changes/fix-extension-slash-commands-in-dashboard/tasks.md` (7 items added/reworked)
- `openspec/changes/fix-extension-slash-commands-in-dashboard/specs/command-routing/spec.md` (routing order fixed)

---

_Generated from session `019de134-7498-73e0-858c-2a9e2fe887d2` · `pi-agent-dashboard` · 2026-05-02. Source extract: `/tmp/facts-1979-17249.md`._
