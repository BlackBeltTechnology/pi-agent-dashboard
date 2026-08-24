---
session: 019ebda1
week: 2026/W24
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [add-image-fit-recommended-extension]
proposal_excerpt: "@blackbelt-technology/pi-image-fit is a first-party, pure-JS pi extension that ships from this monorepo (packages/image-fit-extension/) and transparently downsizes oversize images before they reach the model — sav…"
---

# How we did it: from a flaky test to a scoped OpenSpec proposal + PR — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a bug report, not a feature request: *"The pi-image-fit
bridge tests failed."* The real objective only crystallized through six steering
turns. The operator started by wanting a **green test suite**, then used the AI's
investigation of the `pi-image-fit` package as a springboard: was it installable? was
it in the recommended-extensions list? were *other* first-party extensions similarly
hidden? Those questions converged on a real gap — `@blackbelt-technology/pi-image-fit`
is the only genuine first-party pi extension in the repo that is published and
installable but **not surfaced** in the dashboard's Recommended Extensions card. The
end deliverable became a **scoped OpenSpec proposal** to add it to the manifest,
**bundled with the flaky-test fix**, shipped as a single branch + PR (#102).

## 2. TL;DR playbook

1. **Reproduce the failure first, don't guess.** `npx vitest run 2>&1 | tee /tmp/imgfit-test.log | tail -60` — read the actual failure, not the summary.
2. **Diagnose root cause before touching logic.** The test wasn't broken; the resize *succeeded* (`4032×3024 → 1568×1176` printed) but clocked 5328ms against vitest's default 5000ms timeout. It's a slow-machine flake, not a logic bug.
3. **Apply the surgical fix.** Add `testTimeout: 30000` to `packages/image-fit-extension/vitest.config.ts`. Re-run: 72/72 pass. Zero test logic changed.
4. **Follow the curiosity thread.** Ask the AI to place the fixed package in context: is it installable? is it recommended? what *else* is a first-party extension that isn't surfaced?
5. **Ground every "is X true" claim in the source of truth.** For recommended extensions that's `packages/shared/src/recommended-extensions.ts` (`RECOMMENDED_EXTENSIONS` + `BUNDLED_EXTENSION_IDS`), and `pi.extensions` declarations across `packages/*/package.json`.
6. **Turn the gap into a proposal, not a hasty edit.** `openspec new change "add-image-fit-recommended-extension"`, then walk the four artifacts (proposal → design → specs → tasks) via `openspec instructions <stage>`.
7. **Bake the known break into tasks.** Adding the entry breaks the "contains exactly the six expected entries" test — the tasks.md explicitly updates it to seven and preserves the `BUNDLED_EXTENSION_IDS` subset invariant.
8. **`openspec validate` clean, then ship.** Branch off the real base (`develop`, confirmed via `gh repo view`), commit proposal + test-fix together, push, `gh pr create --base develop`.

## 3. How the collaboration unfolded

**Phase A — Reproduce & root-cause (prompts 1).** The AI ran the suite, read the piped
log, and noticed the resize actually completed — the "failure" was a 5328ms run barely
exceeding the 5000ms default timeout on a machine doing real multi-megapixel image
work. *Why it worked:* it refused to "fix" test logic that wasn't wrong and instead
named the true cause (a timing flake) before changing anything.

**Phase B — Surgical fix (prompt 1 cont.).** One edit: `testTimeout: 30000` in the
package's `vitest.config.ts`. 72 tests pass. *Why it worked:* minimum change, matched
the package's legitimate need (it processes 4032×3024 images), no test semantics
touched.

**Phase C — Context discovery (prompts 2–4).** The operator pivoted from "is it
fixed?" to "where does this package sit?" Three short questions — installable?
recommended? any other hidden extensions? — drove the AI to read
`docs/file-index-extension.md`, `docs/faq.md`, the `RECOMMENDED_EXTENSIONS` manifest,
and every `pi.extensions` declaration under `packages/`. *Decision point:* the AI
established that exactly two packages declare `pi.extensions` (the dashboard bridge —
excluded by design — and `pi-image-fit`), so `pi-image-fit` is the *only* first-party
extension genuinely missing from the recommended card.

**Phase D — Proposal authoring (prompts 5–6).** "make proposal for this fixes" → the
AI scaffolded the OpenSpec change and filled all four artifacts, using
`openspec instructions <stage>` to follow the house schema and `openspec validate` to
prove it clean. *Why it worked:* it identified the exact test that would break on the
add (`"contains exactly the six expected entries"`) and wrote a task to update it to
seven, and it deliberately left `BUNDLED_EXTENSION_IDS` untouched to keep the Electron
bundle / SPDX scope unchanged.

**Phase E — Ship (prompt 7).** Confirmed base branch `develop` via
`git symbolic-ref` / `gh repo view` (didn't assume `main`), created
`feat/image-fit-recommended-extension`, committed proposal + test-fix in one commit,
pushed, opened PR #102. *Decision point surfaced to the human:* the AI flagged that it
bundled an unrelated stability fix with a proposal and offered to split them.

## 4. Prompts that worked

- **Goal prompt — "The pi-image-fit bridge tests failed."** Terse but effective *because*
  the AI turned it into a reproduce-then-diagnose loop instead of a blind patch. A
  stronger version bakes that in: *"pi-image-fit tests fail — reproduce, root-cause,
  and apply the smallest fix; don't change test logic unless it's actually wrong."*
- **High-leverage follow-ups — "Is it on recommended extensions?" / "and is there other
  extensions in pi-dashboard which are not presented?"** Two one-line questions that
  converted a bug fix into a real feature gap. They work because they force the AI to
  check a *source of truth* (the manifest) and to generalize (survey all
  `pi.extensions` packages), surfacing that `pi-image-fit` is uniquely un-surfaced.
- **"make proposal for this fixes"** — the unlock from investigation to durable artifact.
  Stronger: *"draft an OpenSpec change to add pi-image-fit to the recommended manifest;
  scope out bundling; update the exact-set test."*
- **"create a branch and PR for the changes"** — clean handoff to shipping. Effective
  because the earlier grounding meant the branch/commit/PR could be produced in one go.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at "tests are green" after the fix | Asking "is the image fit an installable extension?" | State the wider intent up front: "after fixing, tell me where this package sits (installable? recommended?)" |
| Treat the fix as the whole job | Asking "is it on recommended extensions?" then "other extensions not presented?" | Ask for a gap-survey against the source of truth as part of the kickoff |
| Could have hand-edited the manifest immediately | "make proposal for this fixes" | Default repo convention: manifest/behavior changes go through an OpenSpec change, not a raw edit |
| Assume `main` is the base branch | (AI self-corrected by checking `gh repo view`) | State "base is develop" up front, or trust the AI to confirm via git/gh |
| Bundle an unrelated test-fix with a proposal PR | (AI flagged it and offered to split) | Decide split-vs-bundle up front: "keep the test fix on its own PR" if you want clean history |

The recurring guardrail: **verify claims against the code, not memory.** Every "is X
recommended / bundled / an extension" answer was checked against
`recommended-extensions.ts` and `package.json` `pi.extensions` fields before being
asserted.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it leaned on **existing repo
tooling** correctly, which is the reusable lesson:

- **OpenSpec CLI as the change scaffold.** `openspec new change`,
  `openspec instructions <proposal|design|specs|tasks>`, `openspec validate` produced a
  4-artifact change that validates clean. Invoke this whenever a manifest/behavior
  change needs a durable rationale + task list rather than a one-off edit.
- **`tee` + `tail` for test triage.** `npx vitest run 2>&1 | tee /tmp/imgfit-test.log | tail -60`
  captures the full log once and shows the tail — matches the repo's "pipe once, then
  grep" rule and avoids re-running to inspect errors.

*Skill that could be created:* a **"surface a first-party extension in the recommended
manifest"** playbook — grep `pi.extensions` across packages, diff against
`RECOMMENDED_EXTENSIONS`, and (if a gap exists) scaffold the OpenSpec change with the
exact-set-test update pre-written. This session is a clean template for it.

## 7. Pitfalls & dead ends

- **Don't chase a phantom duplicate manifest.** Early commands probed both
  `src/shared/recommended-extensions.ts` and `packages/shared/src/recommended-extensions.ts`
  (three failed commands checking paths). There is a **single** source of truth:
  `packages/shared/src/recommended-extensions.ts`. If you `diff -q` for a `src/shared/`
  copy and it errors, the copy doesn't exist — stop looking.
- **The exact-set test *will* break.** `"contains exactly the six expected entries"`
  asserts the count. Adding an entry fails it — the fix is a deliberate task (update to
  seven), not a surprise. Grep the test before editing the manifest.
- **Timeout ≠ logic bug.** A vitest failure at ~5.3s on image processing is almost
  certainly the 5000ms default timeout, not a broken assertion. Read whether the
  operation *completed* before touching test logic.
- **Don't assume the base branch.** This repo's default is `develop`, not `main`.
  Confirm with `git symbolic-ref refs/remotes/origin/HEAD` or `gh repo view` before
  `gh pr create`.
- **Bundling a test fix with a proposal PR is a reviewer footgun.** It's scoped fine
  here (both image-fit), but decide split-vs-bundle explicitly.

## 8. Reproduce it faster — checklist

- [ ] `npx vitest run 2>&1 | tee /tmp/imgfit-test.log | tail -60` — reproduce, read the real failure.
- [ ] Confirm the op completed; if it's a timeout, add `testTimeout: 30000` to the package `vitest.config.ts`. Re-run for green.
- [ ] `grep` `pi.extensions` across `packages/*/package.json`; read `RECOMMENDED_EXTENSIONS` + `BUNDLED_EXTENSION_IDS` in `packages/shared/src/recommended-extensions.ts` (single source of truth).
- [ ] Identify the gap: a first-party `pi.extensions` package absent from the recommended manifest.
- [ ] `openspec new change "<name>"`; fill proposal → design → specs → tasks via `openspec instructions <stage>`.
- [ ] Task the exact-set test update (six → seven); keep `BUNDLED_EXTENSION_IDS` untouched (subset invariant, no Electron/SPDX impact).
- [ ] `openspec validate "<name>"` → clean.
- [ ] Confirm base branch (`gh repo view`), branch off `develop`, commit, push, `gh pr create --base develop`.

**Inputs to have ready:** repo checked out with OpenSpec CLI available, `gh` authed.
**Artifacts produced:**
`openspec/changes/add-image-fit-recommended-extension/{proposal,design,tasks}.md` +
`specs/pi-image-fit/spec.md`; `packages/image-fit-extension/vitest.config.ts` (test
fix); branch `feat/image-fit-recommended-extension`; PR #102 → `develop`.

---

_Generated from session `019ebda1-f7c1-7e9a-82ad-e6dcf572c729` · `pi-agent-dashboard` · 2026-06-12. Source extract: deterministic facts sheet._
