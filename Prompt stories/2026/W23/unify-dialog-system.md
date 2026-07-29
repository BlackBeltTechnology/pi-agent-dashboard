---
session: 019ea14c
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "created 1 skill(s) / 1 memory(ies); heavy steering (8 user prompts); large facts sheet (~11459 tok)"
upgrade_status: pending
openspec_changes: [unify-dialog-system]
proposal_excerpt: "The dashboard accumulated three generations of dialog code, each layered on the next without retiring the previous one. The result is visually inconsistent (three overlay tints — var(--bg-overlay), bg-black/50, b…"
---

# How we did it: Unify the dashboard dialog system — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The dashboard had accumulated **three generations of dialog code** stacked on top of one
another, never retiring the old layers. The result was visually inconsistent (three
different overlay tints), behaviourally uneven (some dialogs trapped focus, some didn't,
Esc/click-outside worked inconsistently), and duplicated across ~20 components plus two
plugins. The operator kicked the whole thing off with a single command:

```
/skill:openspec-apply-change unify-dialog-system
```

The *real* objective, made concrete by the attached OpenSpec change: build **one** shared
dialog primitive (`Dialog` shell + `Confirm` preset + `useFocusTrap` hook) in
`packages/client-utils`, wire it into the plugin UI-primitive registry **without breaking
the existing `ui:confirm-dialog` contract**, migrate all ~20 era-1/2/3 dialogs and the jj +
flows plugins onto it, delete the dead `ConfirmDialog` shim, then archive → PR → CI → merge →
clean up. 53 tasks, done in one ~3h session.

## 2. TL;DR playbook

1. **Start from the change, not a blank prompt:** `/skill:openspec-apply-change <change-name>`
   in the worktree. Let the skill load `tasks.md` and drive phase-by-phase.
2. **Build the primitive first, tests alongside** (`useFocusTrap` → `Dialog` → `Confirm`),
   run the *targeted* suite with `HOME=$(mktemp -d) npx vitest run --project <pkg> <files>`
   before touching any call site.
3. **Add the registry key additively:** re-skin `ui:confirm-dialog` via an adapter over the
   new `Confirm` (contract unchanged → plugins inherit the look free), and add a *new*
   `ui:dialog` key with a typed contract exposing the static subcomponents.
4. **Before migrating call sites in a worktree, run `npm install` in the worktree** — a fresh
   `.worktrees/*` checkout shares MAIN's `node_modules`, so cross-package edits aren't seen
   until the worktree gets its own workspace symlinks. (This bit the session hard; §7.)
5. **Migrate era-by-era**, grouping by pattern: simple confirms → `Confirm`; rich body/footer
   or busy/disabled/danger actions → `Dialog` shell. Delete `DialogPortal` wrappers (the new
   primitive owns its portal).
6. **Fix test fallout as you go** — most breakage is stale `data-testid`s and "click the
   container to close" that must become "click the overlay". Add `testId` props where tests
   need hooks.
7. **Validate wide:** `tsc` clean, `npm run build`, full vitest suite, `openspec validate
   --strict`; treat unrelated flaky-timeout failures as pre-existing (confirm by re-running
   in isolation).
8. **Land it:** archive the change (sync delta specs via subagent), revert incidental
   worktree side-effects (`.pi/settings.json`, `package-lock.json`), commit surgically,
   push, open PR, monitor CI, squash-merge to `develop`, then remove worktree + branches.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & primitive build (tasks 1.x–2.x).** The AI read all context files,
the UI-primitives registry, `main.tsx` registration, and an existing era-3 dialog for chrome
reference *before writing a line*. It then built `useFocusTrap`, `Dialog` (portal, `bg-black/60`
overlay, Esc, click-outside, focus trap, full ARIA, size variants, `Dialog.Footer/Cancel/Action`
with `primary|danger|neutral` intents), and the `Confirm` preset — each with its own test file.
*Why it worked:* building and unit-testing the primitive in isolation before any migration meant
every later call-site change was a mechanical swap against a known-good component.

