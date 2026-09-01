---
session: 019f8769
week: 2026/W30
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-markdown-preview-relative-images]
proposal_excerpt: "Opening a `.md` file in the dashboard preview shows a native broken-image glyph for any embedded local image (`![alt](hero-landing.png)`). The image file sits on disk next to the document, but `MarkdownPreview` hands…"
---

# How we did it: Ship the markdown-preview relative-image fix — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a deceptively small prompt: **"rebase to develop."** One turn
later they attached the **`ship-it`** skill, which reframed the *real* objective:
take the already-planned OpenSpec change `fix-markdown-preview-relative-images` from
its worktree through the **full implementation-and-ship pipeline** — apply the tasks,
write the code + tests, merge develop, run the verify gate, archive, commit, push,
open a PR, watch CI, fold CodeRabbit feedback, and squash-merge with cleanup.

The underlying bug: the dashboard's markdown preview rendered a broken-image glyph
for any local image reference (`![alt](hero-landing.png)`) because `MarkdownPreview`
passed the raw relative `src` straight to the browser instead of resolving it against
the document's on-disk directory and routing it through the file API.

## 2. TL;DR playbook

1. **Confirm the base is current** — `git fetch origin develop && git rebase origin/develop`
   (here it was already up to date; don't invent a rebase that isn't needed).
2. **Invoke `ship-it`** to drive the worktree implementation phase; let it orient with
   `openspec status --change <name> --json` and read design + test-plan.
3. **Do the filesystem reality check** — verify which helper/test files actually exist
   before trusting tasks.md checkboxes. Missing files ⇒ full implementation needed.
4. **Write the pure helper first** (`resolve-local-image-src.ts`, browser-safe, no
   `node:path`) + its unit test, then wire the React context + call-sites.
5. **Run the *scoped* vitest suite with an ephemeral HOME**
   (`HOME=$(mktemp -d) npx vitest run <paths>`) — not the whole repo.
6. **Gate on `tsc --noEmit` + Biome `--error-on-warnings` on NEW files only**; treat
   pre-existing warnings in touched files as out-of-scope (surgical-changes rule).
7. **Drive `ship-change` inline**: archive → commit with `git commit -F` (avoid
   backtick substitution) → push → `gh pr create` against develop.
8. **Watch CI** (`gh pr checks <n> --watch`); classify any red as *mine* vs
   *environmental* by checking file overlap with `git diff --name-only`.
9. **Evaluate CodeRabbit findings as untrusted reports** — apply the safe/valid ones,
   defer scope-creeping refactors, reject false positives (archived-artifact noise).
10. **Squash-merge + delete branch + remove worktree**; expect the shell to die when
    the worktree it runs in is removed — that's the successful final step.

## 3. How the collaboration unfolded

**Phase 1 — Orient (rebase + status).** The AI ran `git status`/`rebase` and found the
branch already based on `origin/develop` — it correctly reported "no rebase needed"
instead of forcing one. When `ship-it` arrived it read `openspec status`, the design,
and the test-plan. *Why it worked:* it did not trust the tasks.md checkboxes; it ran a
**filesystem reality check** and discovered the helper + test files didn't exist yet,
so "all tasks unchecked" meant real implementation, not a resume.

**Phase 2 — Discovery of call-sites.** Before writing code it grepped for `absOf`,
read `FilePreviewOverlay`, `MarkdownViewer`, `MarkdownPreview`, and verified that the
hooks `MarkdownContent` needs **degrade gracefully without providers** — the pre-condition
for a standalone RTL test. *Decision point:* the existing `MarkdownViewer` test *mocks*
`MarkdownContent`, so the AI chose to add a **dedicated call-site test rendering the real
component** for faithful end-to-end `img src` assertions.

**Phase 3 — Implement.** Order mattered: (1) the pure `resolveLocalImageSrc` helper +
`dirname` (scheme/`//`/`#` guard, `.`/`..` collapse, POSIX-absolute verbatim), then
(2) `MarkdownContent`'s opt-in `imageBase` prop via a memoized `ImageBaseContext`, with
`PiAssetImg` rewriting local srcs *after* the `pi-asset:` branch and an `onError`
placeholder, then (3) the three call-sites each passing `{cwd, dir: absOf(cwd, dirname(path))}`.
`MarkdownPreviewView` was deliberately left out of scope per task 4.12.

**Phase 4 — Verify.** Scoped vitest (with `HOME=$(mktemp -d)`) went green; `tsc --noEmit`
surfaced only one **pre-existing unrelated** error (`faux-renderers.integration`); Biome
flagged only import-sort on the new file (autofixed). AGENTS.md rows + sidecars updated.

**Phase 5 — Ship.** `ship-change` ran inline: archive+sync, `git commit -F`, push,
`gh pr create` (#385). The full-repo suite showed **21 failures** — the AI classified
every one as environmental (jimp native, missing `tsc` bin, timing flakes) with **zero
overlap** with the change's files, and let CI be the authoritative clean-env gate.

**Phase 6 — CI + review loop.** CI round 1 passed. CodeRabbit posted 4 comments that
failed to inline-post (buried in the review body). The AI evaluated each against the
code, applied #1 (reset `failed` on `src` change) and #2 (add a Windows drive-letter
test), deferred the refactor nitpick, and rejected the archived-artifact false positives.
A later CI red was a `@tanstack/react-virtual` post-teardown timer flake — rerun went
green. PR **#385 squash-merged** (`5fdcc9fda`); worktree removed as the final step.

