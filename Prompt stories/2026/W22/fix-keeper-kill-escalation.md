---
session: 019e7a00
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (9 user prompts)"
upgrade_status: pending
openspec_changes: [fix-keeper-kill-escalation, headless-spawn]
proposal_excerpt: "Users report sessions getting stuck after clicking stop/abort, where \"only server restart helps\". Investigation (2026-05-28) traced this to two concrete gaps in the keeper-mediated headless kill path that landed with…"
---

# How we did it: Escalating the keeper kill path to SIGKILL — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened tiny — `update PR message` — against an already-open proposal PR
(#54) for the `fix-keeper-kill-escalation` change. The *real* objective surfaced two
prompts later once the operator asked **"Is the tasks implemented? Check"** and then
ran `/skill:openspec-apply-change`: take a proposal-only PR (openspec artifacts, zero
code) and drive it all the way to landed — implement the SIGKILL escalation in the
keeper-mediated headless kill path, add CI-safe tests that reproduce the "stuck
session" bug, rebase onto `develop`, get 10/10 CI green, merge, then archive the
change and tear down the worktree. In short: **ship a bugfix from proposal to
archived, end to end.**

## 2. TL;DR playbook

1. **Verify the PR body actually needs work before touching it.** The AI's first move
   was to notice the body already matched the commit and ask what to change — good
   instinct, but the operator wanted a regenerated body from the current openspec
   files. Say: *"Regenerate the PR body from `openspec/changes/<name>/` — structure it
   Why → What → Design Decisions → Tasks → Validation."*
2. **Ask "is it implemented?" before assuming.** The proposal PR had code = 0. A single
   `grep`/`sed` audit against `tasks.md` line-by-line proved 0/38 done. Never trust a
   green PR to mean implemented.
3. **Run `/skill:openspec-apply-change <change>`** and let it walk the tasks.md
   sections (§1 pre-flight gate → §2 code → §3 callers → §4 keeper → §5 tests → §7
   docs → §8 validate). Mark checkboxes per section.
4. **Clear the pre-flight gate first.** tasks.md said "MUST wait for PR #47". Confirm
   PR #47 merged (`gh pr view 47 --json state,mergedAt`) before writing a line.
5. **When a grep reveals an unanticipated call site, STOP and ask.** The §2.7 grep
   flagged `cleanupOrphans` (L492) — not in the proposal. The AI paused via `ask_user`
   for an explicit scope decision instead of silently extending.
6. **Write tests that reproduce the bug in-process** — full Fastify boot + real
   `keeper.cjs` subprocess + a `MOCK_PI_MODE=hung` fixture that traps SIGTERM. Assert
   the hung pi dies in ≥1.8 s (proves the SIGKILL ladder fired, not a flake).
7. **`HOME=$(mktemp -d) npx vitest run <files>`** for targeted runs; `npm test` for the
   full 6400-test sweep before declaring done.
8. **Rebase onto `origin/develop`**, resolve the trivial CHANGELOG conflict (keep both
   entries), `git push --force-with-lease`, then **monitor CI in short poll batches**
   (host has a 120 s RPC timeout — don't block on `gh run watch`).
9. **After merge: archive.** `openspec archive -y`, sync specs, open the archive PR,
   wait for its CI, then delete branches + remove the worktree — but only after
   confirming the archive PR itself merged.

## 3. How the collaboration unfolded

**Phase 1 — Reconcile the PR (Discovery).** The AI inspected the branch (`git log`,
`gh pr view`), found the body already matched the commit, and *asked* rather than
edited. Once told to regenerate, it rebuilt the body from the openspec files into a
Why → What → Design → Tasks → Validation structure. *Why it worked:* the PR body
became a faithful projection of the source artifacts, not hand-wavy prose.

**Phase 2 — Prove nothing was implemented (Audit).** Triggered by "Is the tasks
implemented? Check", the AI produced a per-task status table (§2.1–§7) each with a
grep/line-number *evidence* column, landing on **"Tasks are NOT implemented — this PR
is proposal-only, 0/38."** *Decision point:* the operator then invoked
`openspec-apply-change`, converting an audit into an implementation mandate.

**Phase 3 — Implement section by section (Build).** The skill walked tasks.md: cleared
the §1 pre-flight gate (PR #47 merged), escalated `killBySessionId` to
`killProcess(pid, {timeoutMs:2000})` across all three branches, awaited the four
callers (finding an extra one — `session-api.ts:114` — not in the proposal), and
guarded a `piChild.kill("SIGKILL")` into the keeper's `shutdown()` before
`process.exit`. *Decision point:* the §2.7 grep surfaced `cleanupOrphans` as a 4th
site; the AI **paused and asked** whether to extend escalation there — the operator
approved, and it was folded in (async + a new `await` in `server.ts`).

**Phase 4 — Tests that actually reproduce the bug (Verify).** Prompted by "Is it
possible to make qa / smoke tests…?" and "Tier 1", the AI grounded the answer in
existing scaffolding (`headless-shutdown-fallback.test.ts`, `mock-pi.cjs`) before
writing `session-kill-e2e.test.ts`: real server + real keeper subprocess + a
`MOCK_PI_MODE=hung` fixture, driven over the browser WS `{type:"shutdown"}` /
`{type:"force_kill"}`, asserting the hung pi dies via SIGKILL within ~2 s. Full suite:
6426 passed, 0 failures.

**Phase 5 — Land it (Ship).** "rebase to develop" → committed the working tree, rebased
1-ahead/30-behind → 3-ahead/0-behind, resolved one CHANGELOG conflict (kept both
Fixed entries), force-pushed with lease. "monitor CI" → polled in short batches around
the 120 s RPC ceiling; 10/10 green (`ci` + 6 Linux smokes + 3 Windows smokes) in ~14
min. Operator merged (#54 → `e015d117`).

**Phase 6 — Archive & tear down (Cleanup).** After "I merged the PR", the AI ran
`openspec archive -y`, hit a **pre-existing** structural defect (`headless-spawn/spec.md`
used a `## ADDED Requirements` delta header in a *main* spec), healed it, synced specs,
opened archive PR #60, waited for its 10/10 CI, merged, then deleted both branches and
removed the worktree.

## 4. Prompts that worked

- **Goal (weak → strong).** `update PR message` was underspecified — the AI correctly
  pushed back. Stronger: *"Regenerate PR #54's body from the current
  `openspec/changes/fix-keeper-kill-escalation/` files, structured Why → What → Design
  Decisions → Tasks → Validation."*
- **`Is the tasks implemented? Check`** — high leverage. A one-line trust-but-verify
  that forced an evidence-backed audit and exposed a proposal-only PR before anyone
  assumed it was done.
- **`/skill:openspec-apply-change fix-keeper-kill-escalation`** — handed the whole
  build to a section-walking skill with built-in checkbox discipline.
- **`Tier 1`** — a two-word unlock. After the AI laid out three test tiers, "Tier 1"
  selected the cheapest CI-safe path without re-explaining.
- **`rebase to develop` / `monitor CI` / `I merged the PR`** — terse phase advances.
  Each let the AI infer the full sub-procedure (commit→rebase→resolve→push; poll CI;
  archive+cleanup) rather than being micromanaged.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat an open PR as "done" | "Is the tasks implemented? Check" | Always audit `tasks.md` line-by-line with grep evidence before claiming progress |
| Stop at the ask ("update PR message") without a target | Redirecting to regenerate from openspec files | State the deliverable + structure in the goal prompt |
| Risk silently extending scope to `cleanupOrphans` | The AI self-paused via `ask_user` for approval | Keep the "grep flags an unanticipated site → STOP and ask" reflex; never fold in silently |
| Consider mocking the kill path | Choosing a real keeper + hung-pi e2e | Ask for tests that *reproduce the bug*, not unit stubs |
| Want to `gh run watch` (blocks past 120 s RPC) | Polling CI in short batches | Poll CI in ≤120 s slices in this host |
| Nearly tear down the worktree while archive PR #60 was still open | Waiting to confirm #60 merged first | Never remove a worktree whose branch has an unmerged PR |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were saved this session — the work rode existing assets:

- **`openspec-apply-change` skill** — the backbone. It walks tasks.md section by
  section, enforces the pre-flight gate, and marks checkboxes, so a proposal-only PR
  becomes landed code without the operator tracking 38 tasks by hand. Invoke it the
  moment an audit shows a change is spec-complete but code-empty.
- **`mock-pi.cjs` + `MOCK_PI_MODE=hung` fixture** — the reusable primitive that made
  the bug testable in CI. A fake pi that traps SIGTERM and busy-loops is exactly the
  "stuck session" the manual §6 e2e describes; reuse it for any keeper/kill-path test.
- **`Explore` subagent** — dispatched to update `docs/faq.md` + `docs/architecture.md`
  (docs writes route through a subagent per AGENTS.md Rule 6). When the subagent was
  unavailable mid-run, the AI fell back to editing docs directly in caveman style.

*Worth creating next time:* a small **"archive an openspec change end-to-end"** skill
capturing the archive → heal-broken-main-spec → sync → PR → CI → branch+worktree
teardown sequence, since this session had to rediscover the `## ADDED Requirements`
main-spec pitfall by hitting it.

## 7. Pitfalls & dead ends

- **Proposal PR ≠ implemented.** A clean, open, well-described PR had 0/38 tasks coded.
  *If you inherit a proposal PR, audit `tasks.md` against source with grep before
  building on it.*
- **`sed -i` checkbox bulk-flip failed** (one of 3 failed commands) — flipping all
  `- [ ]` → `- [x]` also marked manual §6 tasks that were never executed. *Un-mark
  manual/operator-only tasks; don't blanket-complete.*
- **Broken main spec blocks archive.** `openspec archive` refused to sync into
  `headless-spawn/spec.md` because it carried a `## ADDED Requirements` delta header (a
  leftover from a 2026-03-24 archive). *If archive/sync refuses, check the target main
  spec for stray delta headers and heal them first.*
- **Mock toggled "alive" too early**, breaking a test because it flipped before
  `killProcess`'s own pre-SIGTERM probe ran. *Model the probe→SIGTERM→dead sequence in
  the mock, not an instant flip.*
- **`gh run watch` vs the 120 s RPC timeout.** Long-blocking CI waits time out the
  host. *Poll in short batches instead.*
- **Removing the worktree too early** would have orphaned the `archive-` branch whose
  PR #60 was still open. *Confirm every dependent PR merged before teardown.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an openspec change with `proposal.md` + `tasks.md`; the
`gh` CLI authed; a worktree on the propose branch; the pre-flight gate PR merged.

- [ ] Audit: grep each `tasks.md` task against source → confirm coded vs proposal-only.
- [ ] `/skill:openspec-apply-change <change>`; clear the §1 pre-flight gate first.
- [ ] Implement section by section; **pause + `ask_user` on any unanticipated call
      site** a verification grep reveals.
- [ ] Write a CI-safe e2e that reproduces the bug (real server + real keeper +
      `MOCK_PI_MODE=hung`); assert timing proves the SIGKILL ladder fired.
- [ ] `HOME=$(mktemp -d) npx vitest run <files>` targeted, then `npm test` full sweep.
- [ ] Route `docs/` edits through the `Explore`/docs subagent (caveman style).
- [ ] Commit → rebase onto `origin/develop` → resolve CHANGELOG (keep both) →
      `git push --force-with-lease`.
- [ ] Poll CI in ≤120 s batches until 10/10 green; operator merges.
- [ ] `openspec archive -y` → heal any broken main spec → sync → archive PR → wait for
      its CI → merge → delete branches + remove worktree.

**Artifacts produced:** `packages/server/src/headless-pid-registry.ts` (escalation),
`rpc-keeper/keeper.cjs` (piChild SIGKILL), `session-kill-e2e.test.ts` +
`keeper-shutdown-kills-pi.test.ts` + `headless-pid-registry-kill-escalation.test.ts`,
updated `docs/faq.md` + `docs/architecture.md` + `CHANGELOG.md`; PR #54 merged as
`e015d117`; PR #60 (archive) merged; change archived to
`openspec/changes/archive/2026-05-30-fix-keeper-kill-escalation/`.

---

_Generated from session `019e7a00-0a90-77dd-abf4-619056d1931e` · `pi-agent-dashboard` · 2026-05-30. Source extract: deterministic facts sheet._
