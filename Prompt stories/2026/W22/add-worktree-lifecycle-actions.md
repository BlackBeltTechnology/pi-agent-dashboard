---
session: 019e6633
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (14 user prompts); large facts sheet (~11212 tok)"
upgrade_status: pending
openspec_changes: [add-worktree-lifecycle-actions, fix-reload-script-ipv6-and-ws-lib]
proposal_excerpt: "`add-worktree-spawn-dialog` shipped worktree creation but explicitly deferred removal, merge, PR creation, and the cwd-loss handling those operations require. Users now have a one-click way to *make* worktrees but no…"
---

# How we did it: Worktree lifecycle actions (remove / merge / PR / cwd-loss) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was the `openspec-apply-change` skill pointed at the change
`add-worktree-lifecycle-actions` — a **47-task, ~30-file, ~80-test** spec-driven change.
The prior change (`add-worktree-spawn-dialog`) had shipped worktree *creation* but
deferred everything that comes after: removing a worktree, merging it back, pushing +
opening a PR, and handling the case where a worktree's directory disappears out from
under an ended session (the "cwd-gone" state). The real objective, once the steering
turns clarified it, was: **implement the full worktree lifecycle end-to-end (server ops
+ shared protocol + bridge probe + 4 client components), then actually drive one real
PR through the dashboard UI** — which surfaced a cascade of real-world integration bugs
(dialog stacking context, force-remove race, wrong PR base ref, `gh --fill` blow-up) that
had to be fixed live before the feature worked in anger.

## 2. TL;DR playbook

1. **Invoke the skill on the change:** `openspec-apply-change` → `add-worktree-lifecycle-actions`.
   Confirm the plan before diving in (project rule: "confirm before any major change").
2. **Work the spec sections in dependency order:** pure helpers → shared types/protocol →
   bridge probe → server endpoints → server cwd-loss handling → client components →
   folder action → mobile → docs → validation. Write tests *per section*, run them,
   mark tasks done.
3. **Register new external tools in the tool registry** (here: `gh`) before the client
   probes for them.
4. **Delegate every `docs/` write to a general-purpose subagent** in caveman style
   (project rule) — gather the row data first, then spawn.
5. **Run the full suite once at the end** (`npm test`), isolate any flake
   (re-run the single file), and mark manual/cross-platform smoke tasks as *deferred*,
   not done, honestly.
6. **Then actually drive the feature in the live UI.** This is where the real bugs live —
   dialog rendering inside the card, remove-not-working, PR errors. Fix each with a
   focused test.
7. **For client-only fixes** rebuild (`npm run build`); **for server-only fixes** restart
   (no build — jiti). Know which one each change needs.
8. **Land it:** archive the change, sync delta specs, commit (excluding unrelated
   proposals), create a jj bookmark, push, and fix any CI type errors your branch surfaces.

## 3. How the collaboration unfolded

**Phase 1 — Survey & plan (23:31–23:54).** The AI read all context files, sized the change
(47 tasks / 2000+ lines), and *checked in before starting* per the project's confirm-first
rule. It surveyed existing patterns (`git-worktree-ops` tests, `DialogPortal`,
`hide_session`, `WorkspaceSubcard`) with targeted `grep`/`read` before writing anything.

**Phase 2 — Sequential build (23:54–00:25).** Twelve spec sections built in dependency
order, each with tests written and run *before* moving on: pure stderr→code mappers
(53 tests), shared types round-trip, bridge cwd probe, 5 server endpoints (16 ops + 13
route tests), server cwd-loss handling, 4 client components (27 tests). Docs delegated to a
subagent. Final suite: **6294 passed, 0 failed** — one flake isolated and confirmed
pre-existing. 45/47 done; the 2 manual/Windows smoke tasks marked *deferred* honestly.

**Phase 3 — Live UI debugging (00:30–01:04).** The human ran the feature and reported real
bugs the tests couldn't catch: (a) the close dialog rendered *inside* the session card, not
full-screen → `DialogPortal` wrap; (b) *remove didn't work* → the shutdown was wired to the
card's own `onShutdown` (takes no id) and a `setTimeout` retry got killed when the card
unmounted → fire shutdown + forced remove in parallel; (c) *PR errored* → gh-gating hid the
button, then a wrong base ref (`gitWorktreeBase` not on origin) + `gh pr create --fill`
blew up → resolve base against `origin/*`, drop `--fill`, derive explicit title.

