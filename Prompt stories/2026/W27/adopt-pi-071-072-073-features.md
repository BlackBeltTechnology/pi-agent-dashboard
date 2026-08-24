---
session: 019f1599
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "yes — heavy steering (10 user prompts); large facts sheet (~16840 tok)"
upgrade_status: pending
openspec_changes: [fix-file-preview-backdrop-blocks-composer, adopt-pi-071-072-073-features]
proposal_excerpt: "The E2E spec `tests/e2e/file-preview-survives-churn.spec.ts` fails deterministically: when the file-preview overlay is open, its full-viewport backdrop intercepts pointer events on the composer **send button**, so the…"
---

# How we did it: Adopt pi 0.71/0.72/0.73 features end-to-end — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single slash command:

```
/skill:openspec-apply-change adopt-pi-071-072-073-features
```

The real objective, once the later steering turns clarified it, was: **implement all
73 tasks of the `adopt-pi-071-072-073-features` OpenSpec change** (a three-phase
catch-up to pi 0.71/0.72/0.73 across shared/server/extension/client), **verify it
with real tests** — including a new Playwright system-browser path the user asked
for mid-flight — then **archive the change** (superseded by a new proposal) and
**ship it through the full `ship-change` pipeline** to a squash-merge on `develop`.
It ran ~4h45m, 44 code files, 220 bash calls, on Opus at medium thinking.

## 2. TL;DR playbook

1. **Start from the change, not the code.** `/skill:openspec-apply-change <name>` →
   read `proposal.md` + `tasks.md` first; work the tasks in phase order (A→B→C→V→D→R).
2. **Per task: read → edit → test → check the box.** For each task read the target +
   a sibling for convention, make the surgical edit, write/adjust the test, run just
   that test, then `sed -i '' 's/- \[ \] X\.N\./- [x] X.N./'` the checkbox.
3. **Run client (jsdom) tests via the parent repo's vitest**, not a worktree-local
   binary — worktrees don't always have `node_modules/.bin/vitest`. Wrap runs in
   `HOME=$(mktemp -d) NODE_OPTIONS="--localstorage-file=$(mktemp)"`.
4. **On a full-suite run, triage failures by kind before reacting** — separate real
   assertion failures (yours) from environmental timeouts / `Jimp is not a
   constructor` / jsdom `canvas` flakes (pre-existing). Confirm the environmental
   ones pass in isolation or on `develop`.
5. **When a test fails you didn't cause, prove it's pre-existing** — read the source
   layering, run the same spec on the parent `develop` branch, don't assume.
6. **For a new bug found in flight, open a tracked OpenSpec `fix-*` change** (proposal
   + spec delta + tasks), don't silently patch.
7. **Delegate every `docs/` write to a subagent** in caveman style; the main agent
   edits source-tree rows directly.
8. **Ship via `ship-change`:** mark manual QA tasks, verify gate (`npm test` +
   `build`), commit → push → PR → watch CI → wait for the *real* CodeRabbit review
   (not the rate-limit ACK) → apply safe fixes / defer spec-contradicting ones →
   loop until CLEAN → squash-merge → delete branch → remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Apply the change (A/B/C, autonomous).** The AI read the proposal (73
tasks), then walked each sub-task with a tight read→edit→test→check-box rhythm:
- **A (pi 0.71):** removed dead OAuth handlers (gemini/antigravity), added a
  `GET /api/provider-auth/handlers` route + shared type, made `ProviderAuthSection`
  render unsupported OAuth rows disabled-with-tooltip; replaced `message_end` text
  handling with a `deriveEffectiveAssistantText` helper across 3 reducer branches;
  wired `thinking_level_select` through the bridge dedup gate.
- **B (pi 0.72):** projected `ModelInfo.supportedThinkingLevels`, filtered the
  `ThinkingLevelSelector` to supported levels; added a graceful **stop-after-turn**
  path (new browser + server→extension protocol messages, handler, gateway dispatch,
  bridge latch, and a CommandInput button+pill).
- **C (pi 0.73):** bash output last-200-lines truncation + a "Show full output"
  affordance backed by a new `useToolFullResult` hook and server route.
