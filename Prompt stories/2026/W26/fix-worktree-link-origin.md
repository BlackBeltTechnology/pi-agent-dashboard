---
session: 019f0a9c
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-worktree-link-origin, git-root-file-containment]
proposal_excerpt: "Follow-up to `git-root-file-containment` (see its **Out of Scope** note). That change *legalized* worktree sessions reading parent-tree files, but did not fix the underlying **link-origin defect** it exposed:"
---

# How we did it: fix-worktree-link-origin — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a single slash command: `/skill:openspec-ff-change fix-worktree-link-origin`.
A `proposal.md` already existed for the change; the ask was to **fast-forward it through the
remaining OpenSpec artifacts** (design → specs → tasks), then implement and ship it.

The *real* objective, once grounded in the code: a **worktree file-link defect**. When a pi
session runs inside `…/repo/.worktrees/<slug>`, absolute file paths in tool output were rendered
and clicked **verbatim** — so clicking a file link opened the **parent checkout's** copy instead
of the worktree's own tree. The prior change `git-root-file-containment` only legalized reading
those parent-tree files; it left the link-origin bug exposed. This change fixes it by re-rooting
absolute tokens onto the worktree at the click/preview target.

## 2. TL;DR playbook

1. `/skill:openspec-ff-change <change>` — fast-forward the already-proposed change through
   design → specs → tasks. Re-run the command if the first pass stalls on a dependency.
2. **Ground the design in real code, not the proposal.** Spawn an `Explore` subagent to find
   the linkifier, then read `linkify-tool-output.ts` + `FileLink.tsx` yourself to confirm the
   *actual* defect site before writing `design.md`.
3. Write specs as one `ADDED` requirement (worktree re-rooting) + one `MODIFIED` (click routing).
   **Front-load a `SHALL`/`MUST` into the requirement's first sentence** — the validator only
   inspects sentence one. `openspec validate <change> --strict`.
4. `/skill:openspec-apply-change <change>` — TDD: write the failing unit test first (red), then
   the pure helper (`link-origin.ts`), then wire it into the renderer, then component tests.
5. **Use the project's own vitest binary**, not `npx vitest` (npx grabs a global). Run tests
   under an ephemeral `HOME=$(mktemp -d)` per the isolation guard.
6. `Use skill ship-change` — verify gate → archive+sync → docs (delegated, caveman style) →
   commit → push → PR against `develop` → watch CI → CodeRabbit → squash-merge → remove worktree.
