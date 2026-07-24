---
session: 019e706d
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (22 user prompts); large facts sheet (~12641 tok)"
upgrade_status: pending
openspec_changes: [redesign-session-card-and-composer]
proposal_excerpt: "Today the session card mixes git and jj in one `WORKSPACE` subcard, hides OpenSpec workflow progression behind a single state pill, and renders the same action surface only in the sidebar — so users lose context the m…"
---

# How we did it: Redesign the session card + composer action strip — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single slash command: `/skill:openspec-apply-change redesign-session-card-and-composer`. That change proposal's real objective: the session card **mixed git and jj into one `WORKSPACE` subcard, hid OpenSpec workflow progression behind a single state pill, and only exposed actions in the sidebar** — so users lost context. The apply covered a 54-task UI redesign (CSS neon-ring foundation, a 7-node OpenSpec stepper, split GIT/JJ subcards, a composer action strip). But the *actual* deliverable that emerged over 22 prompts was much bigger than the written spec: a **semantic action-button palette unified across three surfaces (folder header / sidecard / composer)**, **config-driven action gating** off `openspec config list`, and a full round of live-in-browser visual polish. The spec started it; the steering finished it.

## 2. TL;DR playbook

1. **Kick off the apply**: `/skill:openspec-apply-change <change>`. Let the AI read the spec, mockup, and touched components, then confirm scope before it writes.
2. **Implement in phases, test each phase**: CSS → components → gating → tests. The AI ran `HOME=$(mktemp -d) npx vitest run <suite>` after every phase and only marked `tasks.md` checkboxes green when the suite passed.
3. **Deploy to a *visible* URL**: in a worktree, `npm run build` alone is not enough — the global `pi-dashboard` binary serves the **main repo's** `dist/` via npm-workspace symlink hoisting. Build in the worktree, then **swap the build into the main repo's `packages/client/dist/`** (back up first) and restart. Hard-refresh the browser (⌘⇧R) because the bundle hash is cached.
4. **Iterate on real pixels**: paste a screenshot, name the visual bug, let the AI fix + redeploy + tell you the new bundle hash. Repeat.
5. **When "it's not working" appears, drive the browser**: the AI opened the page with the `browser` skill, snapshotted, and found the buttons were `[disabled]` *because the session was streaming* — not a code bug.
6. **Push config into the UI, not hard-codes**: when the user asked for a non-static stepper, the AI web-fetched the `openspec config list --json` schema, added a server route + `useOpenSpecConfig` hook, and gated every button on `workflows.includes(...)`.
7. **Unify the palette once**: define a single `VARIANT_CLASSES` record (Apply=blue, Verify=green, Archive=purple, Explore/Tasks=cyan, Push/PR=orange, Merge=green, Close=red) and reuse it across all three surfaces.
8. **Land it**: rebase onto develop (resolve the `docs/file-index-client.md` conflict), force-push with `--force-with-lease`, update the PR body, and watch CI — where `tsc --noEmit` catches type errors that local vitest silently passes.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & scoped implementation (spec-driven).** The AI read the change's specs, mockup, and every touched component (`SessionCard`, `SessionOpenSpecActions`, `CommandInput`, `App.tsx`), confirmed the 54-task scope, then implemented phase-by-phase: CSS neon-ring vars + keyframes, a pure `deriveStepperState` + `OpenSpecStepper.tsx`, action gating, GIT/JJ subcard split, the `ComposerSessionActions` strip. Each phase ended with a scoped vitest run and a `sed` checkbox flip in `tasks.md`. *Why it worked:* small phases + immediate tests kept a 6444-test monorepo green throughout.

**Phase 2 — The deploy-visibility trap.** "I don't see" (prompt 7) exposed that a worktree build never reaches the browser: workspace hoisting makes the server resolve the client from the **main repo's** `dist/`. The AI diagnosed it via `require.resolve`, then swapped the worktree build into the main-repo dist (with a `dist.bak-<ts>` backup) and restarted. *Decision point:* the human accepted the swap-and-restore hack as the pragmatic way to preview worktree UI.

**Phase 3 — Live visual iteration.** Prompts 8–13, 16–18 were screenshots + terse bug reports ("buttons too near", "refresh before model selector", "buttons not colored", "hover puts green line inside circle"). The AI moved actions into the `StatusBar` model bar via new `actions`/`leading` slots, wired dead no-op stubs (Tasks, Explore) to real popovers/dialogs, added spin feedback to Refresh, and fixed a `hover:opacity-80` bleed. *Why it worked:* the human reviewed **rendered pixels**, not diffs — every prompt was a concrete observable defect.

