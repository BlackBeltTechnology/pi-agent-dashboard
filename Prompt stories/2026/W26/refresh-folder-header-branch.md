---
session: 019f0a57
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [refresh-folder-header-branch]
proposal_excerpt: "The sidebar folder-header branch label (`GroupGitInfo` in `SessionCard.tsx`) never refreshes when a folder's git HEAD changes outside the dashboard (e.g. `git checkout develop` in a terminal). Two independent defects…"
---

# How we did it: self-refreshing folder-header git branch — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a single slash command: `/skill:openspec-apply-change refresh-folder-header-branch`. There was no prose brief — the entire specification lived in the pre-authored OpenSpec change. The *real* objective, once the change was read: fix two independent defects in the sidebar folder-header branch label (`GroupGitInfo`). First, the label never refreshed when a folder's git HEAD moved outside the dashboard (e.g. a terminal `git checkout develop`). Second, a worktree child's branch could leak into the parent folder header and stick there indefinitely. The fix had to be a server-pushed, self-refreshing folder HEAD value, delivered end-to-end (shared protocol → server poll/watcher → client render) with tests, then shipped as a merged PR against `develop`.

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change-name>` — let the apply skill read the change's context files before touching code.
2. Read the whole vertical slice first (shared protocol, server poll/watcher, client `useMessageHandler` → `App` → `SessionList` → `GroupGitInfo`) so every edit lands with full context.
3. Implement bottom-up: shared message type → server module + unit test → wire into directory-service → client setter/handler → render precedence, ticking off `tasks.md` as you go.
4. Model new infra on the closest existing sibling (the folder-head watcher was built "byte-for-byte" on `openspec-change-watcher.ts`).
5. Run tests with the **parent repo's** vitest binary and the worktree as cwd — the worktree's `node_modules` is empty (`node …/node_modules/vitest/vitest.mjs run` with `HOME=$(mktemp -d)`).
6. When a cross-package type error appears, confirm whether it's the parent-symlink false positive (tsc resolves to the un-edited parent `packages/shared`) before "fixing" it.
7. Mark all `tasks.md` boxes, `openspec validate --strict`, run the advisory CodeRabbit gate.
8. Steer into `ship-change`: build → verify suites → archive + sync specs → commit (`-F` file) → PR → watch CI → wait out CodeRabbit rate-limit → squash-merge → remove worktree.

## 3. How the collaboration unfolded

**Discovery.** The AI resolved the change, then spent ~10 grep/read calls mapping the full data path across `shared`, `server`, and `client` before writing a line. It explicitly narrated "Now I have full context" as the gate to start — a deliberate read-before-write posture that paid off in near-zero rework.

**Implementation (server).** Built the shared `git_head_update { cwd, branch }` message, then `folder-head-poll.ts` (resolved group keys incl. `gitWorktree.mainPath`, per-cwd `readHead`, diff-cache, broadcast-on-change) and `folder-head-watcher.ts` (per-folder `fs.watch` on the gitdir, filtered to `HEAD`). The watcher was modeled directly on the existing openspec watcher — copying a known-good pattern rather than inventing one.

**Implementation (client).** Added the setter/handler in `useMessageHandler`, threaded state through `App` → `SessionList` → `GroupGitInfo`, and changed only branch resolution precedence.

**Verify + Ship.** Full suite green (6423 passed). All 20 tasks ticked, `openspec validate --strict` clean, CodeRabbit advisory run returned 0 real findings. The user's one steering turn — "use ship-change skill" — drove the whole landing sequence: build, verify, archive/sync specs, commit, PR #179, CI green (8m3s), and squash-merge.

**Decision points.** The human chose (a) to let the apply skill run unattended through all 20 tasks, and (b) to switch to `ship-change` rather than hand-rolling the merge — both were single, high-trust delegations.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change refresh-folder-header-branch`.** Effective *because the specification was already externalized*. When the brief lives in a validated OpenSpec change, a one-line apply invocation is the strongest possible kickoff — the AI reads context files instead of guessing scope. The lesson: front-load the spec, keep the prompt thin.
- **High-leverage follow-up — "use ship-change skill".** Four words that unlocked the entire ~40-minute landing pipeline (build → verify → archive → commit → PR → CI → CodeRabbit → merge → cleanup). Naming the skill instead of describing the steps is the reproducible move.

