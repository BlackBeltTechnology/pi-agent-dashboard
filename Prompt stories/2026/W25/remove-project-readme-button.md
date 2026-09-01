---
session: 019eec11
week: 2026/W25
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [remove-project-readme-button]
proposal_excerpt: "The per-folder \"View README.md\" button in the sidebar (and its whole supporting chain — overlay route, fetch hook, server endpoint) is being retired. It adds a per-cwd `/api/readme?check=1` probe fired for every unique folder…"
---

# How we did it: Remove the per-folder "View README.md" button — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single-line kickoff:

```
/skill:openspec-apply-change remove-project-readme-button
```

The real objective: **apply an already-planned OpenSpec change** that retires the
sidebar "View README.md" button and its *entire* supporting chain — the client button
+ state + `/api/readme?check=1` probe effect, the overlay route (`ReadmePreviewRoute`),
the `useReadmeFetch` hook, the `buildReadmeUrl` builder, the depth-2 back-target branch,
and the server `GET /api/readme` endpoint — then take it all the way from code to a
merged PR with the worktree torn down. This was a pure feature-removal-and-ship run,
not a design task: the proposal and `tasks.md` already existed; the AI's job was to
execute all 19 tasks faithfully and land the change.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change-name>` — start the apply loop against the
   existing OpenSpec change.
2. If skill resolution fails inside a worktree, tell it: **"opsx skills presented in
   worktree's parent dir"** — the skill lives at the main repo root, not the checkout.
3. Let the AI read the change's context files, then work `tasks.md` group-by-group
   (client → hooks/lib → server → tests → docs → validate).
4. Removal grep-first: `grep -n "readme\|Readme\|README\|/api/readme\|buildReadmeUrl\|useReadmeFetch"`
   across each touched file before editing, so no dangling reference survives.
5. Run the touched test suites in isolation, not the whole repo:
   `cd packages/client && HOME=$(mktemp -d) npx vitest run <the 3 touched specs>` —
   ignore pre-existing unrelated failures.
6. Type-check the touched packages (`npx tsc -p packages/client/tsconfig.json --noEmit`),
   then `npm run build` to confirm the client compiles.
7. Delegate the `docs/file-index-*.md` row updates to a **general-purpose subagent**
   (caveman style) — main agent never edits `docs/` prose directly.
8. `openspec validate <change> --strict`, then hand the AI the ship checklist as one
   numbered prompt (archive → sync → PR → CI → CodeRabbit → merge → delete branch →
   delete worktree) and let it run the whole tail unattended.

## 3. How the collaboration unfolded

**Phase 1 — Skill resolution (steering needed).** The `/skill:openspec-apply-change`
invocation ran inside `.worktrees/os-remove-project-readme-button`, and the first `find`
for the skill returned nothing. The operator immediately corrected: *"opsx skills
presented in worktree's parent dir."* The AI re-scoped the search to the main repo root,
found the skill, and read `openspec status`/`instructions`. **Why it worked:** the
human pre-empted a long blind search with one factual pointer about worktree topology.

**Phase 2 — Surgical removal (client → hooks/lib → server).** The AI walked `tasks.md`
in order, grepping each file for every readme identifier before editing. It stripped the
`view-readme-btn` button, `readmeDirs` state, `cwdsKey` memo, the `/api/readme?check=1`
probe effect, and now-unused imports from `SessionList.tsx`; removed `ReadmePreviewRoute`,
the overlay member, and 3 render branches from `App.tsx`; deleted `useReadmeFetch.ts`;
dropped `buildReadmeUrl` from `route-builders.ts` and the `readme` depth-2 branch from
`back-target.ts` (keeping `pi-resources`); and removed the `GET /api/readme` route from
`file-routes.ts`. **Why it worked:** grep-before-edit on a shared identifier set is the
correct discipline for a "remove a whole feature chain" task — it catches every call site.

**Phase 3 — Verification.** The AI removed the readme cases from three test suites,
then ran them in isolation (28 whole-repo failures were pre-existing and unrelated;
the 3 touched suites passed, 38 tests). It type-checked the touched packages (remaining
errors were pre-existing `image-fit-extension`/`jimp` issues) and ran `npm run build`
to confirm a clean client compile. **Decision point:** the AI correctly distinguished
*its* failures from the repo's ambient red and did not chase unrelated breakage.

**Phase 4 — Docs + validate.** Row updates to `docs/file-index-client.md` and
`file-index-server.md` were delegated to a general-purpose subagent in caveman style
(the repo's `docs/` write rule). `openspec validate --strict` passed; all 19 tasks
marked complete.

**Phase 5 — Ship (one prompt, whole tail).** The operator handed over an 8-step ship
checklist in a single message. The AI archived + synced the change, committed, opened
**PR #146**, watched CI to green (8m1s), discovered CodeRabbit was **rate-limited**
(no actual review — just a placeholder ✓), *paused to ask how to proceed*, was told to
skip, squash-merged, deleted the remote+local branch, and force-cleaned the worktree
(fixing a `node_modules/.cache/jiti` permission block + `git worktree prune`).

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change remove-project-readme-button`.** Effective
  because the *planning* was already done: an apply-skill invocation on a named change
  gives the AI a `tasks.md` contract to execute, so it needs no re-discovery of scope.
