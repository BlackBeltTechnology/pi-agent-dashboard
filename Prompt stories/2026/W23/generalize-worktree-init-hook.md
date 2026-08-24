---
session: 019e8aa5
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (12 user prompts); large facts sheet (~12526 tok)"
upgrade_status: pending
openspec_changes: [generalize-worktree-init-hook, harden-worktree-spawn]
proposal_excerpt: "Today the only \"initialize a checkout\" mechanism is the **worktree-bootstrap** step (`harden-worktree-spawn`). It is hardcoded and narrow:"
---

# How we did it: Generalize the worktree-init hook — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change generalize-worktree-init-hook
```

The *real* objective, once the change's proposal and the later steering turns
clarified it: **replace the hardcoded, narrow `worktree-bootstrap` step (which
auto-ran `npm ci` on every worktree create and blocked the create response for 60+
seconds) with a project-declared, trust-gated `worktreeInit` hook.** The hook is
read from `.pi/settings.json`, evaluated behind a TOFU (trust-on-first-use) gate,
and surfaced to the user as a manual **Initialize** button instead of an implicit
blocking install. The task spanned the full lifecycle: implement across server +
shared + client, apply the OpenSpec change, archive it, reconcile the now-superseded
`harden-worktree-spawn` change, open/update a PR, fold in CodeRabbit review, resolve
merge conflicts, and squash-merge to `develop`.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change-name>` — let the apply skill drive the task
   checklist; read proposal + design + all specs + the code you'll touch **before**
   writing anything.
2. **Confirm the open design decisions first.** Two decisions in the change materially
   affected churn — pause and `ask_user` before editing, not after reworking.
3. Implement server-first, in dependency order: engine (`worktree-init.ts`) → trust
   store (`worktree-init-trust.ts`) → protocol rename (`worktree_bootstrap_*` →
   `worktree_init_*`) → endpoints (`init-status` + `init`) → delete old
   `worktree-bootstrap*.ts`. Run per-file vitest with `HOME=$(mktemp -d)` after each.
4. Do the client last (largest, riskiest surface): bus rename → `git-api` rework →
   self-contained `WorktreeInitButton` → strip bootstrap flow from `WorktreeSpawnDialog`
   → tests. Type-check the whole repo (`npx tsc --noEmit`) to find dangling refs.
5. Run the full suite once to a temp file, then grep: `npm test 2>&1 | tee /tmp/pi-test.log`.
   Triage any failure as pre-existing vs yours before touching it.
6. `commit and push` → `/skill:openspec-archive-change <name>` → sync delta specs to
   main specs (do it manually if the sync subagent aborts) → validate `--strict`.
7. **Run OpenSpec from the worktree parent's repo root**, not the checkout.
8. Reconcile related changes: ask "what other proposals relate?", run the coherence
   check, archive the superseded one with `--skip-specs`, sync only its surviving
   capability.
9. Update the PR description across all commits → fix CodeRabbit threads (triage each
   against the *code*, not the reviewer prompt) → resolve `develop` conflicts → wait
   for CI green on the merge commit → squash-merge.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & context load.** The AI read the full change (proposal,
design, 3 specs, tasks) plus every source file it would touch, and mapped the
existing bootstrap wiring across server, shared protocol, and client. It explicitly
refused to write code until it understood the blast radius (~12 source files + a
large existing test surface). *Why it worked:* front-loading the read made the later
rename mechanical instead of exploratory.

**Phase 2 — Decision gate.** Before editing, the AI flagged two open design decisions
in the change that would drive rework and used `ask_user` to confirm them. *Decision
point:* the human confirmed direction here, saving a rework cycle on a 710-line dialog
and its test suite.

**Phase 3 — Server implementation (Tasks 1–4).** Engine → trust store → protocol
rename → endpoints, each landed with its unit tests run under `HOME=$(mktemp -d)` so
the TOFU store didn't touch the real `~/.pi`. Old `worktree-bootstrap*.ts` and
obsolete tests deleted. Server + shared type-clean before moving on.

