---
session: 019f186b
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-file-preview-backdrop-blocks-composer]
proposal_excerpt: "The E2E spec `tests/e2e/file-preview-survives-churn.spec.ts` fails deterministically: when the file-preview overlay is open, its full-viewport backdrop intercepts pointer events on the composer send button, so the…"
---

# How we did it: Fix the file-preview backdrop that blocks the composer — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The literal first prompt was `rebase to develop` — but the real objective was to
**apply and ship an existing OpenSpec change**, `fix-file-preview-backdrop-blocks-composer`.
The bug: when the file-preview overlay is open, its full-viewport dim backdrop sits
above the composer and intercepts pointer events, so the E2E spec
`tests/e2e/file-preview-survives-churn.spec.ts` deterministically times out clicking
the **send** button. The desired end state: the preview overlay behaves as a
*non-blocking inspector* — it still dims the message area and dismisses on backdrop
click, but the composer stays fully interactive so a user can keep sending prompts
while a preview is open. Then verify (unit + Docker E2E) and land the change via a PR
to `develop`.

## 2. TL;DR playbook

1. **Rebase the worktree first.** Stash any unrelated dirty files, `git rebase origin/develop`, then `git stash pop`. A stale worktree causes phantom import failures later — do this at the *start*, not after tests break.
2. **Run `/skill:openspec-apply-change fix-file-preview-backdrop-blocks-composer`.** Let the skill read `proposal.md`, `design.md`, and `tasks.md` before touching code.
3. **Read the layout before choosing a fix.** Grep where `CommandInput` mounts — it lives in `App.tsx`, *outside* the `FilePreviewProvider`. That single fact rules out "elevate the composer" (stacking-context-fragile) and forces the backdrop-side fix.
4. **Neutralize the backdrop, don't elevate the composer.** Split the overlay into a `pointer-events-none` outer wrapper + a dim/dismiss layer that covers only the message area, stopping at a `ResizeObserver`-measured composer height (a cutout the composer pokes through). Keep dismissal keyed on the backdrop `data-testid` so the churn invariant stays green.
5. **Write RTL tests first, run with an ephemeral HOME.** `HOME=$(mktemp -d) npx vitest run <overlay+composer tests>`. Prove the composer stays hittable and dim-click still dismisses.
6. **Typecheck + Biome on changed files only.** Confirm every new diagnostic is pre-existing; don't refactor adjacent code.
7. **When Docker is up, run the seeded E2E harness.** The file-preview spec needs `PI_E2E_SEED=1`; pre-build the container manually (first build exceeds the 180 s health wait) and attach with `PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome`.
8. **Ship via `/skill:ship-change`.** Mark deferred-to-CI QA tasks done, run the gate, archive + sync specs, commit (excluding unrelated edits), open the PR, watch CI, address CodeRabbit, squash-merge, clean up the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Rebase & orient.** The AI noticed an unrelated uncommitted edit to
`manage-flows/SKILL.md`, stashed it, rebased onto `origin/develop`, and restored it
cleanly. It then loaded the apply skill and read `design.md` + the E2E spec + helpers.
*Why it worked:* isolating unrelated work before the rebase kept the change surgical.

**Phase 2 — Choose the fix (the pivotal decision).** The proposal offered options; the
AI initially tried an aggressive "any outside click closes" dismissal, which broke the
churn test. It backed out, grepped the composer's ancestor chain, and discovered
`CommandInput` sits in `App.tsx` outside the provider — so composer-elevation was
fragile. **Decision point:** it committed to *Option A (non-blocking inspector)* via a
backdrop cutout instead. This is the reusable insight: fix the layer you *own* (the
backdrop), not the layer with a fragile stacking context.

**Phase 3 — Implement + unit-verify.** `FilePreviewOverlay.tsx` became a click-through
outer wrapper plus a message-area-only dim layer bounded by a `ResizeObserver`-measured
composer height; `CommandInput` got a `data-testid="composer-root"`; two RTL specs
proved the composer stays interactive and dim-click still dismisses. 34 unit tests
green. Typecheck/Biome noise was all pre-existing.

**Phase 4 — E2E under Docker (steering: "docker is running").** The AI hit three walls
in sequence and cleared each: (1) bundled Chromium download timed out on every CDN →
fell back to `PW_CHANNEL=chrome` (system Chrome, same Blink engine); (2) container
health-wait timed out on first build → pre-built manually and attached with
`PW_E2E_USE_RUNNING=1`; (3) the spec's onboarding CTA was disabled → root-caused to a
missing `PI_E2E_SEED=1`, restarted the harness with the seed. The target spec then
passed green on system Chrome.

