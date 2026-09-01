---
session: 019e6c08
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (9 user prompts)"
upgrade_status: pending
openspec_changes: [openspec-worktree-spawn-button]
proposal_excerpt: "When a user is working through an OpenSpec change attached to a folder, the natural next action is often \"give this change its own branch + working tree so I can iterate without disturbing the main checkout.\" Today th…"
---

# How we did it: Apply the `openspec-worktree-spawn-button` change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change openspec-worktree-spawn-button
```

The real objective, once the steering turns filled in the gaps: **implement all 28
tasks of a spec-driven OpenSpec change** that adds a "spawn a worktree for this
OpenSpec change" button to the dashboard client — a new `gitWorktreeEnabled` config
flag, a settings checkbox, a gated `FolderActionBar`, an extended
`WorktreeSpawnDialog` (`initialBranch` + `attachProposal`), a `⑂+` button in
`FolderOpenSpecSection`, the `SessionList` / `App.tsx` wiring — **write the tests
first, run the full suite, commit + push with plain git (no `jj`), delegate docs +
spec-sync to subagents, then archive the change.** Manual browser-verification tasks
were to be *deferred*, not faked.

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change-name>` inside the change's
   worktree. Let the skill read the specs and print the task ledger (0/28).
2. Before writing anything, **map the code**: `grep`/`read` the exact files the tasks
   touch (config, SettingsPanel, FolderActionBar, WorktreeSpawnDialog, SessionList,
   App.tsx) and how config flows client-side (`useConfig` / `/api/config`).
3. Work **task-group by task-group, tests first**: add the `gitWorktreeEnabled`
   config field + round-trip test, run only that file's vitest, then mark the task
   `[x]`. Repeat per §.
4. Run the **full suite once** at the end: `npm test 2>&1 | tee /tmp/pi-test.log | tail`.
   Triage failures — an unrelated `browse-endpoint.test.ts` `node_modules` failure is
   a worktree artifact, not your regression.
5. **Commit with plain git** (`git add -p`-style staged, leave unrelated
   `.pi/settings.json` unstaged) — the user explicitly forbids `jj`.
6. Delegate the **docs update** (caveman-style file-index) and the **spec-sync** to
   `general` subagents so the main context stays focused.
7. **Defer the manual verification tasks** — do NOT try to browser-verify from the
   worktree (it can't resolve the edited shared package; see §7). Mark them done only
   when the user says "defer tests and mark task done".
8. `/skill:openspec-archive-change <change-name>`, then `git commit && git push`.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read the specs, map the code).**
The AI ran `openspec status`/`instructions apply`, read every `spec.md`, then grepped
for the concrete symbols each task touches (`FolderOpenSpecSection`, `WorktreeSpawnDialog`,
`useConfig`, `/api/config`, config-api partial-merge). *Why it worked:* it built a
complete mental model of config flow and prop wiring **before** the first edit, so the
7-section implementation plan it announced was accurate and didn't need rework.

**Phase 2 — Generate, tests-first, one § at a time.**
For each task group it added the test, ran only that file's vitest
(`HOME=$(mktemp -d) npx vitest run <file>`), then marked the checkbox. Config → 64
tests green; targeted client tests → 87 green; integration → 3 green. *Why it worked:*
tight test/impl/checkbox loop kept the ledger truthful and caught breakage instantly.
*Decision point:* the AI kept manual tasks 7.2–7.4 **unchecked** on its own initiative,
correctly recognizing they need a human + browser.

**Phase 3 — Full suite + first commit.**
`npm test` → 6357 pass, 1 unrelated fail. The AI diagnosed the failure as a worktree
`node_modules` hoisting artifact (not its change) and committed `d1122aff`, leaving an
unrelated `.pi/settings.json` rewrite unstaged. *Decision point:* user said `commit to git`.

**Phase 4 — The browser-verify dead end.**
User said `use browser and check`. The AI tried to restart the server from the worktree,
hit stale config, purged the jiti cache, and finally **root-caused** that the worktree
has no own `node_modules`, so the server resolves `@blackbelt-technology/pi-dashboard-shared`
up to the *main repo's* symlink → loads the unedited `config.ts`. It restored the
main-repo server so the live dashboard kept working, and reported the block honestly
instead of faking a green check.