**Phase 4 — Client rework (Task 5).** The largest surface: bus rename, `git-api`
rework, a new self-contained `WorktreeInitButton`, and stripping the bootstrap flow
out of `WorktreeSpawnDialog`. The AI discovered a **latent production bug** here —
`dispatchBootstrapEvent` was imported but never called, so progress never actually
streamed — and wired it correctly. Unicode-dash mismatches in comments defeated
`edit`, so it fell back to `sed` line-range deletes.

**Phase 5 — Verify, apply, archive.** Full suite to a temp log (7090 passed; the one
`pi-image-fit` JPEG failure confirmed pre-existing/flaky, not the change). Commit,
push, archive the change, sync delta specs to main specs. When the sync subagent
aborted, the AI did the sync by hand.

**Phase 6 — Coherence reconciliation.** Prompted with "what other proposal related?",
the AI ran a coherence sweep, found `harden-worktree-spawn` was shipped-on-`develop`
but never archived and now partially obsolete, archived it with `--skip-specs`, and
synced only its surviving `spawn-error-global-toast` capability.

**Phase 7 — PR, review, merge.** Updated PR #74 description across 4 commits, triaged
13 CodeRabbit threads (validating each against the code — including a **critical**
finding: the gate ran repo bash on every `init-status` probe *before* TOFU, an
RCE-on-view hole), applied 8 fixes, resolved `develop` conflicts from an overlapping
`#73` change, waited for CI green on the merge commit, and squash-merged.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change generalize-worktree-init-hook`.
  Effective because the change already carried a proposal + design + specs + tasks, so
  the skill had a concrete checklist to execute. *Lesson:* invest in the OpenSpec
  artifacts up front; the apply skill then does the heavy lifting.
- **`Use openspec from worktree parent's directory`** — a one-line high-leverage
  correction that prevented a whole class of "wrong repo root" failures in a worktree.
- **`What other proposal related?`** — unlocked the entire coherence-reconciliation
  phase; a short question that surfaced a stale, unarchived, superseded change.
- **`Fix coderabbit issues`** — kicked off a disciplined triage-then-fix loop, incl.
  the critical trust-boundary fix.
- **`Currently init worktree slow. Is it executing something inside pi-dashboard
  itself?`** — a good diagnostic prompt: it forced the AI to ground the answer in the
  *deployed* `develop` code path, not the branch it just built.

Weak prompt to rewrite: `a` (a bare confirmation). Prefer an explicit
`yes, run the coherence check on harden-worktree-spawn in single-proposal mode` so the
intent survives out of context.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Run `openspec` from the worktree checkout | "Use openspec from worktree parent's directory" | State the repo-root rule at kickoff (worktree → parent repo root) |
| Answer "why is init slow" from the branch it just built | "Is it executing something inside pi-dashboard itself?" | Always ground runtime questions in the *deployed* branch (`develop`), not the feature branch |
| Treat the change in isolation | "What other proposal related?" | Run a coherence sweep whenever a change supersedes a mechanism another change owns |
| Stop after implementation | "commit and push", "Update PR description", "Fix coderabbit issues", "merge PR" | Chain the full ship lifecycle (commit → archive → sync → PR → review → merge) into one plan |
| Trust CodeRabbit prompts at face value | (implicit quality bar) triage each thread against the code | Validate every reviewer claim against the source before fixing; reject the wrong ones |

## 6. Skills, tools & memory created — and why they're effective

No new persistent skill or memory was created this session, but the workflow leaned on
several existing ones worth invoking again:

- **`openspec-apply-change` / `openspec-archive-change` / `openspec-sync-specs`** — the
  spine of the lifecycle. Effective because they turn a large multi-file change into a
  task checklist and enforce spec/main-spec parity.
- **A spec-coherence-check pass** (single-proposal mode) — the reusable move that
  caught `harden-worktree-spawn` being shipped-but-unarchived-and-obsolete. Invoke
  whenever a change deletes or supersedes another change's mechanism.