**Phase 4 — "Not working" was actually correct behavior.** "The refresh and task buttons are not working" (prompt 10) sent the AI to *drive the browser itself* — it snapshotted and found every action button was `[disabled]` because the session was **streaming**. The gating was intentional (`disabled={streaming}`). *Decision point:* the AI surfaced the design tension (should Tasks be readable during streaming?) instead of blindly "fixing" a non-bug.

**Phase 5 — From static to config-driven.** Prompt 15 asked for the stepper to reflect *available* OpenSpec states, not a hard-coded 7. The AI web-fetched the `openspec config list` schema + `workflows.md`, saved a `workflow-state-diagram.md` (mermaid) into the change dir, then built the pipeline: shared `OpenSpecConfig` type + `DEFAULT_OPENSPEC_CONFIG` fallback, a cached `GET /api/openspec/config` route, a `useOpenSpecConfig(cwd)` hook, and a `wf("<command>")` gate on every button. *Why it worked:* research-before-implement produced a design doc the human approved before any code.

**Phase 6 — Land it.** Rebase onto develop (one conflict in `docs/file-index-client.md`), force-push with lease, rewrite the 8.6 KB PR body, then chase a red CI: `handleBulkArchive(cwd)` vs the prop's `() => void`. Local `npm test` (vitest, no typecheck) passed; CI's `tsc --noEmit` caught it. Fixed by closing over `selectedCwd`.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change redesign-session-card-and-composer`. Effective because the spec/mockup/tasks already existed; the slash command handed the AI a bounded, testable contract. *Stronger version:* add "confirm scope and the phase plan before writing any code" so the AI front-loads the 54-task breakdown (it did anyway, but stating it guarantees it).
- **High-leverage follow-up** — prompt 15: *"The openspec not that static… `openspec config list` shows them. Analyze — use webfetch — to make a workflow diagram… I would like to adapt that, so the timeline be based [on] the given and available states."* One prompt turned a hard-coded stepper into a config-driven system, and it explicitly told the AI **how** to research (webfetch) and **what artifact** to produce first (a diagram). Copy this shape: *observation → the data source → the research method → the artifact → the adaptation.*
- **Screenshot + one-line defect** — prompts 8, 16, 17, 18. Pasting an image with "the buttons are not colored" is higher-bandwidth than any prose description. *Bake in:* always attach the rendered screenshot when reporting a visual bug.
- **"commit and push. The button groups don't show the functional group, e.g. openspec, git, jj. Some label helps"** (prompt 12) — bundles a checkpoint (commit) with the next refinement, keeping momentum.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Build a worktree and assume the browser sees it | "I don't see" | Stating up front: worktree UI needs the *build-swap-into-main-dist* dance + hard refresh (see §7). |
| Leave action buttons as no-op stubs (`/* tasks popover lives on sidecard */`) | "The refresh and task buttons are not working" / "Tasks does not open" | Requiring every rendered button to be wired to a real handler in the same phase it's added. |
| Report defects it couldn't see | AI itself drove the browser to snapshot | Ask the AI to *drive the browser and snapshot* before claiming a button is broken. |
| Hard-code the stepper to 7 fixed nodes | "the openspec not that static… config determines available steps" | Gating UI on runtime config (`openspec config list`) from the start, with a full-set fallback. |
| Color buttons inconsistently per surface | "buttons are not colored" (×3, across sidecard/composer/folder) | Defining ONE semantic `VARIANT_CLASSES` palette and reusing it across every surface. |
| Keep meaningless UI (unattached Archive, single-item overflow menu, redundant Tasks button) | "when no openspec attached the archive is meaningless. Hide them… menu with one item is meaningless" | Hiding actions that don't apply to the current state; never ship a `...` menu with one item. |
| Pass `npm test` locally while a type error lurked | CI `tsc --noEmit` failed on PR #50 | Running `npx tsc --noEmit` (not just vitest) before pushing — vitest doesn't typecheck. |

## 6. Skills, tools & memory created — and why they're effective

No new pi skill or memory was saved this session, but the workflow surfaced **three reusable patterns worth capturing as skills**:

- **`worktree-ui-preview`** — build in the worktree, back up main-repo `packages/client/dist`, swap in the worktree bundle, restart, hard-refresh. Solves the workspace-hoisting invisibility trap that cost several prompts here. *(Note: the repo's `isolated-ui-verification` skill already covers safer isolated preview — prefer it over the dist-swap hack when available.)*
- **`config-driven-ui-gating`** — the shared-type + cached-server-route + `useConfig(cwd)` hook + `wf("cmd")` gate pattern, with a full-set default fallback so the UI never disappears on a failed/slow config fetch. Reusable anywhere a CLI's capability list should drive which buttons render.
- **`semantic-action-palette`** — a single `VARIANT_CLASSES` record (Apply=blue primary, Verify/Merge=green success, Explore/Tasks=cyan info, Archive=purple accent, Push/PR=orange warn, Close=red danger) reused across every action surface, so a color means the same thing everywhere.

Tools that carried the session: the **`browser`** skill (self-driving to snapshot and diagnose "disabled = streaming"), **`web_search` + `ctx_fetch_and_index`** (to pull the `openspec config list` schema before designing), and the **`Explore`** subagent (to update file-index docs).

## 7. Pitfalls & dead ends

- **Worktree build is invisible in the browser.** The global `pi-dashboard` binary symlinks to the *main repo's* server, which resolves the client from the *main repo's* `dist/` via npm-workspace hoisting. Building in the worktree changes nothing you can see. *Fix:* back up + swap the worktree build into `packages/client/dist/`, restart, and hard-refresh (⌘⇧R) — the old bundle hash is cached. Restore later with `mv packages/client/dist.bak-* packages/client/dist`.
- **"Button not working" during streaming is by design.** Every action is `disabled={streaming}`. *If you hit this:* wait for the spinner to stop, or drive the browser to confirm the `[disabled]` attribute before touching code.
- **`npm test` (vitest) does NOT typecheck.** A `(cwd: string) => void` vs `() => void` prop mismatch passed locally and only failed on CI's `tsc --noEmit`. *Fix:* run `npx tsc --noEmit` before pushing.
- **Vitest doesn't inherit Vite's path aliases.** New exports in the shared package resolved to the hoisted main-repo symlink (which lacked them) until the alias was added to `vitest.config.ts`. *If tests can't find a fresh shared-package export, add the alias.*
- **A batched multi-edit rolls back entirely if one edit fails.** When edit #4 didn't match, edits #1–3 silently reverted too. *Re-apply the whole batch after fixing the failing hunk.*
- **Single-item overflow menus are noise.** A `...` menu hosting one "Archive anyway" item was promoted to a plain inline button; all the portal/ref/click-outside plumbing became dead code and had to be removed.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-apply-change <change>` — let the AI read spec + mockup + touched components and confirm the phase plan.
- [ ] Implement phase-by-phase; after each phase run `HOME=$(mktemp -d) npx vitest run <suite>` and flip `tasks.md` checkboxes only on green.
- [ ] To preview worktree UI: `npm run build` in the worktree → back up `packages/client/dist` → swap in the worktree bundle → restart → hard-refresh (⌘⇧R).
- [ ] Iterate with **screenshots + one-line defect** reports; let the AI redeploy and report the new bundle hash each time.
- [ ] When a control "doesn't work," have the AI **drive the browser + snapshot** before editing — check for `[disabled]`/streaming first.
- [ ] For dynamic behavior, gate UI on runtime config (`openspec config list --json`) with a full-set fallback; research the schema (webfetch) and save a mermaid state diagram before coding.
- [ ] Define ONE semantic color palette and reuse it across every action surface.
- [ ] Before pushing: `npx tsc --noEmit` (vitest won't catch type errors) + full `npm test`.
- [ ] Land it: rebase onto develop (`--force-with-lease`), resolve `docs/file-index-*` conflicts, update the PR body, watch CI.

**Key inputs to have ready:** the OpenSpec change dir (`openspec/changes/<name>/` with specs + mockup + tasks.md), a running dashboard server, a browser for pixel review.
**Artifacts produced:** `OpenSpecStepper.tsx`, `ComposerSessionActions.tsx` (+ tests), `openspec-config-api.ts`, `workflow-state-diagram.md`, edits across `SessionCard`, `SessionOpenSpecActions`, `StatusBar`, `CommandInput`, `App.tsx`, the shared `OpenSpecConfig` type, and the server config route — landed as PR #50 (9 commits).

---

_Generated from session `019e706d` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/redesign-session-card-and-composer` · 2026-05-28. Source extract: session facts sheet._