There were no weak prompts to rewrite — the session ran on two crisp, delegation-style prompts.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| finish apply and stop at "implementation complete" | "use ship-change skill" | chain apply → ship-change explicitly, or set the expectation that a completed change gets landed |
| over-reach an edit — nulled `branchUrl`/`prNumber` in `GroupGitInfo`, which would strip PR badges from *every* folder | (self-caught, no human turn needed) | scope render-precedence edits to the single field that changed; re-read the blast radius before touching shared render state |

Most "corrections" in this session were *self-corrections* the model caught mid-flight (the branchUrl over-reach, the stray-key edit retry, the dead `onFolderHeadCallback`). The single human steering turn was purely additive scope ("now ship it"), not a redirect — a sign the pre-authored spec removed most ambiguity up front.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created. The session was a clean composition of existing ones:

- **`openspec-apply-change`** — read the change, drove 20 tasks with running checkbox state. Invoke it whenever a validated change exists and you want spec-driven implementation.
- **`ship-change`** — the landing pipeline (verify → archive → commit → PR → CI watch → CodeRabbit → squash-merge → worktree cleanup). Invoke it the moment apply reports complete.
- **A one-off subagent** (`general-purpose`) added file-index rows for the new folder-head files — the Documentation Update Protocol delegation, caveman style.

Recommendation: no skill needs creating; the effective pattern here is *chaining* apply → ship-change, which is already what both skills document.

## 7. Pitfalls & dead ends

- **Empty worktree `node_modules`.** `npm test` / `npx vitest` fail — the worktree has no local `.bin`. Fix: `HOME=$(mktemp -d) node /…/pi-agent-dashboard/node_modules/vitest/vitest.mjs run <specs>` with the worktree as cwd. (6 of the 86 commands failed chasing this before landing on the parent-binary invocation.)
- **Cross-package tsc false positives.** The parent `node_modules` symlinks `@blackbelt/shared` → the parent repo's `packages/shared`, so `tsc --noEmit` reports "no exported member" against the *un-edited* parent copy even though vitest (worktree src) passes. Confirm the symlink target before editing to "fix" a phantom type error.
- **macOS `fs.watch` filename reporting is unreliable**, and `vi.spyOn(fs,"watch")` can't redefine the export. Fix: extract a pure `HEAD`-filter helper and unit-test *that* deterministically instead of the raw watch event.
- **CodeRabbit's first "pass" was a rate-limit ACK, not a review.** The limit reset in ~11 min. Wait out the window, then `@coderabbitai full review`. Treating the ACK as a green light would have merged without a real review.
- **Worktree branch-collision on merge.** `develop` was checked out in the parent, so the local squash-merge checkout failed even though the *server-side* PR merge succeeded. Verify merge state via `gh` before assuming failure; force-delete the local branch (squash commits aren't ancestors) and `git worktree remove`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a validated OpenSpec change (`openspec validate --strict` clean), the parent repo checked out with a populated root `node_modules`, `gh` authenticated, CodeRabbit enabled on the repo.

1. `/skill:openspec-apply-change <change-name>`
2. Let it read context; implement bottom-up (shared → server+test → wire → client → render), ticking `tasks.md`.
3. Test via parent vitest binary: `HOME=$(mktemp -d) node <parent>/node_modules/vitest/vitest.mjs run <specs>`, worktree as cwd.
4. Ignore parent-symlink tsc phantoms; fix only in-package type errors.
5. `openspec validate <change> --strict`; run advisory CodeRabbit gate.
6. Prompt: **"use ship-change skill"** → build, verify, archive/sync, commit `-F`, PR, watch CI, wait out CodeRabbit rate-limit, squash-merge, `git worktree remove`.

**Final artifacts:** PR #179 (merged, squash `27599d7`) against `develop`; new `packages/server/src/folder-head-poll.ts` + `folder-head-watcher.ts` (+ tests); `git_head_update` in `browser-protocol.ts`; archived change at `openspec/changes/archive/2026-06-27-refresh-folder-header-branch/`; new spec `openspec/specs/folder-head-refresh/spec.md`.

---

_Generated from session `019f0a57-5222-7c1c-8066-8be32aef8a16` · `pi-agent-dashboard` · 2026-06-27. Source extract: `/tmp/facts-1784849409N.md`._
