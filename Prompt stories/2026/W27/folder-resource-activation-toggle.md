---
session: 019f2ca3
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [folder-resource-activation-toggle]
proposal_excerpt: "The dashboard already wraps pi's **install** dimension into settings pages at both scopes: the directory settings surface (`/folder/:cwd/settings/:page?`) and the global settings page (`/settings/:page?`, `SettingsPan…"
---

# How we did it: folder-resource activation toggle — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was a single skill invocation:

```
/skill:openspec-apply-change folder-resource-activation-toggle
```

The real objective: implement an already-designed OpenSpec change end to end — add
an **enable/disable toggle** for pi resources (skills, extensions, prompts, packages)
inside the dashboard, at both the folder and global scope. That means threading a new
`enabled` flag through the shared types, having the server read/write pi's own
activation state (never reimplementing pi's glob logic), exposing toggle + reload
endpoints, and wiring the switch UI into the existing resource surfaces — then landing
it through the full ship pipeline. The single steering turn (`Use ship-change skill`)
confirmed the second half: after 13/13 tasks were green, drive PR → CI → CodeRabbit →
squash-merge → worktree cleanup.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change-name>` from inside the change's worktree.
2. **Read before writing:** design.md, spec.md, tasks.md, plus every file the tasks
   name — and the relevant pi `dist/core/*.d.ts` (PackageManager, SettingsManager) to
   reuse pi's own resolver instead of reinventing it.
3. Fix the worktree's missing cross-package resolution **first**: mirror the parent's
   `node_modules/@blackbelt-technology/*` scope symlinks, repointed at the worktree's
   own packages, so `tsc` and vitest resolve sibling packages.
4. Implement task-by-task, TDD: shared types → server core (injectable resolver) →
   route → client api → hook → UI, writing a focused test per module and marking each
   task done only after it passes in isolation (`HOME=$(mktemp -d) npx vitest run <file>`).
5. Run the quality gate (`tsc --noEmit` + Biome). Fix **only the warnings your code
   introduced**; leave pre-existing warnings in files you merely touched.
6. Run the full suite; when failures appear, **prove they're flaky/environmental** by
   re-running suspects in isolation and against unmodified `main` before declaring them
   unrelated.
7. Update the directory `AGENTS.md` rows for every new file.
8. `Use ship-change skill` → archive+sync specs, commit, PR to `develop`, watch CI,
   drain CodeRabbit threads, squash-merge, delete branch + remove worktree.

## 3. How the collaboration unfolded

**Discovery (read-only).** Before touching code the AI read design/spec/tasks and the
key existing files (scanner, pi-gateway, server wiring, client `PiResourcesView` /
`resource-tree` / settings surfaces), and — crucially — inspected pi's own
`config-selector.js` and `settings-manager.d.ts` to learn the exact on-disk activation
format. This front-loaded reading is why the later implementation reused pi's resolver
verbatim instead of guessing glob semantics.

**Worktree plumbing.** The worktree had no local `node_modules`, so
`@blackbelt-technology/*` imports resolved to the *main* repo. The AI detected this and
recreated the parent's scope symlinks pointing at the worktree's own packages — a
prerequisite for multi-package type-checking that would otherwise silently type against
stale code.

**Implement (TDD, task-ordered).** Shared `enabled` flag → scanner stamping (injectable
resolver, defaults true) → `resource-activation-toggle.ts` core (replays pi's
config-selector write via `SettingsManager`) → `resource-activation-routes.ts`
(`/toggle` with per-file write mutex + `affectedSessions`, `/reload` folder-scoped) →
client `resources-api.ts` → `useResourceActivation` hook → toggle switch + reload banner
threaded into both render surfaces. Each module got its own passing test before the next.

**Verify.** `tsc` clean, Biome fixed only self-introduced warnings, and the full suite's
failures were dissected: each was either flaky under parallel port/fs contention (passed
in isolation) or environmental (`image-fit` needs per-package jimp; electron test uses a
machine path — both fail on unmodified `main` too). None touched the change's code.

**Ship (steering turn 2).** `ship-change`: `openspec archive` synced 3 requirements into
the main spec, commit → PR #232 → CI green over **3 rounds**, and CodeRabbit's 9 real
comments (1 Critical, 4 Major) were triaged and fixed (6 auto-resolved, 2 doc nits
handled), then squash-merged and the worktree torn down.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change folder-resource-activation-toggle`.
  Effective because the *design work was already done*: a well-formed OpenSpec change
  (proposal + design + spec + tasks) turns implementation into a deterministic execution
  of an ordered task list. The leverage is upstream, in the spec.
- **High-leverage follow-up** — `Use ship-change skill`. One short phrase handed off the
  entire land-it pipeline (archive → PR → CI → review → merge → cleanup) to a codified
  workflow, so the operator never had to micromanage the ship.

A future operator's stronger kickoff: same command, but confirm up front *"reuse pi's
own resolver — do not reimplement glob/activation logic"* and *"prove any full-suite
failures are pre-existing on main before proceeding"*, since both were things the AI
did well here but only by its own judgment.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementation was green | "Use ship-change skill" | State up front: "apply **and** ship via ship-change" so the handoff is one continuous run |
| (self-corrected) risk reimplementing pi's activation glob format | — (AI read pi's `config-selector.js` first) | Say "reuse pi's `SettingsManager`/`PackageManager`; never reinvent glob logic" |
| (self-corrected) type against stale main packages in a worktree | — (AI mirrored scope symlinks) | Note the worktree-symlink prereq in the apply skill / project docs |
| (self-corrected) treat flaky full-suite failures as real breakage | — (AI re-ran in isolation + on main) | State "CI's clean `npm ci` is the authoritative gate; prove local failures are flaky/environmental" |

This session needed almost no manual redirection — the single explicit steer was the
ship handoff. The rest of the "steering" was the AI's own discipline, which a future
operator should make explicit rather than rely on.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was a pure *consumption* of two
existing project skills, which is exactly why it ran so cleanly:

- **`openspec-apply-change`** — turns a designed change into an ordered, testable task
  execution. Effective because the hard thinking lives in the spec; apply just executes
  and marks tasks. Invoke it whenever a change has a complete proposal/design/spec/tasks.
- **`ship-change`** — codifies archive → PR → CI-watch → CodeRabbit-drain →
  squash-merge → worktree cleanup. Effective because it removes every manual ship step
  and encodes the exit condition (CI green + all review threads resolved). Invoke it once
  implementation is green and the change is ready to land.

If anything deserves capturing as a memory, it's the **worktree scope-symlink prereq**
and the **flaky-vs-environmental triage recipe** — both were re-derived here and would
save time if written down.

## 7. Pitfalls & dead ends

- **Worktree cross-package imports resolve to main.** No local `node_modules` means
  `@blackbelt-technology/*` type-checks against the parent repo. → Mirror the parent's
  `node_modules/@blackbelt-technology/*` symlinks into the worktree, repointed at its
  own `packages/*`, before running `tsc`/vitest.
- **Full-suite failures that aren't yours.** `image-fit` (missing per-package jimp),
  `spa-fallback` (needs a client build), `node-electron-resolution` (machine path) fail
  under the worktree. → Re-run each suspect in isolation (`HOME=$(mktemp -d) npx vitest
  run <file>`) and against unmodified `main`; if they pass there, they're
  flaky/environmental. Trust CI's clean install.
- **The spec's disable pattern was wrong.** It used `-./.pi/notes.md`; pi computes the
  pattern **relative to baseDir** (`skills/notes.md`), disable `-<pattern>`, enable
  `+<pattern>`. → Verify the on-disk format against pi's real resolver, not the spec text.
- **Removing the worktree kills the shell's cwd.** `git worktree remove` from inside the
  worktree strands the Bash tool. → Do final cleanup from the parent checkout (or a
  sandbox shell with an explicit cwd).
- **`--delete-branch` collides with the worktree/`develop` checkout.** The remote merge
  still succeeds. → Delete the remote branch and remove the worktree manually afterward.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a complete OpenSpec change (proposal + design + spec + tasks)
in its own worktree; `gh` authenticated; access to pi's `dist/core/*.d.ts`.

- [ ] `cd .worktrees/<change>` and mirror parent `@blackbelt-technology/*` scope symlinks.
- [ ] `/skill:openspec-apply-change <change-name>`.
- [ ] Read design/spec/tasks + every named file + pi's `SettingsManager`/`PackageManager` types.
- [ ] Implement task-by-task TDD; test each module in isolation before marking done.
- [ ] `tsc --noEmit` + Biome; fix only self-introduced warnings.
- [ ] Full suite; triage failures (isolation + unmodified `main`) before proceeding.
- [ ] Update directory `AGENTS.md` rows for new files.
- [ ] `Use ship-change skill` → archive+sync, PR to `develop`, drain CodeRabbit, squash-merge, cleanup.

**Final artifacts (worktree-relative):** `packages/shared/src/rest-api.ts` (+`enabled`),
`packages/server/src/pi-resource-activation.ts`, `resource-activation-toggle.ts`,
`routes/resource-activation-routes.ts` (+ tests), `packages/client/src/lib/resources-api.ts`,
`hooks/useResourceActivation.ts`, toggle UI in `resource-tree.tsx` / `PiResourcesView.tsx` /
`DirectorySettings/ResourcesPage.tsx`. Merged as PR #232 (sha `16874def`).

---

_Generated from session `019f2ca3` · `pi-agent-dashboard` · 2026-07-04. Source extract: deterministic facts sheet._