- *Why it worked:* reading a sibling file for convention before each edit kept the new
  code idiomatic; running only the touched test kept the loop fast; checkbox discipline
  made progress auditable. The AI also **caught its own premature checkbox** ("I
  prematurely marked A.3… let me revert") — self-correction beat drift.

**Phase 2 — Playwright on the system browser (steering #1–#3).** The user asked
"can we make tests with Playwright using the system browser?" The AI discovered the
suite already existed (`tests/e2e/`, bundled Chromium) and made the browser
`PW_CHANNEL`-gated (`channel: "chrome"/"msedge"`), self-skipped the Chromium download
when a channel is set, and taught `global-setup.ts` to skip the bundled-Chromium
preflight under `PW_CHANNEL`. Running it: **19/20 passed** on system Chrome.

**Phase 3 — Isolate the 1 failure (steering #4 "a").** `file-preview-survives-churn`
failed. The AI *refused to assume* it was the channel: it read the source
(`FilePreviewOverlay` backdrop is `fixed inset-0 z-50`, composer has no z-elevation),
noted bundled Chromium and system Chrome share Blink, and **ran the same spec from the
parent `develop` branch** to prove the failure is byte-identical and pre-existing.
Then it opened a tracked bug note `fix-file-preview-backdrop-blocks-composer`
(proposal + spec delta + tasks) rather than patching silently.

**Phase 4 — Archive (steering #5 "b, archive… because new proposal supersedes").**
`openspec archive` aborted on **pre-existing corruption** in 4 main specs (stray
`## ADDED Requirements` delta headers, missing `## Purpose`). The AI normalized the
headers *while preserving requirement counts* (4/2/7/36 verified), re-grounded the
Purpose sections, backed out a partially-synced requirement, and re-ran until the
archive landed (+9/-2 across 8 capabilities).

**Phase 5 — Ship (steering #6–#9 "use ship-change skill").** Full pipeline: verify
gate (28 env failures triaged as pre-existing), commit → PR #203 → CI green → wait
through **three CodeRabbit rounds**, applying safe fixes and deferring
spec-contradicting ones with documented reasons, repeatedly **re-merging `develop`**
as it advanced (union-conflict resolution on file-index rows + CHANGELOG + specs),
`npm install` for a newly-merged Monaco dep — until CLEAN/MERGEABLE, then
squash-merge (`472c3c72`), delete branch, remove worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change adopt-pi-071-072-073-features`.
  Effective because it binds the whole session to a spec artifact with an explicit,
  checkable task list; the AI never had to guess scope.
- **High-leverage follow-ups:**
  - *"Is it possible to make tests with playwright? Use system browser for execution
    env"* — a capability question that unlocked the whole `PW_CHANNEL` feature.
  - *"a" / "b, archive… because new proposal supersedes"* — one-character/short picks
    that resolved an `ask_user` decision and set the archive direction in one breath.
  - *"use ship-change skill"* (repeated) — named the exact pipeline, so the AI ran a
    known, auditable end-to-end flow instead of improvising a merge.
- **Rewrite of a weak prompt:** the bare `"ok, run tests"` worked here but a stronger
  form is *"run the e2e suite with PW_CHANNEL=chrome and tell me which failures are
  mine vs pre-existing"* — it front-loads the triage expectation.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stay inside vitest only | "make tests with playwright, use system browser" | State the E2E/system-browser expectation in the goal prompt |
| Treat a red test as its own bug | (implicit, via the AI's own discipline) "a" to continue | Always A/B the failing spec against `develop` before claiming ownership |
| Want to patch the preview bug inline | "b, archive… new proposal supersedes" | Open a `fix-*` OpenSpec change for any bug found mid-flight |
| Stop at the red local gate | "use ship-change skill" (×3) + "go on" | Pre-agree that env flakes (Jimp/canvas/timeouts) don't block; CI is the authoritative gate |
| Mark a checkbox early (A.3) | (self-caught) | Only check a box after its test passes green |

Quality bars the user imposed implicitly: **verify with real browsers**, **don't
conflate pre-existing failures with your change**, and **land through the sanctioned
`ship-change` pipeline**, not an ad-hoc merge.

## 6. Skills, tools & memory created — and why they're effective

No new persistent skill/memory was written this session, but the workflow leaned on
several existing ones worth naming:
- **`openspec-apply-change`** — the backbone; turns a spec into a checkbox-driven task
  loop. Invoke it whenever a change has a `tasks.md`.
- **`ship-change`** — the end-to-end land pipeline (verify → PR → CI → CodeRabbit loop
  → squash-merge → worktree cleanup). Invoke by name once implementation is done.
- **4× `general-purpose` (DocScribe) subagents** — one per `docs/file-index-*.md`,
  run in parallel, caveman style. Effective because the main agent is forbidden to
  edit `docs/` directly; parallel delegation kept the doc sync off the critical path.

**Recommended skill to create:** a *"triage-e2e-failure-mine-vs-preexisting"* project
skill capturing the A/B-against-`develop` proof recipe (read source layering → same
Blink engine note → run spec on parent branch) — it recurred and is easy to forget.

## 7. Pitfalls & dead ends

- **Worktree-local vitest missing.** `node_modules/.bin/vitest` wasn't present in the
  worktree for client (jsdom) tests → run via the parent repo's vitest with a
  `--project` filter. Fix: `HOME=$(mktemp -d) NODE_OPTIONS="--localstorage-file=…"`.
- **Bundled Chromium download kept timing out** (`Download failure, code=1`) on this
  network → couldn't run the literal bundled-vs-system A/B; the *source-layering proof*
  stood in for it.
- **`tsc` from the worktree root reported phantom type errors** — the
  `@blackbelt-technology/pi-dashboard-shared` symlink pointed at the *parent* repo's
  shared (without the new types). The Vite build + vitest (worktree alias) were the
  trustworthy signal; don't chase the root-tsc artifact.
- **`openspec archive` aborted on pre-existing main-spec corruption** (stray
  `## ADDED Requirements`, missing `## Purpose`) and even **partially wrote** a spec
  before aborting. Fix: normalize headers preserving requirement counts, restore
  Purpose, back out the partial write, re-run.
- **CodeRabbit's first "pass" is a rate-limit ACK, not a review** ("next review in 5
  minutes"). Trigger a full review and wait ~5–10 min for the real inline comments.
- **`develop` advanced repeatedly during the CI loop** → recurring union conflicts on
  `file-index-*`, `CHANGELOG`, and `bridge-extension` spec (keep *both* annotations),
  plus a new Monaco dep needing `npm install`. Expect to re-merge more than once.
- **`--delete-branch` failed on the local git switch** (worktree collision — `develop`
  checked out in the parent). Delete the remote branch, then remove the worktree with
  `--force -D` from the parent repo.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; a running Docker harness for E2E;
a system Chrome/Edge install; `gh` authenticated; parent repo's vitest available.

- [ ] `/skill:openspec-apply-change <name>` → read `proposal.md` + `tasks.md`.
- [ ] Work tasks in phase order; per task read→edit→test→check the box.
- [ ] Client tests via parent vitest with `HOME=$(mktemp -d)` + `--localstorage-file`.
- [ ] For E2E on the system browser: `PW_CHANNEL=chrome npm run test:e2e`.
- [ ] Any failing spec → A/B against parent `develop` before claiming it's yours.
- [ ] New bug in flight → open a `fix-*` OpenSpec change (proposal + spec delta + tasks).
- [ ] `docs/` writes → delegate to subagents (caveman style); source rows direct.
- [ ] Archive: `openspec archive -y`; fix any pre-existing spec corruption first.
- [ ] `use ship-change skill` → verify gate → PR → CI → real CodeRabbit → loop → squash-merge → cleanup.

**Final artifacts produced:**
- PR #203 → squash commit `472c3c72` on `develop` (change merged & archived).
- `openspec/changes/fix-file-preview-backdrop-blocks-composer/` (tracked bug note).
- `PW_CHANNEL` system-browser path in `playwright.config.ts`, `package.json`,
  `tests/e2e/global-setup.ts`, `tests/e2e/README.md`.

---

_Generated from session `019f1599-8026-78ef-bb53-f528cbca27d6` · `pi-agent-dashboard` · 2026-06-30. Source extract: `/tmp/facts-adopt071.md`._