**Phase 2 — Registry wiring (tasks 2.6–2.8).** Re-skinned `ui:confirm-dialog` through an
adapter (contract unchanged) and added an **additive** `ui:dialog` key with a typed contract.
*Decision point:* keep the old key's contract byte-for-byte so plugins inherit the new look
with zero edits — a deliberate backward-compat move.

**Phase 3–5 — Mass migration (era 1, 3, then 2).** ~20 dialogs + jj/flows plugins moved onto
`Dialog`/`Confirm`. The AI **considered delegating the bulk era-2 migration to a `react-expert`
subagent** but chose to do it inline "for precision" — the migrations needed per-file judgment
(which need `Confirm` vs `Dialog`, which keep a form for Enter-to-submit, which use danger
intents). *Why that worked:* the pattern was consistent enough to be fast but varied enough that
a blind batch would have mis-classified several.

**Phase 6 — Validation & cleanup.** Swept for stray overlay/z-index roots (correctly scoping
out non-dialog modals like bottom-sheets), ran `tsc` + build + full suite + strict openspec
validation, and delegated the `docs/` update to a subagent in caveman style per AGENTS.md.

**Land (steering prompts 3–8).** Archive → sync specs (subagent) → commit → PR #90 → CI green →
squash-merge to `develop` → remove worktree + local/remote branches. The operator drove this
tail with terse one-liners ("go on", "merge PR", "delete branch, worktree").

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change unify-dialog-system`.** The single most
  effective move: it hands the AI a 53-task plan with acceptance criteria instead of a prose
  ask. All the "what to build" ambiguity was pre-resolved in the change. *This is the pattern
  to copy: do the spec work first, then let the apply skill execute it.*
- **"go on"** — a high-leverage unlock after the AI paused on the worktree `npm install`
  question; a single word resumed the whole migration once the environment was fixed.
- **"Is there anything to fix in coderabbit review?"** — a good verification prompt that
  surfaced the *misleading* CodeRabbit green (it had actually hit a rate limit and reviewed
  nothing; §7).
- **"merge to develop" / "delete branch, worktree"** — terse closers that worked because the
  AI already had full PR/branch context. A future operator can lean on this: once CI is green,
  short imperatives are enough.

*Weak-prompt rewrite:* instead of "go on" mid-flow, a stronger nudge is **"you're inside a
worktree — run `npm install` here first so cross-package edits resolve, then continue"**, which
skips the diagnostic detour entirely.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Pause when worktree cross-package edits weren't seen by tests | "go on" (after the AI diagnosed the missing worktree `node_modules`) | State up front: fresh worktrees need `npm install` before cross-package work (a project memory was saved for exactly this) |
| Report CodeRabbit as "pass" from a green check | "Is there anything to fix in coderabbit review?" | Always open the actual review body — a green check can mean *rate-limited, zero findings*, not *vetted* |
| Say the merge went to `main` | "merge to develop" | Confirm the repo's default/base branch (`develop`, no `main`) before describing where work landed |
| Leave incidental worktree side-effects staged | (self-corrected) | Revert `.pi/settings.json` + `package-lock.json` touched by the worktree `npm install` to keep commits surgical |

Note the operator's steering was almost entirely *procedural* (environment, land-the-change),
not corrective on the code itself — a sign the OpenSpec plan front-loaded the hard decisions.

## 6. Skills, tools & memory created — and why they're effective

- **Skill `migrate-dialog-to-unified-shell` (project).** Captures the exact repeat recipe:
  swap an era-1/2/3 dialog onto the `Dialog`/`Confirm` primitive — portal, Esc, focus-trap,
  ARIA, intents. *Effective because* the session did this ~20 times and the classification
  rules (Confirm vs Dialog, delete DialogPortal wrapper, testId hooks, overlay-close test
  fix) are non-obvious the first time. **Invoke it** whenever another legacy dialog surfaces
  or a new one is written.
- **Project memory — worktree node_modules fall-through.** Records that `.worktrees/*` start
  with only `node_modules/.vite`; cross-package `@blackbelt-technology/*` imports fall through
  to MAIN's `node_modules` (whose symlinks point at MAIN's packages) until you `npm install`
  in the worktree. *Effective because* this cost real diagnostic time; the memory turns a
  30-minute detour into a one-line precondition. **Invoke it** at the start of any
  cross-package work inside a worktree.
- **Subagents used (not created):** `general-purpose` for the `docs/` caveman-style update and
  for the delta-spec sync — both self-contained, isolatable jobs that keep the main context clean.

## 7. Pitfalls & dead ends

- **Worktree can't see cross-package edits.** Symptom: you edit `packages/shared` but tests /
  runtime still resolve the OLD file. Cause: worktree shares MAIN's `node_modules`.
  **Fix:** `npm install` inside the worktree to create local workspace symlinks. (13 of the 13
  failed commands clustered around diagnosing this.)
- **jsdom has no layout.** `offsetParent` is always `null` and `CSS` is undefined — a
  visibility filter using them silently breaks the focus trap in tests. **Fix:** drop the
  `offsetParent` check; use `getElementById` instead of `CSS.escape`-style queries.
- **Stray `newText_x` edit keys.** The AI repeatedly left a malformed edit key and had to redo
  edits cleanly (happened 3×). **If you hit garbled edits, re-view the file tail and redo the
  edit as one clean block** rather than patching the patch.
- **A green CodeRabbit check ≠ a review.** It had hit an org usage-credit / rate limit and
  produced **zero** findings; the "pass" only meant "no findings produced". **Fix:** read the
  review body; re-trigger with `@coderabbitai review` after credits refresh, or self-review
  the diff.
- **Tests that "click the container to close".** After migration the container no longer
  dismisses — only the overlay does. **Fix:** update those tests to click the overlay element.
- **Two full-suite failures were unrelated flakes** (`pi-image-fit` JPEG, `pi-dashboard-server`
  doctor-route — both timeouts). **Confirm by re-running in isolation** before assuming your
  change caused them.
- **Deleting your own active worktree.** The final cleanup removed the worktree the shell was
  `cd`'d into, so subsequent commands failed with "Working directory does not exist". **Fix:**
  run the `git worktree remove` from the MAIN repo, and `cd` back to it afterward.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- An OpenSpec change with a full `tasks.md` (do the spec work first — this is what made the
  session smooth).
- A worktree at `.worktrees/<name>` for the change.
- `gh` auth for the PR + CI monitoring.

**Checklist:**
1. `/skill:openspec-apply-change <change>` in the worktree.
2. **`npm install` in the worktree** (before any cross-package edits).
3. Build the primitive + tests first; verify with a targeted `HOME=$(mktemp -d) npx vitest run
   --project <pkg> <files>`.
4. Wire the registry **additively** (re-skin old key via adapter, add new key with typed
   contract).
5. Migrate call sites era-by-era; drop `DialogPortal` wrappers; add `testId`s where tests need
   them; fix overlay-close + stale-testid test fallout.
6. Validate wide: `tsc`, `npm run build`, full suite, `openspec validate --strict`; re-run any
   failures in isolation to prove they're pre-existing.
7. Delegate `docs/` + spec-sync to subagents.
8. Revert incidental worktree files, commit surgically, push, open PR, **read** the CodeRabbit
   body (not just the check), squash-merge to `develop`.
9. From the MAIN repo, `git worktree remove` + delete local/remote branches.

**Artifacts produced:** `packages/client-utils/src/{useFocusTrap,Dialog,Confirm}.tsx` (+ tests),
additive `ui:dialog` registry key in `packages/shared`, ~20 migrated dialogs + jj/flows plugins,
deleted `ConfirmDialog` shim, two new synced spec capabilities
(`openspec/specs/{dialog-system,confirm-dialog}/spec.md`), archived change at
`openspec/changes/archive/2026-06-07-unify-dialog-system/`, merged **PR #90** on `develop`.

---

_Generated from session `019ea14c` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-07. Source extract: `/var/folders/qb/.../session_facts.XXXXXX`._