**Phase 4 — Land & clean up (00:56–01:35).** Archive → sync delta specs (3 caps extended,
1 new) → commit (deliberately excluding the unrelated `fix-reload-script-ipv6-and-ws-lib`
proposal) → jj bookmark + push → fix a CI `tsc` error (`tunnel` section missing from the
client's `DiagnosticsSection` maps) that the branch happened to surface.

**Decision points the human owned:** whether a worktree branch is mandatory (answered:
no); gate PR buttons on `gh` availability; which commit to fold back onto and where
(`add-worktree-lifecycle-actions` branch, not trunk).

## 4. Prompts that worked

- **The goal prompt** (the `openspec-apply-change` skill invocation) — effective because it
  handed the AI a *structured, testable spec* with numbered tasks. The AI never had to
  guess scope; it read tasks.md and executed. Reusable lesson: **feed the AI a spec, not a
  vague feature request**, for anything above ~5 files.
- **"PR buttons be shown when gh tool is available"** — a one-line quality bar that unlocked
  the whole gh-gating design (probe once per page, hide when unavailable, keep View-PR when
  a PR already exists). Short, specific, high-leverage.
- **"yes and update docs proposal"** — bundled an approval with a scope reminder in five
  words. Effective because it kept docs + spec in sync with the code in one turn.
- **"The error [image]"** — pasting the actual gh error screenshot is what let the AI
  diagnose the wrong-base + `--fill` root cause. **Show the real error, don't paraphrase it.**
- **"The git branch is add-worktree-lifecycle-actions. I would like to fold-back there"** —
  the *first* "fold back" was ambiguous and the AI stalled; naming the exact target branch
  unblocked it instantly. Rewrite of the weak version: state the destination ref explicitly
  the first time.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Render `fixed inset-0` dialogs inside the SessionCard's stacking context | "Close dialog showed in session card, not on whole screen" | Always wrap card-spawned dialogs in `DialogPortal` from the start |
| Wire a per-card `onShutdown` (no id) to shut down *another* session, with a `setTimeout` retry that dies on unmount | "removing seems not work" | Fire shutdown + `force:true` remove in parallel; never rely on a timer that outlives the component |
| Render the "Open PR" button unconditionally, then fail with `gh_not_found` | "PR buttons be shown when gh tool is available" | Probe the tool registry once per page and gate the button on availability |
| Leave spec saying "four actions always visible" after gh-gating the impl | (implicit — AI caught its own contradiction) | Update spec + proposal in the same turn you change UI behavior |
| Pass `gitWorktreeBase` (a local-only branch) as the PR base | Pasted the real gh error image | Resolve PR base against `origin/*` refs; fall through to `origin/{develop,main,master}` |
| Use `gh pr create --fill` (needs base on remote) | Same error | Derive explicit `--title` from the last commit subject; pass empty body; drop `--fill` |
| Stall on the ambiguous "fold back" | "fold-back there … branch is add-worktree-lifecycle-actions" | Name the exact target ref in the request |
| Commit unrelated staged proposals | (AI self-corrected) | Selectively stage; keep unrelated changes (`fix-reload-script-ipv6-and-ws-lib`) out of the commit |

## 6. Skills, tools & memory created — and why they're effective

No new pi *skill* or *memory* was created this session, but three **general-purpose
subagents** were spawned for docs work — and that pattern is the reusable asset:

- **Docs-to-subagent delegation** (used 3×: initial docs, gh-gating docs, delta-spec sync).
  Captures the project rule that all `docs/` writes go through a subagent in caveman style.
  Effective because it keeps the main context lean and enforces the house doc style without
  the main agent context-switching into prose mode. **Invoke it** whenever a change touches
  `docs/` — gather the row data in the main session, then hand the subagent a precise spec.
- **`gh` registered in the tool registry** — makes an external CLI *discoverable* to the
  client so UI can probe availability (`/api/tools/gh`) and gate features. Reusable pattern
  for any optional external binary the UI depends on.

Recommended skill to create from this session: **"drive an openspec change to a live PR"** —
the apply → archive → sync → commit → bookmark → push → fix-CI loop was executed ad-hoc and
would benefit from being a codified procedure (it partly overlaps the existing `ship-change`
/ `ship-it` skills — worth reconciling against those).

## 7. Pitfalls & dead ends

- **Dialogs clipped inside cards:** if a dialog renders *inside* a component instead of
  full-screen, the parent has a stacking context → wrap in `DialogPortal` (renders at
  `document.body`).
- **`setTimeout` retry killed on unmount:** if an action ends the session that owns the
  component firing it, any pending timer dies. Fire the follow-up request *immediately in
  parallel* with `force:true` so the server skips the now-invalid precondition.
- **`gh pr create --fill` cryptic failure:** `--fill` needs the base branch on the remote.
  When the base is local-only, it explodes. Resolve base against `origin/*` and pass an
  explicit `--title` derived from the last commit subject instead.
- **gh writes errors to stdout, not stderr:** concatenate stdout+stderr before mapping error
  codes, or you'll miss the real message ("could not compute…").
- **Toast hid the real error:** surface stderr in a `<details>` disclosure so the operator
  can see the actual gh/git output behind a generic code like `pushed_but_pr_failed`.
- **jj-colocated "detached HEAD":** expected in this repo — jj owns HEAD. Git commits still
  land; set a `jj bookmark` to get a pushable branch pointer.
- **Branch your change surfaces an unrelated CI break:** the `tunnel` `DoctorSection` was
  added elsewhere but the client's `SECTION_ORDER`/`SECTION_LABEL` maps were never updated →
  `tsc` TS2741. Two-line fix; not yours conceptually but blocks your PR, so fix it.
- **Full-suite flake:** a chat-image-paste test failed on retry but passed in isolation —
  re-run the single file to confirm a flake before treating it as a regression.
- **Don't mark manual/cross-platform tasks "done" you can't run:** 12.3 (live smoke) and
  12.4 (Windows VM) were honestly left *deferred* (45/47), not falsely checked.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the openspec change with a filled `tasks.md`; `gh` installed +
authed for the PR path; a running dashboard to drive the live UI; jj/git push access.

- [ ] `openspec-apply-change` on the change; confirm the plan before building.
- [ ] Build spec sections in dependency order; write + run tests per section; mark done.
- [ ] Register any new external CLI (`gh`) in the tool registry before the client probes it.
- [ ] Wrap all card-spawned dialogs in `DialogPortal`; avoid unmount-fragile `setTimeout`.
- [ ] Gate optional-tool UI on a registry probe; keep spec/proposal in sync with UI behavior.
- [ ] Delegate `docs/` writes to a general-purpose subagent (caveman style).
- [ ] `npm test`; isolate flakes; leave un-runnable smoke tasks *deferred*, not done.
- [ ] Drive the feature live; fix real integration bugs with focused tests.
- [ ] Client fix → `npm run build`; server fix → restart (no build, jiti).
- [ ] Archive → sync delta specs → commit (exclude unrelated proposals) → jj bookmark → push.
- [ ] For the PR path: resolve base against `origin/*`, drop `gh --fill`, use explicit title.
- [ ] Fix any CI `tsc` error your branch surfaces (e.g. missing `tunnel` section maps).

**Artifacts produced:** `packages/server/src/git-worktree-lifecycle.ts`,
`active-sessions-in-cwd.ts`, extended `git-operations.ts` + `routes/git-routes.ts`;
client `CwdGonePill.tsx`, `MergeConfirmDialog.tsx`, `CloseWorktreeDialog.tsx`,
`WorktreeActionsMenu.tsx`; shared `types.ts`/`protocol.ts` updates; ~80 tests.
Commits: `9c1c961b` (feature), `efffdb74` (PR-base + error-toast fix), `f264a086`
(CI tunnel-section fix). Pushed to `origin/add-worktree-lifecycle-actions`.

---

_Generated from session `019e6633` · `pi-agent-dashboard` · 2026-05-26. Source extract: deterministic facts sheet (session-to-guideline)._
