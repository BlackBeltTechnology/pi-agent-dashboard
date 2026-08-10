---
session: 019e0cfe
week: 2026/W19
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
---

# How we did it: Fix two "pre-existing" CI test failures — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator ran the full CI sequence locally (`npm install → lint → test → build`)
and everything was green **except two test failures** — which they had already
triaged as *pre-existing on HEAD, unrelated to their own commits* (verified by
stashing their changes and re-running). Rather than let them rot, the ask was blunt:
paste the two failures with root cause + owner, then **"Fix them"**.

The real objective: make the two red tests green with the *minimal, correct* fix for
each — one a stale assertion count, one a lint-rule violation — and commit **only**
those two fixes, leaving unrelated working-tree noise untouched.

## 2. TL;DR playbook

1. **Hand the AI the triage, not just the symptom.** Paste each failing test with its
   file, the exact error (`expected length 5, got 6`), the root cause, and the owner.
   End with `Fix them`.
2. Let the AI **read the two failing test files + the code they assert against**
   (`recommended-routes.test.ts`, `compose-lifecycle.ts`, `exec.ts`).
3. **Failure 1 (stale count):** the recommended-extensions list grew by one
   (`pi-memory-honcho`); bump the test's expected length `5 → 6` (and rename the test
   to match).
4. **Failure 2 (lint rule):** swap the raw `import { spawn } from "node:child_process"`
   for the platform-safe wrapper
   `@blackbelt-technology/pi-dashboard-shared/platform/exec.js` (same `spawn` signature
   + `windowsHide: true`).
5. **Confirm the plugin can resolve the shared package** (`grep pi-dashboard-shared
   packages/honcho-plugin/package.json`) before trusting the import.
6. **Run only the two affected specs** with `npx vitest run <file1> <file2>` — and
   re-run under a clean `HOME=$(mktemp -d)` to prove no env leakage. Expect 22/22 pass.
7. **Commit exactly the two files**, explicitly `git add`-ing them by path; leave the
   unrelated openspec + `package-lock.json` churn unstaged.

## 3. How the collaboration unfolded

Four tight phases across ~9 minutes, 15 bash calls, 2 reads, 2 edits — no dead ends.

- **Triage-in → Locate.** Because the goal prompt already carried root cause + owner,
  the AI skipped re-diagnosis and went straight to reading the two test files and the
  code under test (`grep`/`cat` on `recommended-routes.test.ts`,
  `no-direct-child-process.test.ts`, `exec.ts`, `recommended-extensions.ts`). *Why it
  worked:* the human front-loaded the diagnosis, so the AI spent its budget confirming,
  not guessing.
- **Fix 1 — align the count.** Bumped the expected length `5 → 6` and renamed the test
  to reflect the added `pi-memory-honcho` entry. A pure assertion-catch-up, not a
  behavior change.