**Phase 5 — Ship (steering: "Use ship-change skill").** The verify gate surfaced 42
client test files failing on a phantom `route-descriptor.js` import. Root cause: the
branch was **22 commits behind** develop and a cross-worktree symlink resolved
`dashboard-plugin-runtime`→parent (had the import) while shared→worktree (missing the
file). A second rebase fixed it (and pulled develop's Jimp fix). Gate green, archived +
synced the delta spec via a subagent, committed (excluding `manage-flows`), opened
PR #213, watched CI green, applied CodeRabbit's one test-strengthening nitpick,
re-pushed, squash-merged, and removed the worktree.

## 4. Prompts that worked

- **The goal prompt (`rebase to develop`)** — terse, but it correctly front-loaded the
  rebase. A stronger kickoff would name the whole intent: *"Rebase this worktree onto
  develop, then apply and ship the OpenSpec change fix-file-preview-backdrop-blocks-composer."*
- **`/skill:openspec-apply-change fix-file-preview-backdrop-blocks-composer`** — high
  leverage: it handed the AI the proposal/design/tasks context so it chose Option A
  deliberately instead of guessing.
- **`docker is running`** (3 words) — unblocked the entire E2E phase. A single-fact
  environment signal let the AI switch from "E2E blocked" to running the harness.
- **`Use ship-change skill`** — delegated the whole land-it pipeline (gate → archive →
  PR → CI → CodeRabbit → merge → cleanup) to a known procedure.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Start editing before rebasing | `rebase to develop` as the very first prompt | Always rebase the worktree onto develop *before* apply — stale branches cause phantom import failures |
| Reach for "any outside click closes" dismissal (broke churn test) | (self-corrected after test failure) | Read where the composer mounts *first*; keep dismissal keyed on the backdrop `data-testid` to preserve the churn invariant |
| Assume E2E was permanently blocked | `docker is running` | Give the environment signal early; know that `PW_CHANNEL=chrome` sidesteps the bundled-Chromium CDN |
| Trust the verify gate at face value | `Use ship-change skill` (which forced a re-gate) | Re-rebase before shipping; whole-file (not assertion) test failures usually mean a stale worktree, not real breakage |

Additional quality bars the human's skills imposed: exclude unrelated edits
(`manage-flows/SKILL.md`) from the commit; treat QA/E2E tasks deferred to CI as done in
the ship gate; confirm CodeRabbit actually reviewed (not a rate-limited ACK).

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the work was fully carried by
existing procedures: `openspec-apply-change`, `openspec-archive-change`,
`openspec-sync-specs` (run via a `general-purpose` subagent for the delta-spec sync),
and `ship-change`. A single subagent isolated the spec sync so the main context stayed
focused on the code change.

**Recommended skill to create:** *"debug-stale-worktree-import-failures"* — capturing
the signature (whole test *files* failing on a phantom import that exists nowhere in
current source) and the fix (rebase onto latest develop; cross-worktree symlinks resolve
runtime→parent vs shared→worktree and drift when the branch falls behind). This recurred
mid-session and cost real time; it is clearly reproducible.

## 7. Pitfalls & dead ends

- **Aggressive dismissal broke the churn test.** "Any outside click closes" changes the
  modal semantics — revert to backdrop-`data-testid`-only dismissal.
- **Bundled Chromium download times out on every CDN** (`cdn.playwright.dev` + both MS
  mirrors → `http=000`). Don't fight it; use `PW_CHANNEL=chrome` (system Chrome shares
  the Blink engine) and run the bundled leg in CI.
- **Docker health-wait times out on first build** (build exceeds the 180 s cap). Pre-build
  the container manually, then attach with `PW_E2E_USE_RUNNING=1`.
- **File-preview spec's onboarding CTA is disabled** without `PI_E2E_SEED=1`. Start the
  harness with the seed set.
- **Phantom `route-descriptor.js` import fails 42 test files.** Not a stale vite cache —
  the branch was 22 commits behind develop. Rebase again.
- **Archived `tasks.md` checkboxes shipped unchecked.** `git mv` staged the original file
  content while the `[x]` edits stayed unstaged. Re-`git add` planning docs after editing
  before committing.
- **`gh pr merge` worktree collision.** Merge succeeds remotely but `gh` fails switching
  the local checkout to `develop` (already used by the parent worktree) — the error is
  cosmetic; verify against `origin/develop`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a worktree for the change, Docker running, system Chrome
installed, `gh` authenticated, the OpenSpec change already proposed with `design.md`.

- [ ] Stash unrelated edits → `git rebase origin/develop` → `git stash pop`.
- [ ] `/skill:openspec-apply-change fix-file-preview-backdrop-blocks-composer`; read proposal/design/tasks.
- [ ] Grep where `CommandInput` mounts → confirm it's outside the provider → choose the backdrop-cutout fix.
- [ ] Edit `FilePreviewOverlay.tsx` (click-through wrapper + measured-height dim layer + cutout) and tag `CommandInput` with `data-testid="composer-root"`.
- [ ] Add RTL specs; `HOME=$(mktemp -d) npx vitest run` the overlay + composer tests.
- [ ] Typecheck + Biome on changed files; confirm no *new* diagnostics.
- [ ] Docker E2E: pre-build container, `PI_E2E_SEED=1`, attach `PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome`, run the target spec.
- [ ] `/skill:ship-change`: re-rebase, gate, archive + sync specs, commit (exclude unrelated edits), PR to develop, watch CI, address CodeRabbit, squash-merge, remove worktree.

**Final artifacts produced:**
- `packages/client/src/components/FilePreviewOverlay.tsx`
- `packages/client/src/components/CommandInput.tsx`
- `packages/client/src/components/__tests__/FilePreviewOverlay.test.tsx`
- `openspec/changes/fix-file-preview-backdrop-blocks-composer/tasks.md` (archived)
- PR #213 → squash-merged to `develop` (`7b9748fda`)

---

_Generated from session `019f186b-7588-7f00-ab75-e94d81cdeb06` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-24. Source extract: deterministic facts sheet._
