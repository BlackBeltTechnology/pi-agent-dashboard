---
session: 019ec80b
week: 2026/W24
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [reorganize-settings-into-pages]
proposal_excerpt: "The settings panel grew from the 4-tab `settings-tabbed-layout` into 7 uneven top-tabs. Two tabs (`General`, `Advanced`) each carry ~8 unrelated sections while `Servers`/`Packages`/`Plugins` carry one. `Advanced` re-r…"
---

# How we did it: Reorganize the settings panel from tabs into pages — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single skill invocation:

```
/skill:openspec-apply-change reorganize-settings-into-pages
```

The real objective — spelled out in the attached proposal — was to replace the
overgrown 7-tab settings panel (two tabs carrying ~8 unrelated sections each) with a
**grouped left-nav, page-per-topic layout**: 10 pages (`general, server, sessions,
remote, security, providers, packages, plugins, openspec, developer`), a canonical
`/settings/:page?` route with legacy `?tab=` upgrade-redirects, and a plugin-slot
registry contract that normalizes unknown tab ids to `general`. The task was
end-to-end: implement the 24 spec tasks, keep tests green, sync the delta spec,
archive the change, and land it as a merged PR with green CI.

The three follow-up prompts (`go on`, `/skill:openspec-archive-change …`,
`commit. create PR and monitor CI`) were pure *sequencing* — the operator drove the
change through its lifecycle stages and let the AI carry each stage to completion.

## 2. TL;DR playbook

1. **Kick off from the change, not the code:** `/skill:openspec-apply-change <name>`.
   The AI reads proposal + design + spec + `tasks.md` before touching anything.
2. **Read the whole target component first** — `SettingsPanel.tsx` was ~1000 lines;
   the AI mapped exact JSX block line-ranges before editing.
3. **Splice large JSX relocations with a Node script**, not hand-edits — reuse the
   existing blocks verbatim (re-indented) to assemble the new page structure.
4. **Fix the registry contract at the source** (`slot-types.ts` `VALID_SETTINGS_TABS`
   + `forTab` fallback), then let the type-checker surface every downstream break.
5. **`npm ci` inside the worktree** so cross-package imports resolve to worktree
   source before running `tsc`/`vitest` (a fresh worktree has no `node_modules`).
6. **Rewrite route-dependent tests with real `wouter` memory-location**, and assert on
   **URL**, not on heading text (page name collides with nav-button text).
7. **`go on`** to let the AI finish all 24 tasks, then verify with
   `openspec validate --strict` and a production `npm run build`.
8. **Archive** via `/skill:openspec-archive-change` — it syncs the delta spec into the
   main spec (delegated to a subagent, caveman-style docs) and moves the change to the
   dated archive folder.
9. **`commit. create PR and monitor CI`** — exclude machine-local `.pi/settings.json`,
   push, open the PR, resolve any `develop` conflict, force-push, watch CI to green.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read before write).** The AI resolved the apply skill, read all
context files (proposal/design/spec/tasks), then read `SettingsPanel.tsx` *fully* and
grep-mapped the routing in `App.tsx` and the `SettingsSectionSlot` consumer. *Why it
worked:* a 1000-line component with cross-page JSX relocation is unsafe to edit blind;
the upfront map made every later splice surgical.

**Phase 2 — Registry contract first (Task 1).** Extended `SettingsTab` /
`VALID_SETTINGS_TABS` to the 10 page ids and made `forTab` normalize both unset *and*
unknown claim tabs to `general`. *Why:* fixing the enumerated source of truth first
lets `tsc` enumerate every downstream consumer that must change — the compiler becomes
the task list.

**Phase 3 — Routing + layout splice (Tasks 2–4).** Rather than hand-relocate ~500 lines
of JSX across 10 pages, the AI wrote a `/tmp/splice.cjs` Node script that reused the
existing blocks verbatim (re-indented) into the new grouped-left-nav structure, then
replaced the old `tabs` array with `navGroups` and wired `App.tsx` to
`/settings/:page?` with legacy `?tab=` → canonical `replace`. A single mounted panel
resolves the page from the URL, so an unsaved draft survives cross-page navigation.

**Phase 4 — Worktree install + typecheck.** `tsc` initially couldn't resolve
cross-package imports because the fresh worktree had no `node_modules`. The AI ran
`npm ci` inside the worktree, confirmed the only remaining `tsc` errors were
pre-existing/unrelated (`image-fit`), and proved **0 errors from its own changes**.

**Phase 5 — Tests (Task 5).** The old `SettingsPanel` test mocked only `useLocation`;
the page model needs real routing. The AI rewrote it with `wouter`'s memory-location +
jsdom history, hit the "Sessions matches both nav button and heading" trap, and
switched to **URL assertions**. Added registry-fallback cases, updated the changed
internal-link tests, and ran the broader client + runtime suites (an unrelated
`useImagePaste` failure was confirmed as parallel-load flakiness, green in isolation).

**Phase 6 — Validate, sync, archive.** `openspec validate --strict` passed; delta spec
for `settings-panel` was synced into the main spec (delegated to a subagent per the
docs-write protocol) and the change was archived to the dated folder.