**Phase 5 — Land it (no jj) + archive.**
User issued a burst of steering: `no jj, commit and push`, `no jj, defer tests`,
`defer tests and mark task done`. The AI marked all 28 tasks done, committed `4d93509a`,
pushed, then ran `/skill:openspec-archive-change` — delegating the spec-sync to a
subagent — producing archive commit `7e833116`.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change openspec-worktree-spawn-button`.
  Effective because the change already had complete specs + a 28-task ledger; the skill
  supplies all structure, so a one-line invocation is enough. *Make it better next time*
  by adding the standing constraints up front: "use plain git not jj, defer manual
  browser tasks, delegate docs to a subagent."
- **High-leverage follow-ups** — short and surgical:
  - `commit to git` — checkpointed the green implementation.
  - `defer tests and mark task done` — unblocked the ledger without pretending manual
    verification ran.
  - `/skill:openspec-archive-change openspec-worktree-spawn-button` — one line to finalize.
- **Weak prompt to rewrite:** `use browser and check` cost ~2 hours on an impossible
  path. Stronger: *"Don't browser-verify from the worktree — it can't resolve the edited
  shared package. Defer 7.2–7.4 and note it in tasks.md."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reach for `jj` when committing | `no jj, commit and push` (said **three** times) | State "plain git only, never jj" in the opening prompt / a project memory |
| Attempt real browser verification from the worktree | `use browser and check` → then accept the deferral | Tell it up front worktree can't serve edited shared pkg; defer manual tasks |
| Leave manual tasks unchecked (correct) but stall the ledger | `defer tests and mark task done` | Add a rule: manual-verify tasks get marked done + annotated "deferred to CI/human" |
| Wait at decision points | `go on` | Pre-authorize autonomous continuation for non-destructive steps |

The user's standing quality bar: **don't fake verification** — defer honestly, keep the
ledger truthful, and never let an unrelated file (`.pi/settings.json`) sneak into a commit.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work rode existing skills
(`openspec-apply-change`, `openspec-archive-change`) and two `general` subagents:

- **Subagent: "Update file-index docs (caveman style)"** — kept the docs write out of
  the main context and enforced the repo's caveman doc convention. Invoke whenever a
  change adds components that need file-index rows.
- **Subagent: "Sync openspec delta specs to main"** — folded the change's delta specs
  into main specs during archive. Invoke as the archive's spec-sync step.

**Skill that SHOULD exist** (and the session proves it): a
`worktree-cannot-serve-edited-shared-pkg` guardrail — capturing that a dashboard server
started from a `.worktrees/*` checkout resolves `@blackbelt-technology/pi-dashboard-shared`
up to the main repo's `node_modules` symlink, so in-browser verification of shared-pkg
edits is impossible until the worktree is folded back. Two hours were lost rediscovering
this; it belongs in a project memory.

## 7. Pitfalls & dead ends

- **Browser verification from a worktree is impossible for shared-pkg edits.** The
  worktree has no own `node_modules`; the server resolves the shared package up to the
  *main repo's* symlink and loads the unedited `config.ts`. `gitWorktreeEnabled` never
  appears in `/api/config`. → **Defer manual verification; fold the worktree back to
  trunk first, then restart the main-repo server.**
- **Stale jiti cache** after restarting the server from the worktree — purge it and
  restart, but it still won't fix the resolution issue above.
- **`browse-endpoint.test.ts` fails in a worktree** expecting `node_modules` — a
  hoisted-deps environment artifact, **not** a regression. Don't chase it.
- **`openspec status` reports `isComplete: false` even with all 28 tasks `[x]`** — that
  flag is driven by artifact status, not checkboxes. The task list being fully checked
  is the real signal for archive.
- **`jj` reflex** — the assistant repeatedly reached for `jj`; the user forbade it three
  times. Use plain `git`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name with complete specs + task ledger; a
worktree at `.worktrees/<change>/`; awareness that plain git (not `jj`) is required.

- [ ] `/skill:openspec-apply-change <change-name>` — read specs, print ledger.
- [ ] Map config flow + prop wiring (`grep useConfig /api/config` + read the target files) BEFORE editing.
- [ ] Per § : test-first → `HOME=$(mktemp -d) npx vitest run <file>` → mark `[x]`.
- [ ] Full suite once: `npm test 2>&1 | tee /tmp/pi-test.log | tail`; ignore the known worktree `browse-endpoint` fail.
- [ ] `git commit` (plain git); leave unrelated `.pi/settings.json` unstaged.
- [ ] Delegate docs (caveman file-index) + spec-sync to `general` subagents.
- [ ] Defer manual browser tasks — DON'T verify shared-pkg edits from the worktree.
- [ ] `/skill:openspec-archive-change <change-name>` → `git commit && git push`.

**Final artifacts produced:** commits `d1122aff` (impl) → `4d93509a` (ledger) →
`7e833116` (archive); archive at `openspec/changes/archive/2026-05-28-openspec-worktree-spawn-button/`;
12 edited + 1 new test file across `packages/shared`, `packages/client`.

---

_Generated from session `019e6c08-fb00-7095-a071-05c73192b90f` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-28. Source extract: session facts sheet (openspec-worktree-spawn-button)._