7. When the gate goes red, **prove it's pre-existing/environmental** (diff-scope it to unrelated
   packages) before pushing — or fix the environment (worktree's own `npm install`).

## 3. How the collaboration unfolded

**Phase 1 — Fast-forward artifacts (Discovery + Design).**
The model located the existing change, read `proposal.md`, and pulled the design instructions.
It spawned an `Explore` subagent to find the link-origin code. Crucially, when Explore concluded
"resolution is correct," the model **distrusted that and read the source itself** — finding the
real defect: `linkify-tool-output.ts` flags absolute path tokens, and `FileLink.tsx` passes them
verbatim into `openFile(path)`, so an absolute parent-checkout path opens the parent copy. Key
design insight: the parent root is derivable by **stripping the trailing `/.worktrees/<slug>`
segment from cwd** — a pure string op, no new server payload, no git spawn. It wrote `design.md`,
then `spec.md` (one ADDED + one MODIFIED requirement), hitting one validator quirk (SHALL must be
in the first sentence), then `tasks.md`. `openspec validate --strict` green.

**Phase 2 — Apply (TDD implementation).**
Red first: wrote `link-origin.test.ts`, confirmed it fails because `link-origin.ts` doesn't exist.
Then implemented the pure helper (`stripWorktreeSegment` + `resolveLinkOrigin`, separator- and
drive-letter-normalized), got 13 unit tests green, wired it into `FileLink.tsx` so `origin` feeds
**both the tooltip and the open/preview target** (design decision D3), added component tests, and
type-checked. It correctly identified that the tsc errors were **pre-existing jimp import failures
in `image-fit-extension`**, unrelated to the change.

**Phase 3 — Ship (verify → land).**
This is where most of the 10 hours went. The verify gate showed 17 test failures — all in
`pi-image-fit-extension` from a **stale `jimp@0.16.13` install** (vs `^1.6.1` required). The model
paused and asked the human before pushing a red gate. The human said fix the install first. Root
cause: the worktree had **no per-package `node_modules`**, so jimp resolved up to the parent's
transitive v0. Fix: run `npm install` in the worktree; revert the resulting massive lockfile churn
(a different npm version re-annotating `"dev": true`); keep `node_modules`. Then 3 merge conflicts
from develop's PR #180 (file-preview refactor) — reconciled by keeping both sides. Then CI surfaced
a **pre-existing type error on develop's tip** (`WorktreeSpawnDialog.tsx:655`) inherited via the
merge; fixed with the existing `() => void handleCreateAndSpawn()` pattern. Two flaky tests
(a perf timeout, a clipboard/modal test) passed on rerun. CodeRabbit was rate-limited — the model
waited out the ~26-min window, triggered a real review, got one advisory "split the 126 KB index"
nit, and **deferred it** as out-of-scope. Squash-merged; worktree removed.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-ff-change fix-worktree-link-origin`. Effective because it
  named the exact change and invoked the right skill; the model needed no clarification to start.
  A stronger version bundles the intent: *"Fast-forward fix-worktree-link-origin through design/
  specs/tasks, grounding the design in the actual linkifier code, then apply and ship it."*
- **High-leverage follow-up** — `/skill:openspec-apply-change fix-worktree-link-origin`. One line
  moved from artifacts to a full TDD implementation.
- **High-leverage follow-up** — `Use skill ship-change`. Delegated the entire land pipeline
  (gate → archive → docs → PR → CI → CodeRabbit → merge → cleanup) to one skill.
- **The steering that mattered most** was the human's "fix the install first" reply at the red-gate
  checkpoint — see §5.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Consider pushing with a red verify gate, calling the failures "pre-existing environmental" | Saying **fix the install first** before shipping | Make "green the environment before you ship" a hard rule; run the worktree's own `npm install` up front |
| Trust the `Explore` subagent's "resolution is correct" verdict | (self-corrected) read the source itself to confirm the real defect | Always ground OpenSpec design in the actual code, never in the proposal's "site TBD" or a subagent summary |
| Reach for `npx vitest` (grabbed a global binary) | (self-corrected) use the project's `node_modules/.bin` binary | State up front: worktrees resolve deps from their own install — run `npm install` and use local `.bin` |
| Want to commit the lockfile churn after `npm install` | (self-corrected) `git checkout package-lock.json` — churn was npm-version re-annotation noise | Revert lockfile after a worktree install unless the change genuinely needs a dep bump |
| Consider bundling CodeRabbit's "split the 126 KB index" nit into the bugfix PR | (self-corrected) defer it — out of surgical-change scope | Treat advisory refactor suggestions on pre-existing files as separate tracked work |

The single explicit human correction (fix the install) was decisive; the model self-corrected on
the rest, which is the pattern worth reproducing: **pause at irreversible steps and diff-scope every
red signal to prove it's not yours.**

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the work rode entirely on existing skills:

- `openspec-ff-change` / `openspec-apply-change` / `ship-change` — the change lifecycle. Effective
  because each is a self-contained gate sequence; the operator only supplies the change name.
- `Explore` subagent — isolated read-only search for the linkifier code. Useful, but its verdict
  needed verification (see §5).
- `general-purpose` subagent — updated `docs/file-index-client.md` rows in **caveman style** per the
  Documentation Update Protocol (docs writes are always delegated).

**Recommended skill to create:** a *worktree-verify-gate* helper that (1) ensures the worktree has
its own `node_modules` (`npm install` if `.bin` missing), (2) reverts lockfile churn, and (3) runs
the gate with the local vitest binary under ephemeral `HOME`. This session spent hours rediscovering
that dance; it's clearly repeatable.

## 7. Pitfalls & dead ends

- **Worktree has no `node_modules` → phantom failures.** If tests fail with `jimp`/`Jimp`
  constructor errors or "cannot find vitest," the worktree is resolving deps from the parent's
  transitive install. Fix: `npm install` inside the worktree, then `git checkout package-lock.json`.
- **`npx vitest` grabs a global binary.** Use `node_modules/.bin/vitest` from the (installed)
  worktree instead.
- **OpenSpec `--strict` validator only reads the first sentence** for `SHALL`/`MUST`. Front-load the
  modal verb into the opening sentence of each requirement or validation fails.
- **Merging `develop` can inherit its red tip.** develop's own CI was red (a type error in
  `WorktreeSpawnDialog.tsx`); the PR inherited it via merge. Check develop's CI before blaming your
  own diff; fix the one-liner with the existing pattern in the same file.
- **CodeRabbit "pass" with 0 comments can be a rate-limit ACK**, not a real review. Verify a
  walkthrough exists; wait out the window and re-trigger if needed.
- **`gh pr merge` errors trying to switch the local checkout to `develop`** (already checked out in
  the parent worktree) — the server-side merge + branch delete still succeed. Verify remotely.
- **Flaky full-suite tests** (a >4000-entry perf timeout; a clipboard/modal test) pass in isolation
  and on rerun. Confirm in isolation before treating as a real failure.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name (with `proposal.md` already present), a clean
worktree at `…/repo/.worktrees/<slug>`, and `gh` auth for the PR/merge steps.

- [ ] `npm install` inside the worktree first (get its own `.bin` + nested deps); revert lockfile.
- [ ] `/skill:openspec-ff-change <change>` — design → specs → tasks.
- [ ] Ground `design.md` by reading the real code (`linkify-tool-output.ts`, `FileLink.tsx`), not
      the proposal or a subagent summary.
- [ ] Front-load `SHALL`/`MUST` into each requirement's first sentence; `openspec validate --strict`.
- [ ] `/skill:openspec-apply-change <change>` — TDD: failing test → pure helper → wire renderer →
      component tests. Use the local vitest binary under `HOME=$(mktemp -d)`.
- [ ] Diff-scope every red gate signal; fix the environment rather than ship red.
- [ ] `Use skill ship-change` — archive+sync, delegate docs (caveman style), PR against `develop`,
      wait for a **real** CodeRabbit review, defer out-of-scope nits, squash-merge, remove worktree.

**Artifacts produced:**
- `packages/client/src/lib/link-origin.ts` (+ `__tests__/link-origin.test.ts`)
- `packages/client/src/components/tool-renderers/FileLink.tsx` (+ its test)
- `openspec/changes/fix-worktree-link-origin/{design,specs,tasks}.md` (archived)
- `docs/file-index-client.md` rows for `link-origin.ts` + `FileLink.tsx`
- Merged as PR #181 → `develop`, squash commit `f0c4089d`.

---

_Generated from session `019f0a9c-710e-754f-8b0e-16495d4f0f2c` · `pi-agent-dashboard` · 2026-07-24. Source extract: `/var/folders/qb/m1_q3v6d5bnfzbpmc0dkkqx40000gn/T/facts.XXXXXX.07XCrruMqW`._