- **The docs subagent (caveman-style)** — used for every `docs/` write per AGENTS.md.

*Recommended skill to create:* a **"ship an OpenSpec change end-to-end"** playbook that
chains apply → verify → commit/push → archive → sync-specs → PR update → CodeRabbit
autofix → conflict-resolve → squash-merge, since this session performed exactly that
sequence by hand across 12 steering turns.

## 7. Pitfalls & dead ends

- **`edit` fails on unicode-dash comments.** Comment lines with en/em dashes wouldn't
  match. *Fix:* delete by line range with `sed -i '' 'START,ENDd' file`.
- **Sync subagent aborted silently** (tree stayed clean). *Fix:* detect the no-op and
  do the delta→main spec sync manually.
- **Strict per-spec validation is repo-wide-red already** (151 failures; 121 specs use
  the legacy `## ADDED Requirements` header the strict validator rejects). *Fix:* don't
  chase it — give only your *brand-new* spec the conforming `## Purpose` + `##
  Requirements` shape; leave pre-existing non-conformance alone and note it.
- **Flaky `pi-image-fit` JPEG test** (a `sharp` resize timing out ~5s). Confirm it's
  pre-existing before spending time — it is unrelated to this change.
- **`setTimeout(0)` socket disable leaks an infinite timeout** on keep-alive sockets.
  *Fix:* restore the per-socket timeout on response `finish`.
- **Gate ran repo bash before TOFU** on every `init-status` probe — an RCE-on-view
  hole. *Fix:* don't evaluate the project-declared `gate` until the hook hash is
  trusted; untrusted → `{ hasHook: true, trusted: false }`, button shows, gate runs
  only after confirmation.
- **`develop` conflicts** from an overlapping `#73` client change. *Fix:* keep your
  no-bootstrap structure, adopt develop's `+Session →` label naming, delete the
  bootstrap tests develop re-added.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- A completed OpenSpec change (proposal + design + specs + tasks) at
  `openspec/changes/<name>/`.
- A git worktree on the feature branch; know the **parent repo root** for all
  `openspec` calls.
- GitHub PR access + CodeRabbit enabled on the repo.

**Checklist:**
1. `/skill:openspec-apply-change <name>` — read everything first; `ask_user` on open
   design decisions before editing.
2. Implement server → shared → client in dependency order; per-file vitest with
   `HOME=$(mktemp -d)`; `npx tsc --noEmit` after the client to catch dangling refs.
3. `npm test 2>&1 | tee /tmp/pi-test.log` → `grep -nE 'FAIL|Error|✗'`; triage
   pre-existing vs yours.
4. `commit and push` → `/skill:openspec-archive-change <name>` → sync delta specs to
   main specs (manually if the subagent aborts) → `openspec validate <name> --strict`
   from the parent repo root.
5. Coherence sweep for superseded changes; archive with `--skip-specs`, sync only the
   surviving capability.
6. Update the PR description across all commits → fix CodeRabbit (triage vs code, apply
   valid ones, add tests for new guards) → resolve conflicts → wait for CI green on the
   **merge** commit → squash-merge.

**Final artifacts produced:**
- `packages/server/src/worktree-init.ts` (+ `worktree-init-trust.ts`) and their tests
- `packages/client/src/components/WorktreeInitButton.tsx` (+ test)
- Reworked `git-routes.ts`, `browser-protocol.ts`, `WorktreeSpawnDialog.tsx`,
  `FolderActionBar.tsx`, `git-api.ts`, `useMessageHandler.ts`
- Synced main specs (`worktree-init-hook`, `git-operations-api`, `folder-action-bar`,
  `spawn-error-global-toast`); two archived changes
- Squash-merged PR #74 → `develop` (`351d3373`)

---

_Generated from session `019e8aa5-ccd1-7cfa-9c5a-819376574114` · `pi-agent-dashboard` · 2026-06-05. Source extract: session-to-guideline facts sheet._