**Phase 7 — Ship (PR + CI).** Excluded a tooling-rewritten `.pi/settings.json`, opened
**PR #128**, discovered `develop` was 10 commits ahead with a conflicting
`embed-git-bash-on-windows` feature touching the same file — so GitHub couldn't build
a test-merge commit and **CI never triggered**. The AI rebased, resolved a
context-collision conflict (kept its security-page content, confirmed develop's
non-UI `windowsGitSource` additions survived, re-inserted develop's Windows git/bash
`SelectField` block into the new **Sessions** page), re-verified `tsc`/build, force-
pushed, and watched CI to green. CodeRabbit review completed; mergeable.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change reorganize-settings-into-pages`.**
  Effective because the *entire spec* (proposal, design, 24 tasks) was already
  attached to the change; the one-liner hands the AI a fully-specified job. **Do the
  spec work up front so the kickoff can be this short.**
- **`go on`** — a zero-cost unlock: the AI had front-loaded the plan, so "continue"
  carried it through all 24 tasks without re-litigating scope.
- **`/skill:openspec-archive-change <name>`** — invoked the lifecycle stage explicitly
  rather than describing it; the skill knew to sync the delta spec and move to archive.
- **`commit. create PR and monitor CI`** — one terse instruction that implied the whole
  ship sequence (stage, commit, push, PR, watch). Effective because "monitor CI" gave
  the AI license to *resolve the conflict that blocked CI*, not just report red.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat each lifecycle stage as its own turn | Driving apply → archive → ship as separate prompts | State the full lifecycle up front: "apply, then archive + sync specs, then commit + PR + watch CI" |
| Pause after a completed stage | `go on` to continue through all tasks | Say "run to completion, don't stop between tasks" in the kickoff |
| Not anticipate a stale `develop` | `commit. create PR and monitor CI` (open-ended enough to allow a rebase) | Warn "develop may be ahead — rebase and resolve if the PR conflicts" |

Note: this was a *low-steering* session — 4 prompts, all sequencing. The heavy lifting
(reading, splicing, testing, conflict-resolution) was autonomous. The reproducibility
win is front-loading the lifecycle intent so even the sequencing prompts collapse.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created; the session *consumed* existing ones:

- **`openspec-apply-change` / `openspec-archive-change` / `openspec-sync-specs`** — the
  spec-driven lifecycle skills. Effective because they encode "read context → implement
  tasks → validate strict → sync delta → archive" so a single invocation runs the
  whole stage. Invoke them by change name; let them drive.
- **Subagent delegation for docs writes** — two `general-purpose` subagents handled the
  file-index annotations and the delta→main spec sync, honoring the repo's rule that
  `docs/` writes are delegated (caveman style). Invoke this whenever a change touches
  `docs/` or spec prose.

**Skill worth creating:** a *worktree-ship* skill capturing "fresh worktree needs
`npm ci` before tsc/vitest → exclude machine-local `.pi/settings.json` → PR to develop
may conflict + block CI → rebase, resolve context-collisions by keeping your side and
re-inserting the other branch's genuinely-new blocks → force-push → watch CI." Every
one of these was rediscovered live this session.

## 7. Pitfalls & dead ends

- **Fresh worktree has no `node_modules`** → `tsc` can't resolve cross-package imports.
  Fix: `npm ci` inside the worktree *before* typechecking or testing.
- **Page name collides with nav-button text** in RTL queries ("Sessions" matched both).
  Fix: assert on the **URL** (`window.location` / memory-location), not heading text.
- **Route-dependent tests can't mock only `useLocation`.** Fix: mount real `wouter`
  with a memory-location + jsdom history so `/settings/:page?` actually resolves.
- **A conflicting PR silently blocks CI.** GitHub can't build a test-merge commit when
  the branch conflicts with base, so **no checks run at all** — it looks hung, not red.
  Fix: rebase onto `develop`, resolve, force-push; CI triggers once mergeable.
- **Auto-merge context-collisions misalign unrelated blocks.** develop's Sessions
  additions got aligned against the new Security page. Fix: keep *your* side for your
  content, then separately re-insert the *other* branch's genuinely-new feature block
  in its correct new home. Resolve by line number when special chars break exact match.
- **Tooling rewrites `.pi/settings.json`** to a machine-absolute `source` path. Fix:
  exclude it from the commit — it would break other clones/CI.
- **Parallel-load test flakiness** (`useImagePaste`) — confirm green in isolation
  before blaming your change.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an OpenSpec change with proposal/design/spec/`tasks.md`
authored; a worktree checkout; GitHub auth for `gh` PR + CI.

- [ ] `/skill:openspec-apply-change <name>` — let it read all context first.
- [ ] Read the target component fully; map JSX block line-ranges before editing.
- [ ] Fix the enumerated source-of-truth type first; let `tsc` list downstream breaks.
- [ ] Splice large JSX relocations with a Node script (verbatim reuse, re-indent).
- [ ] `npm ci` inside the worktree before `tsc` / `vitest`.
- [ ] Rewrite route tests with real `wouter` memory-location; assert on URL.
- [ ] `go on` → finish all tasks → `openspec validate --strict` + `npm run build`.
- [ ] `/skill:openspec-archive-change <name>` (syncs delta spec, delegates docs writes).
- [ ] Exclude `.pi/settings.json`; `commit. create PR and monitor CI`.
- [ ] If PR conflicts: rebase onto `develop`, keep-your-side + re-insert their new
      blocks, force-push, watch CI to green.

**Final artifacts:** the reorganized `SettingsPanel.tsx` (10-page left-nav layout),
`App.tsx` canonical `/settings/:page?` routing, extended `slot-types.ts` /
`slot-registry.ts` registry contract, rewritten `SettingsPanel.test.tsx` (+ fallback
and link tests), the synced `settings-panel` main spec, the archived change at
`openspec/changes/archive/2026-06-15-reorganize-settings-into-pages/`, and merged-ready
**PR #128** with green CI.

---

_Generated from session `019ec80b` · `pi-agent-dashboard` · 2026-06-15. Source extract: deterministic facts sheet._