- **Fix 2 — route through the wrapper.** Replaced the raw `node:child_process` import
  with the shared `platform/exec.js` wrapper. The AI **verified the dependency was
  resolvable** (`grep pi-dashboard-shared` in the plugin's `package.json`) before
  trusting it — the decision point that de-risks a cross-package import.
- **Verify → Commit.** Ran the two specs directly, then again under a scratch `HOME`
  to rule out user-env contamination; 22/22 green. On the human's `Commit changes`, the
  AI staged **only** the two fixed files by explicit path and wrote a scoped
  `fix(tests): …` message — deliberately leaving unrelated changes unstaged.

## 4. Prompts that worked

- **The goal prompt (the effective bit):** it wasn't "tests are failing, help." It was
  a *structured triage table* — per failure: file, exact error, root cause, owner —
  capped with `Fix them`. This is the pattern to reuse: **do the diagnosis yourself,
  hand the AI a fix list.** It collapses the discovery phase and prevents the AI from
  re-litigating whether the failures are "really" the operator's.
- **High-leverage follow-up:** `Commit changes` — two words, but because the working
  state was already clean-and-verified, it unlocked a correctly-scoped commit. Its
  power came from the *prior* setup, not the words.

Weak-prompt rewrite: instead of "fix the failing tests," write
> "Two failing tests, both pre-existing (verified by stashing my changes). (1) `<file>`: `<error>` — cause `<x>`. (2) `<file>`: `<error>` — cause `<y>`. Fix each minimally and commit only those files."

## 5. Steering & corrections (what to watch for)

Light-touch session — the up-front triage did the steering. The guardrails worth
baking in:

| The AI tended to… | The human steered by… | Bake this in next time by… |
|-------------------|-----------------------|----------------------------|
| Potentially stage the whole dirty tree on "commit" | (pre-empted) the AI itself scoped `git add` to two paths | State "commit ONLY the fixed files" up front when the tree has unrelated churn |
| Trust a cross-package import blindly | (self-corrected) grepped the plugin `package.json` for the dep first | Make "verify the dependency resolves before importing it" a standing rule |
| Run the whole `npm test` suite to re-check | narrowed to `npx vitest run <two files>` + clean-`HOME` re-run | Ask for *targeted* spec runs, not the full suite, when the failure set is known |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created — appropriately, this was a routine two-fix job. But
the session encodes two **reusable micro-patterns** worth remembering:

- **Clean-`HOME` re-run** (`HOME=$(mktemp -d) npx vitest run …`): re-runs the specs
  with a throwaway home dir to prove a pass isn't an artifact of the operator's local
  env/config. Invoke whenever a test's result might depend on user state.
- **Explicit-path commit hygiene**: `git add <file1> <file2> && git commit` instead of
  `git add -A`, deliberately leaving unrelated openspec / lockfile changes unstaged.
  Invoke any time the working tree carries changes you didn't author this turn.

If this pattern (fix pre-triaged CI failures → targeted verify → scoped commit) recurs,
a small "surgical-test-fix" skill would be justified.

## 7. Pitfalls & dead ends

- **None hit this session** (0 failed commands) — because the diagnosis arrived with
  the prompt. The *avoided* pitfalls are the lesson:
  - **Don't `git add -A`** when the tree has unrelated changes — you'd bundle openspec
    edits + `package-lock.json` into a "fix(tests)" commit. Stage by explicit path.
  - **Don't assume a shared-package import resolves** — a plugin can lack the workspace
    dep in its `package.json`. `grep` for it first; if missing, the import fails at
    build, not lint.
  - **Don't re-run the whole suite to confirm two fixes** — it's slow and noisy. Run the
    two specs directly.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the exact failing-test output (file + error + root cause),
a clean HEAD baseline to confirm pre-existing-ness, and the path to the shared
platform wrapper (`@blackbelt-technology/pi-dashboard-shared/platform/exec.js`).

- [ ] Paste both failures as a triage list (file · error · cause · owner), end with `Fix them`.
- [ ] Read the two test files + the code they assert against.
- [ ] Stale-count failure → bump the expected length to match the grown list; rename test.
- [ ] Lint-rule failure → replace `node:child_process` import with the shared `platform/exec.js` wrapper.
- [ ] `grep` the plugin `package.json` to confirm the shared dep resolves.
- [ ] `npx vitest run <two specs>`, then re-run under `HOME=$(mktemp -d)`; expect 22/22.
- [ ] `git add <file1> <file2> && git commit -m "fix(tests): …"` — nothing else staged.

**Artifacts produced:**
- `packages/server/src/__tests__/recommended-routes.test.ts` (edited — count `5 → 6`)
- `packages/honcho-plugin/src/server/compose-lifecycle.ts` (edited — wrapper import)
- Commit `6a193c72` — only the two fixes.

---

_Generated from session `019e0cfe` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-09. Source extract: deterministic facts sheet (Honcho test fail fix)._