## 4. Prompts that worked

- **The goal prompt — "rebase to develop"** was *too thin on its own*; it only became
  actionable when paired with the `ship-it` skill attachment. A stronger kickoff:
  **"Rebase to develop, then run ship-it on `fix-markdown-preview-relative-images`."**
- **Attaching the skill as the second turn** was the real high-leverage move — it handed
  the AI the entire pipeline contract (apply → merge → test → ship) instead of leaving it
  to improvise the sequence.
- The session ran on **one goal + one steering turn**; the rest was the AI executing a
  well-scoped skill autonomously. That is the sign of a good pre-planned OpenSpec change.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat "rebase" as the whole task | attaching the `ship-it` skill to reveal the real ship pipeline | naming the skill in the goal prompt up front |
| Risk trusting tasks.md checkboxes | (skill enforced) a **filesystem reality check** before implementing | always verify file existence, not checkbox state |
| Want to run the whole vitest repo | scope to the changed files + `HOME=$(mktemp -d)` | keep a scoped-suite command ready |
| Blur pre-existing vs introduced failures | classify red by `git diff --name-only` overlap | check file overlap before blaming your change |
| Take CodeRabbit text at face value | evaluate each finding against real code as an *untrusted report* | apply-safe / defer-scope / reject-false-positive triage |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created; this session was a **clean execution of the
existing `ship-it` skill** (which composes `openspec-apply-change`, the docker harness,
and `ship-change`). That is itself the lesson: when a change is well-planned, the ship
phase should be a near-autonomous skill run.

- **`ship-it`** — captures the entire worktree implementation-and-land contract; invoke
  it whenever a planned OpenSpec change is ready to build inside its worktree.
- **Reusable pattern worth remembering:** the *filesystem-reality-check over checkbox-state*
  discipline and the *environmental-vs-mine failure classification via `git diff` overlap*
  are the two moves that keep a headless ship honest. If they aren't already codified in
  `ship-it`, they are strong candidates for a guardrail note there.

## 7. Pitfalls & dead ends

- **`git commit -m` with backticks in the message** substitutes shell commands — the AI
  used `git commit -F /tmp/commit-msg.txt` to avoid it. Do the same for any message
  containing `` `code` ``.
- **Full-repo vitest is noisy in a dev env**: `Jimp is not a constructor` (×17), missing
  `tsc` bin, `node_modules`-in-listing, and timing flakes are all environmental. Don't
  block the ship on them — verify file-overlap and defer to clean-env CI.
- **`biome --changed` compares against committed diff** and detected 0 uncommitted files;
  the real correctness gate is `tsc --noEmit` + Biome on the *new* files.
- **CI flake:** a `@tanstack/react-virtual` `Timeout._onTimeout` firing after test teardown
  can fail an otherwise-green run — rerun the failed job rather than chasing it.
- **The worktree removes itself:** `git worktree remove` deletes the directory your shell
  is in, so the Bash tool "dies" on the final step. That is expected success, not an error.
- **Post-merge local `develop` checkout fails inside a worktree** (branch already checked
  out in the parent) — the remote squash-merge still succeeds; verify with `gh pr view`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a planned OpenSpec change in its own worktree, `gh` authed,
CodeRabbit enabled on the repo, the `ship-it` skill available.

1. `git fetch origin develop && git rebase origin/develop` (skip if already current).
2. Invoke `ship-it`; let it read `openspec status --json` + design + test-plan.
3. Filesystem reality check — confirm helper/test files exist before trusting checkboxes.
4. Implement pure helper + test first, then context + call-sites (leave out-of-scope hosts).
5. `HOME=$(mktemp -d) npx vitest run <scoped paths>` → green.
6. `tsc --noEmit` + Biome `--error-on-warnings` on new files only.
7. Archive → `git commit -F` → push → `gh pr create` against develop.
8. `gh pr checks <n> --watch`; classify red by `git diff --name-only` overlap.
9. Triage CodeRabbit: apply safe/valid, defer scope-creep, reject false positives; re-push.
10. Squash-merge + delete branch + `git worktree remove` (expect the shell to end).

**Final artifacts produced:**
- `packages/client/src/components/preview/resolve-local-image-src.ts` (+ tests)
- `packages/client/src/components/__tests__/image-base-callsites.test.tsx`
- edits to `MarkdownContent.tsx`, `MarkdownPreview.tsx`, `MarkdownViewer.tsx`, `FilePreviewOverlay.tsx`
- PR **#385**, squash-merged to `develop` (`5fdcc9fda`).

---

_Generated from session `019f8769-569f-7fcf-b39c-ade0af8b2ede` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-22. Source extract: session facts sheet._