- **High-leverage follow-up — the batched ship checklist:**
  `1. I will test later, mark as complete 2. archive and sync 3. create a PR 4. Monitor
  CI 5. Fix coderabbit issues 6. merge PR 7. delete branch 8. delete worktree`. One
  numbered list unlocked the entire ship tail unattended. **Why it worked:** explicit,
  ordered, and it front-loaded the two judgment calls (defer testing; how to handle
  review) so the AI didn't have to stop and ask on each.
- **Correction that saved minutes — "opsx skills presented in worktree's parent dir."**
  A five-word topology fact that ended a failing search.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Search for the OpenSpec skill inside the worktree checkout and find nothing | "opsx skills presented in worktree's parent dir" | State up front: *resolve OpenSpec skills from the main repo root, not the `.worktrees/<name>` checkout* (this is already an AGENTS.md convention — cite it) |
| Wait for direction on testing + the full ship sequence | Hand over one explicit 8-step checklist, deferring tests ("I will test later, mark as complete") | Give the ship checklist in the *same* message as the apply kickoff when you already know you'll merge |
| Stop and ask when CodeRabbit produced no real review (rate-limited placeholder ✓) | "Skip CodeRabbit, merge" | Decide the review policy in advance: *if CodeRabbit is rate-limited, treat the check as non-blocking and merge* |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this session **consumed** existing assets rather
than producing them:

- **`openspec-apply-change` skill** — drove the whole execution from a pre-written
  `tasks.md`. Invoke it whenever a change has been planned and only needs building.
- **general-purpose subagent for `docs/` rows** — isolates the caveman-style
  `file-index-*.md` update so the main agent never edits `docs/` prose directly.
  Invoke it on any file-index/doc-row update the apply loop reaches.

Recommendation: the ship tail here is a repeatable procedure (archive → sync → PR →
CI-watch → CodeRabbit-or-skip → squash-merge → delete branch → force-clean worktree).
That is exactly what the repo's **`ship-change`/`ship-it`** skills already encode — for
a future run, invoke those instead of hand-listing the 8 steps.

## 7. Pitfalls & dead ends

- **Skill not found in a worktree.** `find` inside `.worktrees/<name>` misses the
  OpenSpec skill — it lives at the main repo root. Re-scope the search there (or resolve
  from the parent) instead of a full-disk `find /`.
- **Whole-repo `npm test` is noisy.** 28 failures were pre-existing and unrelated to the
  change. Run only the touched suites (`npx vitest run <specs>`) and grep the log for your
  own identifiers before concluding anything is broken.
- **Vitest home/config interference.** The touched suites needed `HOME=$(mktemp -d) npx
  vitest run …` from inside `packages/client` to run clean.
- **CodeRabbit "✓" can be a placeholder.** A green CodeRabbit check does **not** guarantee
  a review happened — it may be rate-limited ("Review limit reached… prepaid credits").
  Fetch the actual review comments/reviews via `gh api …/pulls/<n>/reviews` before
  claiming a clean review; treat rate-limit as non-blocking, not as a pass.
- **Worktree won't delete.** `node_modules/.cache/jiti` had restrictive perms that blocked
  `rm -rf`. Fix with `chmod -R u+rwx .worktrees/<name>` then `rm -rf` + `git worktree prune`.
- **`gh pr view` right after merge can error** on the local post-merge cleanup path even
  though the merge succeeded — re-query the PR state to confirm before assuming failure.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- A planned OpenSpec change with a complete `tasks.md` (`openspec/changes/<name>/`).
- A worktree checked out for the change; `gh` authenticated; merge + review policy decided.

**Steps:**
- [ ] `/skill:openspec-apply-change <change-name>` (resolve the skill from the *main repo
      root*, not the worktree checkout).
- [ ] Work `tasks.md` in order; grep each file for the full identifier set before editing.
- [ ] Run only the touched test suites in isolation
      (`cd packages/client && HOME=$(mktemp -d) npx vitest run <specs>`); ignore pre-existing red.
- [ ] Type-check touched packages + `npm run build`.
- [ ] Delegate `docs/file-index-*.md` rows to a general-purpose subagent (caveman style).
- [ ] `openspec validate <change> --strict`.
- [ ] Ship via the **`ship-change`/`ship-it`** skill (or a single numbered checklist):
      archive → sync → PR → watch CI → CodeRabbit-or-skip → squash-merge → delete branch →
      force-clean worktree (`chmod -R u+rwx` + `rm -rf` + `git worktree prune`).

**Artifacts produced:** PR #146 (merged, squash) removing `SessionList.tsx` /`App.tsx` /
`useContentViews.ts` /`route-builders.ts` /`back-target.ts` /`file-routes.ts` readme code,
deleted `useReadmeFetch.ts`, pruned test cases in 3 suites, updated `file-index-*.md` docs,
archived change `2026-06-21-remove-project-readme-button`.

---

_Generated from session `019eec11` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-21. Source extract: deterministic facts sheet._
